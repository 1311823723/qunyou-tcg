import characters from "../../../../data/cards/characters.json" with { type: "json" };
import { HAND_IDS } from "../../auto-engine.mts";
import type { AutoPlayerState } from "../../auto-types";
import type { CardInstance } from "../../types";
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
  type CharacterSkillRuntimeContext,
} from "../character-skill.mts";

export const MIZAI_CHARACTER_IDS = {
  spy: "char_036_keke_spy",
  seer: "char_037_keke_seer",
  avenger: "char_038_keke_avenger",
  judge: "char_039_keke_judge",
  detective: "char_040_fengyaojing_detective",
  baiziWatcher: "char_041_baizi_watcher",
  neo: "char_042_xiaoapan_neo",
  falcon: "char_043_baizi_falcon",
  sheriff: "char_044_arthur_sheriff",
  assassin: "char_045_guamao_assassin",
  fengyaojingWatcher: "char_046_fengyaojing_watcher",
  ironclad: "char_047_miaosila_ironclad",
  highPriest: "char_048_xiaoka_high-priest",
  undertaker: "char_049_xiaoapan_undertaker",
  bomber: "char_050_dong_bomber",
  lobbyist: "char_051_baizi_lobbyist",
} as const;

const characterById = new Map(characters.map((card) => [card.id, card]));
const rankPoints = new Map(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map((rank, index) => [rank, index + 1]));

function permutations<T>(items: T[]): T[][] {
  return items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function isRed(card: CardInstance) {
  return card.joker === "big" || ["红桃", "方块"].includes(card.suit || "");
}

function point(card: CardInstance) {
  if (card.joker === "big") return 15;
  if (card.joker === "small") return 14;
  return rankPoints.get(card.rank || "") || 0;
}

function pokerLabel(card: CardInstance) {
  if (card.joker === "big") return "大王";
  if (card.joker === "small") return "小王";
  return `${card.suit || ""}${card.rank || ""}`;
}

function inspect(context: CharacterSkillRuntimeContext, kind: "handDeckTop" | "opponentHand" | "characterRole", characterDefinitionId?: string) {
  context.emitEvent("inspection", {
    sourcePlayerId: context.player.id,
    targetPlayerId: context.opponent()?.id,
    characterDefinitionId,
    metadata: { inspectionKind: kind },
  });
}

function movePindianCard(context: CharacterSkillRuntimeContext, owner: AutoPlayerState, instanceId: string) {
  const index = owner.hand.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) throw new Error("拼点牌已经不在手牌中。");
  const [card] = owner.hand.splice(index, 1);
  card.ownerId = undefined;
  context.state.handDiscard.push(card);
  return card;
}

const spy: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.spy,
  trigger: { event: "preparation", relation: "source_self" },
  activate(context) {
    const opponent = context.opponent();
    const hasStrike = Boolean(opponent?.hand.some((card) => card.definitionId === HAND_IDS.strike));
    inspect(context, "opponentHand");
    context.setPrompt("spy-inspect", {
      title: "洞察",
      message: hasStrike ? "对手手牌中有【出刀】。完成观看后强化你的下一张【出刀】。" : "对手手牌中没有【出刀】。完成观看后获得本回合防护。",
      selectableCards: opponent?.hand || [],
      options: [{ value: "done", label: "完成观看" }],
    }, { hasStrike });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "spy-inspect" || choiceValue(payload) !== "done") return false;
    if (context.continuation.data?.hasStrike === true) context.boostNextStrikeDamage(1);
    else {
      context.addModifier({ kind: "mizai-strike-block", count: 1, sourceDefinitionId: MIZAI_CHARACTER_IDS.spy });
      context.addModifier({ kind: "damage-shield", count: 1, sourceDefinitionId: MIZAI_CHARACTER_IDS.spy });
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};

