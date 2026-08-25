import type { LobbyRoomSummary, RoomState } from "./types";

export function pruneLobbyRooms(
  source: Record<string, LobbyRoomSummary>,
  now: number,
  ttlMs: number,
) {
  const rooms = { ...source };
  let changed = false;
  for (const [code, room] of Object.entries(rooms)) {
    if (now - room.updatedAt < ttlMs) continue;
    delete rooms[code];
    changed = true;
  }
  return { rooms, changed };
}

export function sortLobbyRooms(rooms: LobbyRoomSummary[]) {
  return [...rooms].sort((left, right) => {
    if (left.status !== right.status) return left.status === "waiting" ? -1 : 1;
    return right.createdAt - left.createdAt;
  });
}

export function buildLobbyRoomSummary(state: RoomState, now: number): LobbyRoomSummary {
  const hostConnected = !state.players[0]?.disconnectedAt;
  return {
    mode: "classic",
    roomCode: state.roomCode,
    status: state.started ? "playing" : "waiting",
    players: state.players.map((player) => ({
      nickname: player.nickname,
      connected: !player.disconnectedAt,
    })),
    playerCount: state.players.length,
    capacity: 2,
    joinable: !state.started && state.players.length < 2 && hostConnected,
    spectatorCount: state.spectators.length,
    createdAt: state.createdAt,
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    updatedAt: now,
  };
}
