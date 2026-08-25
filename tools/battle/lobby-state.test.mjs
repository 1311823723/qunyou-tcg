import assert from "node:assert/strict";
import test from "node:test";
import { buildLobbyRoomSummary, pruneLobbyRooms, sortLobbyRooms } from "../../worker/src/lobby-state.mts";

function summary(roomCode, status, createdAt, updatedAt = createdAt) {
  return {
    roomCode,
    status,
    players: [],
    playerCount: 0,
    capacity: 2,
    joinable: status === "waiting",
    spectatorCount: 0,
    createdAt,
    updatedAt,
  };
}

test("lobby pruning removes expired summaries without mutating stored input", () => {
  const source = {
    FRESH1: summary("FRESH1", "waiting", 900, 900),
    EXPIRE: summary("EXPIRE", "playing", 0, 0),
  };
  const result = pruneLobbyRooms(source, 1_000, 500);
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.rooms), ["FRESH1"]);
  assert.deepEqual(Object.keys(source), ["FRESH1", "EXPIRE"]);
});

test("lobby sorting keeps waiting rooms first and newest rooms first", () => {
  const rooms = sortLobbyRooms([
    summary("PLAY01", "playing", 900),
    summary("WAIT01", "waiting", 700),
    summary("WAIT02", "waiting", 800),
  ]);
  assert.deepEqual(rooms.map((room) => room.roomCode), ["WAIT02", "WAIT01", "PLAY01"]);
});

test("room summaries only allow joining an online host with an open waiting seat", () => {
  const state = {
    roomCode: "ROOM01",
    started: false,
    createdAt: 100,
    players: [{ nickname: "房主" }],
    spectators: [],
  };
  const open = buildLobbyRoomSummary(state, 200);
  assert.equal(open.mode, "classic");
  assert.equal(open.joinable, true);
  assert.equal(open.status, "waiting");
  assert.deepEqual(open.players, [{ nickname: "房主", connected: true }]);

  const disconnected = buildLobbyRoomSummary({ ...state, players: [{ nickname: "房主", disconnectedAt: 150 }] }, 200);
  assert.equal(disconnected.joinable, false);
  const playing = buildLobbyRoomSummary({ ...state, started: true, startedAt: 180 }, 200);
  assert.equal(playing.joinable, false);
  assert.equal(playing.status, "playing");
  assert.equal(playing.startedAt, 180);
});