const seer: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.seer,
  trigger: { event: "prediction_targeted", relation: "source_self" },
  activate(context) {
    const cardInstanceId = String(context.event?.metadata?.cardInstanceId || "");
    if (!cardInstanceId) throw new Error("预言目标牌已经不在结算中。");
    context.setPrompt("seer-declare", {
      title: "预言成真",
      message: "宣言这张牌是否会对对手本体造成伤害。",
      options: [{ value: "damage", label: "会造成伤害" }, { value: "no-damage", label: "不会造成伤害" }],
    }, { cardInstanceId });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "seer-declare") {
      const value = choiceValue(payload);
      if (!['damage', 'no-damage'].includes(value)) throw new Error("预言宣言无效。");
      context.addModifier({
        kind: "mizai-prediction",
        count: 1,
        sourceDefinitionId: MIZAI_CHARACTER_IDS.seer,
        characterInstanceId: context.role.instanceId,
        targetCardInstanceId: String(context.continuation?.data?.cardInstanceId || ""),
        predictedDamage: value === "damage",
      });
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step !== "seer-inspect" || choiceValue(payload) !== "done") return false;
    inspect(context, "opponentHand");
    context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const avenger = immediateCharacterSkill({
  cardId: MIZAI_CHARACTER_IDS.avenger,
  trigger: { event: "damage_after", relation: "source_self" },
  canActivate: (context) => (context.state.usageCounters[`damage-events-dealt:${context.state.turnNumber}:${context.player.id}`] || 0) === 2,
  effect(context) {
    context.addModifier({ kind: "extra-strike", count: 1, sourceDefinitionId: MIZAI_CHARACTER_IDS.avenger });
  },
});

function openJudgeChoice(context: CharacterSkillRuntimeContext, neededDefinitionId: string) {
  const opponent = context.opponent();
  const matching = opponent?.hand.filter((card) => card.definitionId === neededDefinitionId) || [];
  const roles = opponent?.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot ? [{ slot, slotIndex }] : []) || [];
  const options = [
    ...(matching.length ? [{ value: "give", label: `交给对手1张【${context.handName(neededDefinitionId)}】` }] : []),
    ...roles.map(({ slot, slotIndex }) => ({
      value: `rest:${slotIndex}`,
      label: slot.faceDown ? `休整角色位 ${slotIndex + 1}` : `休整【${characterById.get(slot.definitionId)?.name || `角色位 ${slotIndex + 1}`}】`,
    })),
  ];
  if (!options.length) options.push({ value: "fallback", label: "无牌可交且无角色可休整，令对手摸1张" });
  context.setPrompt("judge-opponent", {
    title: "审判",
    message: `对手声明需要【${context.handName(neededDefinitionId)}】，请选择支付方式。`,
    options,
  }, { neededDefinitionId }, opponent?.id);
}

const judge: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.judge,
  trigger: { event: "basic_card_needed", relation: "source_self" },
  activate(context) {
    const needed = String(context.event?.metadata?.neededDefinitionId || "");
    if (needed) return openJudgeChoice(context, needed);
    const options: Array<{ value: string; label: string }> = context.canUseBasic(HAND_IDS.strike)
      ? [{ value: HAND_IDS.strike, label: "声明需要【出刀】" }]
      : [];
    if (context.player.health < context.player.maxHealth) options.push({ value: HAND_IDS.aid, label: "声明需要【急救】" });
    context.setPrompt("judge-declare", { title: "审判", message: "声明1种你需要使用的基础牌。", options });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "judge-declare") {
      const needed = choiceValue(payload);
      if (![HAND_IDS.strike, HAND_IDS.aid].includes(needed as never)) throw new Error("当前不能声明这种基础牌。");
      openJudgeChoice(context, needed);
      return true;
    }
    if (step === "judge-opponent") {
      const value = choiceValue(payload);
      const needed = String(context.continuation?.data?.neededDefinitionId || "");
      if (value === "give") {
        const cards = context.opponent()?.hand.filter((card) => card.definitionId === needed) || [];
        if (!cards.length) throw new Error("已经没有可交出的同名基础牌。");
        context.setPrompt("judge-give", {
          title: "交出基础牌",
          message: `选择1张【${context.handName(needed)}】交给对手并视为由其使用或打出。`,
          min: 1,
          max: 1,
          cardInstanceIds: cards.map((card) => card.instanceId),
          selectableCards: cards,
        }, { neededDefinitionId: needed }, context.opponent()?.id);
        return true;
      }
      if (value.startsWith("rest:")) {
        context.restOpponentCharacter(Number(value.slice(5)));
        context.clearPrompt(prompt.id);
        return true;
      }
      if (value === "fallback") {
        context.draw(1);
        context.clearPrompt(prompt.id);
        return true;
      }
      throw new Error("审判支付选择无效。");
    }
    if (step !== "judge-give") return false;
    const ids = selectedCardIds(payload);
    const needed = String(context.continuation?.data?.neededDefinitionId || "");
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张同名基础牌。");
    context.useOpponentBasic(ids[0], needed);
    context.clearPrompt(prompt.id);
    return true;
  },
};

