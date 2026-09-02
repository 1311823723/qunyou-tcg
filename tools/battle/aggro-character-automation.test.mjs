import assert from "node:assert/strict";
import test from "node:test";
import aggroDeck from "../../data/decks/aggro.deck.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { AGGRO_CHARACTER_IDS } from "../../worker/src/skills/characters/aggro.mts";
import { fixedAutoScenario } from "./fixtures/auto-scenario.mjs";

function runtime(definitionId) {
  const { owner, opponent, state } = fixedAutoScenario({ ownerRoles: [definitionId] });
  owner.characterDeck = [];
  owner.retired = [];
  owner.banished = [];
  opponent.characterDeck = [];
  opponent.retired = [];
  opponent.banished = [];
  const role = owner.characterSlots[0];
  let prompt;
  let damage = 0;
  let opponentDraw = 0;
  let copiedSlot;
  let bombSlot;
  let lockedSlot;
  let undodgeable = false;
  let dodged = false;
  const discarded = [];
  const logs = [];
  const context = {
    state,
    player: owner,
    role,
    opponent: () => opponent,
    setPrompt: (step, value, data = {}, decisionPlayerId = owner.id) => {
      prompt = { id: "prompt", kind: "character-skill", playerId: decisionPlayerId, ...value, context: { continuation: { step, data } } };
    },
    clearPrompt: () => { prompt = undefined; },
    draw: () => 1,
    drawOpponent: (count) => { opponentDraw += count; return count; },
    discardOwnHand: (ids) => ids.map((id) => owner.hand.splice(owner.hand.findIndex((card) => card.instanceId === id), 1)[0]),
    discardOpponentHand: (ids) => ids.map((id) => opponent.hand.splice(opponent.hand.findIndex((card) => card.instanceId === id), 1)[0]),
    discardRandomOpponent: (count) => opponent.hand.splice(0, count),
    randomOpponentHand: () => opponent.hand[0],
    takeTopHandCards: () => [],
    putHandDeckTop: () => {},
    putHandDeckBottom: () => {},
    gainFromHandDiscard: () => [],
    shuffleFromHandDiscard: () => [],
    addModifier: (modifier) => state.turnModifiers.push(modifier),
    counterCurrentHand: () => true,
    damageOpponent: (amount) => { damage += amount; return amount; },
    heal: () => 0,
    markerCount: () => 0,
    addCounterMarker: () => 0,
    removeCounterMarker: () => 0,
    copyActionEffect: () => true,
    restOpponentCharacter: () => {},
    revealOpponentCharacter: (slotIndex) => { opponent.characterSlots[slotIndex].faceDown = false; return opponent.characterSlots[slotIndex]; },
    banishOpponentCharacterUntilNextPreparation: (slotIndex) => opponent.characterSlots[slotIndex],
    lockOpponentCharacterReveal: (slotIndex) => { lockedSlot = slotIndex; },
    placeOpponentBomb: (slotIndex) => { bombSlot = slotIndex; },
    shuffleSelfFromRetired: () => true,
    shuffleOwnRetired: () => true,
    banishOpponentRetired: () => true,
    makeCurrentStrikeUndodgeable: () => { undodgeable = true; return true; },
    boostNextStrikeDamage: (amount = 1) => state.turnModifiers.push({ kind: "aggro-next-strike-damage", count: amount }),
    copyOpponentCharacterSkill: (slotIndex) => { copiedSlot = slotIndex; },
    dodgeCurrentStrike: () => { dodged = true; return true; },
    currentStrikeCanBeDodged: () => true,
    isActionCard: (id) => id.startsWith("hand_trick_"),
    handName: (id) => id,
    handLabel: (card) => `${card.suit || ""}${card.rank || ""}【${card.definitionId}】`,
    addLog: (message) => logs.push(message),
    emitEvent: () => {},
  };
  return {
    context, owner, opponent, state,
    getPrompt: () => prompt,
    getDamage: () => damage,
    getOpponentDraw: () => opponentDraw,
    getCopiedSlot: () => copiedSlot,
    getBombSlot: () => bombSlot,
    getLockedSlot: () => lockedSlot,
    getUndodgeable: () => undodgeable,
    getDodged: () => dodged,
    discarded,
    logs,
  };
}

function resolve(module, setup, payload) {
  const prompt = setup.getPrompt();
  return module.resolveChoice({ ...setup.context, continuation: prompt.context.continuation }, prompt, payload);
}

test("上头组16张角色全部登记为全自动模块", () => {
  assert.equal(aggroDeck.characterIds.length, 16);
  for (const id of aggroDeck.characterIds) {
    assert.ok(characterSkillForId(id), `${id} missing module`);
    assert.equal(implementation[id].automation, "implemented");
  }
});

