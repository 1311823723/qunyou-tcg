import assert from "node:assert/strict";
import test from "node:test";
import { migrateRoomState, ROOM_STATE_VERSION } from "../../worker/src/state-migration.mts";

function character(id) {
  return {
    instanceId: id,
    definitionId: `definition-${id}`,
    kind: "character",
    ownerId: "p1",
  };
}

test("legacy character hands migrate into character decks exactly once", () => {
  const state = {
    revision: 7,
    players: [{
      id: "p1",
      characterDeck: [character("deck-1"), character("deck-2")],
      characterHand: [character("hand-1"), character("hand-2")],
    }],
  };
  const deterministicShuffle = (items) => [...items].reverse();

  const first = migrateRoomState(state, deterministicShuffle);
  assert.deepEqual(first, { migrated: true, recycledCount: 2 });
  assert.equal(state.stateVersion, ROOM_STATE_VERSION);
  assert.equal(state.revision, 8);
  assert.equal("characterHand" in state.players[0], false);
  assert.deepEqual(
    state.players[0].characterDeck.map((card) => card.instanceId),
    ["hand-2", "hand-1", "deck-2", "deck-1"],
  );

  const second = migrateRoomState(state, deterministicShuffle);
  assert.deepEqual(second, { migrated: false, recycledCount: 0 });
  assert.equal(state.revision, 8);
  assert.deepEqual(
    state.players[0].characterDeck.map((card) => card.instanceId),
    ["hand-2", "hand-1", "deck-2", "deck-1"],
  );
});
