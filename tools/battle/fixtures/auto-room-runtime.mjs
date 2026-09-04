import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after } from "node:test";

// Compile the real room; only Cloudflare storage/socket bindings are simulated.
// No test-only state mutation endpoint is exposed by the production Worker.
const directory = await mkdtemp(path.join(tmpdir(), "auto-room-tests-"));
after(() => rm(directory, { recursive: true, force: true }));
const output = path.join(directory, "room.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../../../worker/src/auto-room.ts", import.meta.url))],
  outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent",
  plugins: [{ name: "cloudflare-test-binding", setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare", namespace: "test" }));
    b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", loader: "js" }));
  } }],
});
export const { AutoBattleRoom, validAutoLoadout } = await import(pathToFileURL(output).href);

export function hand(id, definitionId, ownerId = "p1", suit = "红桃", rank = "7") {
  return { instanceId: id, definitionId, ownerId, kind: "hand", suit, rank, faceDown: false };
}
export function role(id, definitionId, ownerId = "p1", faceDown = false) {
  return { instanceId: id, definitionId, ownerId, kind: "character", faceDown };
}
export async function roomRuntime(ownerRoles = [], opponentRoles = []) {
  let initializing;
  const sockets = ["p1", "p2", "spectator"].map((id) => ({
    messages: [], deserializeAttachment: () => ({ playerId: id, isSpectator: id === "spectator" }),
    send(raw) { this.messages.push(JSON.parse(raw)); },
  }));
  const storage = { async get() {}, async put() {}, async setAlarm() {}, async deleteAll() {}, async deleteAlarm() {} };
  const ctx = { storage, blockConcurrencyWhile(fn) { initializing = fn(); }, getWebSockets: () => sockets };
  const room = new AutoBattleRoom(ctx, {});
  await initializing;
  const players = [room.newPlayer("p1", "a", "房主", "deck_combo_001"), room.newPlayer("p2", "b", "对手", "deck_mizai_001")];
  for (const [i, roles] of [ownerRoles, opponentRoles].entries()) {
    players[i].characterSlots = [0, 1, 2, 3].map((index) => roles[index] ? role(`p${i + 1}-role-${index}`, roles[index], players[i].id) : null);
    players[i].characterDeck = [];
  }
  room.state = { mode: "auto", stateVersion: 4, roomCode: "TEST19", createdAt: Date.now(), lastActivityAt: Date.now(), started: true,
    players, spectators: [], handDeck: Array.from({ length: 30 }, (_, i) => hand(`deck-${i}`, "hand_basic_001", undefined)),
    handDiscard: [], handBanished: [], resolving: [], turnNumber: 1, phase: "play", currentPlayerId: "p1", firstPlayerId: "p1", stack: [],
    consecutivePasses: 0, usageCounters: {}, turnModifiers: [], deployedThisPhase: 0, recentEvents: [], pendingBodyTriggers: [], pendingJudgments: [], pendingDamages: [],
    revision: 0, logs: [], processedActionIds: [] };
  return {
    room, sockets, get state() { return room.state; }, get owner() { return room.state.players[0]; }, get opponent() { return room.state.players[1]; },
    async command(playerId, type, payload = {}) {
      const socket = sockets.find((s) => s.deserializeAttachment().playerId === playerId);
      const previous = socket.messages.length;
      await room.webSocketMessage(socket, JSON.stringify({ type, payload, actionId: crypto.randomUUID(), baseRevision: room.state.revision, protocolVersion: 2 }));
      const error = socket.messages.slice(previous).find((m) => m.type === "error");
      if (error) throw new Error(error.error);
    },
    async activate(index = 0, playerId = "p1", costIndices) {
      const player = room.state.players.find((p) => p.id === playerId);
      const card = player.characterSlots[index];
      const selection = room.skillCostSelection(player, card.instanceId);
      const costCharacterIds = costIndices ? costIndices.map((i) => player.characterSlots[i].instanceId) : selection?.cardInstanceIds.slice(0, selection.min) || [];
      await this.command(playerId, "skill:activate", { instanceId: card.instanceId, costCharacterIds });
    },
    async choose(payload, playerId = room.state.prompt?.playerId) { await this.command(playerId, "choice:submit", { promptId: room.state.prompt?.id, ...payload }); },
    async pass() { await this.command(room.state.prompt.playerId, room.state.prompt.kind === "response" ? "response:pass" : "choice:submit", { value: "pass" }); },
  };
}
