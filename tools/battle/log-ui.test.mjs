import assert from "node:assert/strict";
import test from "node:test";
import {
  battleLogRegionId,
  battleLogTargetKey,
  filterBattleLogs,
  formatBattleLog,
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

test("battle log text is summarized with semantic badges", () => {
  assert.deepEqual(formatBattleLog({
    id: "skill",
    at: 1,
    text: "玩家A 声明发动角色【警长-秦帝】的技能【正义执行】｜类型：角色 / 强攻｜发动时机：对手准备阶段｜消耗：休整 1｜效果：造成1点伤害。",
    kind: "action",
  }), {
    badge: "技能",
    tone: "skill",
    text: "玩家A 声明【正义执行】",
    detail: "角色：警长-秦帝｜类型：角色 / 强攻｜发动时机：对手准备阶段｜消耗：休整 1｜效果：造成1点伤害。",
  });
  assert.equal(formatBattleLog({ id: "discard", at: 1, text: "玩家A 弃置了黑桃7【杀】" }).badge, "弃置");
  assert.equal(formatBattleLog({ id: "rest", at: 1, text: "玩家A 休整了角色牌【忍者-摆子】，置于角色牌堆底" }).badge, "休整");
  assert.equal(formatBattleLog({ id: "view", at: 1, text: "玩家A 查看了 玩家B 的手牌", kind: "inspection" }).badge, "查看");
});
