export const TOKEN_KEY = "qunyou-battle-token-v1";
export const PENDING_KEY = "qunyou-battle-pending-v1";
export const PROFILE_KEY = "qunyou-battle-profile-v1";
export const ACTIVE_ROOMS_KEY = "qunyou-battle-active-rooms-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type BattleProfile = { nickname: string };
export type ActiveRoomRecord = { role: "player"; joinedAt: number };

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    return value && typeof value === "object" ? value as T : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeNickname(value: unknown) {
  return String(value || "").trim().slice(0, 20);
}

export function readPending(storage: StorageLike = localStorage) {
  return readJson<Record<string, unknown>>(storage, PENDING_KEY, {});
}

export function readProfile(storage: StorageLike = localStorage): BattleProfile | undefined {
  const profile = readJson<Partial<BattleProfile>>(storage, PROFILE_KEY, {});
  const nickname = normalizeNickname(profile.nickname);
  if (nickname) return { nickname };

  const pending = readPending(storage);
  const migratedNickname = normalizeNickname(pending.nickname);
  if (!migratedNickname) return undefined;
  const migrated = { nickname: migratedNickname };
  storage.setItem(PROFILE_KEY, JSON.stringify(migrated));
  return migrated;
}

export function saveProfile(nickname: unknown, storage: StorageLike = localStorage): BattleProfile {
  const normalized = normalizeNickname(nickname);
  if (!normalized) throw new Error("请输入 1–20 个字符的用户名。");
  const profile = { nickname: normalized };
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
  const pending = readPending(storage);
  storage.setItem(PENDING_KEY, JSON.stringify({ ...pending, nickname: normalized }));
  return profile;
}

export function getBattleToken(storage: StorageLike = localStorage) {
  const saved = storage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const created = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  storage.setItem(TOKEN_KEY, created);
  return created;
}

export function readActiveRooms(storage: StorageLike = localStorage) {
  return readJson<Record<string, ActiveRoomRecord>>(storage, ACTIVE_ROOMS_KEY, {});
}

export function markActiveRoom(roomCode: string, storage: StorageLike = localStorage) {
  const code = roomCode.trim().toUpperCase();
  if (!code) return;
  const rooms = readActiveRooms(storage);
  rooms[code] = { role: "player", joinedAt: Date.now() };
  storage.setItem(ACTIVE_ROOMS_KEY, JSON.stringify(rooms));
}

export function clearActiveRoom(roomCode: string, storage: StorageLike = localStorage) {
  const rooms = readActiveRooms(storage);
  delete rooms[roomCode.trim().toUpperCase()];
  storage.setItem(ACTIVE_ROOMS_KEY, JSON.stringify(rooms));
}

export function isActivePlayerRoom(roomCode: string, storage: StorageLike = localStorage) {
  return readActiveRooms(storage)[roomCode.trim().toUpperCase()]?.role === "player";
}

export function nextLobbyPollDelay(roomCount: number) {
  return roomCount > 0 ? 5000 : undefined;
}
