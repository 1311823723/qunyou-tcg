import assert from "node:assert/strict";
import test from "node:test";
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import dispatchDeck from "../../data/decks/dispatch.deck.json" with { type: "json" };
import { HAND_IDS } from "../../worker/src/auto-engine.mts";
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { DISPATCH_CHARACTER_IDS } from "../../worker/src/skills/characters/dispatch.mts";
import { fixedAutoScenario } from "./fixtures/auto-scenario.mjs";

function hand(instanceId, definitionId = HAND_IDS.strike) {
  return { instanceId, definitionId, kind: "hand" };
}

function runtime(definitionId, event) {
  const { owner, opponent, state } = fixedAutoScenario({
    ownerRoles: [definitionId],
    opponentRoles: ["char_001_keke_assassin"],
  });
  state.usageCounters = {};
  const role = owner.characterSlots[0];
  let prompt;
  let virtualBasic;
  let drawn = 0;
  let deployed = 0;
  const context = {
    state, player: owner, role, event,
    opponent: () => opponent,
    setPrompt: (step, value, data = {}, decisionPlayerId = owner.id) => {
      prompt = { id: crypto.randomUUID(), kind: "character-skill", playerId: decisionPlayerId, ...value, context: { continuation: { step, data } } };
    },
    clearPrompt: () => { prompt = undefined; },
    canUseBasic: (id) => id === HAND_IDS.strike || (id === HAND_IDS.aid && owner.health < owner.maxHealth),
    handName: (id) => id === HAND_IDS.strike ? "出刀" : "急救",
    handLabel: (card) => `${card.suit || ""}${card.rank || ""}【${card.definitionId}】`,
    useVirtualBasic: (id, options) => { virtualBasic = { id, options }; },
    gainOpponentHand: (id) => {
      const index = opponent.hand.findIndex((card) => card.instanceId === id);
      const [card] = opponent.hand.splice(index, 1);
      owner.hand.push(card);
      return card;
    },
    discardOwnHand: (ids) => ids.map((id) => owner.hand.splice(owner.hand.findIndex((card) => card.instanceId === id), 1)[0]),
    deployTopCharacters: (count = 1) => { deployed += count; return []; },
    draw: (count) => { drawn += count; return count; },
    addModifier: (modifier) => state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: owner.id, ...modifier }),
    boostNextStrikeDamage: (count = 1) => state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: owner.id, kind: "aggro-next-strike-damage", count }),
    emitEvent: () => {},
  };
  return {
    context, owner, opponent, state, role,
    getPrompt: () => prompt,
    getVirtualBasic: () => virtualBasic,
    getDrawn: () => drawn,
    getDeployed: () => deployed,
  };
}

function resolve(module, setup, payload) {
  const prompt = setup.getPrompt();
  return module.resolveChoice({ ...setup.context, continuation: prompt.context.continuation }, prompt, payload);
}

test("执棋组16张角色全部登记为全自动模块", () => {
  for (const id of dispatchDeck.characterIds) {
    assert.ok(characterSkillForId(id), id);
    assert.equal(implementation[id].automation, "implemented", id);
  }
});

test("审判官由对手选择允许虚拟基础牌或交出真实手牌", () => {
  const setup = runtime(DISPATCH_CHARACTER_IDS.judge);
  setup.opponent.hand.push(hand("gift"));
  const module = characterSkillForId(DISPATCH_CHARACTER_IDS.judge);
  module.activate(setup.context);
  resolve(module, setup, { value: HAND_IDS.strike });
  assert.equal(setup.getPrompt().playerId, setup.opponent.id);
  resolve(module, setup, { value: "give" });
  resolve(module, setup, { cardInstanceIds: ["gift"] });
  assert.equal(setup.owner.hand.at(-1).instanceId, "gift");

  const allow = runtime(DISPATCH_CHARACTER_IDS.judge);
  module.activate(allow.context);
  resolve(module, allow, { value: HAND_IDS.strike });
  resolve(module, allow, { value: "allow" });
  assert.equal(allow.getVirtualBasic().id, HAND_IDS.strike);
});

test("风姬、变形鸭和警长使用结构化的强化、布阵和虚拟出刀", () => {
  const watcher = runtime(DISPATCH_CHARACTER_IDS.watcher);
  const watcherModule = characterSkillForId(DISPATCH_CHARACTER_IDS.watcher);
  watcherModule.activate(watcher.context);
  resolve(watcherModule, watcher, { value: "calm" });
  assert.equal(watcher.state.turnModifiers[0].kind, "combo-next-action-draw");

  const morphling = runtime(DISPATCH_CHARACTER_IDS.morphling);
  morphling.owner.hand.push(hand("cost"));
  const morphlingModule = characterSkillForId(DISPATCH_CHARACTER_IDS.morphling);
  morphlingModule.activate(morphling.context);
  resolve(morphlingModule, morphling, { cardInstanceIds: ["cost"] });
  assert.equal(morphling.owner.hand.length, 0);
  assert.equal(morphling.getDeployed(), 1);

  const sheriff = runtime(DISPATCH_CHARACTER_IDS.sheriff);
  sheriff.opponent.characterSlots[0].faceDown = false;
  const sheriffModule = characterSkillForId(DISPATCH_CHARACTER_IDS.sheriff);
  sheriffModule.activate(sheriff.context);
  resolve(sheriffModule, sheriff, { value: "0" });
  assert.deepEqual(sheriff.getVirtualBasic(), { id: HAND_IDS.strike, options: { restTargetSlotOnDamage: 0 } });
});

test("侦探与观者的私密观看和本回合上阵绑定可恢复", () => {
  const detective = runtime(DISPATCH_CHARACTER_IDS.detective, { metadata: { revealedFromFaceDown: true } });
  detective.opponent.characterSlots[0].faceDown = true;
  const detectiveModule = characterSkillForId(DISPATCH_CHARACTER_IDS.detective);
  detectiveModule.activate(detective.context);
  const hiddenId = detective.opponent.characterSlots[0].instanceId;
  resolve(detectiveModule, detective, { cardInstanceIds: [hiddenId] });
  assert.equal(detective.getPrompt().selectableCards[0].instanceId, hiddenId);
  resolve(detectiveModule, detective, { value: "done" });
  assert.equal(detective.getDrawn(), 1);

  const watcher = runtime(DISPATCH_CHARACTER_IDS.formationWatcher, { amount: 2 });
  watcher.state.usageCounters[`deployed:${watcher.state.turnNumber}:${watcher.owner.id}:${watcher.role.instanceId}`] = 1;
  const module = characterSkillForId(DISPATCH_CHARACTER_IDS.formationWatcher);
  module.activate(watcher.context);
  resolve(module, watcher, { cardInstanceIds: [watcher.role.instanceId] });
  assert.equal(watcher.role.faceDown, false);
  assert.equal(watcher.state.turnModifiers[0].characterInstanceId, watcher.role.instanceId);
});
