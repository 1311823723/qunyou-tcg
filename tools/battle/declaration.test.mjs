import assert from "node:assert/strict";
import test from "node:test";
import {
  DECLARATION_CATEGORIES,
  DECLARATION_STATIC_OPTIONS,
  declarationOptions,
} from "../../src/scripts/battle-declaration.mjs";
import { resolveDeclaration } from "../../worker/src/declaration.mts";

const handCards = new Map([
  ["hand_basic_001", { name: "出刀" }],
  ["hand_basic_004", { name: "冒名顶替" }],
]);

test("declaration UI exposes all five stable categories", () => {
  assert.deepEqual(DECLARATION_CATEGORIES.map((item) => item.value), [
    "suit",
    "rank",
    "face",
    "characterRole",
    "handCard",
  ]);
  assert.ok(DECLARATION_STATIC_OPTIONS.rank.includes("小王"));
  assert.ok(DECLARATION_STATIC_OPTIONS.rank.includes("大王"));
  assert.deepEqual(declarationOptions("handCard", [...handCards].map(([id, card]) => ({ id, ...card }))), [
    { value: "hand_basic_001", label: "出刀" },
    { value: "hand_basic_004", label: "冒名顶替" },
  ]);
});

test("worker resolves static and hand-card declarations without changing log labels", () => {
  assert.deepEqual(resolveDeclaration({ category: "suit", value: "红桃" }, handCards), {
    category: "suit",
    categoryLabel: "花色",
    value: "红桃",
    displayValue: "红桃",
  });
  assert.deepEqual(resolveDeclaration({ category: "handCard", value: "hand_basic_001" }, handCards), {
    category: "handCard",
    categoryLabel: "手牌",
    value: "hand_basic_001",
    displayValue: "出刀",
  });
});

test("worker rejects invalid categories, values and hand-card ids", () => {
  assert.throws(() => resolveDeclaration({ category: "suit", value: "彩虹" }, handCards), /声明选项无效/);
  assert.throws(() => resolveDeclaration({ category: "unknown", value: "正面" }, handCards), /声明选项无效/);
  assert.throws(() => resolveDeclaration({ category: "handCard", value: "missing" }, handCards), /声明的手牌不存在/);
});
