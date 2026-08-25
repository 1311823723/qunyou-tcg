import assert from "node:assert/strict";
import test from "node:test";
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import mizaiDeck from "../../data/decks/mizai.deck.json" with { type: "json" };
import { HAND_IDS } from "../../worker/src/auto-engine.mts";
import { characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { MIZAI_CHARACTER_IDS } from "../../worker/src/skills/characters/mizai.mts";
import { fixedAutoScenario } from "./fixtures/auto-scenario.mjs";

function hand(instanceId, definitionId, extras = {}) {
  return { instanceId, definitionId, kind: "hand", ...extras };
}

function runtime(definitionId, event) {
  const { owner, opponent, state } = fixedAutoScenario({ ownerRoles: [definitionId] });
  owner.characterDeck = [];
  owner.retired = [];
  owner.banished = [];
  opponent.characterDeck = [];
  opponent.retired = [];
  opponent.banished = [];
  state.usageCounters = {};
  const role = owner.characterSlots[0];
  let prompt;
  let drawn = 0;
  let damage = 0;
  let usedBasic;
  const restedSlots = [];
  const inspections = [];
  const logs = [];
  const context = {
    state,
    player: owner,
    role,
    event,
    opponent: () => opponent,
    setPrompt: (step, value, data = {}, decisionPlayerId = owner.id) => {
      prompt = { id: crypto.randomUUID(), kind: "character-skill", playerId: decisionPlayerId, ...value, context: { continuation: { step, data } } };
    },
    clearPrompt: () => { prompt = undefined; },
    draw: (count) => { drawn += count; return count; },
    drawOpponent: () => 0,
    discardOwnHand: (ids) => ids.map((id) => owner.hand.splice(owner.hand.findIndex((card) => card.instanceId === id), 1)[0]),
    discardOpponentHand: (ids) => ids.map((id) => opponent.hand.splice(opponent.hand.findIndex((card) => card.instanceId === id), 1)[0]),
    discardRandomOpponent: (count) => opponent.hand.splice(0, count),
    gainRandomOpponentHand: () => {
      const card = opponent.hand.shift();
      if (card) owner.hand.push(card);
      return card;
    },
    canUseBasic: () => true,
    randomOpponentHand: () => opponent.hand[0],
    takeTopHandCards: (count) => Array.from({ length: count }, () => state.handDeck.pop()).filter(Boolean),
    putHandDeckTop: (cards) => { for (const card of [...cards].reverse()) state.handDeck.push(card); },
    putHandDeckBottom: (cards) => { for (const card of [...cards].reverse()) state.handDeck.unshift(card); },
    gainFromHandDiscard: () => [],
    shuffleFromHandDiscard: () => [],
    addModifier: (modifier) => state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: owner.id, ...modifier }),
    counterCurrentHand: () => true,
    damageOpponent: (amount) => { damage += amount; return amount; },
    heal: () => 0,
    markerCount: () => 0,
    addCounterMarker: () => 0,
    removeCounterMarker: () => 0,
    copyActionEffect: () => false,
    restOpponentCharacter: (slotIndex) => { restedSlots.push(slotIndex); opponent.characterSlots[slotIndex] = null; },
    revealOpponentCharacter: (slotIndex) => { opponent.characterSlots[slotIndex].faceDown = false; return opponent.characterSlots[slotIndex]; },
    banishOpponentCharacterUntilNextPreparation: () => undefined,
    lockOpponentCharacterReveal: () => {},
    placeOpponentBomb: () => {},
    shuffleSelfFromRetired: () => true,
    shuffleOwnRetired: () => true,
    banishOpponentRetired: () => true,
    makeCurrentStrikeUndodgeable: () => true,
    boostNextStrikeDamage: (amount = 1) => state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: owner.id, kind: "aggro-next-strike-damage", count: amount }),
    useOpponentBasic: (instanceId, basicId) => { usedBasic = { instanceId, definitionId: basicId }; },
    copyOpponentCharacterSkill: () => {},
    dodgeCurrentStrike: () => true,
    isActionCard: (id) => id.startsWith("hand_trick_"),
    handName: (id) => id,
    addLog: (message) => logs.push(message),
    emitEvent: (type, details) => { if (type === "inspection") inspections.push(details); },
  };
  return {
    context,
    owner,
    opponent,
    state,
    getPrompt: () => prompt,
    getDrawn: () => drawn,
    getDamage: () => damage,
    getUsedBasic: () => usedBasic,
    restedSlots,
    inspections,
    logs,
  };
}

function resolve(module, setup, payload) {
  const prompt = setup.getPrompt();
  return module.resolveChoice({ ...setup.context, continuation: prompt.context.continuation }, prompt, payload);
}

