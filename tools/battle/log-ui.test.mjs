import assert from "node:assert/strict";
import test from "node:test";
import {
  battleLogRegionId,
  battleLogTargetKey,
  filterBattleLogs,
} from "../../src/scripts/battle-log.mjs";

const logs = [
  { id: "legacy", text: "旧日志", at: 1 },
  { id: "mine", text: "我的操作", at: 2, actorId: "p1", kind: "action" },
  { id: "opponent", text: "对手操作", at: 3, actorId: "p2", kind: "action" },
  { id: "inspect", text: "查看行为", at: 4, actorId: "p1", kind: "inspection" },
  { id: "system", text: "系统行为", at: 5, kind: "system" },
];

test("battle logs are filtered from the viewer perspective", () => {
  assert.deepEqual(filterBattleLogs(logs, "all", "p1").map((log) => log.id), [
    "legacy", "mine", "opponent", "inspect", "system",
  ]);
  assert.deepEqual(filterBattleLogs(logs, "mine", "p1").map((log) => log.id), ["mine"]);
  assert.deepEqual(filterBattleLogs(logs, "opponent", "p1").map((log) => log.id), ["opponent"]);
  assert.deepEqual(filterBattleLogs(logs, "inspection", "p1").map((log) => log.id), ["inspect"]);
});

test("log targets map to public table regions without card identifiers", () => {
  const slot = { zone: "characterSlot", ownerId: "p2", slotIndex: 2 };
  assert.equal(battleLogTargetKey(slot, "p1"), "characterSlot:2@p2");
  assert.equal(battleLogRegionId(slot, "p1"), "battle-player-opponent");

  const ownHand = { zone: "hand", ownerId: "p1" };
  assert.equal(battleLogTargetKey(ownHand, "p1"), "hand@p1");
  assert.equal(battleLogRegionId(ownHand, "p1"), "battle-hand-self");

  assert.equal(battleLogTargetKey({ zone: "handDiscard" }, "p1"), "handDiscard");
  assert.equal(battleLogRegionId({ zone: "handDiscard" }, "p1"), "battle-center");
  assert.equal("instanceId" in slot, false);
});

test("legacy logs without targets remain non-locatable", () => {
  assert.equal(battleLogTargetKey(undefined, "p1"), undefined);
  assert.equal(battleLogRegionId(undefined, "p1"), undefined);
});
