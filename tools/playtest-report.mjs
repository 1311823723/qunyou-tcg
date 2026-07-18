import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlaytestReport, formatPlaytestReport, parseMatchRecords } from "./playtest/report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(root, process.argv[2] || "playtest/matches.csv");

async function loadDecks() {
  const deckDir = path.join(root, "data", "decks");
  const files = (await readdir(deckDir)).filter((file) => file.endsWith(".deck.json"));
  const decks = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(deckDir, file), "utf8"))));
  return new Map(decks.map((deck) => [deck.id, deck.name]));
}

try {
  const [csv, deckNames] = await Promise.all([readFile(sourcePath, "utf8"), loadDecks()]);
  const records = parseMatchRecords(csv, new Set(deckNames.keys()));
  console.log(formatPlaytestReport(buildPlaytestReport(records, deckNames)));
} catch (error) {
  console.error(`PLAYTEST REPORT FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
