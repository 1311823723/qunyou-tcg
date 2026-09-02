import assert from "node:assert/strict";
import test from "node:test";
import characters from "../../data/cards/characters.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import aggroDeck from "../../data/decks/aggro.deck.json" with { type: "json" };
import comboDeck from "../../data/decks/combo.deck.json" with { type: "json" };
import mizaiDeck from "../../data/decks/mizai.deck.json" with { type: "json" };
import bloodDeck from "../../data/decks/blood.deck.json" with { type: "json" };
import defenseDeck from "../../data/decks/defense.deck.json" with { type: "json" };
import ambushDeck from "../../data/decks/ambush.deck.json" with { type: "json" };
import dispatchDeck from "../../data/decks/dispatch.deck.json" with { type: "json" };
import transDeck from "../../data/decks/trans.deck.json" with { type: "json" };
import {
  characterSkillForId,
  registeredCharacterSkillIds,
} from "../../worker/src/skills/character-registry.mts";
import { COMBO_CHARACTER_IDS } from "../../worker/src/skills/characters/combo.mts";
import { fixedAutoScenario } from "./fixtures/auto-scenario.mjs";

function card(instanceId, definitionId, ownerId = "p1") {
  return { instanceId, definitionId, kind: "character", ownerId };
}

function runtime(definitionId, event) {
  const { owner, opponent, state } = fixedAutoScenario();
  const role = card("role", definitionId);
  let prompt;
  let drawn = 0;
  let copied;
  let damage = 0;
  let healed = 0;
  let countered = false;
  const logs = [];
  const markerCounts = new Map();
  const context = {
    state,
    player: owner,
    role,
    event,
    opponent: () => opponent,
    setPrompt: (step, value, data, decisionPlayerId = owner.id) => { prompt = { id: "prompt", kind: "character-skill", playerId: decisionPlayerId, ...value, context: { continuation: { step, data } } }; },
    clearPrompt: () => { prompt = undefined; },
    draw: (count) => { drawn += count; return count; },
    takeTopHandCards: (count) => Array.from({ length: count }, () => state.handDeck.pop()).filter(Boolean),
    putHandDeckTop: (cards) => { for (const item of [...cards].reverse()) state.handDeck.push(item); },
    putHandDeckBottom: (cards) => { for (const item of [...cards].reverse()) state.handDeck.unshift(item); },
    gainFromHandDiscard: (ids) => ids.map((id) => {
      const [item] = state.handDiscard.splice(state.handDiscard.findIndex((candidate) => candidate.instanceId === id), 1);
      item.ownerId = owner.id;
      owner.hand.push(item);
      return item;
    }),
    shuffleFromHandDiscard: (ids) => ids.map((id) => {
      const [item] = state.handDiscard.splice(state.handDiscard.findIndex((candidate) => candidate.instanceId === id), 1);
      state.handDeck.push(item);
      return item;
    }),
    addModifier: (modifier) => state.turnModifiers.push(modifier),
    counterCurrentHand: () => { countered = true; return true; },
    damageOpponent: (amount) => { damage += amount; return amount; },
    heal: (amount) => { healed += amount; return amount; },
    markerCount: (label) => markerCounts.get(label) || 0,
    addCounterMarker: (label, amount = 1) => { markerCounts.set(label, (markerCounts.get(label) || 0) + amount); return markerCounts.get(label); },
    removeCounterMarker: (label, amount = 1) => {
      const value = markerCounts.get(label) || 0;
      if (value < amount) return 0;
      markerCounts.set(label, value - amount);
      return amount;
    },
    copyActionEffect: (copiedDefinitionId, targetSlotIndex) => { copied = { copiedDefinitionId, targetSlotIndex }; return true; },
    restOpponentCharacter: () => {},
    isActionCard: (id) => id.startsWith("hand_trick_"),
    handName: (id) => id,
    handLabel: (card) => `${card.suit || ""}${card.rank || ""}【${card.definitionId}】`,
    addLog: (message) => { logs.push(message); },
    emitEvent: () => {},
  };
  return {
    context, owner, opponent, state,
    getPrompt: () => prompt,
    getDrawn: () => drawn,
    getCopied: () => copied,
    getDamage: () => damage,
    getHealed: () => healed,
    getCountered: () => countered,
    getLogs: () => logs,
    markerCount: (label) => markerCounts.get(label) || 0,
  };
}

