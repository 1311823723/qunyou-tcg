import assert from "node:assert/strict";
import test from "node:test";
import {
  MATCH_HEADERS,
  buildPlaytestReport,
  formatPlaytestReport,
  parseMatchRecords,
} from "./report.mjs";

const deckIds = new Set(["deck_aggro_001", "deck_mizai_001", "deck_defense_001"]);
const sample = `${MATCH_HEADERS.join(",")}\n`
  + `2026-07-18,0.2.0,deck_aggro_001,deck_mizai_001,p1,p1,6,3,0,char_a;char_b,"\u8282\u594f\u5f88\u5feb,\u65e0\u5361\u987f"\n`
  + `2026-07-18,0.2.0,deck_defense_001,deck_aggro_001,p2,p1,9,1,0,char_b,\n`
  + `2026-07-18,0.2.0,deck_mizai_001,deck_defense_001,p1,draw,12,1,1,,\n`;

test("playtest CSV supports quoted notes and normalized problem cards", () => {
  const records = parseMatchRecords(sample, deckIds);
  assert.equal(records.length, 3);
  assert.equal(records[0].notes, "节奏很快,无卡顿");
  assert.deepEqual(records[0].problemCards, ["char_a", "char_b"]);
  assert.equal(records[0].turns, 6);
});

test("playtest records reject unknown decks and invalid result fields", () => {
  const unknownDeck = sample.replace("deck_aggro_001", "deck_unknown_001");
  assert.throws(() => parseMatchRecords(unknownDeck, deckIds), /不是已知预组 ID/);
  const invalidWinner = sample.replace(",p1,p1,6,", ",p1,p3,6,");
  assert.throws(() => parseMatchRecords(invalidWinner, deckIds), /winner 必须/);
  const invalidHealth = sample.replace(",3,0,char_a", ",8,0,char_a");
  assert.throws(() => parseMatchRecords(invalidHealth, deckIds), /player1EndHealth/);
});

test("playtest report calculates deck, first-player, matchup and issue-card summaries", () => {
  const report = buildPlaytestReport(parseMatchRecords(sample, deckIds), new Map([
    ["deck_aggro_001", "上头组"],
    ["deck_mizai_001", "密裁组"],
    ["deck_defense_001", "不落组"],
  ]));
  assert.equal(report.games, 3);
  assert.equal(report.firstPlayerWins, 1);
  assert.equal(report.firstPlayerDecisiveGames, 2);
  assert.equal(report.deckStats.get("deck_aggro_001").wins, 1);
  assert.equal(report.problems.get("char_b"), 2);
  const markdown = formatPlaytestReport(report);
  assert.match(markdown, /先手胜率（不含平局）：50\.0%/);
  assert.match(markdown, /上头组/);
  assert.match(markdown, /char_b \| 2/);
});
