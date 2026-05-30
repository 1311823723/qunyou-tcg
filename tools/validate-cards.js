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
const characters = readJSON("cards/characters.json");
const handCards = readJSON("cards/hand_cards.json");
const aggroDeck = readJSON("decks/aggro.deck.json");
const mizaiDeck = readJSON("decks/mizai.deck.json");
const comboDeck = readJSON("decks/combo.deck.json");
const transDeck = readJSON("decks/trans.deck.json");
const allDecks = [aggroDeck, mizaiDeck, comboDeck, transDeck];

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
registerIds(characters, "characters.json");
registerIds(handCards, "hand_cards.json");

const bodyIds = new Set(bodies.map((b) => b.id));
const characterIds = new Set(characters.map((c) => c.id));

// Check each deck references valid IDs
for (const deck of allDecks) {
  if (!bodyIds.has(deck.bodyId)) {
    errors.push(`Deck ${deck.id} bodyId "${deck.bodyId}" not found in bodies.json`);
  }
  for (const cid of deck.characterIds) {
    if (!characterIds.has(cid)) {
      errors.push(`Deck ${deck.id} character "${cid}" not found in characters.json`);
    }
  }
  if (deck.characterIds.length !== 16) {
    errors.push(`Deck ${deck.id} has ${deck.characterIds.length} characters, expected 16`);
  }
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

// Check each body has valid extraForm if present
for (const body of bodies) {
  if (body.extraForm) {
    const ef = body.extraForm;
    if (!ef.type || !["mega", "z-move", "terastal", "dynamax"].includes(ef.type)) {
      errors.push(`Body "${body.id}" extraForm has invalid type: ${ef.type}`);
    }
    if (!ef.name) {
      errors.push(`Body "${body.id}" extraForm missing name`);
    }
    if (!ef.skillName) {
      errors.push(`Body "${body.id}" extraForm missing skillName`);
    }
    if (!ef.effectText) {
      errors.push(`Body "${body.id}" extraForm missing effectText`);
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
  const extraFormCount = bodies.filter((b) => b.extraForm).length;
  console.log("VALIDATION PASSED");
  console.log(`  Bodies: ${bodies.length} (${extraFormCount} with extra form)`);
  console.log(`  Characters: ${characters.length}`);
  console.log(`  Hand cards (types): ${handCards.length}`);
  console.log(`  Hand cards (total): ${totalCount}`);
  console.log(`  Decks: ${allDecks.length} (${allDecks.map(d => d.characterIds.length + " chars").join(", ")})`);
  console.log("  All IDs unique: yes");
}
