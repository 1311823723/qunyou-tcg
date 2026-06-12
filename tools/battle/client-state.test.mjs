import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBattleSnapshot } from "../../src/scripts/battle-state.mjs";

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
        characterHand: [],
        characterDeckCount: 12,
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

test("private card counts fall back to redacted arrays", () => {
  const normalized = normalizeBattleSnapshot(snapshot({
    hand: [{ faceDown: true }, { faceDown: true }],
    characterHand: [{ faceDown: true }],
  }));
  const opponent = normalized.players[1];
  assert.equal(opponent.handCount, 2);
  assert.equal(opponent.characterHandCount, 1);
});

test("count-only legacy snapshots receive safe card-back placeholders", () => {
  const normalized = normalizeBattleSnapshot(snapshot({
    handCount: 5,
    characterHandCount: 4,
  }));
  const opponent = normalized.players[1];
  assert.equal(opponent.hand.length, 5);
  assert.equal(opponent.characterHand.length, 4);
  assert.ok([...opponent.hand, ...opponent.characterHand].every((card) =>
    card.faceDown && !card.instanceId && !card.definitionId
  ));
});
