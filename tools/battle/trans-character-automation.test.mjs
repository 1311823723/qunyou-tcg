import assert from "node:assert/strict";
import test from "node:test";
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import transDeck from "../../data/decks/trans.deck.json" with { type: "json" };
import { HAND_IDS } from "../../worker/src/auto-engine.mts";
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { TRANS_CHARACTER_IDS } from "../../worker/src/skills/characters/trans.mts";
import { fixedAutoScenario } from "./fixtures/auto-scenario.mjs";

function card(instanceId, definitionId, kind = "hand") {
  return { instanceId, definitionId, kind, ownerId: "p1", faceDown: false };
}

function runtime(definitionId, event) {
  const { owner, opponent, state } = fixedAutoScenario({ ownerRoles: [definitionId] });
  owner.characterDeck = [];
  owner.retired = [];
  owner.banished = [];
  owner.characterSlots.push(null, null, null);
  state.usageCounters = {};
  const role = owner.characterSlots[0];
  let prompt;
  let virtualBasic;
  const context = {
    state, player: owner, role, event,
    opponent: () => opponent,
    setPrompt: (step, value, data = {}, decisionPlayerId = owner.id) => {
      prompt = { id: crypto.randomUUID(), kind: "character-skill", playerId: decisionPlayerId, ...value, context: { continuation: { step, data } } };
    },
    clearPrompt: () => { prompt = undefined; },
    markerCount: (label) => owner.markers.find((entry) => entry.kind === "counter" && entry.label === label)?.count || 0,
    addCounterMarker: (label, amount = 1) => {
      const marker = owner.markers.find((entry) => entry.kind === "counter" && entry.label === label);
      if (marker) marker.count += amount;
      else owner.markers.push({ id: crypto.randomUUID(), kind: "counter", label, ownerId: owner.id, count: amount });
      return marker?.count || amount;
    },
    removeCounterMarker: (label, amount = 1) => {
      const marker = owner.markers.find((entry) => entry.kind === "counter" && entry.label === label);
      if (!marker || marker.count < amount) return 0;
      marker.count -= amount;
      if (!marker.count) owner.markers.splice(owner.markers.indexOf(marker), 1);
      return amount;
    },
    addModifier: (modifier) => state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: owner.id, ...modifier }),
    useVirtualBasic: (id, options) => { virtualBasic = { id, options }; },
    reviveOwnRetired: (instanceId) => {
      const index = owner.retired.findIndex((item) => item.instanceId === instanceId);
      const [revived] = owner.retired.splice(index, 1);
      revived.faceDown = true;
      owner.characterSlots[1] = revived;
      return revived;
    },
    gainFromHandDiscard: (ids) => ids.map((id) => {
      const index = state.handDiscard.findIndex((item) => item.instanceId === id);
      const [gained] = state.handDiscard.splice(index, 1);
      owner.hand.push(gained);
      return gained;
    }),
  };
  return { context, owner, state, role, getPrompt: () => prompt, getVirtualBasic: () => virtualBasic };
}

function resolve(module, setup, payload) {
  const prompt = setup.getPrompt();
  return module.resolveChoice({ ...setup.context, continuation: prompt.context.continuation }, prompt, payload);
}

function setCharge(setup, count) {
  setup.owner.markers.push({ id: "charge", kind: "counter", label: "充能球", ownerId: setup.owner.id, count });
}

test("变通组16张角色全部登记为全自动模块", () => {
  for (const id of transDeck.characterIds) {
    assert.ok(characterSkillForId(id), id);
    assert.equal(implementation[id].automation, "implemented", id);
  }
});

test("三种故障机器人共用充能球并转化为减伤、伤害与降费", () => {
  const frost = runtime(TRANS_CHARACTER_IDS.frostDefect);
  const frostModule = characterSkillForId(TRANS_CHARACTER_IDS.frostDefect);
  frostModule.activate(frost.context);
  resolve(frostModule, frost, { value: "charge" });
  assert.equal(frost.context.markerCount("充能球"), 1);
  frostModule.activate(frost.context);
  resolve(frostModule, frost, { value: "discharge" });
  assert.equal(frost.state.turnModifiers[0].kind, "damage-shield");

  const dark = runtime(TRANS_CHARACTER_IDS.darkDefect);
  setCharge(dark, 3);
  const darkModule = characterSkillForId(TRANS_CHARACTER_IDS.darkDefect);
  darkModule.activate(dark.context);
  resolve(darkModule, dark, { value: "discharge:3" });
  assert.deepEqual(dark.getVirtualBasic(), { id: HAND_IDS.strike, options: { damage: 3 } });
  assert.equal(dark.context.markerCount("充能球"), 0);

  const plasma = runtime(TRANS_CHARACTER_IDS.plasmaDefect);
  setCharge(plasma, 1);
  const plasmaModule = characterSkillForId(TRANS_CHARACTER_IDS.plasmaDefect);
  plasmaModule.activate(plasma.context);
  resolve(plasmaModule, plasma, { value: "discharge" });
  assert.equal(plasma.state.turnModifiers[0].kind, "trans-next-skill-cost-down");
});

test("通灵者以真实退场牌上阵并绑定本回合退场标记", () => {
  const setup = runtime(TRANS_CHARACTER_IDS.medium);
  setup.owner.retired.push(card("spirit", "char_001_keke_assassin", "character"));
  const module = characterSkillForId(TRANS_CHARACTER_IDS.medium);
  module.activate(setup.context);
  resolve(module, setup, { cardInstanceIds: ["spirit"] });
  assert.equal(setup.owner.retired.length, 0);
  assert.equal(setup.owner.characterSlots[1].instanceId, "spirit");
  assert.equal(setup.owner.characterSlots[1].faceDown, true);
  assert.equal(setup.state.turnModifiers[0].kind, "trans-revived-character");
});

test("黑鸦只在【出刀】造成伤害后回收弃牌堆中的真实【出刀】", () => {
  const setup = runtime(TRANS_CHARACTER_IDS.silentHunter, { amount: 1 });
  setup.state.handDiscard.push(card("strike", HAND_IDS.strike));
  const module = characterSkillForId(TRANS_CHARACTER_IDS.silentHunter);
  assert.equal(module.canActivate(setup.context), true);
  module.activate(setup.context);
  resolve(module, setup, { cardInstanceIds: ["strike"] });
  assert.equal(setup.owner.hand[0].instanceId, "strike");
  assert.equal(setup.state.handDiscard.length, 0);
});
