const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");

function readJSON(filename) {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: File not found: ${filePath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

let errors = [];

const bodies = readJSON("cards/bodies.json");
const megas = readJSON("cards/megas.json");
const characters = readJSON("cards/characters.json");
const handCards = readJSON("cards/hand_cards.json");
const aggroDeck = readJSON("decks/aggro.deck.json");

// Collect all card IDs
const allIds = new Set();
function registerIds(list, source) {
  for (const item of list) {
    if (allIds.has(item.id)) {
      errors.push(`Duplicate ID: ${item.id} (found in ${source})`);
    }
    allIds.add(item.id);
  }
}

registerIds(bodies, "bodies.json");
registerIds(megas, "megas.json");
registerIds(characters, "characters.json");
registerIds(handCards, "hand_cards.json");

// Check deck references
const bodyIds = new Set(bodies.map((b) => b.id));
const megaIds = new Set(megas.map((m) => m.id));
const characterIds = new Set(characters.map((c) => c.id));

if (!bodyIds.has(aggroDeck.bodyId)) {
  errors.push(`Deck bodyId "${aggroDeck.bodyId}" not found in bodies.json`);
}
if (!megaIds.has(aggroDeck.megaId)) {
  errors.push(`Deck megaId "${aggroDeck.megaId}" not found in megas.json`);
}
for (const cid of aggroDeck.characterIds) {
  if (!characterIds.has(cid)) {
    errors.push(`Deck character "${cid}" not found in characters.json`);
  }
}
if (aggroDeck.characterIds.length !== 16) {
  errors.push(`Deck has ${aggroDeck.characterIds.length} characters, expected 16`);
}

// Check hand card total by counting cards array
const totalCount = handCards.reduce((sum, card) => sum + card.cards.length, 0);
if (totalCount !== 52) {
  errors.push(`Hand cards total count = ${totalCount}, expected 52`);
}

// Check each hand card has suit/rank
for (const card of handCards) {
  if (!card.cards || !Array.isArray(card.cards)) {
    errors.push(`Hand card "${card.id}" missing cards array`);
    continue;
  }
  for (let i = 0; i < card.cards.length; i++) {
    const c = card.cards[i];
    if (!c.suit || !c.rank) {
      errors.push(`Hand card "${card.id}" card #${i + 1} missing suit or rank`);
    }
  }
}

// Check each character has required fields
const charRequiredFields = [
  "mainRole", "tags", "cost", "timing", "skillName", "effectText",
];
for (const char of characters) {
  for (const field of charRequiredFields) {
    if (char[field] === undefined || char[field] === null) {
      errors.push(`Character "${char.id}" missing required field: ${field}`);
    }
  }
}

if (errors.length > 0) {
  console.error("VALIDATION FAILED:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log("VALIDATION PASSED");
  console.log(`  Bodies: ${bodies.length}`);
  console.log(`  Megas: ${megas.length}`);
  console.log(`  Characters: ${characters.length}`);
  console.log(`  Hand cards (types): ${handCards.length}`);
  console.log(`  Hand cards (total): ${totalCount}`);
  console.log(`  Deck characters: ${aggroDeck.characterIds.length}`);
  console.log("  All IDs unique: yes");
}