test("本地固定场景可指定牌序和双方角色位", () => {
  const scenario = fixedAutoScenario({
    ownerRoles: [COMBO_CHARACTER_IDS.prophet],
    opponentRoles: [COMBO_CHARACTER_IDS.sheriff],
    handDeck: ["hand_basic_001", "hand_trick_001"],
  });
  assert.equal(scenario.owner.characterSlots[0].definitionId, COMBO_CHARACTER_IDS.prophet);
  assert.equal(scenario.opponent.characterSlots[0].definitionId, COMBO_CHARACTER_IDS.sheriff);
  assert.equal(scenario.state.handDeck.pop().definitionId, "hand_trick_001");
});

test("已解锁预组的角色全部有稳定ID注册模块", () => {
  const registered = new Set(registeredCharacterSkillIds());
  const expected = new Set([...comboDeck.characterIds, ...aggroDeck.characterIds, ...mizaiDeck.characterIds, ...bloodDeck.characterIds, ...defenseDeck.characterIds, ...ambushDeck.characterIds, ...dispatchDeck.characterIds, ...transDeck.characterIds]);
  assert.equal(registered.size, expected.size);
  assert.deepEqual(expected, registered);
  for (const id of expected) {
    assert.ok(characterSkillForId(id));
    assert.equal(implementation[id].automation, "implemented");
  }
  assert.equal(characters.length, 120);
});

test("牌堆整理技能使用可序列化选择恢复牌序", () => {
  const module = characterSkillForId(COMBO_CHARACTER_IDS.prophet);
  const setup = runtime(module.cardId);
  setup.state.handDeck = [
    { instanceId: "bottom", definitionId: "hand_basic_001", kind: "hand" },
    { instanceId: "middle", definitionId: "hand_trick_001", kind: "hand" },
    { instanceId: "top", definitionId: "hand_basic_002", kind: "hand" },
  ];
  module.activate(setup.context);
  const prompt = setup.getPrompt();
  assert.equal(prompt.context.continuation.step, "prophet-order");
  module.resolveChoice({ ...setup.context, continuation: prompt.context.continuation }, prompt, { value: "1,3 | 2" });
  assert.deepEqual(setup.state.handDeck.map((item) => item.instanceId), ["middle", "bottom", "top"]);
});

test("延迟摸牌、充能球与行动牌复制都产生结构化状态", () => {
  const politician = runtime(COMBO_CHARACTER_IDS.politician);
  characterSkillForId(COMBO_CHARACTER_IDS.politician).activate(politician.context);
  assert.equal(politician.state.turnModifiers[0].kind, "combo-next-action-draw");

  const defect = runtime(COMBO_CHARACTER_IDS.defect);
  const defectModule = characterSkillForId(COMBO_CHARACTER_IDS.defect);
  defectModule.activate(defect.context);
  const defectPrompt = defect.getPrompt();
  defectModule.resolveChoice({ ...defect.context, continuation: defectPrompt.context.continuation }, defectPrompt, { value: "charge" });
  assert.equal(defect.getPrompt(), undefined);

  const event = { id: "action", type: "card_resolved", cardDefinitionId: "hand_trick_004", sourcePlayerId: "p1", metadata: { actionCard: true } };
  const morph = runtime(COMBO_CHARACTER_IDS.morphling, event);
  characterSkillForId(COMBO_CHARACTER_IDS.morphling).activate(morph.context);
  assert.deepEqual(morph.getCopied(), { copiedDefinitionId: "hand_trick_004", targetSlotIndex: undefined });
});

test("触发规则覆盖主动、己方结算和对手响应", () => {
  assert.deepEqual(characterSkillForId(COMBO_CHARACTER_IDS.watcherSearch).trigger, { event: "play_phase", relation: "source_self" });
  assert.deepEqual(characterSkillForId(COMBO_CHARACTER_IDS.watcherRecycle).trigger, { event: "action_resolved", relation: "source_self" });
  assert.deepEqual(characterSkillForId(COMBO_CHARACTER_IDS.pelican).trigger, { event: "action_used", relation: "source_opponent" });
  assert.deepEqual(characterSkillForId(COMBO_CHARACTER_IDS.ninja).trigger, { event: "card_responded", relation: "source_opponent" });
});

