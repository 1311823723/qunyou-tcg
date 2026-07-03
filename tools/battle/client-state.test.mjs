import assert from "node:assert/strict";
import test from "node:test";
import { defaultHandLimit, normalizeBattleSnapshot } from "../../src/scripts/battle-state.mjs";

function snapshot(player) {
  return {
    roomCode: "ABC123",
    you: "p1",
    revision: 1,
    players: [
      {
        id: "p1",
        nickname: "自己",
        ready: true,
        connected: true,
        hand: [],
        characterDeckCount: 14,
        characterSlots: [null, null, null, null],
        retired: [],
        banished: [],
      },
      {
        id: "p2",
        nickname: "对手",
        ready: true,
        connected: true,
        characterDeckCount: 12,
        characterSlots: [null, null, null, null],
        retired: [],
        banished: [],
        ...player,
      },
    ],
    game: {
      started: true,
      turnNumber: 1,
      handDeckCount: 42,
      handDiscard: [],
      resolving: [],
      logs: [],
    },
  };
}

test("private hand counts fall back to redacted arrays", () => {
  const normalized = normalizeBattleSnapshot(snapshot({
    hand: [{ faceDown: true }, { faceDown: true }],
  }));
  const opponent = normalized.players[1];
  assert.equal(opponent.handCount, 2);
});

test("count-only legacy snapshots receive safe card-back placeholders", () => {
  const normalized = normalizeBattleSnapshot(snapshot({
    handCount: 5,
    characterHand: [{ faceDown: true }],
    characterHandCount: 4,
  }));
  const opponent = normalized.players[1];
  assert.equal(opponent.hand.length, 5);
  assert.ok(opponent.hand.every((card) =>
    card.faceDown && !card.instanceId && !card.definitionId
  ));
  assert.equal("characterHand" in opponent, false);
  assert.equal("characterHandCount" in opponent, false);
});

test("default hand limit uses capped health plus revealed characters", () => {
  assert.equal(defaultHandLimit({ health: 7, characterSlots: [null, null] }), 4);
  assert.equal(defaultHandLimit({
    health: 3,
    characterSlots: [
      { instanceId: "face-up-1", faceDown: false },
      { instanceId: "face-down", faceDown: true },
      { id: "marker", label: "标记" },
      { instanceId: "face-up-2", faceDown: false },
    ],
  }), 5);
  assert.equal(defaultHandLimit({
    health: 0,
    characterSlots: [{ instanceId: "face-up", faceDown: false }],
  }), 1);
});
