import { HAND_IDS } from "../../auto-engine.mts";
import type { CardInstance } from "../../types";
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
  type CharacterSkillRuntimeContext,
} from "../character-skill.mts";

export const COMBO_CHARACTER_IDS = {
  prophet: "char_054_xiangcai_prophet",
  watcherSearch: "char_056_huihuan_watcher",
  silentHunterRecycle: "char_057_guamao_silent-hunter",
  politician: "char_058_xiangcai_politician",
  justice: "char_059_dong_justice",
  defect: "char_060_linglong_defect-robot",
  watcherRecycle: "char_061_xiangcai_watcher",
  morphling: "char_062_guamao_morphling",
  assassin: "char_063_dong_assassin",
  pelican: "char_064_huihuan_pelican",
  highPriest: "char_065_dong_high-priest",
  ninja: "char_066_linglong_ninja",
  neo: "char_067_xiangcai_neo",
  birdEater: "char_068_huihuan_bird-eater",
  sheriff: "char_069_dong_sheriff",
  silentHunterControl: "char_070_huihuan_silent-hunter",
} as const;

function permutations<T>(items: T[]): T[][] {
  return items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function parseIndexes(value: string, count: number) {
  const [topText = "", bottomText = ""] = value.split("|");
  const parse = (text: string) => text.trim() ? text.trim().split(/[,\uff0c\s]+/).map(Number) : [];
  const top = parse(topText);
  const bottom = parse(bottomText);
  const all = [...top, ...bottom];
  if (all.length !== count || new Set(all).size !== count || all.some((index) => !Number.isInteger(index) || index < 1 || index > count)) {
    throw new Error("牌堆顺序必须恰好包含每张牌的编号。");
  }
  return { top: top.map((index) => index - 1), bottom: bottom.map((index) => index - 1) };
}

function finishTopCards(context: CharacterSkillRuntimeContext, cards: CardInstance[], top: number[], bottom: number[]) {
  context.putHandDeckTop(top.map((index) => cards[index]));
  context.putHandDeckBottom(bottom.map((index) => cards[index]));
}

const prophet: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.prophet,
  trigger: { event: "preparation", relation: "source_self" },
  activate(context) {
    const count = context.player.body?.definitionId === "body_combo_001" ? 5 : 3;
    const cards = context.takeTopHandCards(count);
    if (!cards.length) return;
    context.setPrompt("prophet-order", {
      title: "鱼群预演",
      message: "输入牌堆顶与牌堆底的顺序，用 | 分隔。例如 1,3 | 2,4。",
      cardInstanceIds: cards.map((card) => card.instanceId),
      selectableCards: cards,
    }, { cardIds: cards.map((card) => card.instanceId) });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "prophet-order") return false;
    const cards = prompt.selectableCards || [];
    const { top, bottom } = parseIndexes(choiceValue(payload), cards.length);
    finishTopCards(context, cards, top, bottom);
    context.clearPrompt(prompt.id);
    context.addLog(`${context.player.nickname}重新安排了共用手牌牌堆顶 ${cards.length} 张牌`, context.player.id, { zone: "handDeck" });
    return true;
  },
};