test("操作组的四类资源移动都验证实体牌", () => {
  const recycle = runtime(COMBO_CHARACTER_IDS.silentHunterRecycle);
  recycle.state.handDiscard.push({ instanceId: "action", definitionId: "hand_trick_001", kind: "hand" });
  const recycleModule = characterSkillForId(COMBO_CHARACTER_IDS.silentHunterRecycle);
  recycleModule.activate(recycle.context);
  const recyclePrompt = recycle.getPrompt();
  recycleModule.resolveChoice({ ...recycle.context, continuation: recyclePrompt.context.continuation }, recyclePrompt, { cardInstanceIds: ["action"] });
  assert.equal(recycle.owner.hand[0].instanceId, "action");

  const watcher = runtime(COMBO_CHARACTER_IDS.watcherRecycle, { id: "event", metadata: { cardInstanceId: "resolved" } });
  watcher.state.handDiscard.push({ instanceId: "resolved", definitionId: "hand_trick_002", kind: "hand" });
  characterSkillForId(COMBO_CHARACTER_IDS.watcherRecycle).activate(watcher.context);
  assert.equal(watcher.state.handDeck[0].instanceId, "resolved");
  assert.equal(watcher.getDrawn(), 1);

  const bird = runtime(COMBO_CHARACTER_IDS.birdEater);
  bird.state.handDiscard.push(
    { instanceId: "a", definitionId: "hand_trick_001", kind: "hand" },
    { instanceId: "b", definitionId: "hand_trick_002", kind: "hand" },
  );
  const birdModule = characterSkillForId(COMBO_CHARACTER_IDS.birdEater);
  birdModule.activate(bird.context);
  const birdPrompt = bird.getPrompt();
  birdModule.resolveChoice({ ...bird.context, continuation: birdPrompt.context.continuation }, birdPrompt, { cardInstanceIds: ["a", "b"] });
  assert.equal(bird.state.handDiscard.length, 0);
  assert.equal(bird.getDrawn(), 2);
});

test("正义使者只在行动牌未造成伤害后处理牌堆顶", () => {
  const module = characterSkillForId(COMBO_CHARACTER_IDS.justice);
  const damaged = runtime(COMBO_CHARACTER_IDS.justice, { id: "damaged", metadata: { causedDamage: true } });
  assert.equal(module.canActivate(damaged.context), false);

  const safe = runtime(COMBO_CHARACTER_IDS.justice, { id: "safe", metadata: { causedDamage: false } });
  safe.state.handDeck.push({ instanceId: "reviewed", definitionId: "hand_basic_001", kind: "hand" });
  assert.equal(module.canActivate(safe.context), true);
  module.activate(safe.context);
  const prompt = safe.getPrompt();
  module.resolveChoice({ ...safe.context, continuation: prompt.context.continuation }, prompt, { value: "discard" });
  assert.equal(safe.state.handDiscard[0].instanceId, "reviewed");
  assert.equal(safe.getPrompt(), undefined);
});

test("看牌、展示和宣言的多步选择保持私有提示", () => {
  const search = runtime(COMBO_CHARACTER_IDS.watcherSearch);
  search.state.handDeck.push(
    { instanceId: "basic", definitionId: "hand_basic_001", kind: "hand" },
    { instanceId: "action", definitionId: "hand_trick_001", kind: "hand" },
  );
  const searchModule = characterSkillForId(COMBO_CHARACTER_IDS.watcherSearch);
  searchModule.activate(search.context);
  const searchPrompt = search.getPrompt();
  const option = searchPrompt.options.find((candidate) => candidate.value.startsWith("take:0"));
  searchModule.resolveChoice({ ...search.context, continuation: searchPrompt.context.continuation }, searchPrompt, { value: option.value });
  assert.equal(search.owner.hand[0].definitionId, "hand_trick_001");

  const neo = runtime(COMBO_CHARACTER_IDS.neo);
  neo.owner.hand.push({ instanceId: "shown", definitionId: "hand_trick_005", kind: "hand", ownerId: "p1" });
  const neoModule = characterSkillForId(COMBO_CHARACTER_IDS.neo);
  neoModule.activate(neo.context);
  const neoPrompt = neo.getPrompt();
  neoModule.resolveChoice({ ...neo.context, continuation: neoPrompt.context.continuation }, neoPrompt, { cardInstanceIds: ["shown"] });
  assert.equal(neo.getDrawn(), 1);

  const sheriff = runtime(COMBO_CHARACTER_IDS.sheriff);
  const sheriffModule = characterSkillForId(COMBO_CHARACTER_IDS.sheriff);
  sheriffModule.activate(sheriff.context);
  const sheriffPrompt = sheriff.getPrompt();
  sheriffModule.resolveChoice({ ...sheriff.context, continuation: sheriffPrompt.context.continuation }, sheriffPrompt, { value: "action" });
  assert.equal(sheriff.state.turnModifiers[0].declaredHandType, "action");
  assert.equal(sheriff.state.turnModifiers[0].targetPlayerId, "p2");
  assert.ok(sheriff.getLogs().some((message) => message.includes("宣言了行动牌")));
});

