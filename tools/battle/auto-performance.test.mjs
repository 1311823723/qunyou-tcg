import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomSource = readFileSync(new URL("../../worker/src/auto-room.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../../src/scripts/auto-battle-client.ts", import.meta.url), "utf8");

test("auto room persists ordinary actions without refreshing lobby or alarm", () => {
  const actionBlock = roomSource.slice(roomSource.indexOf("async webSocketMessage"), roomSource.indexOf("async webSocketClose"));
  assert.match(actionBlock, /await this\.persist\(false\)/);
  assert.match(actionBlock, /lobbyBefore !== this\.lobbyFingerprint\(\)/);
  assert.match(actionBlock, /this\.sendAck[\s\S]*this\.broadcast\(\)/);
});

test("auto room reuses serialized snapshots by viewer perspective", () => {
  const broadcastBlock = roomSource.slice(roomSource.indexOf("private broadcast"), roomSource.indexOf("private lobbyFingerprint"));
  assert.match(broadcastBlock, /new Map<string, string>/);
  assert.match(broadcastBlock, /attachment\.isSpectator \? "spectator" : attachment\.playerId/);
});

test("auto client serializes authoritative actions and gates diagnostics", () => {
  assert.match(clientSource, /if \(pendingAction\) return false/);
  assert.match(clientSource, /params\.get\("perf"\) === "1"/);
  assert.match(clientSource, /renderPlayer\(opponent[\s\S]*"opponent"\)/);
  assert.match(clientSource, /replaceGameRegion/);
});