const watcherSearch: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.watcherSearch,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const cards = context.takeTopHandCards(3);
    if (!cards.length) return;
    const actionIndexes = cards.flatMap((card, index) => context.isActionCard(card.definitionId) ? [index] : []);
    const options = actionIndexes.flatMap((take) => permutations(cards.map((_, index) => index).filter((index) => index !== take)).map((order) => ({
      value: `take:${take}|bottom:${order.join(",")}`,
      label: `获得【${context.handName(cards[take].definitionId)}】；其余置底：${order.map((index) => context.handName(cards[index].definitionId)).join(" → ")}`,
    })));
    if (!options.length) options.push(...permutations(cards.map((_, index) => index)).map((order) => ({
      value: `take:-1|bottom:${order.join(",")}`,
      label: `无行动牌，全部置底：${order.map((index) => context.handName(cards[index].definitionId)).join(" → ")}`,
    })));
    context.setPrompt("watcher-search", { title: "深水观测", message: "选择1张行动牌加入手牌，并安排其余牌的置底顺序。", selectableCards: cards, options }, { cardIds: cards.map((card) => card.instanceId) });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "watcher-search") return false;
    const cards = prompt.selectableCards || [];
    const match = choiceValue(payload).match(/^take:(-?\d+)\|bottom:([\d,]*)$/);
    if (!match) throw new Error("观测选择无效。");
    const take = Number(match[1]);
    const order = match[2] ? match[2].split(",").map(Number) : [];
    const expected = cards.map((_, index) => index).filter((index) => index !== take).sort();
    if (JSON.stringify([...order].sort()) !== JSON.stringify(expected)) throw new Error("置底顺序不完整。");
    if (take >= 0) {
      if (!cards[take] || !context.isActionCard(cards[take].definitionId)) throw new Error("只能获得行动牌。");
      cards[take].ownerId = context.player.id;
      context.player.hand.push(cards[take]);
    }
    context.putHandDeckBottom(order.map((index) => cards[index]));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const silentHunterRecycle: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.silentHunterRecycle,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => context.state.handDiscard.some((card) => context.isActionCard(card.definitionId)),
  activate(context) {
    const cards = context.state.handDiscard.filter((card) => context.isActionCard(card.definitionId));
    context.setPrompt("gain-discard-action", { title: "静默回收", message: "选择1张行动牌加入手牌。", min: 1, max: 1, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "gain-discard-action") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张行动牌。");
    context.gainFromHandDiscard(ids);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const politician = immediateCharacterSkill({
  cardId: COMBO_CHARACTER_IDS.politician,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    context.addModifier({ kind: "combo-next-action-draw", count: 1, sourceDefinitionId: COMBO_CHARACTER_IDS.politician });
  },
});

const justice: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.justice,
  trigger: { event: "action_resolved", relation: "source_self" },
  canActivate: (context) => context.event?.metadata?.causedDamage !== true,
  activate(context) {
    const cards = context.takeTopHandCards(1);
    if (!cards.length) return;
    context.setPrompt("justice-top", { title: "无伤复盘", message: "观看牌堆顶1张牌，将其弃置或放回牌堆顶。", selectableCards: cards, options: [{ value: "discard", label: "置入弃牌区" }, { value: "top", label: "放回牌堆顶" }] }, { cardIds: cards.map((card) => card.instanceId) });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "justice-top") return false;
    const [card] = prompt.selectableCards || [];
    const value = choiceValue(payload);
    if (!card || !["discard", "top"].includes(value)) throw new Error("复盘选择无效。");
    if (value === "top") context.putHandDeckTop([card]);
    else { card.ownerId = undefined; context.state.handDiscard.push(card); }
    context.clearPrompt(prompt.id);
    return true;
  },
};