function openDetectiveReward(context: CharacterSkillRuntimeContext) {
  const opponent = context.opponent();
  const hidden = opponent?.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot && slot.faceDown ? [{ slot, slotIndex }] : []) || [];
  const options = [
    ...(opponent?.hand.length ? [{ value: "hand", label: "观看对手所有手牌" }] : []),
    ...(hidden.length ? [{ value: "role", label: "观看对手1张暗置角色" }] : []),
  ];
  if (!options.length) return false;
  context.setPrompt("detective-reward", { title: "谜案对决", message: "你拼点获胜，选择一项情报奖励。", options });
  return true;
}

const detective: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.detective,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.hand.length > 0,
  activate(context) {
    context.setPrompt("pindian-own", {
      title: "谜案对决",
      message: "选择1张手牌用于拼点。",
      min: 1,
      max: 1,
      cardInstanceIds: context.player.hand.map((card) => card.instanceId),
      selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "pindian-own") {
      const ids = selectedCardIds(payload);
      if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张拼点牌。");
      const opponent = context.opponent();
      if (!opponent?.hand.length) {
        const own = movePindianCard(context, context.player, ids[0]);
        context.addLog(`${context.player.nickname}以${pokerLabel(own)}拼点，对手没有手牌，拼点获胜`, context.player.id, { zone: "handDiscard" });
        if (!openDetectiveReward(context)) context.clearPrompt(prompt.id);
        return true;
      }
      context.setPrompt("pindian-opponent", {
        title: "谜案对决",
        message: "选择1张手牌用于拼点。",
        min: 1,
        max: 1,
        cardInstanceIds: opponent.hand.map((card) => card.instanceId),
        selectableCards: opponent.hand,
      }, { ownCardId: ids[0] }, opponent.id);
      return true;
    }
    if (step === "pindian-opponent") {
      const ids = selectedCardIds(payload);
      const opponent = context.opponent();
      const ownId = String(context.continuation?.data?.ownCardId || "");
      if (!opponent || ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张拼点牌。");
      const own = movePindianCard(context, context.player, ownId);
      const theirs = movePindianCard(context, opponent, ids[0]);
      context.addLog(`${context.player.nickname}以${pokerLabel(own)}与${opponent.nickname}的${pokerLabel(theirs)}拼点`, context.player.id, { zone: "handDiscard" });
      if (point(own) > point(theirs) && openDetectiveReward(context)) return true;
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step === "detective-reward") {
      const value = choiceValue(payload);
      const opponent = context.opponent();
      if (value === "hand") {
        inspect(context, "opponentHand");
        context.setPrompt("detective-hand-done", {
          title: "谜案对决·手牌情报",
          message: "你观看了对手所有手牌。",
          selectableCards: opponent?.hand || [],
          options: [{ value: "done", label: "完成观看" }],
        });
        return true;
      }
      if (value === "role") {
        const options = opponent?.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot && slot.faceDown
          ? [{ value: String(slotIndex), label: `对手角色位 ${slotIndex + 1}` }]
          : []) || [];
        context.setPrompt("detective-role", { title: "谜案对决·角色情报", message: "选择1张暗置角色观看。", options });
        return true;
      }
      throw new Error("拼点奖励选择无效。");
    }
    if (step === "detective-role") {
      const slotIndex = Number(choiceValue(payload));
      const role = context.opponent()?.characterSlots[slotIndex];
      if (!role || !("instanceId" in role) || !role.faceDown) throw new Error("选择的角色已不再暗置。");
      inspect(context, "characterRole", role.definitionId);
      context.setPrompt("detective-role-done", {
        title: "谜案对决·角色情报",
        message: "你观看了这张暗置角色。",
        selectableCards: [role],
        options: [{ value: "done", label: "完成观看" }],
      });
      return true;
    }
    if (!["detective-hand-done", "detective-role-done"].includes(step || "") || choiceValue(payload) !== "done") return false;
    context.clearPrompt(prompt.id);
    return true;
  },
};

