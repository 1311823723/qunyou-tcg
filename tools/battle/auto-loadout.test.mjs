import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import bodies from "../../data/cards/bodies.json" with { type: "json" };
import characters from "../../data/cards/characters.json" with { type: "json" };
import automation from "../../data/cards/character_automation.json" with { type: "json" };
const source = await readFile(new URL("../../src/scripts/auto-loadout.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { autoBodyCards, resolveAutoLoadout, validAutoCustomDeck } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

const allowed = bodies.filter((body) => !["body_roaming_001", "body_antimagic_001", "body_crossfire_001"].includes(body.id));
const catalog = {
  cards: Object.fromEntries([
    ...bodies.map((body) => [body.id, { id: body.id, kind: "body" }]),
    ...characters.map((card) => [card.id, { id: card.id, kind: "character", automationLevel: automation[card.id].level }]),
  ]),
  decks: allowed.map((body) => ({ id: body.id.replace("body_", "deck_"), bodyId: body.id, autoReady: true })),
};
const customDeck = { bodyId: allowed[0].id, characterIds: characters.slice(0, 16).map((card) => card.id) };

test("\u81ea\u52a8\u7f16\u8f91\u5668\u63d0\u4f9b9\u4e2a\u5df2\u5b9e\u73b0\u672c\u4f53\uff0c\u5408\u6cd5\u81ea\u9009\u4fdd\u5b58\u540e\u53ef\u4ee5\u6062\u590d", () => {
  assert.equal(autoBodyCards(catalog).length, 9);
  assert.ok(validAutoCustomDeck(catalog, customDeck));
  assert.deepEqual(resolveAutoLoadout(catalog, { deckId: "custom", customDeck }), { deckId: "custom", customDeck });
});

test("旧浏览器中的未开放本体、重复或失效自选会回退预组，不修改草稿", () => {
  const originals = [null, "bad", {}, { deckId: "custom", customDeck: { ...customDeck, bodyId: "body_roaming_001" } },
    { deckId: "custom", customDeck: { ...customDeck, characterIds: Array(16).fill(characters[0].id) } },
    { deckId: "custom", customDeck: { ...customDeck, characterIds: ["unknown", ...customDeck.characterIds.slice(1)] } }];
  for (const original of originals) {
    const copy = structuredClone(original);
    assert.deepEqual(resolveAutoLoadout(catalog, original), { deckId: catalog.decks[0].id });
    assert.deepEqual(original, copy);
  }
  assert.deepEqual(resolveAutoLoadout(catalog, { deckId: catalog.decks[3].id }), { deckId: catalog.decks[3].id });
});