test("攻防、响应和指定干扰技能进入统一规则原子", () => {
  const assassin = runtime(COMBO_CHARACTER_IDS.assassin);
  characterSkillForId(COMBO_CHARACTER_IDS.assassin).activate(assassin.context);
  assert.equal(assassin.getDamage(), 1);

  const pelican = runtime(COMBO_CHARACTER_IDS.pelican);
  pelican.state.stack.push({
    id: "target-action",
    kind: "hand",
    sourcePlayerId: "p2",
    card: { instanceId: "target-card", definitionId: "hand_trick_001", kind: "hand", ownerId: "p2" },
    definitionId: "hand_trick_001",
    mode: "play",
    cancelled: false,
  });
  characterSkillForId(COMBO_CHARACTER_IDS.pelican).activate(pelican.context);
  assert.equal(pelican.getCountered(), true);
  assert.equal(pelican.getDrawn(), 0);
  assert.equal(pelican.state.turnModifiers[0].kind, "combo-counter-action-draw");
  assert.equal(pelican.state.turnModifiers[0].targetCardInstanceId, "target-card");

  const priest = runtime(COMBO_CHARACTER_IDS.highPriest);
  characterSkillForId(COMBO_CHARACTER_IDS.highPriest).activate(priest.context);
  assert.equal(priest.getHealed(), 1);

  const ninja = runtime(COMBO_CHARACTER_IDS.ninja);
  characterSkillForId(COMBO_CHARACTER_IDS.ninja).activate(ninja.context);
  assert.equal(ninja.state.turnModifiers[0].kind, "extra-strike");

  const control = runtime(COMBO_CHARACTER_IDS.silentHunterControl);
  characterSkillForId(COMBO_CHARACTER_IDS.silentHunterControl).activate(control.context);
  assert.equal(control.state.turnModifiers[0].kind, "combo-direct-disrupt");
  control.opponent.hand.push({ instanceId: "private-card", definitionId: "hand_basic_001", kind: "hand", ownerId: "p2" });
  const controlModule = characterSkillForId(COMBO_CHARACTER_IDS.silentHunterControl);
  const prompt = {
    id: "direct",
    cardInstanceIds: ["private-card"],
    context: { continuation: { step: "direct-disrupt", data: { operation: "steal" } } },
  };
  controlModule.resolveChoice({ ...control.context, continuation: prompt.context.continuation }, prompt, { cardInstanceIds: ["private-card"] });
  assert.equal(control.owner.hand[0].instanceId, "private-card");
  assert.equal(control.getLogs().some((message) => message.includes("出刀")), false);
});

test("充能球移去后只会强化下一个其他角色技能", () => {
  const defect = runtime(COMBO_CHARACTER_IDS.defect);
  defect.context.addCounterMarker("充能球", 1);
  const module = characterSkillForId(COMBO_CHARACTER_IDS.defect);
  module.activate(defect.context);
  const prompt = defect.getPrompt();
  module.resolveChoice({ ...defect.context, continuation: prompt.context.continuation }, prompt, { value: "discharge" });
  assert.equal(defect.markerCount("充能球"), 0);
  assert.equal(defect.state.turnModifiers[0].kind, "combo-next-other-skill-damage");
  assert.equal(defect.state.turnModifiers[0].sourceDefinitionId, COMBO_CHARACTER_IDS.defect);
});
