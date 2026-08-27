import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_STATE_VERSION,
  HAND_IDS,
  advancePhase,
  beginResponseWindow,
  canUseInPlay,
  deployTopCharacter,
  drawCards,
  handLimit,
  legalResponseCards,
  passResponseWindow,
} from "../../worker/src/auto-engine.mts";

function card(instanceId, definitionId, ownerId = "p1") {
  return { instanceId, definitionId, ownerId, kind: definitionId.startsWith("hand_") ? "hand" : "character" };
}

function player(id, bodyDefinitionId = "body_aggro_001") {
  return {
    id, token: id, nickname: id, ready: true, health: 7, maxHealth: 7,
    body: card(`${id}-body`, bodyDefinitionId, id),
    bodyState: { progress: 0, progressMax: 6, flipped: false, extraFormUsed: false, trackedCharacterInstanceIds: [] },
    hand: [], characterDeck: [], characterSlots: [null, null, null, null], markers: [], retired: [], banished: [],
  };
}

function state() {
  const p1 = player("p1");
  const p2 = player("p2");
  return {
    stateVersion: AUTO_STATE_VERSION, mode: "auto", roomCode: "AUTO01", createdAt: 0, lastActivityAt: 0,
    started: true, players: [p1, p2], spectators: [], handDeck: [], handDiscard: [], resolving: [],
    currentPlayerId: "p1", firstPlayerId: "p1", turnNumber: 1, phase: "preparation", stack: [],
    consecutivePasses: 0, usageCounters: {}, turnModifiers: [], deployedThisPhase: 0,
    recentEvents: [], pendingBodyTriggers: [],
    revision: 0, logs: [], processedActionIds: [],
  };
}

test("automatic hand limit uses capped health and at most two revealed characters", () => {
  const owner = player("p1");
  owner.health = 6;
  owner.characterSlots = [
    { ...card("c1", "char_001", "p1"), faceDown: false },
    { ...card("c2", "char_002", "p1"), faceDown: false },
    { ...card("c3", "char_003", "p1"), faceDown: false },
    { ...card("c4", "char_004", "p1"), faceDown: true },
  ];
  assert.equal(handLimit(owner), 6);
  owner.health = 2;
  assert.equal(handLimit(owner), 4);
});

test("draw recycles discard only when the shared deck runs out", () => {
  const room = state();
  room.handDeck = [card("a", HAND_IDS.strike, undefined)];
  room.handDiscard = [card("b", HAND_IDS.aid, undefined)];
  assert.equal(drawCards(room, room.players[0], 2, (items) => items), 2);
  assert.equal(room.players[0].hand.length, 2);
  assert.equal(room.handDiscard.length, 0);
});

test("phase advancement draws automatically and blocks excess hand at discard", () => {
  const room = state();
  room.handDeck = [card("a", HAND_IDS.strike, undefined), card("b", HAND_IDS.aid, undefined)];
  assert.equal(advancePhase(room, room.players[0], (items) => items), "draw");
  assert.equal(room.players[0].hand.length, 2);
  room.phase = "discard";
  room.players[0].hand = Array.from({ length: 6 }, (_, index) => card(`h${index}`, HAND_IDS.strike));
  assert.equal(advancePhase(room, room.players[0], (items) => items), "discard");
  assert.equal(room.prompt.kind, "discard");
  assert.equal(room.prompt.min, 2);
});

test("deployment uses the lowest empty slot and stops at four roles", () => {
  const owner = player("p1");
  owner.characterSlots[0] = card("existing", "char_a");
  owner.characterDeck = [card("bottom", "char_b"), card("top", "char_c")];
  const deployed = deployTopCharacter(owner);
  assert.equal(deployed.slotIndex, 1);
  assert.equal(deployed.card.instanceId, "top");
  assert.equal(deployed.card.faceDown, true);
});

