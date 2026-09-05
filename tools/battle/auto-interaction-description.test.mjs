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