test("密裁组16张角色全部登记为全自动模块", () => {
  assert.equal(mizaiDeck.characterIds.length, 16);
  for (const id of mizaiDeck.characterIds) {
    assert.ok(characterSkillForId(id), `${id} missing module`);
    assert.equal(implementation[id].automation, "implemented");
  }
});

test("间谍与预言家把私有情报转化为结构化回合状态", () => {
  const spy = runtime(MIZAI_CHARACTER_IDS.spy);
  spy.opponent.hand.push(hand("strike", HAND_IDS.strike));
  const spyModule = characterSkillForId(MIZAI_CHARACTER_IDS.spy);
  spyModule.activate(spy.context);
  assert.equal(spy.getPrompt().playerId, spy.owner.id);
  assert.equal(spy.getPrompt().selectableCards[0].instanceId, "strike");
  resolve(spyModule, spy, { value: "done" });
  assert.equal(spy.state.turnModifiers[0].kind, "aggro-next-strike-damage");
  assert.equal(spy.inspections[0].metadata.inspectionKind, "opponentHand");

  const seer = runtime(MIZAI_CHARACTER_IDS.seer, { id: "strike", metadata: { cardInstanceId: "played" } });
  const seerModule = characterSkillForId(MIZAI_CHARACTER_IDS.seer);
  seerModule.activate(seer.context);
  resolve(seerModule, seer, { value: "no-damage" });
  assert.deepEqual(
    Object.fromEntries(Object.entries(seer.state.turnModifiers[0]).filter(([key]) => ["kind", "targetCardInstanceId", "predictedDamage"].includes(key))),
    { kind: "mizai-prediction", targetCardInstanceId: "played", predictedDamage: false },
  );
});

test("审判官在主动与基础牌需求窗口都由对手完成选择", () => {
  const setup = runtime(MIZAI_CHARACTER_IDS.judge);
  setup.opponent.hand.push(hand("gift", HAND_IDS.dodge));
  const module = characterSkillForId(MIZAI_CHARACTER_IDS.judge);
  module.activate(setup.context);
  resolve(module, setup, { value: HAND_IDS.strike });
  assert.equal(setup.getPrompt().playerId, setup.opponent.id);

  const response = runtime(MIZAI_CHARACTER_IDS.judge, { id: "need", metadata: { neededDefinitionId: HAND_IDS.dodge } });
  response.opponent.hand.push(hand("dodge", HAND_IDS.dodge));
  module.activate(response.context);
  resolve(module, response, { value: "give" });
  resolve(module, response, { cardInstanceIds: ["dodge"] });
  assert.deepEqual(response.getUsedBasic(), { instanceId: "dodge", definitionId: HAND_IDS.dodge });
});

test("拼点、牌堆整理与观看角色均使用真实实体牌", () => {
  const detective = runtime(MIZAI_CHARACTER_IDS.detective);
  detective.owner.hand.push(hand("own", HAND_IDS.draw, { rank: "K", suit: "黑桃" }));
  detective.opponent.hand.push(hand("their", HAND_IDS.strike, { rank: "2", suit: "红桃" }));
  detective.opponent.characterSlots = [{ instanceId: "hidden", definitionId: MIZAI_CHARACTER_IDS.avenger, kind: "character", faceDown: true }];
  const detectiveModule = characterSkillForId(MIZAI_CHARACTER_IDS.detective);
  detectiveModule.activate(detective.context);
  resolve(detectiveModule, detective, { cardInstanceIds: ["own"] });
  resolve(detectiveModule, detective, { cardInstanceIds: ["their"] });
  resolve(detectiveModule, detective, { value: "role" });
  resolve(detectiveModule, detective, { value: "0" });
  assert.equal(detective.getPrompt().selectableCards[0].instanceId, "hidden");
  assert.equal(detective.state.handDiscard.length, 2);

  const watcher = runtime(MIZAI_CHARACTER_IDS.baiziWatcher);
  watcher.state.handDeck.push(
    hand("bottom", HAND_IDS.draw, { suit: "黑桃" }),
    hand("top", HAND_IDS.strike, { suit: "梅花" }),
  );
  const watcherModule = characterSkillForId(MIZAI_CHARACTER_IDS.baiziWatcher);
  watcherModule.activate(watcher.context);
  resolve(watcherModule, watcher, { value: "0" });
  assert.equal(watcher.owner.hand.at(-1).instanceId, "top");
  assert.equal(watcher.state.handDeck[0].instanceId, "bottom");

  const neo = runtime(MIZAI_CHARACTER_IDS.neo);
  neo.state.handDeck.push(hand("a", HAND_IDS.draw), hand("b", HAND_IDS.strike), hand("c", HAND_IDS.aid));
  const neoModule = characterSkillForId(MIZAI_CHARACTER_IDS.neo);
  neoModule.activate(neo.context);
  resolve(neoModule, neo, { value: "0|1,2" });
  assert.equal(neo.owner.hand.at(-1).instanceId, "c");
  assert.deepEqual(neo.state.handDeck.map((card) => card.instanceId), ["a", "b"]);
});