test("response legality keeps private hand choices scoped to current responder", () => {
  const room = state();
  room.players[1].hand = [
    card("dodge", HAND_IDS.dodge, "p2"),
    card("counter", HAND_IDS.counter, "p2"),
    card("meeting", HAND_IDS.meeting, "p2"),
    card("joker", HAND_IDS.impersonate, "p2"),
  ];
  room.stack = [{ kind: "hand", id: "strike", sourcePlayerId: "p1", targetPlayerId: "p2", card: card("s", HAND_IDS.strike), definitionId: HAND_IDS.strike }];
  room.responsePlayerId = "p2";
  room.prompt = { id: "prompt", kind: "response", playerId: "p2", title: "响应", message: "响应" };
  assert.deepEqual(legalResponseCards(room, room.players[1]).map((item) => item.instanceId).sort(), ["dodge", "joker", "meeting"]);
  room.responsePlayerId = "p1";
  room.prompt.playerId = "p1";
  room.players[0].hand = [card("source-joker", HAND_IDS.impersonate, "p1")];
  assert.deepEqual(legalResponseCards(room, room.players[0]), [], "the strike source cannot dodge its own strike with the small joker");
  room.responsePlayerId = "p2";
  room.prompt.playerId = "p2";
  assert.deepEqual(legalResponseCards(room, room.players[0]), []);
});

test("a responder passing closes only that card's response window", () => {
  const room = state();
  const strike = { kind: "hand", id: "strike", sourcePlayerId: "p1", targetPlayerId: "p2", card: card("s", HAND_IDS.strike), definitionId: HAND_IDS.strike };
  room.stack = [strike];
  beginResponseWindow(room, strike);
  assert.equal(room.responsePlayerId, "p2");
  assert.match(room.prompt.message, /【出刀】正对你生效/);
  assert.equal(passResponseWindow(room, "p2"), "resolve");
  assert.equal(strike.responseWindowClosed, true);
  assert.equal(room.prompt, undefined);
  assert.notEqual(room.responsePlayerId, "p1", "the source must not be asked to respond to its own strike");
});

test("passing a source-only skill window opens the real target response", () => {
  const room = state();
  const strike = { kind: "hand", id: "strike", sourcePlayerId: "p1", targetPlayerId: "p2", card: card("s", HAND_IDS.strike), definitionId: HAND_IDS.strike };
  room.stack = [strike];
  room.responsePlayerId = "p1";
  room.prompt = { id: "source-skill", kind: "response", playerId: "p1", title: "技能窗口", message: "技能", context: { skillOnly: true } };
  assert.equal(passResponseWindow(room, "p1"), "response");
  assert.equal(room.responsePlayerId, "p2");
  assert.equal(strike.responseWindowClosed, undefined);
});

test("turn advancement preserves game limits and clears turn-scoped counters", () => {
  const room = state();
  room.phase = "end";
  room.usageCounters = {
    "skill:game:p1:limited": 1,
    "body:game:p1:z-used": 1,
    "skill:turn:1:p1:once": 1,
    "skill-actions:1:p1": 2,
  };
  assert.equal(advancePhase(room, room.players[0], (items) => items), "preparation");
  assert.deepEqual(room.usageCounters, { "skill:game:p1:limited": 1, "body:game:p1:z-used": 1 });
  assert.equal(room.currentPlayerId, "p2");
});

test("间谍的无出刀分支只封锁本回合主动出刀", () => {
  const room = state();
  room.phase = "play";
  room.turnModifiers.push({ id: "spy", ownerId: "p1", kind: "mizai-strike-block", count: 1 });
  assert.equal(canUseInPlay(room, room.players[0], HAND_IDS.strike), false);
  assert.equal(canUseInPlay(room, room.players[0], HAND_IDS.draw), true);
});

test("拟态的本回合费用减免会过期，执棋Z招式的下一次减免会保留", () => {
  const room = state();
  room.phase = "end";
  room.turnModifiers = [
    { id: "trans", ownerId: "p1", kind: "body-next-skill-cost-rest-one", count: 1, characterInstanceId: "c1", expiresAtTurnNumber: 2 },
    { id: "dispatch", ownerId: "p1", kind: "body-next-skill-cost-rest-one", count: 1, characterInstanceId: "c2" },
  ];
  advancePhase(room, room.players[0], (items) => items);
  assert.deepEqual(room.turnModifiers.map((modifier) => modifier.id), ["dispatch"]);
});
