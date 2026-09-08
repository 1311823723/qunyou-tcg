import assert from "node:assert/strict";
import test from "node:test";
import { roomRuntime, hand } from "./fixtures/auto-room-runtime.mjs";

test("hand descriptions expose public target slots and explicit quick-play eligibility", async () => {
  const { room, owner, opponent } = await roomRuntime([], ["char_001_keke_assassin"]);
  owner.hand = [hand("strike", "hand_basic_001"), hand("crisis", "hand_trick_004"), hand("joker", "hand_basic_004")];
  const actions = room.describeActions(owner, room.legalActionsFor(owner, owner.hand.map((card) => card.instanceId), []));
  assert.equal(actions.find((action) => action.payload?.instanceId === "strike").interaction.quickPlay, true);
  assert.deepEqual(actions.find((action) => action.payload?.instanceId === "crisis").interaction.target, { playerId: opponent.id, slotIndex: 0 });
  assert.ok(actions.filter((action) => action.payload?.instanceId === "joker").every((action) => action.interaction.quickPlay === false));
});

test("skill descriptions preserve effective rest costs and cannot enable quick submit", async () => {
  const { room, owner, state } = await roomRuntime(["char_001_keke_assassin", "char_002_weixiaokele_assassin"]);
  const role = owner.characterSlots[0];
  state.turnModifiers.push({ kind: "next-skill-cost-rest-one", ownerId: owner.id, count: 1 });
  const selection = room.skillCostSelection(owner, role.instanceId);
  const [action] = room.describeActions(owner, [{ type: "skill:activate", payload: { instanceId: role.instanceId }, selection }]);
  assert.equal(action.interaction.cost.kind, "rest");
  assert.equal(action.interaction.cost.amount, 1);
  assert.notEqual(action.interaction.quickPlay, true);
  assert.equal(state.turnModifiers.length, 1, "describing a cost must not consume its modifier");
});

test("new descriptions never expose private instance IDs to the opponent or spectator", async () => {
  const { room, owner } = await roomRuntime(["char_001_keke_assassin"]);
  owner.hand = [hand("private-hand-id", "hand_basic_001")];
  owner.characterSlots[0].faceDown = true;
  const ownerView = room.snapshotFor(owner.id);
  assert.ok(ownerView.game.legalActions.some((action) => action.payload?.instanceId === 'private-hand-id'));
  for (const view of [room.snapshotFor('p2'), room.snapshotFor('spectator', true)]) {
    const descriptions = JSON.stringify({ actions: view.game.legalActions, reasons: view.game.unavailableReasons });
    assert.equal(descriptions.includes('private-hand-id'), false);
    assert.equal(descriptions.includes(owner.characterSlots[0].instanceId), false);
  }
  assert.deepEqual(room.snapshotFor('spectator', true).game.unavailableReasons, {});
});

test("matched fees offer the real trigger cost and refuse a missing fee context", async () => {
  const { room, owner, state } = await roomRuntime(['char_114_zongzi_bodyguard', 'char_002_weixiaokele_assassin']);
  const role = owner.characterSlots[0];
  assert.equal(room.skillCostSelection(owner, role.instanceId).cardInstanceIds.length, 0);
  state.prompt = { id: 'cost-prompt', kind: 'character-trigger', playerId: owner.id, context: { eventId: 'targeted' } };
  state.recentEvents = [{ id: 'targeted', type: 'skill_targeted_character', metadata: { costType: '休整', costAmount: 2 } }];
  let selection = room.skillCostSelection(owner, role.instanceId);
  assert.equal(selection.min, 2);
  assert.equal(selection.cardInstanceIds.length, 2);
  state.recentEvents[0].metadata = { costType: '退场', costAmount: 0 };
  selection = room.skillCostSelection(owner, role.instanceId);
  assert.equal(selection, undefined);
  const [action] = room.describeActions(owner, [{ type: 'skill:activate', payload: { instanceId: role.instanceId }, selection }]);
  assert.deepEqual(action.interaction.cost, { kind: 'retire', fixedIds: [role.instanceId], amount: 1 });
});

test('structured blockers share legality, distinguish usage/locks/cost and remain private', async () => {
  const { room, owner, state } = await roomRuntime(['char_013_weixiaokele_morphling']);
  const role = owner.characterSlots[0];
  const key = room.characterUsageKey(owner, `${role.instanceId}:${role.definitionId}`, 'phase:1:play_phase', 'turn');
  state.usageCounters[key] = 1;
  let view = room.snapshotFor(owner.id).game;
  assert.equal(view.skillBlockers[role.instanceId].code, 'usage');
  assert.ok(!view.legalSkillInstanceIds.includes(role.instanceId));
  state.usageCounters = {};
  state.turnModifiers.push({ kind: 'defense-skill-lock', targetPlayerId: owner.id, targetCharacterInstanceId: role.instanceId });
  view = room.snapshotFor(owner.id).game;
  assert.equal(view.skillBlockers[role.instanceId].code, 'locked');
  state.turnModifiers = [];
  role.faceDown = true;
  state.turnModifiers.push({ kind: 'aggro-reveal-lock', targetPlayerId: owner.id, targetCharacterInstanceId: role.instanceId });
  assert.equal(room.snapshotFor(owner.id).game.skillBlockers[role.instanceId].code, 'reveal');
  state.turnModifiers.push({ kind: 'defense-skill-lock', targetPlayerId: owner.id, targetCharacterInstanceId: role.instanceId });
  view = room.snapshotFor(owner.id).game;
  assert.equal(view.skillBlockers[role.instanceId].code, 'reveal', 'first actual guard wins when restrictions overlap');
  assert.equal(view.skillBlockers[role.instanceId].message, view.unavailableReasons[role.instanceId]);
  assert.deepEqual(room.snapshotFor('spectator', true).game.skillBlockers, {});
  assert.equal(JSON.stringify(room.snapshotFor('p2').game.skillBlockers).includes(role.instanceId), false);
});

