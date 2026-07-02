import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/scripts/battle-profile.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const profile = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("legacy pending nickname migrates into the browser profile", () => {
  const storage = memoryStorage({
    [profile.PENDING_KEY]: JSON.stringify({ nickname: "  老玩家  ", deckId: "deck_aggro_001" }),
  });
  assert.deepEqual(profile.readProfile(storage), { nickname: "老玩家" });
  assert.deepEqual(JSON.parse(storage.getItem(profile.PROFILE_KEY)), { nickname: "老玩家" });
});

test("saving a profile updates pending room identity without losing loadout", () => {
  const storage = memoryStorage({
    [profile.PENDING_KEY]: JSON.stringify({ deckId: "custom", customDeck: { bodyId: "body" } }),
  });
  assert.deepEqual(profile.saveProfile(" 新名字 ", storage), { nickname: "新名字" });
  assert.deepEqual(JSON.parse(storage.getItem(profile.PENDING_KEY)), {
    deckId: "custom",
    customDeck: { bodyId: "body" },
    nickname: "新名字",
  });
});

test("active player rooms support reconnect lookup and cleanup", () => {
  const storage = memoryStorage();
  profile.markActiveRoom("abc123", storage);
  assert.equal(profile.isActivePlayerRoom("ABC123", storage), true);
  profile.clearActiveRoom("ABC123", storage);
  assert.equal(profile.isActivePlayerRoom("ABC123", storage), false);
});

test("lobby polls every five seconds only while rooms exist", () => {
  assert.equal(profile.nextLobbyPollDelay(3), 5000);
  assert.equal(profile.nextLobbyPollDelay(0), undefined);
});
