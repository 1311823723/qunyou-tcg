import type { CardInstance, PlayerState, RoomState } from "./types";

export const ROOM_STATE_VERSION = 3;

type LegacyPlayerState = PlayerState & {
  characterHand?: CardInstance[];
};

export function migrateRoomState(
  state: RoomState,
  shuffle: <T>(items: T[]) => T[],
) {
  const previousVersion = state.stateVersion || 1;
  if (previousVersion >= ROOM_STATE_VERSION) {
    return { migrated: false, recycledCount: 0 };
  }

  let recycledCount = 0;
  if (previousVersion < 2) {
    for (const player of state.players) {
      const legacyPlayer = player as LegacyPlayerState;
      const legacyHand = Array.isArray(legacyPlayer.characterHand) ? legacyPlayer.characterHand : [];
      if (legacyHand.length) {
        player.characterDeck = shuffle([...player.characterDeck, ...legacyHand]);
        recycledCount += legacyHand.length;
      }
      delete legacyPlayer.characterHand;
    }
  }

  if (state.started && !state.startedAt) state.startedAt = state.lastActivityAt || state.createdAt;

  state.stateVersion = ROOM_STATE_VERSION;
  state.revision = (state.revision || 0) + 1;
  return { migrated: true, recycledCount };
}