test('rest payment and reward report different direct causes without disclosing hidden cards', async () => {
  const { room, owner, state } = await roomRuntime(['char_001_keke_assassin', 'char_002_weixiaokele_assassin']);
  const role = owner.characterSlots[0];
  role.faceDown = true;
  room.paySkillCost(owner, role, { type: '休整', amount: 1 }, { costCharacterIds: [role.instanceId] });
  assert.equal(owner.characterSlots[0], null, 'rest returns the role to its deck');
  assert.equal(owner.characterDeck[0], role);
  const events = room.snapshotFor('spectator', true).game.recentEvents;
  assert.equal(events.find(e => e.type === 'character_rested').cause.kind, 'skill-cost');
  assert.equal(events.find(e => e.type === 'cards_drawn').cause.kind, 'rest-reward');
  assert.equal(events.find(e => e.type === 'cards_drawn').amount, 1);
  const publicText = JSON.stringify(events);
  assert.equal(publicText.includes(role.definitionId), false);
  assert.equal(publicText.includes(role.instanceId), false);
  assert.equal(publicText.includes(owner.hand[0].instanceId), false);
  assert.ok(state.recentEvents.some(e => e.metadata), 'internal rule metadata still exists');
});

test('serialized skill continuation preserves direct cause, independent of unrelated stack/event', async () => {
  const { room, owner, state } = await roomRuntime(['char_001_keke_assassin']);
  const role = owner.characterSlots[0];
  const context = room.characterSkillContext(owner, role);
  context.setPrompt('later', { title: '继续', message: '选择' });
  const continuation = JSON.parse(JSON.stringify(state.prompt.context.continuation));
  assert.deepEqual(continuation.cause, { kind: 'skill', sourcePlayerId: owner.id });
  state.recentEvents = [{ id: 'unrelated', type: 'cards_drawn', sourcePlayerId: 'p2' }];
  const resumed = room.characterSkillContext(owner, role, state.recentEvents[0], continuation);
  owner.health = 5;
  resumed.heal(1); resumed.draw(1);
  for (const e of state.recentEvents.filter(e => e.id !== 'unrelated')) assert.deepEqual(e.cause, continuation.cause);
});

test('deferred damage carries its original reason through serialized pending state', async () => {
  const { room, owner, opponent, state } = await roomRuntime();
  const cause = { kind: 'skill', sourcePlayerId: owner.id };
  state.pendingDamages.push(JSON.parse(JSON.stringify({ id: 'pending', eventId: 'before', sourcePlayerId: owner.id, targetPlayerId: opponent.id, amount: 1, cause })));
  room.resolvePendingDamage();
  const e = state.recentEvents.find(e => e.type === 'damage_after');
  assert.deepEqual(e.cause, cause);
  assert.equal(e.amount, 1);
});

test('no-target condition uses the module predicate; free modified cost is explicit', async () => {
  const { room, owner, state } = await roomRuntime(['char_013_weixiaokele_morphling']);
  const role = owner.characterSlots[0];
  const view = room.snapshotFor(owner.id).game;
  assert.equal(view.skillBlockers[role.instanceId].code, 'target');
  assert.match(view.skillBlockers[role.instanceId].message, /没有可选的明置角色/);
  const [action] = room.describeActions(owner, [{ type: 'skill:activate', payload: { instanceId: role.instanceId }, selection: { kind: 'skill-cost', cardInstanceIds: [], min: 0, max: 0 } }]);
  assert.equal(action.interaction.cost.kind, 'none');
  assert.equal(state.turnModifiers.length, 0);
});

test('insufficient fee has a cost blocker and description never consumes a reduction', async () => {
  const { room, owner, state } = await roomRuntime(['char_004_horus-lupercal_pelican'], ['char_001_keke_assassin']);
  const role = owner.characterSlots[0];
  assert.equal(room.snapshotFor(owner.id).game.skillBlockers[role.instanceId].code, 'cost');
  state.turnModifiers.push({ kind: 'trans-next-skill-cost-down', ownerId: owner.id, count: 1 });
  const view = room.snapshotFor(owner.id).game;
  assert.equal(view.skillBlockers[role.instanceId], undefined);
  const action = view.legalActions.find(a => a.type === 'skill:activate');
  assert.equal(action.interaction.cost.amount, 1);
  assert.match(action.interaction.costModifiers.join(''), /费用修正/);
  assert.equal(state.turnModifiers.length, 1);
});