const baiziWatcher: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.baiziWatcher,
  trigger: { event: "preparation", relation: "source_self" },
  activate(context) {
    const cards = context.takeTopHandCards(2);
    if (!cards.length) return;
    inspect(context, "handDeckTop");
    if (cards.length === 1 || isRed(cards[0]) === isRed(cards[1])) {
      context.setPrompt("two-color-same", {
        title: "两仪洞见",
        message: "颜色相同，选择1张加入手牌，另一张置于牌堆底。",
        selectableCards: cards,
        options: cards.map((card, index) => ({ value: String(index), label: `获得【${context.handName(card.definitionId)}】${pokerLabel(card)}` })),
      });
      return;
    }
    context.draw(1);
    context.setPrompt("two-color-different", {
      title: "两仪洞见",
      message: "颜色不同。你已摸1张牌，请选择这两张牌放回牌堆顶的顺序。",
      selectableCards: cards,
      options: permutations(cards.map((_, index) => index)).map((order) => ({
        value: order.join(","),
        label: `牌堆顶：${order.map((index) => `【${context.handName(cards[index].definitionId)}】`).join(" → ")}`,
      })),
    });
  },
  resolveChoice(context, prompt, payload) {
    const cards = prompt.selectableCards || [];
    if (context.continuation?.step === "two-color-same") {
      const index = Number(choiceValue(payload));
      if (!cards[index]) throw new Error("两仪洞见选择无效。");
      cards[index].ownerId = context.player.id;
      context.player.hand.push(cards[index]);
      context.putHandDeckBottom(cards.filter((_, candidate) => candidate !== index));
      context.clearPrompt(prompt.id);
      return true;
    }
    if (context.continuation?.step !== "two-color-different") return false;
    const order = choiceValue(payload).split(",").map(Number);
    if (order.length !== cards.length || new Set(order).size !== cards.length || order.some((index) => !cards[index])) throw new Error("牌堆顶顺序无效。");
    context.putHandDeckTop(order.map((index) => cards[index]));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const neo: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.neo,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const cards = context.takeTopHandCards(3);
    if (!cards.length) return;
    inspect(context, "handDeckTop");
    const options = cards.flatMap((take, takeIndex) => permutations(cards.map((_, index) => index).filter((index) => index !== takeIndex)).map((order) => ({
      value: `${takeIndex}|${order.join(",")}`,
      label: `获得【${context.handName(take.definitionId)}】；牌堆顶：${order.map((index) => `【${context.handName(cards[index].definitionId)}】`).join(" → ") || "无"}`,
    })));
    context.setPrompt("neo-top-three", { title: "全息投影", message: "选择1张加入手牌，并安排其余牌的牌堆顶顺序。", selectableCards: cards, options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "neo-top-three") return false;
    const cards = prompt.selectableCards || [];
    const [takeText, orderText = ""] = choiceValue(payload).split("|");
    const take = Number(takeText);
    const order = orderText ? orderText.split(",").map(Number) : [];
    const expected = cards.map((_, index) => index).filter((index) => index !== take).sort();
    if (!cards[take] || JSON.stringify([...order].sort()) !== JSON.stringify(expected)) throw new Error("全息投影选择无效。");
    cards[take].ownerId = context.player.id;
    context.player.hand.push(cards[take]);
    context.putHandDeckTop(order.map((index) => cards[index]));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const falcon: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.falcon,
  trigger: { event: "strike_dodged", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot && slot.faceDown
      ? [{ value: String(slotIndex), label: `对手角色位 ${slotIndex + 1}` }]
      : []) || [];
    context.setPrompt("falcon-role", { title: "俯瞰猎场", message: "选择1张暗置角色观看。", options });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "falcon-role") {
      const slotIndex = Number(choiceValue(payload));
      const role = context.opponent()?.characterSlots[slotIndex];
      if (!role || !("instanceId" in role) || !role.faceDown) throw new Error("选择的角色已不再暗置。");
      inspect(context, "characterRole", role.definitionId);
      context.setPrompt("falcon-done", {
        title: "俯瞰猎场",
        message: characterById.get(role.definitionId)?.mainRole === "强攻" ? "该角色为强攻，完成观看后将其休整。" : "该角色不是强攻。",
        selectableCards: [role],
        options: [{ value: "done", label: "完成观看" }],
      }, { slotIndex, isAggro: characterById.get(role.definitionId)?.mainRole === "强攻" });
      return true;
    }
    if (step !== "falcon-done" || choiceValue(payload) !== "done") return false;
    if (context.continuation?.data?.isAggro === true) context.restOpponentCharacter(Number(context.continuation.data?.slotIndex));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const sheriff: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.sheriff,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const opponent = context.opponent();
    context.setPrompt("sheriff-choice", {
      title: "突击审讯",
      message: "选择展示所有手牌，或弃置1张手牌。",
      options: [
        { value: "show", label: "展示所有手牌" },
        ...(opponent?.hand.length ? [{ value: "discard", label: "弃置1张手牌" }] : []),
      ],
    }, {}, opponent?.id);
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "sheriff-choice") {
      const value = choiceValue(payload);
      const opponent = context.opponent();
      if (value === "show") {
        context.setPrompt("sheriff-show", {
          title: "突击审讯·展示",
          message: "对手展示了所有手牌。",
          selectableCards: opponent?.hand || [],
          options: [{ value: "done", label: "完成查看" }],
        });
        return true;
      }
      if (value === "discard" && opponent?.hand.length) {
        context.setPrompt("sheriff-discard", {
          title: "突击审讯·弃牌",
          message: "选择1张手牌弃置。",
          min: 1,
          max: 1,
          cardInstanceIds: opponent.hand.map((card) => card.instanceId),
          selectableCards: opponent.hand,
        }, {}, opponent.id);
        return true;
      }
      throw new Error("审讯选择无效。");
    }
    if (step === "sheriff-discard") {
      const ids = selectedCardIds(payload);
      if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌弃置。");
      context.discardOpponentHand(ids);
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step !== "sheriff-show" || choiceValue(payload) !== "done") return false;
    context.clearPrompt(prompt.id);
    return true;
  },
};

