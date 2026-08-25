import assert from "node:assert/strict";
import test from "node:test";
import {
  BODY_IDS,
  bodyProgressDelta,
  triggerKindForBody,
} from "../../worker/src/body-automation.mts";
import {
  bodySkillForId,
  extraStrikeAllowance,
  registeredBodySkillIds,
} from "../../worker/src/skills/body-registry.mts";

function player(definitionId, flipped = false, id = "p1") {
  return {
    id,
    nickname: id,
    body: { instanceId: `${id}-body`, definitionId, kind: "body", ownerId: id },
    bodyState: { progress: 0, progressMax: 6, flipped, extraFormUsed: false, trackedCharacterInstanceIds: [] },
    hand: [],
  };
}

function event(type, extra = {}) {
  return { id: "event", type, turnNumber: 1, ...extra };
}

function runtime(owner, opponent = player(BODY_IDS.defense)) {
  const state = {
    turnNumber: 1,
    currentPlayerId: owner.id,
    phase: "play",
    usageCounters: {},
    pendingBodyTriggers: [],
    handDeck: [],
    handDiscard: [],
  };
  let prompt;
  let drawn = 0;
  let startedStrike;
  const key = (scope, suffix) => `body:${scope}:${scope === "turn" ? `${state.turnNumber}:` : ""}${owner.id}:${suffix}`;
  const context = {
    state,
    player: owner,
    opponent: () => opponent,
    skillName: (extra = false) => extra ? "强化技能" : "本体技能",
    usage: (scope, suffix) => state.usageCounters[key(scope, suffix)] || 0,
    incrementUsage: (scope, suffix, amount = 1) => {
      const usageKey = key(scope, suffix);
      state.usageCounters[usageKey] = (state.usageCounters[usageKey] || 0) + amount;
      return state.usageCounters[usageKey];
    },
    enqueueTrigger: (kind, eventId, triggerContext) => state.pendingBodyTriggers.push({ id: "queued", kind, playerId: owner.id, eventId, context: triggerContext }),
    setPrompt: (value) => { prompt = { id: "prompt", ...value }; },
    clearPrompt: () => { prompt = undefined; },
    draw: (count) => { drawn += count; return count; },
    takeTopHandCards: (count) => Array.from({ length: count }, () => state.handDeck.pop()).filter(Boolean),
    discardHandCard: (target, instanceId) => {
      const index = target.hand.findIndex((card) => card.instanceId === instanceId);
      if (index < 0) return undefined;
      const [card] = target.hand.splice(index, 1);
      card.ownerId = undefined;
      state.handDiscard.push(card);
      return card;
    },
    gainHandCard: (card) => { card.ownerId = owner.id; owner.hand.push(card); },
    discardLooseCard: (card) => { card.ownerId = undefined; state.handDiscard.push(card); },
    handName: (definitionId) => definitionId,
    addLog: () => {},
    emitEvent: () => {},
    legalStrikeCards: () => owner.hand.filter((card) => ["hand_basic_001", "hand_basic_004"].includes(card.definitionId)),
    startBodyStrike: (targetPlayerId, cardInstanceId) => { startedStrike = { targetPlayerId, cardInstanceId }; },
  };
  return { context, getPrompt: () => prompt, getDrawn: () => drawn, getStartedStrike: () => startedStrike };
}

test("首批三张本体由技能注册表管理", () => {
  assert.deepEqual(registeredBodySkillIds(), [BODY_IDS.aggro, BODY_IDS.mizai, BODY_IDS.combo]);
  assert.equal(bodyProgressDelta(player(BODY_IDS.aggro), event("damage_after", { sourcePlayerId: "p1", amount: 1 })), 0, "兼容层不应再处理已迁移本体");
});

test("爆杀本体按伤害点数累计进度，Mega 提供两次额外出刀", () => {
  const front = player(BODY_IDS.aggro);
  const mega = player(BODY_IDS.aggro, true);
  const dealt = event("damage_after", { sourcePlayerId: "p1", targetPlayerId: "p2", amount: 2 });
  const skill = bodySkillForId(BODY_IDS.aggro);
  const { context, getPrompt, getDrawn } = runtime(front);
  assert.equal(skill.progressDelta(front, dealt), 2);
  assert.equal(skill.collectTrigger(context, dealt).kind, "aggro-draw");
  assert.equal(skill.collectTrigger(context, { ...dealt, id: "second" }), undefined, "每回合只收集首次伤害触发");
  assert.equal(extraStrikeAllowance(front), 1);
  assert.equal(extraStrikeAllowance(mega), 2);
  assert.equal(skill.openPrompt(context, { id: "trigger", kind: "aggro-draw", playerId: front.id, eventId: dealt.id }), true);
  skill.resolveChoice(context, getPrompt(), { value: "draw" });
  assert.equal(getDrawn(), 1);
});

test("爆杀 Mega 在结束阶段建立可恢复的出刀选择", () => {
  const owner = player(BODY_IDS.aggro, true);
  owner.hand = [{ instanceId: "strike", definitionId: "hand_basic_001", kind: "hand", ownerId: owner.id }];
  const skill = bodySkillForId(BODY_IDS.aggro);
  const { context, getPrompt, getStartedStrike } = runtime(owner);
  context.state.currentPlayerId = "p2";
  context.state.phase = "end";
  skill.onPhaseEntered(context, "end", owner);
  const trigger = context.state.pendingBodyTriggers[0];
  assert.equal(trigger.kind, "aggro-mega-end-strike");
  assert.equal(skill.openPrompt(context, trigger), true);
  skill.resolveChoice(context, getPrompt(), { cardInstanceIds: ["strike"] });
  assert.deepEqual(getStartedStrike(), { targetPlayerId: "p2", cardInstanceId: "strike" });
});

