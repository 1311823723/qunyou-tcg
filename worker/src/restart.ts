import type { PendingRestart, RoomState } from "./types";

export const RESTART_REQUEST_TTL_MS = 60_000;
const REVISION_INDEPENDENT_RESTART_COMMANDS = new Set([
  "room:restartRespond",
  "room:restartCancel",
]);

export function isRevisionIndependentRestartCommand(command: string) {
  return REVISION_INDEPENDENT_RESTART_COMMANDS.has(command);
}

export function clearExpiredRestart(state: RoomState, now = Date.now()) {
  if (!state.pendingRestart || state.pendingRestart.expiresAt > now) return false;
  state.pendingRestart = undefined;
  return true;
}

export function createRestartRequest(state: RoomState, playerId: string, now = Date.now()): PendingRestart {
  if (state.pendingRestart) throw new Error("已经有一个重新开始请求等待处理。");
  const pending: PendingRestart = {
    id: crypto.randomUUID(),
    requestedBy: playerId,
    expiresAt: now + RESTART_REQUEST_TTL_MS,
  };
  state.pendingRestart = pending;
  return pending;
}