const assassin: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.assassin,
  trigger: { event: "strike_used", relation: "source_opponent" },
  canActivate: (context) => Boolean(context.opponent()?.hand.length),
  activate(context) {
    const opponent = context.opponent();
    inspect(context, "opponentHand");
    context.setPrompt("assassin-discard", {
      title: "暗杀令",
      message: "观看对手手牌，选择其中1张令其弃置。",
      min: 1,
      max: 1,
      cardInstanceIds: opponent?.hand.map((card) => card.instanceId) || [],
      selectableCards: opponent?.hand || [],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "assassin-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择对手1张手牌。");
    const [card] = context.discardOpponentHand(ids);
    if (card?.definitionId === HAND_IDS.dodge) context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

function topBottomArrangements(cards: CardInstance[], handName: (definitionId: string) => string) {
  const indexes = cards.map((_, index) => index);
  const options: Array<{ value: string; label: string }> = [];
  for (let mask = 0; mask < (1 << cards.length); mask += 1) {
    const top = indexes.filter((index) => (mask & (1 << index)) !== 0);
    const bottom = indexes.filter((index) => !top.includes(index));
    for (const topOrder of permutations(top)) for (const bottomOrder of permutations(bottom)) {
      options.push({
        value: `top:${topOrder.join(",")}|bottom:${bottomOrder.join(",")}`,
        label: `牌顶：${topOrder.map((index) => `【${handName(cards[index].definitionId)}】`).join(" → ") || "无"}；牌底：${bottomOrder.map((index) => `【${handName(cards[index].definitionId)}】`).join(" → ") || "无"}`,
      });
    }
  }
  return options;
}

const fengyaojingWatcher: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.fengyaojingWatcher,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const cards = context.takeTopHandCards(3);
    if (!cards.length) return;
    inspect(context, "handDeckTop");
    context.setPrompt("watcher-arrange", {
      title: "预知",
      message: "将这些牌以任意顺序放回牌堆顶或牌堆底。",
      selectableCards: cards,
      options: topBottomArrangements(cards, context.handName),
    });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "watcher-arrange") {
      const cards = prompt.selectableCards || [];
      const match = choiceValue(payload).match(/^top:([\d,]*)\|bottom:([\d,]*)$/);
      if (!match) throw new Error("预知牌序无效。");
      const parse = (value: string) => value ? value.split(",").map(Number) : [];
      const top = parse(match[1]);
      const bottom = parse(match[2]);
      const all = [...top, ...bottom];
      if (all.length !== cards.length || new Set(all).size !== cards.length || all.some((index) => !cards[index])) throw new Error("预知牌序不完整。");
      context.putHandDeckTop(top.map((index) => cards[index]));
      context.putHandDeckBottom(bottom.map((index) => cards[index]));
      const hidden = context.opponent()?.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot && slot.faceDown
        ? [{ value: String(slotIndex), label: `对手角色位 ${slotIndex + 1}` }]
        : []) || [];
      if (bottom.length >= 2 && hidden.length) {
        context.setPrompt("watcher-role", { title: "预知·额外情报", message: "你将至少2张牌置于牌堆底，选择1张暗置角色观看。", options: hidden });
      } else context.clearPrompt(prompt.id);
      return true;
    }
    if (step === "watcher-role") {
      const slotIndex = Number(choiceValue(payload));
      const role = context.opponent()?.characterSlots[slotIndex];
      if (!role || !("instanceId" in role) || !role.faceDown) throw new Error("选择的角色已不再暗置。");
      inspect(context, "characterRole", role.definitionId);
      context.setPrompt("watcher-role-done", {
        title: "预知·额外情报",
        message: "你观看了这张暗置角色。",
        selectableCards: [role],
        options: [{ value: "done", label: "完成观看" }],
      });
      return true;
    }
    if (step !== "watcher-role-done" || choiceValue(payload) !== "done") return false;
    context.clearPrompt(prompt.id);
    return true;
  },
};

