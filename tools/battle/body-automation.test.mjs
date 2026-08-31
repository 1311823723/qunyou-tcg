import assert from "node:assert/strict";
import test from "node:test";
import { BODY_IDS } from "../../worker/src/skills/body-ids.mts";
import {
  bodySkillForId,
  extraStrikeAllowance,
  registeredBodySkillIds,
} from "../../worker/src/skills/body-registry.mts";
import { bodyTraitLogText } from "../../worker/src/skills/body-skill.mts";

function player(definitionId, flipped = false, id = "p1") {
  return {
    id,
    nickname: id,
    body: { instanceId: `${id}-body`, definitionId, kind: "body", ownerId: id },
    bodyState: { progress: 0, progressMax: 6, flipped, extraFormUsed: false, trackedCharacterInstanceIds: [] },
    hand: [],
    health: 7,
    maxHealth: 7,
    characterDeck: [],
    characterSlots: [null, null, null, null],
    retired: [],
    banished: [],
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
    turnModifiers: [],
    players: [owner, opponent],
  };
  let prompt;
  let drawn = 0;
  let startedStrike;
  let judgment;
  let prevented = [];
  const logs = [];
  const key = (scope, suffix) => `body:${scope}:${scope === "turn" ? `${state.turnNumber}:` : ""}${owner.id}:${suffix}`;
  const context = {
    state,
    player: owner,
    opponent: () => opponent,
    skillName: (extra = false) => extra ? "强化特性" : "本体特性",
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
    characterName: (definitionId) => definitionId,
    logTrait: () => { logs.push(bodyTraitLogText(owner.nickname, owner.bodyState.flipped ? "强化特性" : "本体特性", owner.bodyState.flipped)); },
    addLog: (message) => { logs.push(message); },
    emitEvent: (type, details) => { prevented.push({ type, details }); },
    shuffle: (items) => [...items],
    deployTopCharacter: () => {
      const slotIndex = owner.characterSlots.indexOf(null);
      const card = owner.characterDeck.pop();
      if (slotIndex < 0 || !card) return undefined;
      card.faceDown = true;
      owner.characterSlots[slotIndex] = card;
      return { card, slotIndex };
    },
    restOwnCharacter: (instanceId) => {
      const index = owner.characterSlots.findIndex((card) => card?.instanceId === instanceId);
      if (index < 0) return false;
      const card = owner.characterSlots[index];
      owner.characterSlots[index] = null;
      owner.characterDeck.unshift(card);
      return true;
    },
    startJudgment: (purpose) => { judgment = purpose; },
    discardRandom: (target) => {
      const card = target.hand.shift();
      if (card) state.handDiscard.push(card);
      return card;
    },
    heal: (count) => {
      const recovered = Math.min(count, owner.maxHealth - owner.health);
      owner.health += recovered;
      return recovered;
    },
    legalStrikeCards: () => owner.hand.filter((card) => ["hand_basic_001", "hand_basic_004"].includes(card.definitionId)),
    startBodyStrike: (targetPlayerId, cardInstanceId) => { startedStrike = { targetPlayerId, cardInstanceId }; },
  };
  return {
    context,
    getPrompt: () => prompt,
    getDrawn: () => drawn,
    getStartedStrike: () => startedStrike,
    getJudgment: () => judgment,
    getEvents: () => prevented,
    getLogs: () => logs,
  };
}

test("本体特性日志区分普通特性、Mega特性与Z招式", () => {
  assert.equal(bodyTraitLogText("微笑尅乐", "怦然杀意"), "微笑尅乐的特性【怦然杀意】触发");
  assert.equal(bodyTraitLogText("微笑尅乐", "爱至癫狂", true), "微笑尅乐的Mega 特性【爱至癫狂】触发");
});

test("8张本体全部由技能注册表管理", () => {
  assert.deepEqual(registeredBodySkillIds(), Object.values(BODY_IDS));
  for (const id of Object.values(BODY_IDS)) assert.ok(bodySkillForId(id), `${id} 应已注册`);
});

test("爆杀本体按伤害点数累计进度，Mega 提供两次额外出刀", () => {
  const front = player(BODY_IDS.aggro);
  const mega = player(BODY_IDS.aggro, true);
  const dealt = event("damage_after", { sourcePlayerId: "p1", targetPlayerId: "p2", amount: 2 });
  const skill = bodySkillForId(BODY_IDS.aggro);
  const { context, getPrompt, getDrawn, getLogs } = runtime(front);
  assert.equal(skill.progressDelta(front, dealt), 2);
  assert.equal(skill.collectTrigger(context, dealt).kind, "aggro-draw");
  assert.equal(skill.collectTrigger(context, { ...dealt, id: "second" }), undefined, "每回合只收集首次伤害触发");
  assert.equal(extraStrikeAllowance(front), 1);
  assert.equal(extraStrikeAllowance(mega), 2);
  assert.equal(skill.openPrompt(context, { id: "trigger", kind: "aggro-draw", playerId: front.id, eventId: dealt.id }), true);
  skill.resolveChoice(context, getPrompt(), { value: "draw" });
  assert.equal(getDrawn(), 1);
  assert.deepEqual(getLogs(), ["p1的特性【本体特性】触发"]);
});