const defect: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.defect,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => context.markerCount("充能球") < 3 || context.markerCount("充能球") > 0,
  activate(context) {
    const count = context.markerCount("充能球");
    const options = [];
    if (count < 3) options.push({ value: "charge", label: "放置1枚充能球" });
    if (count > 0) options.push({ value: "discharge", label: "移去1枚充能球，准备闪电" });
    context.setPrompt("defect-choice", { title: "闪电充能球", message: `当前充能球：${count}/3`, options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "defect-choice") return false;
    const value = choiceValue(payload);
    if (value === "charge") context.addCounterMarker("充能球", 1);
    else if (value === "discharge") {
      if (!context.removeCounterMarker("充能球", 1)) throw new Error("没有可移去的充能球。");
      context.addModifier({ kind: "combo-next-other-skill-damage", count: 1, sourceDefinitionId: COMBO_CHARACTER_IDS.defect, characterInstanceId: context.role.instanceId });
    } else throw new Error("充能球选择无效。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

const watcherRecycle: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.watcherRecycle,
  trigger: { event: "action_resolved", relation: "source_self" },
  canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceId && context.state.handDiscard.some((card) => card.instanceId === context.event?.metadata?.cardInstanceId)),
  activate(context) {
    const id = String(context.event?.metadata?.cardInstanceId || "");
    const index = context.state.handDiscard.findIndex((card) => card.instanceId === id);
    if (index < 0) return;
    const [card] = context.state.handDiscard.splice(index, 1);
    context.putHandDeckBottom([card]);
    context.draw(1);
  },
};

const morphling: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.morphling,
  trigger: { event: "action_resolved", relation: "source_self" },
  canActivate: (context) => Boolean(context.event?.cardDefinitionId && context.isActionCard(context.event.cardDefinitionId)),
  activate(context) {
    const definitionId = context.event?.cardDefinitionId || "";
    if (!context.copyActionEffect(definitionId)) context.addLog(`${context.player.nickname}复制的【${context.handName(definitionId)}】已无合法结算对象`, context.player.id, { zone: "resolving" });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    const value = choiceValue(payload);
    const definitionId = String(context.continuation?.data?.copiedDefinitionId || "");
    if (step === "copy-target") {
      const slotIndex = Number(value);
      if (!Number.isInteger(slotIndex)) throw new Error("复制目标无效。");
      context.clearPrompt(prompt.id);
      if (!context.copyActionEffect(definitionId, slotIndex)) throw new Error("复制目标已不合法。");
      return true;
    }
    if (step === "copy-crisis-choice") {
      const slotIndex = Number(context.continuation?.data?.targetSlotIndex);
      if (value === "rest") context.restOpponentCharacter(slotIndex);
      else if (value === "damage") context.damageOpponent(1);
      else throw new Error("危机破坏复制选择无效。");
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step === "copy-inspect-choice") {
      const slotIndex = Number(context.continuation?.data?.targetSlotIndex);
      const opponent = context.opponent();
      const role = opponent?.characterSlots[slotIndex];
      if (!role || !("instanceId" in role) || !role.faceDown) throw new Error("被观看的角色已不是暗置状态。");
      if (value === "reveal") role.faceDown = false;
      else if (value !== "keep") throw new Error("看破复制选择无效。");
      context.emitEvent("inspection", { sourcePlayerId: context.player.id, targetPlayerId: opponent.id, characterDefinitionId: role.definitionId });
      context.clearPrompt(prompt.id);
      return true;
    }
    return false;
  },
};

const assassin = immediateCharacterSkill({
  cardId: COMBO_CHARACTER_IDS.assassin,
  trigger: { event: "action_resolved", relation: "source_opponent" },
  effect: (context) => { context.damageOpponent(1); },
});

const pelican: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.pelican,
  trigger: { event: "action_used", relation: "source_opponent" },
  canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && !item.cancelled && context.isActionCard(item.definitionId)),
  activate(context) {
    const target = [...context.state.stack].reverse().find((item) => item.kind === "hand" && !item.cancelled && context.isActionCard(item.definitionId));
    if (!target || target.kind !== "hand") throw new Error("当前没有可无效的行动牌。");
    if (!context.counterCurrentHand()) throw new Error("当前没有可无效的行动牌。");
    context.addModifier({
      kind: "combo-counter-action-draw",
      count: 1,
      sourceDefinitionId: COMBO_CHARACTER_IDS.pelican,
      targetCardInstanceId: target.card.instanceId,
    });
  },
};

const highPriest = immediateCharacterSkill({
  cardId: COMBO_CHARACTER_IDS.highPriest,
  trigger: { event: "action_resolved", relation: "target_self" },
  canActivate: (context) => context.event?.metadata?.causedDamage !== true,
  effect: (context) => { context.heal(1); },
});

const ninja = immediateCharacterSkill({
  cardId: COMBO_CHARACTER_IDS.ninja,
  trigger: { event: "card_responded", relation: "source_opponent" },
  canActivate: (context) => context.state.phase === "play" && context.state.currentPlayerId === context.player.id,
  effect(context) {
    context.addModifier({ kind: "extra-strike", count: 1, sourceDefinitionId: COMBO_CHARACTER_IDS.ninja });
  },
});

