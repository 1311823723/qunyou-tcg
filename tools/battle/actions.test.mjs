import assert from "node:assert/strict";
import test from "node:test";
import { actionFeedback, actionLockKey, actionTargetKey, moveTargetKey } from "../../src/scripts/battle-actions.mjs";

test("battle action feedback preserves move and generic success text", () => {
  assert.deepEqual(actionFeedback("card:move", { targetZone: "characterSlot", targetIndex: 1 }, "【黑桃 A 出刀】"), {
    label: "移动至角色位 2",
    successMessage: "已将【黑桃 A 出刀】置入角色位 2",
  });
  assert.deepEqual(actionFeedback("declaration:create", {}), {
    label: "声明已记录",
    successMessage: "声明已记录",
  });
});

test("battle actions map targets without reading page state", () => {
  assert.equal(moveTargetKey({ targetZone: "characterSlot", targetIndex: 2, targetOwnerId: "p2" }), "characterSlot:2@p2");
  assert.equal(actionTargetKey("card:draw", {}, { you: "p1" }), "hand@p1");
  assert.equal(actionTargetKey("marker:adjust", { markerId: "m1" }, { you: "p1", markerOwnerId: "p2" }), "bodyMarker@p2");
  assert.equal(actionTargetKey("slot-marker:create", { playerId: "p2", slotIndex: 3 }, { you: "p1" }), "characterSlot:3@p2");
});

test("battle action locks isolate cards, counters and markers", () => {
  assert.equal(actionLockKey("card:move", { instanceId: "card-1" }), "card:card-1");
  assert.equal(actionLockKey("health:set", { playerId: "p2" }), "health:set:p2");
  assert.equal(actionLockKey("marker:adjust", { markerId: "marker-1" }), "marker:marker-1");
  assert.equal(actionLockKey("turn:end", {}), "turn:end");
});