test("密裁组攻防与退场触发进入统一规则原子", () => {
  const avenger = runtime(MIZAI_CHARACTER_IDS.avenger);
  avenger.state.usageCounters[`damage-events-dealt:${avenger.state.turnNumber}:${avenger.owner.id}`] = 2;
  const avengerModule = characterSkillForId(MIZAI_CHARACTER_IDS.avenger);
  assert.equal(avengerModule.canActivate(avenger.context), true);
  avengerModule.activate(avenger.context);
  assert.equal(avenger.state.turnModifiers[0].kind, "extra-strike");

  const assassin = runtime(MIZAI_CHARACTER_IDS.assassin);
  assassin.opponent.hand.push(hand("dodge", HAND_IDS.dodge));
  const assassinModule = characterSkillForId(MIZAI_CHARACTER_IDS.assassin);
  assassinModule.activate(assassin.context);
  resolve(assassinModule, assassin, { cardInstanceIds: ["dodge"] });
  assert.equal(assassin.getDrawn(), 1);

  const ironclad = runtime(MIZAI_CHARACTER_IDS.ironclad);
  ironclad.owner.hand.push(hand("cost", HAND_IDS.draw));
  const ironcladModule = characterSkillForId(MIZAI_CHARACTER_IDS.ironclad);
  ironcladModule.activate(ironclad.context);
  resolve(ironcladModule, ironclad, { cardInstanceIds: ["cost"] });
  assert.deepEqual(ironclad.state.turnModifiers.map((modifier) => modifier.kind), ["aggro-next-strike-damage", "mizai-next-strike-undodgeable"]);

  const bomber = runtime(MIZAI_CHARACTER_IDS.bomber);
  bomber.opponent.hand.push(
    hand("black-a", HAND_IDS.strike, { suit: "黑桃" }),
    hand("black-b", HAND_IDS.dodge, { suit: "梅花" }),
    hand("red", HAND_IDS.aid, { suit: "红桃" }),
  );
  characterSkillForId(MIZAI_CHARACTER_IDS.bomber).activate(bomber.context);
  assert.equal(bomber.opponent.hand.length, 0);
  assert.equal(bomber.getDamage(), 1);
});

test("审讯、神佑、退场收益与说客保持选择方和收益方分离", () => {
  const sheriff = runtime(MIZAI_CHARACTER_IDS.sheriff);
  sheriff.opponent.hand.push(hand("shown", HAND_IDS.draw));
  const sheriffModule = characterSkillForId(MIZAI_CHARACTER_IDS.sheriff);
  sheriffModule.activate(sheriff.context);
  assert.equal(sheriff.getPrompt().playerId, sheriff.opponent.id);
  resolve(sheriffModule, sheriff, { value: "show" });
  assert.equal(sheriff.getPrompt().playerId, sheriff.owner.id);

  const priest = runtime(MIZAI_CHARACTER_IDS.highPriest);
  priest.opponent.hand.push(hand("seen", HAND_IDS.strike));
  const priestModule = characterSkillForId(MIZAI_CHARACTER_IDS.highPriest);
  priestModule.activate(priest.context);
  resolve(priestModule, priest, { value: "done" });
  assert.equal(priest.getDrawn(), 1);

  const undertaker = runtime(MIZAI_CHARACTER_IDS.undertaker, { targetPlayerId: "p1" });
  characterSkillForId(MIZAI_CHARACTER_IDS.undertaker).activate(undertaker.context);
  assert.equal(undertaker.getDrawn(), 2);

  const lobbyist = runtime(MIZAI_CHARACTER_IDS.lobbyist);
  lobbyist.opponent.hand.push(hand("gift", HAND_IDS.draw));
  const lobbyistModule = characterSkillForId(MIZAI_CHARACTER_IDS.lobbyist);
  lobbyistModule.activate(lobbyist.context);
  assert.equal(lobbyist.getPrompt().playerId, lobbyist.opponent.id);
  resolve(lobbyistModule, lobbyist, { value: "give" });
  assert.equal(lobbyist.owner.hand.at(-1).instanceId, "gift");
});