const neo: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.neo,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.hand.some((card) => context.isActionCard(card.definitionId)),
  activate(context) {
    const cards = context.player.hand.filter((card) => context.isActionCard(card.definitionId));
    context.setPrompt("neo-reveal", { title: "行动展示", message: "选择1张行动牌展示，然后摸1张牌。", min: 1, max: 1, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "neo-reveal") return false;
    const ids = selectedCardIds(payload);
    const card = context.player.hand.find((candidate) => candidate.instanceId === ids[0]);
    if (ids.length !== 1 || !card || !prompt.cardInstanceIds?.includes(card.instanceId)) throw new Error("请选择1张行动牌展示。");
    context.addLog(`${context.player.nickname}展示了【${context.handName(card.definitionId)}】`, context.player.id, { zone: "hand", ownerId: context.player.id });
    context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const birdEater: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.birdEater,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.state.handDiscard.some((card) => context.isActionCard(card.definitionId)),
  activate(context) {
    const cards = context.state.handDiscard.filter((card) => context.isActionCard(card.definitionId));
    context.setPrompt("bird-eater-shuffle", { title: "弃牌再编", message: "选择至多2张行动牌洗回牌堆，然后摸等量牌。", min: 0, max: Math.min(2, cards.length), cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards, options: [{ value: "none", label: "不选择牌" }] });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "bird-eater-shuffle") return false;
    const ids = choiceValue(payload) === "none" ? [] : selectedCardIds(payload);
    if (ids.length > Number(prompt.max || 0) || new Set(ids).size !== ids.length || ids.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("洗回牌的选择无效。");
    context.shuffleFromHandDiscard(ids);
    context.draw(ids.length);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const sheriff: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.sheriff,
  trigger: { event: "opponent_preparation", relation: "source_opponent" },
  activate(context) {
    context.setPrompt("sheriff-declare", { title: "类型宣言", message: "宣言基础牌或行动牌。", options: [{ value: "basic", label: "基础牌" }, { value: "action", label: "行动牌" }] });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "sheriff-declare") return false;
    const value = choiceValue(payload) as "basic" | "action";
    if (!["basic", "action"].includes(value)) throw new Error("宣言类型无效。");
    context.addModifier({ kind: "combo-declare-hand-type", count: 1, declaredHandType: value, targetPlayerId: context.opponent()?.id, sourceDefinitionId: COMBO_CHARACTER_IDS.sheriff });
    context.addLog(`${context.player.nickname}宣言了${value === "basic" ? "基础牌" : "行动牌"}`, context.player.id, { zone: "resolving" });
    context.clearPrompt(prompt.id);
    return true;
  },
};

const silentHunterControl: CharacterSkillModule = {
  cardId: COMBO_CHARACTER_IDS.silentHunterControl,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    context.addModifier({ kind: "combo-direct-disrupt", count: 1, sourceDefinitionId: COMBO_CHARACTER_IDS.silentHunterControl, characterInstanceId: context.role.instanceId });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "direct-disrupt") return false;
    const ids = selectedCardIds(payload);
    const opponent = context.opponent();
    const index = opponent?.hand.findIndex((card) => card.instanceId === ids[0]) ?? -1;
    if (ids.length !== 1 || !opponent || index < 0 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择对手1张手牌。");
    const [card] = opponent.hand.splice(index, 1);
    if (context.continuation.data?.operation === "steal") {
      card.ownerId = context.player.id;
      context.player.hand.push(card);
      context.addLog(`${context.player.nickname}指定获得了对手1张手牌`, context.player.id, { zone: "hand", ownerId: opponent.id });
    } else {
      card.ownerId = undefined;
      context.state.handDiscard.push(card);
      context.emitEvent("hand_discarded", { sourcePlayerId: context.player.id, targetPlayerId: opponent.id, amount: 1 });
      context.addLog(`${context.player.nickname}指定弃置了对手的【${context.handName(card.definitionId)}】`, context.player.id, { zone: "handDiscard" });
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const comboCharacterSkills = [
  prophet,
  watcherSearch,
  silentHunterRecycle,
  politician,
  justice,
  defect,
  watcherRecycle,
  morphling,
  assassin,
  pelican,
  highPriest,
  ninja,
  neo,
  birdEater,
  sheriff,
  silentHunterControl,
] satisfies CharacterSkillModule[];
