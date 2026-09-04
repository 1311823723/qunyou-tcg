import { HAND_IDS, handIsLocked } from "../../auto-engine.mts";
import { choiceValue, selectedCardIds, type CharacterSkillModule, type CharacterSkillRuntimeContext as Context } from "../character-skill.mts";
import type { AutoPrompt } from "../../auto-types";
import type { CardInstance } from "../../types";

export const EXTRA_CHARACTER_IDS = {
  warlock: "char_021_xiaoapan_warlock", rosa: "char_024_weixiaokele_ironclad",
  neo: "char_026_miaosila_neo", undertaker: "char_028_arthur_undertaker",
  luna: "char_029_daidaishou_luna", detective: "char_030_miaosila_detective",
  watcher: "char_031_arthur_watcher", beast: "char_053_xiaoka_zaun-beast",
  weilong: "char_075_baizi_weilong", hackclaw: "char_076_daidaishou_hackclaw",
  shepherd: "char_077_xiaoapan_shepherd", deepBlue: "char_078_huihuan_deep-blue",
  painter: "char_079_xiaoka_visionary-painter", colors: "char_080_huihuan_visionary-painter",
  invisible: "char_099_kabishou_invisible-duck", bomber: "char_100_miaosila_demolitionist",
  dodo: "char_102_miaosila_dodo", snitch: "char_103_zongzi_snitch", celebrity: "char_113_miaosila_celebrity",
} as const;
const play = { event: "play_phase", relation: "source_self" } as const;
function select(context: Context, step: string, title: string, message: string, cards: CardInstance[], min = 1, max = min, playerId?: string, data?: Record<string, unknown>) {
  context.setPrompt(step, { title, message, min, max, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards }, data, playerId);
}
function ids(prompt: AutoPrompt, payload: Record<string, unknown>) {
  const chosen = selectedCardIds(payload);
  if (new Set(chosen).size !== chosen.length || chosen.length < (prompt.min ?? 1) || chosen.length > (prompt.max ?? 1)
    || chosen.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("选牌数量或对象无效。");
  return chosen;
}
function inspectHand(context: Context) {
  context.emitEvent("inspection", { sourcePlayerId: context.player.id, targetPlayerId: context.opponent()?.id, metadata: { inspectionKind: "opponentHand" } });
}
function viewAndTake(context: Context, step: string, title: string) {
  const target = context.opponent();
  if (!target?.hand.length) return;
  inspectHand(context);
  select(context, step, title, "观看对手手牌，选择1张获得。", target.hand);
}
const warlock: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.warlock, trigger: play,
  canActivate: (c) => c.player.hand.length >= 2,
  activate: (c) => select(c, "contract", "暗影契约", "弃置2张手牌；其中有【出刀】则造成2点伤害，否则造成1点。", c.player.hand, 2),
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "contract") return false;
    const cards = c.discardOwnHand(ids(p, value));
    c.clearPrompt(p.id);
    c.damageOpponent(cards.some((card) => card.definitionId === HAND_IDS.strike) ? 2 : 1, { after: "draw-one" });
    return true;
  },
};
const rosa: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.rosa, trigger: play,
  canActivate: (c) => c.player.hand.length > 0 && c.player.markers.filter((m) => m.kind === "cards" && m.label === "藤蔓").reduce((n, m) => n + (m.kind === "cards" ? m.cards.length : 0), 0) < 2,
  activate(c) {
    const count = c.player.markers.reduce((n, m) => n + (m.kind === "cards" && m.label === "藤蔓" ? m.cards.length : 0), 0);
    select(c, "vines", "藤蔓护甲", "选择至多2张手牌作为藤蔓标记。", c.player.hand, 0, Math.min(2 - count, c.player.hand.length));
  },
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "vines") return false;
    c.storeOwnHandCards(ids(p, value), "extra-vine"); c.clearPrompt(p.id); return true;
  },
};
const neo: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.neo, trigger: play,
  canActivate: (c) => c.player.hand.some((a) => c.state.handDiscard.some((b) => b.definitionId === a.definitionId)),
  activate(c) { select(c, "backup-show", "全息备份", "展示1张手牌，回收弃牌区中的同名牌。", c.player.hand.filter((a) => c.state.handDiscard.some((b) => b.definitionId === a.definitionId))); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step === "backup-show") {
      const card = c.player.hand.find((card) => card.instanceId === ids(p, value)[0]);
      if (!card) throw new Error("展示牌已不存在。");
      c.addLog(`${c.player.nickname}展示了${c.handLabel(card)}`, c.player.id);
      select(c, "backup-gain", "全息备份", "选择1张同名牌加入手牌。", c.state.handDiscard.filter((a) => a.definitionId === card.definitionId)); return true;
    }
    if (c.continuation?.step !== "backup-gain") return false;
    c.gainFromHandDiscard(ids(p, value)); c.clearPrompt(p.id); return true;
  },
};
const undertaker: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.undertaker, trigger: { event: "character_retired", relation: "target_opponent" },
  canActivate: (c) => c.player.retired.length > 0,
  activate: (c) => select(c, "bury", "陪葬登记", "选择己方1张退场角色洗回角色牌堆。", c.player.retired),
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "bury") return false;
    if (!c.shuffleOwnRetired(ids(p, value)[0])) throw new Error("角色已不在退场区。");
    c.clearPrompt(p.id); return true;
  },
};
const luna: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.luna, trigger: play, canActivate: (c) => Boolean(c.opponent()?.hand.length),
  activate(c) {
    const card = c.randomOpponentHand(); if (!card) return;
    c.addLog(`${c.opponent()!.nickname}展示了${c.handLabel(card)}`, c.player.id);
    c.addModifier({ kind: "extra-hand-lock", count: 1, targetPlayerId: c.opponent()!.id, copiedDefinitionId: card.definitionId });
  },
};
const detective: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.detective, trigger: play, canActivate: (c) => Boolean(c.opponent()?.hand.length),
  activate(c) { inspectHand(c); select(c, "evidence", "证物搜查", "观看对手所有手牌，选择其中1张令其弃置。", c.opponent()!.hand); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "evidence") return false;
    const [card] = c.discardOpponentHand(ids(p, value)); if (card && c.isActionCard(card.definitionId)) c.draw(1);
    c.clearPrompt(p.id); return true;
  },
};
const watcher: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.watcher, trigger: play, canActivate: (c) => Boolean(c.opponent()?.characterDeck.length),
  activate(c) { select(c, "formation-bottom", "窥阵", "观看对手角色牌堆顶至多2张牌，选择1张置底。", c.opponent()!.characterDeck.slice(-2).reverse()); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "formation-bottom") return false;
    const id = ids(p, value)[0], deck = c.opponent()!.characterDeck;
    const index = deck.findIndex((card) => card.instanceId === id);
    if (index < Math.max(0, deck.length - 2)) throw new Error("角色已不在牌堆顶。");
    deck.unshift(deck.splice(index, 1)[0]); c.clearPrompt(p.id); return true;
  },
};
const beast: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.beast, trigger: { event: "damage_after", relation: "target_opponent" },
  canActivate: (c) => Number(c.event?.amount) > 0,
  activate(c) {
    c.addModifier({ kind: "extra-strike", count: 1, sourceDefinitionId: EXTRA_CHARACTER_IDS.beast });
    if (c.event?.metadata?.desertButcherEnhanced) c.addModifier({ kind: "extra-hunt-strike", count: 1,
      sourceDefinitionId: EXTRA_CHARACTER_IDS.beast, targetSlotIndex: Number(c.state.usageCounters[`turn:${c.state.turnNumber}:${c.player.id}:strike`] || 0) + 1 });
  },
};
const weilong: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.weilong, trigger: play,
  canActivate: (c) => !handIsLocked(c.state, c.player.id, HAND_IDS.strike),
  activate: (c) => c.useVirtualBasic(HAND_IDS.strike, { requiredDodges: 2 }),
};
const hackclaw: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.hackclaw, trigger: play, canActivate: (c) => Boolean(c.opponent()?.hand.length),
  activate(c) { c.setPrompt("declare-action", { title: "信号破译", message: "宣言一种行动牌。", options: Object.values(HAND_IDS).filter((id) => c.isActionCard(id)).map((id) => ({ value: id, label: c.handName(id) })) }); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step === "declare-action") {
      const name = choiceValue(value); if (!p.options?.some((o) => o.value === name)) throw new Error("行动牌宣言无效。");
      c.addLog(`${c.player.nickname}宣言【${c.handName(name)}】`, c.player.id); inspectHand(c);
      const cards = c.opponent()!.hand;
      if (cards.some((card) => card.definitionId === name)) select(c, "decode-gain", "信号破译", "宣言命中，选择对手1张手牌获得。", cards);
      else c.setPrompt("decode-done", { title: "信号破译", message: "没有宣言的牌，仅观看手牌。", selectableCards: cards, options: [{ value: "done", label: "完成观看" }] });
      return true;
    }
    if (c.continuation?.step === "decode-gain") c.gainOpponentHand(ids(p, value)[0]);
    else if (c.continuation?.step !== "decode-done" || choiceValue(value) !== "done") return false;
    c.clearPrompt(p.id); return true;
  },
};
const shepherd: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.shepherd, trigger: play,
  canActivate: (c) => Boolean(c.opponent()?.characterSlots.some((s) => s && "instanceId" in s)),
  activate(c) { c.setPrompt("sonic-rest", { title: "声波震慑", message: "选择对手1张上阵角色休整。", options: c.opponent()!.characterSlots.flatMap((s, i) => s && "instanceId" in s ? [{ value: String(i), label: `对手角色位 ${i + 1}` }] : []) }); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "sonic-rest") return false;
    const slot = choiceValue(value); if (!p.options?.some((o) => o.value === slot)) throw new Error("角色位无效。");
    c.restOpponentCharacter(Number(slot)); c.clearPrompt(p.id); return true;
  },
};
const deepBlue: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.deepBlue, trigger: play, canActivate: (c) => Boolean(c.opponent()?.hand.length),
  activate(c) { const target = c.opponent()!; c.setPrompt("net-choice", { title: "铁网封锁", message: "选择弃置2张手牌，或展示全部手牌并交出1张。", options: [...(target.hand.length >= 2 ? [{ value: "discard", label: "弃置2张手牌" }] : []), { value: "show", label: "展示全部手牌" }] }, {}, target.id); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step === "net-choice") {
      const choice = choiceValue(value), target = c.opponent()!;
      if (!p.options?.some((o) => o.value === choice)) throw new Error("封锁选择无效。");
      if (choice === "discard") select(c, "net-discard", "铁网封锁", "选择2张手牌弃置。", target.hand, 2, 2, target.id);
      else { c.addLog(`${target.nickname}展示了全部手牌：${target.hand.map((card) => c.handLabel(card)).join("、")}`, c.player.id); select(c, "net-gain", "铁网封锁", "选择对手展示的1张牌获得。", target.hand); }
      return true;
    }
    if (c.continuation?.step === "net-discard") c.discardOpponentHand(ids(p, value));
    else if (c.continuation?.step === "net-gain") c.gainOpponentHand(ids(p, value)[0]);
    else return false;
    c.clearPrompt(p.id); return true;
  },
};
function basicOptions(c: Context) {
  const needed = String(c.event?.metadata?.neededDefinitionId || "");
  return [HAND_IDS.strike, HAND_IDS.dodge, HAND_IDS.aid].filter((id) => !handIsLocked(c.state, c.player.id, id)
    && (needed ? needed === id && (id !== HAND_IDS.dodge || c.currentStrikeCanBeDodged()) : id !== HAND_IDS.dodge && c.canUseBasic(id)));
}
const painter: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.painter, trigger: { event: "basic_card_needed", relation: "source_self" },
  canActivate: (c) => c.player.hand.length > 0 && basicOptions(c).length > 0,
  activate(c) { c.setPrompt("paint-basic", { title: "即兴调色", message: "选择要视为使用或打出的基础牌。", options: basicOptions(c).map((id) => ({ value: id, label: c.handName(id) })) }); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step === "paint-basic") {
      const definitionId = choiceValue(value); if (!p.options?.some((o) => o.value === definitionId)) throw new Error("基础牌选择无效。");
      select(c, "paint-discard", "即兴调色", "弃置1张手牌以完成转化。", c.player.hand, 1, 1, undefined, { definitionId }); return true;
    }
    if (c.continuation?.step !== "paint-discard") return false;
    const definitionId = String(c.continuation.data?.definitionId || "");
    c.discardOwnHand(ids(p, value)); c.clearPrompt(p.id);
    if (definitionId === HAND_IDS.dodge) { if (!c.dodgeCurrentStrike()) throw new Error("当前不能闪避。"); }
    else c.useVirtualBasic(definitionId);
    return true;
  },
};
const colors: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.colors, trigger: play,
  activate(c) { c.setPrompt("color-choice", { title: "悲喜三原色", message: "选择一项效果。", options: [{ value: "damage", label: "本回合下一次伤害+1" }, { value: "draw", label: "摸2张手牌" }, ...(c.opponent()?.hand.length ? [{ value: "take", label: "观看并获得对手1张手牌" }] : [])] }); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step === "color-choice") {
      const choice = choiceValue(value); if (!p.options?.some((o) => o.value === choice)) throw new Error("三原色选择无效。");
      if (choice === "take") { viewAndTake(c, "color-take", "悲喜三原色"); return true; }
      if (choice === "draw") c.draw(2); else c.addModifier({ kind: "extra-next-damage", count: 1 });
    } else if (c.continuation?.step === "color-take") c.gainOpponentHand(ids(p, value)[0]);
    else return false;
    c.clearPrompt(p.id); return true;
  },
};
const invisible: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.invisible, trigger: { event: "inspection_before", relation: "target_self" },
  canActivate: (c) => Boolean(c.state.pendingInspection && !c.state.pendingInspection.prevented),
  activate(c) { c.setPrompt("swap-hidden", { title: "无影调包", message: "防止此次观看，是否将被观看角色置底并替换？", options: [{ value: "swap", label: "防止并调包" }, { value: "keep", label: "只防止观看" }] }); },
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "swap-hidden") return false;
    const choice = choiceValue(value); if (!["swap", "keep"].includes(choice)) throw new Error("调包选择无效。");
    c.preventInspection(choice === "swap"); c.clearPrompt(p.id); return true;
  },
};
const bomber: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.bomber, trigger: { event: "character_deployed", relation: "target_opponent" },
  canActivate: (c) => c.event?.metadata?.deploymentPhaseOrdinal === 2 && Boolean(c.opponent()?.characterSlots.some((s) => s && "instanceId" in s && s.instanceId === c.event?.metadata?.characterInstanceId)),
  activate(c) {
    const index = c.opponent()!.characterSlots.findIndex((s) => s && "instanceId" in s && s.instanceId === c.event?.metadata?.characterInstanceId);
    if (index >= 0) c.restOpponentCharacter(index);
  },
};
function discardedThisEvent(c: Context) { const ids = String(c.event?.metadata?.cardInstanceIds || "").split(","); return c.state.handDiscard.filter((card) => ids.includes(card.instanceId)); }
const dodo: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.dodo, trigger: { event: "hand_discarded", relation: "target_self" },
  canActivate: (c) => c.event?.sourcePlayerId === c.opponent()?.id && discardedThisEvent(c).length > 0,
  activate: (c) => select(c, "recover-discard", "反向泄密", "收回此次弃置的1张牌，然后对手摸1张。", discardedThisEvent(c)),
  resolveChoice(c, p, value) { if (c.continuation?.step !== "recover-discard") return false; c.gainFromHandDiscard(ids(p, value)); c.drawOpponent(1); c.clearPrompt(p.id); return true; },
};
const snitch: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.snitch, trigger: { event: "opponent_extra_draw", relation: "target_opponent" },
  canActivate: (c) => Boolean(c.opponent()?.hand.length),
  activate: (c) => select(c, "return-loot", "赃物退回", "选择1张手牌置于共用手牌牌堆底。", c.opponent()!.hand, 1, 1, c.opponent()!.id),
  resolveChoice(c, p, value) {
    if (c.continuation?.step !== "return-loot") return false;
    const id = ids(p, value)[0], target = c.opponent()!, index = target.hand.findIndex((card) => card.instanceId === id);
    if (index < 0) throw new Error("手牌已不存在。");
    c.putHandDeckBottom(target.hand.splice(index, 1)); c.emitEvent("hand_lost", { sourcePlayerId: c.player.id, targetPlayerId: target.id, amount: 1 }); c.clearPrompt(p.id); return true;
  },
};
const celebrity: CharacterSkillModule = {
  cardId: EXTRA_CHARACTER_IDS.celebrity, trigger: play,
  canActivate: (c) => c.player.hand.some((card) => card.definitionId !== HAND_IDS.dodge),
  activate: (c) => select(c, "store-decoy", "舆论替身", "将1张非【闪避】手牌暗置于本体旁，作为备用【闪避】。", c.player.hand.filter((card) => card.definitionId !== HAND_IDS.dodge)),
  resolveChoice(c, p, value) { if (c.continuation?.step !== "store-decoy") return false; c.storeOwnHandCards(ids(p, value), "extra-decoy"); c.clearPrompt(p.id); return true; },
};
export const extraCharacterSkills: CharacterSkillModule[] = [warlock, rosa, neo, undertaker, luna, detective, watcher, beast, weilong, hackclaw, shepherd, deepBlue, painter, colors, invisible, bomber, dodo, snitch, celebrity];
