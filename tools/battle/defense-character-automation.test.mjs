import assert from "node:assert/strict";
import test from "node:test";
import defenseDeck from "../../data/decks/defense.deck.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { DEFENSE_CHARACTER_IDS } from "../../worker/src/skills/characters/defense.mts";

test("不落组16张角色全部登记为全自动模块", () => {
  for (const id of defenseDeck.characterIds) {
    assert.ok(characterSkillForId(id), id);
    assert.equal(implementation[id].automation, "implemented", id);
  }
});

test("不落组防伤、手牌保护和角色离场使用独立时机", () => {
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.highPriest).trigger.event, "damage_before");
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.locksmith).trigger.event, "hand_lost_before");
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.bodyguardAichitun).trigger.event, "character_leave_before");
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.vigilanteTutu).trigger.event, "damage_prevented");
});

test("不落组判定、展示和回合锁定保留结构化入口", () => {
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.birdwatcher).trigger.event, "body_targeted_by_hand");
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.mimic).trigger.event, "strike_targeted");
  assert.equal(characterSkillForId(DEFENSE_CHARACTER_IDS.astral).trigger.event, "preparation");
});

test("伤害前技能修改待结算伤害，不再提前取消手牌", () => {
  let pendingDamage = 2;
  let drew = 0;
  const events = [];
  const context = {
    player: { id: "p1" },
    event: { cardDefinitionId: "hand_trick_004" },
    reducePendingDamage(amount = Number.POSITIVE_INFINITY) {
      const reduced = Math.min(pendingDamage, amount);
      pendingDamage -= reduced;
      return reduced;
    },
    counterCurrentHand() {
      throw new Error("伤害前技能不应再操作响应阶段的手牌结算项。");
    },
    draw(count) { drew += count; return count; },
    emitEvent(type, details) { events.push({ type, details }); },
  };

  characterSkillForId(DEFENSE_CHARACTER_IDS.highPriest).activate(context);
  assert.equal(pendingDamage, 0);
  assert.equal(drew, 1);
  assert.deepEqual(events.map((event) => event.details.amount), [2]);

  pendingDamage = 2;
  events.length = 0;
  characterSkillForId(DEFENSE_CHARACTER_IDS.adventurer).activate(context);
  assert.equal(pendingDamage, 1);
  assert.deepEqual(events.map((event) => event.details.amount), [1]);
});

test("保镖在真正伤害窗口休整角色并防止伤害", () => {
  const module = characterSkillForId(DEFENSE_CHARACTER_IDS.bodyguardQindi);
  let pendingDamage = 1;
  let restedSlot = -1;
  let healed = 0;
  let cleared = false;
  const prompt = { id: "damage-choice", options: [{ value: "1", label: "角色位 2" }] };
  const context = {
    player: { id: "p1" },
    continuation: { step: "qindi-bodyguard-rest" },
    restOwnCharacter(slot) { restedSlot = slot; },
    reducePendingDamage() { const amount = pendingDamage; pendingDamage = 0; return amount; },
    heal(amount) { healed += amount; return amount; },
    emitEvent() {},
    clearPrompt() { cleared = true; },
  };
  assert.equal(module.resolveChoice(context, prompt, { value: "1" }), true);
  assert.equal(restedSlot, 1);
  assert.equal(pendingDamage, 0);
  assert.equal(healed, 1);
  assert.equal(cleared, true);
});
