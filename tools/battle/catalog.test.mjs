import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../../", import.meta.url);
const bodies = JSON.parse(await readFile(new URL("data/cards/bodies.json", root), "utf8"));
const handCards = JSON.parse(await readFile(new URL("data/cards/hand_cards.json", root), "utf8"));
const workerConfig = JSON.parse(await readFile(new URL("worker/wrangler.jsonc", root), "utf8"));
const deckFiles = ["aggro", "mizai", "combo", "trans"];
const decks = await Promise.all(deckFiles.map(async (slug) =>
  JSON.parse(await readFile(new URL(`data/decks/${slug}.deck.json`, root), "utf8")),
));
const characters = JSON.parse(await readFile(new URL("data/cards/characters.json", root), "utf8"));

function progressMax(body) {
  const match = body.extraForm?.condition?.match(/累计[^\d]{0,24}(\d+)\s*(?:点|次|张)/);
  return match ? Number(match[1]) : undefined;
}

test("the shared hand deck contains exactly 52 physical cards", () => {
  assert.equal(handCards.reduce((total, card) => total + card.cards.length, 0), 52);
});

test("every online deck has one body and sixteen characters", () => {
  for (const deck of decks) {
    assert.ok(bodies.some((body) => body.id === deck.bodyId));
    assert.equal(deck.characterIds.length, 16);
    assert.equal(new Set(deck.characterIds).size, 16);
  }
});

test("current body cards expose the expected Mega progress maxima", () => {
  assert.deepEqual(Object.fromEntries(bodies.map((body) => [body.id, progressMax(body)])), {
    body_aggro_001: 6,
    body_mizai_001: 4,
    body_combo_001: 6,
    body_trans_001: 4,
  });
});

test("online card source data exposes Mega conditions and character costs", () => {
  assert.ok(bodies.every((body) => body.extraForm?.condition));
  assert.ok(characters.every((card) => {
    if (!card.timing || !card.cost?.type) return false;
    if (card.cost.type === "休整") return Number.isFinite(card.cost.amount);
    return Boolean(card.cost.text);
  }));
});

test("battle worker defines separate create and join rate limits", () => {
  assert.deepEqual(workerConfig.ratelimits.map((item) => ({
    name: item.name,
    limit: item.simple.limit,
    period: item.simple.period,
  })), [
    { name: "CREATE_RATE_LIMITER", limit: 10, period: 60 },
    { name: "JOIN_RATE_LIMITER", limit: 30, period: 60 },
  ]);
});

test("every table card has a 750px high-resolution preview", async () => {
  for (const subDir of ["bodies", "characters", "hand_cards"]) {
    const tableDir = new URL(`public/cards/${subDir}/`, root);
    const highResDir = new URL(`public/cards-hd/${subDir}/`, root);
    const tableFiles = (await readdir(tableDir)).filter((file) => file.endsWith(".webp")).sort();
    const highResFiles = (await readdir(highResDir)).filter((file) => file.endsWith(".webp")).sort();
    assert.deepEqual(highResFiles, tableFiles);
    for (const file of highResFiles) {
      const metadata = await sharp(fileURLToPath(new URL(file, highResDir))).metadata();
      assert.equal(metadata.width, 750, `${subDir}/${file} width`);
      assert.equal(metadata.height, 1050, `${subDir}/${file} height`);
    }
  }
});

test("body animation portraits are present and alpha-capable", async () => {
  const expected = bodies.flatMap((body) => [
    `${body.id}_front.webp`,
    `${body.id}_mega.webp`,
  ]).sort();
  const portraitDir = new URL("public/battle-portraits/", root);
  const files = (await readdir(portraitDir)).filter((file) => file.endsWith(".webp")).sort();
  assert.deepEqual(files, expected);
  for (const file of files) {
    const metadata = await sharp(fileURLToPath(new URL(file, portraitDir))).metadata();
    assert.equal(metadata.hasAlpha, true, `${file} alpha`);
    assert.ok(metadata.height <= 1200, `${file} height should stay lightweight`);
    assert.ok(metadata.width > 100 && metadata.height > 100, `${file} should not be empty`);
  }
});