test("刺客的花色宣言与定位识破均按真实牌和角色数据结算", () => {
  const suit = runtime(AGGRO_CHARACTER_IDS.kekeAssassin);
  suit.opponent.hand.push({ instanceId: "shown", definitionId: "hand_basic_001", kind: "hand", suit: "红桃" });
  const suitModule = characterSkillForId(AGGRO_CHARACTER_IDS.kekeAssassin);
  suitModule.activate(suit.context);
  resolve(suitModule, suit, { value: "红桃" });
  assert.equal(suit.getDamage(), 1);

  const identity = runtime(AGGRO_CHARACTER_IDS.weixiaokeleAssassin);
  identity.opponent.characterSlots = [{ instanceId: "hidden", definitionId: AGGRO_CHARACTER_IDS.baiziBomber, kind: "character", faceDown: true }];
  const identityModule = characterSkillForId(AGGRO_CHARACTER_IDS.weixiaokeleAssassin);
  identityModule.activate(identity.context);
  resolve(identityModule, identity, { value: "强攻" });
  resolve(identityModule, identity, { value: "0" });
  assert.equal(identity.opponent.characterSlots[0].faceDown, false);
  assert.equal(identity.getDamage(), 1);
});

test("延迟、封锁、炸弹和拟态技能生成可序列化选择", () => {
  const pelican = runtime(AGGRO_CHARACTER_IDS.pelican);
  pelican.opponent.characterSlots = [{ instanceId: "target", definitionId: AGGRO_CHARACTER_IDS.baiziBomber, kind: "character", faceDown: false }];
  const pelicanModule = characterSkillForId(AGGRO_CHARACTER_IDS.pelican);
  pelicanModule.activate(pelican.context);
  resolve(pelicanModule, pelican, { value: "0" });
  assert.equal(pelican.getDamage(), 1);

  const ninja = runtime(AGGRO_CHARACTER_IDS.baiziNinja);
  ninja.opponent.characterSlots = [{ instanceId: "hidden", definitionId: AGGRO_CHARACTER_IDS.baiziBomber, kind: "character", faceDown: true }];
  const ninjaModule = characterSkillForId(AGGRO_CHARACTER_IDS.baiziNinja);
  ninjaModule.activate(ninja.context);
  resolve(ninjaModule, ninja, { value: "0" });
  assert.equal(ninja.getLockedSlot(), 0);

  const bomb = runtime(AGGRO_CHARACTER_IDS.weixiaokeleBomber);
  bomb.opponent.characterSlots = [null];
  const bombModule = characterSkillForId(AGGRO_CHARACTER_IDS.weixiaokeleBomber);
  bombModule.activate(bomb.context);
  resolve(bombModule, bomb, { value: "0" });
  assert.equal(bomb.getBombSlot(), 0);

  const morph = runtime(AGGRO_CHARACTER_IDS.morphling);
  morph.opponent.characterSlots = [{ instanceId: "revealed", definitionId: AGGRO_CHARACTER_IDS.lobbyist, kind: "character", faceDown: false }];
  const morphModule = characterSkillForId(AGGRO_CHARACTER_IDS.morphling);
  morphModule.activate(morph.context);
  resolve(morphModule, morph, { value: "0" });
  assert.equal(morph.getCopiedSlot(), 0);
});

test("攻击强化、不可闪避和虚拟闪避使用统一结算原子", () => {
  const lobbyist = runtime(AGGRO_CHARACTER_IDS.lobbyist);
  characterSkillForId(AGGRO_CHARACTER_IDS.lobbyist).activate(lobbyist.context);
  assert.equal(lobbyist.state.turnModifiers[0].kind, "aggro-next-strike-damage");

  const ninja = runtime(AGGRO_CHARACTER_IDS.weixiaokeleNinja);
  characterSkillForId(AGGRO_CHARACTER_IDS.weixiaokeleNinja).activate(ninja.context);
  assert.equal(ninja.getUndodgeable(), true);

  const gravy = runtime(AGGRO_CHARACTER_IDS.gravy);
  gravy.owner.hand.push({ instanceId: "cost", definitionId: "hand_trick_001", kind: "hand" });
  const gravyModule = characterSkillForId(AGGRO_CHARACTER_IDS.gravy);
  gravyModule.activate(gravy.context);
  resolve(gravyModule, gravy, { cardInstanceIds: ["cost"] });
  assert.equal(gravy.owner.hand.length, 0);
  assert.equal(gravy.getDodged(), true);
});