const ironclad: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.ironclad,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.hand.length > 0,
  activate(context) {
    context.setPrompt("ironclad-discard", {
      title: "蓄力一击",
      message: "弃置1张手牌，强化本回合下一张【出刀】。",
      min: 1,
      max: 1,
      cardInstanceIds: context.player.hand.map((card) => card.instanceId),
      selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "ironclad-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌弃置。");
    context.discardOwnHand(ids);
    context.boostNextStrikeDamage(1);
    context.addModifier({ kind: "mizai-next-strike-undodgeable", count: 1, sourceDefinitionId: MIZAI_CHARACTER_IDS.ironclad });
    context.clearPrompt(prompt.id);
    return true;
  },
};

const highPriest: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.highPriest,
  trigger: { event: "strike_targeted", relation: "target_self" },
  activate(context) {
    const opponent = context.opponent();
    inspect(context, "opponentHand");
    context.setPrompt("priest-inspect", {
      title: "神佑",
      message: "观看对手手牌，然后摸1张牌。",
      selectableCards: opponent?.hand || [],
      options: [{ value: "done", label: "完成观看并摸牌" }],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "priest-inspect" || choiceValue(payload) !== "done") return false;
    context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const undertaker = immediateCharacterSkill({
  cardId: MIZAI_CHARACTER_IDS.undertaker,
  trigger: { event: "character_retired", relation: "any" },
  effect(context) {
    context.draw(context.event?.targetPlayerId === context.player.id ? 2 : 1);
  },
});

const bomber = immediateCharacterSkill({
  cardId: MIZAI_CHARACTER_IDS.bomber,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    while (context.opponent()?.hand.length) {
      const [card] = context.discardRandomOpponent(1);
      if (!card || isRed(card)) break;
    }
    context.damageOpponent(1);
  },
});

const lobbyist: CharacterSkillModule = {
  cardId: MIZAI_CHARACTER_IDS.lobbyist,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const opponent = context.opponent();
    context.setPrompt("lobbyist-choice", {
      title: "筹码交易",
      message: "选择令技能发动者随机获得你1张手牌，或令其摸1张牌。",
      options: [
        ...(opponent?.hand.length ? [{ value: "give", label: "令其获得我1张手牌" }] : []),
        { value: "draw", label: "令其摸1张手牌" },
      ],
    }, {}, opponent?.id);
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "lobbyist-choice") return false;
    const value = choiceValue(payload);
    if (value === "give") {
      const card = context.gainRandomOpponentHand();
      if (!card) throw new Error("对手已经没有可获得的手牌。");
    } else if (value === "draw") context.draw(1);
    else throw new Error("筹码交易选择无效。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const mizaiCharacterSkills = [
  spy,
  seer,
  avenger,
  judge,
  detective,
  baiziWatcher,
  neo,
  falcon,
  sheriff,
  assassin,
  fengyaojingWatcher,
  ironclad,
  highPriest,
  undertaker,
  bomber,
  lobbyist,
] satisfies CharacterSkillModule[];