test("放弃本体特性时不会写入触发日志", () => {
  const owner = player(BODY_IDS.aggro);
  const skill = bodySkillForId(BODY_IDS.aggro);
  const { context, getPrompt, getLogs } = runtime(owner);
  const dealt = event("damage_after", { sourcePlayerId: owner.id, targetPlayerId: "p2", amount: 1 });
  assert.equal(skill.openPrompt(context, { id: "trigger", kind: "aggro-draw", playerId: owner.id, eventId: dealt.id }), true);
  skill.resolveChoice(context, getPrompt(), { value: "pass" });
  assert.deepEqual(getLogs(), []);
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

test("行动、拟态和调度本体都由模块处理", () => {
  const action = event("card_used", { sourcePlayerId: "p1", metadata: { actionCard: true } });
  const combo = player(BODY_IDS.combo);
  const comboSkill = bodySkillForId(BODY_IDS.combo);
  assert.equal(comboSkill.progressDelta(combo, action), 1);
  assert.equal(comboSkill.collectTrigger(runtime(combo).context, event("card_resolved", { sourcePlayerId: "p1", metadata: { actionCard: true } })).kind, "combo-action");
  const virtual = event("skill_used", { sourcePlayerId: "p1", metadata: { virtualCard: true } });
  const trans = player(BODY_IDS.trans);
  assert.equal(bodySkillForId(BODY_IDS.trans).progressDelta(trans, virtual), 1);
  assert.equal(bodySkillForId(BODY_IDS.trans).collectTrigger(runtime(trans).context, virtual).kind, "trans-deploy");
  const reveal = event("character_revealed", { sourcePlayerId: "p2", targetPlayerId: "p2" });
  const dispatch = player(BODY_IDS.dispatch);
  assert.equal(bodySkillForId(BODY_IDS.dispatch).progressDelta(dispatch, reveal), 1);
  assert.equal(bodySkillForId(BODY_IDS.dispatch).collectTrigger(runtime(dispatch).context, reveal).kind, "dispatch-reveal");
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
  const blood = player(BODY_IDS.blood);
  assert.equal(bodySkillForId(BODY_IDS.blood).progressDelta(blood, judgment), 1);
  const ambush = event("skill_used", { sourcePlayerId: "p1", metadata: { mainRole: "伏击", leftFieldForCost: true } });
  const owner = player(BODY_IDS.ambush);
  assert.equal(bodySkillForId(BODY_IDS.ambush).progressDelta(owner, ambush), 1);
  assert.equal(bodySkillForId(BODY_IDS.ambush).collectTrigger(runtime(owner).context, ambush).kind, "ambush-refill");
});

test("防御本体只计入闪避或己方对自己的防伤", () => {
  const owner = player(BODY_IDS.defense);
  const dodge = event("strike_dodged", { sourcePlayerId: "p1", targetPlayerId: "p2" });
  const ownPrevention = event("damage_prevented", { sourcePlayerId: "p1", targetPlayerId: "p1", amount: 1 });
  const opponentPrevention = event("damage_prevented", { sourcePlayerId: "p2", targetPlayerId: "p1", amount: 1 });
  const skill = bodySkillForId(BODY_IDS.defense);
  const context = runtime(owner).context;
  assert.equal(skill.progressDelta(owner, dodge), 1);
  assert.equal(skill.progressDelta(owner, ownPrevention), 1);
  assert.equal(skill.collectTrigger(context, ownPrevention).kind, "defense-reward");
  assert.equal(skill.progressDelta(owner, opponentPrevention), 0);
  assert.equal(skill.collectTrigger(context, opponentPrevention), undefined);
});

test("卖血本体的判定发动与红黑分支可恢复", () => {
  const owner = player(BODY_IDS.blood);
  owner.hand = [{ instanceId: "self", definitionId: "hand_basic_001", kind: "hand", ownerId: owner.id }];
  const opponent = player(BODY_IDS.defense, false, "p2");
  opponent.hand = [{ instanceId: "other", definitionId: "hand_basic_002", kind: "hand", ownerId: opponent.id }];
  const skill = bodySkillForId(BODY_IDS.blood);
  const run = runtime(owner, opponent);
  assert.equal(skill.openPrompt(run.context, { id: "t", kind: "blood-judgment", playerId: owner.id, eventId: "damage" }), true);
  skill.resolveChoice(run.context, run.getPrompt(), { value: "judge" });
  assert.equal(run.getJudgment(), "blood-body");
  assert.equal(skill.resolveJudgment(run.context, {}, "黑色"), true);
  assert.equal(opponent.hand.length, 0);
  assert.equal(run.getPrompt().context.action, "blood-self-discard");
});

test("拟态本体暗置上阵并在回合末休整跟踪角色", () => {
  const owner = player(BODY_IDS.trans);
  owner.characterDeck.push({ instanceId: "role", definitionId: "char", kind: "character" });
  const skill = bodySkillForId(BODY_IDS.trans);
  const run = runtime(owner);
  skill.openPrompt(run.context, { id: "t", kind: "trans-deploy", playerId: owner.id, eventId: "virtual" });
  skill.resolveChoice(run.context, run.getPrompt(), { value: "deploy" });
  assert.equal(owner.characterSlots[0].instanceId, "role");
  skill.onPhaseEntered(run.context, "end", owner);
  assert.equal(owner.characterSlots[0], null);
  assert.deepEqual(owner.bodyState.trackedCharacterInstanceIds, []);
});

test("防御Z招式会自动防止致命伤害并回复2点体力", () => {
  const owner = player(BODY_IDS.defense, true);
  owner.health = 1;
  const skill = bodySkillForId(BODY_IDS.defense);
  const run = runtime(owner);
  assert.equal(skill.preventDamage(run.context, 2), true);
  assert.equal(owner.health, 3);
  assert.equal(owner.bodyState.extraFormUsed, true);
  assert.equal(run.getEvents()[0].type, "damage_prevented");
});
