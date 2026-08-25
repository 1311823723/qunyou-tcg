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
