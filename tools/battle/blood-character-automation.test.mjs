import assert from "node:assert/strict";
import test from "node:test";
import bloodDeck from "../../data/decks/blood.deck.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { BLOOD_CHARACTER_IDS } from "../../worker/src/skills/characters/blood.mts";

test("逆命组16张角色全部登记为全自动模块", () => {
  for (const id of bloodDeck.characterIds) {
    assert.ok(characterSkillForId(id), id);
    assert.equal(implementation[id].automation, "implemented", id);
  }
});

test("逆命组区分受到伤害、失去体力和判定时机", () => {
  assert.deepEqual(characterSkillForId(BLOOD_CHARACTER_IDS.vigilante).trigger, { event: "damage_after", relation: "target_self" });
  assert.deepEqual(characterSkillForId(BLOOD_CHARACTER_IDS.serialKiller).trigger, { event: "health_lost_after", relation: "target_self" });
  assert.deepEqual(characterSkillForId(BLOOD_CHARACTER_IDS.astral).trigger, { event: "judgment_revealed", relation: "any" });
  assert.deepEqual(characterSkillForId(BLOOD_CHARACTER_IDS.canadian).trigger, { event: "judgment_resolved", relation: "any" });
});

test("逆命组主动发动和延迟收益保留结构化次数", () => {
  assert.equal(characterSkillForId(BLOOD_CHARACTER_IDS.ironclad).trigger.event, "play_phase");
  assert.equal(characterSkillForId(BLOOD_CHARACTER_IDS.medium).trigger.event, "damage_after");
  assert.equal(characterSkillForId(BLOOD_CHARACTER_IDS.detective).trigger.event, "judgment_resolved");
  assert.equal(characterSkillForId(BLOOD_CHARACTER_IDS.snitch).trigger.event, "damage_after");
});
