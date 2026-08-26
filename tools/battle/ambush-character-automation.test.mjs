import assert from "node:assert/strict";
import test from "node:test";
import ambushDeck from "../../data/decks/ambush.deck.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { AMBUSH_CHARACTER_IDS } from "../../worker/src/skills/characters/ambush.mts";

test("幽幕组16张角色全部登记为全自动模块", () => {
  for (const id of ambushDeck.characterIds) {
    assert.ok(characterSkillForId(id), id);
    assert.equal(implementation[id].automation, "implemented", id);
  }
});

test("幽幕组的行动牌、明置和技能结算伏击分属独立窗口", () => {
  assert.equal(characterSkillForId(AMBUSH_CHARACTER_IDS.silentHunter).trigger.event, "action_used");
  assert.equal(characterSkillForId(AMBUSH_CHARACTER_IDS.nameless).trigger.event, "character_revealed");
  assert.equal(characterSkillForId(AMBUSH_CHARACTER_IDS.identityThief).trigger.event, "skill_resolved");
  assert.equal(characterSkillForId(AMBUSH_CHARACTER_IDS.vulture).trigger.event, "hand_discarded");
});

test("需在支付或响应前改写结算的伏击保留注册模块", () => {
  assert.ok(characterSkillForId(AMBUSH_CHARACTER_IDS.silencer));
  assert.ok(characterSkillForId(AMBUSH_CHARACTER_IDS.professional));
  assert.ok(characterSkillForId(AMBUSH_CHARACTER_IDS.falcon));
});