test("密裁只计入共用手牌堆顶或对手手牌的有效观看", () => {
  const owner = player(BODY_IDS.mizai);
  const skill = bodySkillForId(BODY_IDS.mizai);
  const { context, getPrompt } = runtime(owner);
  const valid = event("inspection", { sourcePlayerId: "p1", metadata: { inspectionKind: "opponentHand" } });
  const invalid = event("inspection", { sourcePlayerId: "p1", metadata: { inspectionKind: "characterRole" } });
  assert.equal(skill.progressDelta(owner, valid), 1);
  assert.equal(skill.collectTrigger(context, valid).kind, "mizai-inspection");
  assert.equal(skill.progressDelta(owner, invalid), 0);
  assert.equal(skill.collectTrigger(context, invalid), undefined);
  assert.equal(skill.openPrompt(context, { id: "trigger", kind: "mizai-inspection", playerId: owner.id, eventId: valid.id }), true);
  assert.deepEqual(getPrompt().options.map((option) => option.value), ["draw", "pass"]);
});

test("密裁弃牌分支由模块验证并移动对手手牌", () => {
  const owner = player(BODY_IDS.mizai);
  const opponent = player(BODY_IDS.defense, false, "p2");
  opponent.hand = [{ instanceId: "target-card", definitionId: "hand_basic_001", kind: "hand", ownerId: "p2" }];
  const skill = bodySkillForId(BODY_IDS.mizai);
  const { context, getPrompt } = runtime(owner, opponent);
  const trigger = { id: "trigger", kind: "mizai-inspection", playerId: owner.id, eventId: "inspection" };
  assert.equal(skill.openPrompt(context, trigger), true);
  skill.resolveChoice(context, getPrompt(), { value: "discard" });
  const discardPrompt = getPrompt();
  assert.equal(discardPrompt.context.action, "mizai-discard");
  skill.resolveChoice(context, discardPrompt, { cardInstanceIds: ["target-card"] });
  assert.equal(opponent.hand.length, 0);
  assert.equal(context.state.handDiscard[0].instanceId, "target-card");
  assert.equal(context.usage("turn", "mizai"), 1);
});

test("行动本体已迁移，拟态和调度仍由兼容层处理", () => {
  const action = event("card_used", { sourcePlayerId: "p1", metadata: { actionCard: true } });
  const combo = player(BODY_IDS.combo);
  const comboSkill = bodySkillForId(BODY_IDS.combo);
  assert.equal(comboSkill.progressDelta(combo, action), 1);
  assert.equal(comboSkill.collectTrigger(runtime(combo).context, event("card_resolved", { sourcePlayerId: "p1", metadata: { actionCard: true } })).kind, "combo-action");
  const virtual = event("skill_used", { sourcePlayerId: "p1", metadata: { virtualCard: true } });
  assert.equal(bodyProgressDelta(player(BODY_IDS.trans), virtual), 1);
  const reveal = event("character_revealed", { sourcePlayerId: "p2", targetPlayerId: "p2" });
  assert.equal(bodyProgressDelta(player(BODY_IDS.dispatch), reveal), 1);
  assert.equal(triggerKindForBody(player(BODY_IDS.dispatch), reveal), "dispatch-reveal");
});

test("行动 Mega 的牌堆顶选择保留真实卡例归属", () => {
  const owner = player(BODY_IDS.combo, true);
  const skill = bodySkillForId(BODY_IDS.combo);
  const { context, getPrompt } = runtime(owner);
  context.state.handDeck = [
    { instanceId: "bottom", definitionId: "hand_basic_001", kind: "hand" },
    { instanceId: "top", definitionId: "hand_basic_002", kind: "hand" },
  ];
  assert.equal(skill.openPrompt(context, { id: "trigger", kind: "combo-action", playerId: owner.id, eventId: "resolved" }), true);
  skill.resolveChoice(context, getPrompt(), { cardInstanceIds: ["top"] });
  assert.equal(owner.hand[0].instanceId, "top");
  assert.equal(owner.hand[0].ownerId, owner.id);
  assert.equal(context.state.handDiscard[0].instanceId, "bottom");
  assert.equal(context.state.handDiscard[0].ownerId, undefined);
});

test("卖血和伏击本体只计入自己的专属结算", () => {
  const judgment = event("judgment_resolved", { sourcePlayerId: "p1", metadata: { bodySkill: true } });
  assert.equal(bodyProgressDelta(player(BODY_IDS.blood), judgment), 1);
  const ambush = event("skill_used", { sourcePlayerId: "p1", metadata: { mainRole: "伏击", leftFieldForCost: true } });
  assert.equal(bodyProgressDelta(player(BODY_IDS.ambush), ambush), 1);
  assert.equal(triggerKindForBody(player(BODY_IDS.ambush), ambush), "ambush-refill");
});

test("防御本体只计入闪避或己方对自己的防伤", () => {
  const owner = player(BODY_IDS.defense);
  const dodge = event("strike_dodged", { sourcePlayerId: "p1", targetPlayerId: "p2" });
  const ownPrevention = event("damage_prevented", { sourcePlayerId: "p1", targetPlayerId: "p1", amount: 1 });
  const opponentPrevention = event("damage_prevented", { sourcePlayerId: "p2", targetPlayerId: "p1", amount: 1 });
  assert.equal(bodyProgressDelta(owner, dodge), 1);
  assert.equal(bodyProgressDelta(owner, ownPrevention), 1);
  assert.equal(triggerKindForBody(owner, ownPrevention), "defense-reward");
  assert.equal(bodyProgressDelta(owner, opponentPrevention), 0);
  assert.equal(triggerKindForBody(owner, opponentPrevention), undefined);
});
