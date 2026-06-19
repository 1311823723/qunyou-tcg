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
const dispatchDeck = readJSON("decks/dispatch.deck.json");
const bloodDeck = readJSON("decks/blood.deck.json");
const ambushDeck = readJSON("decks/ambush.deck.json");
const defenseDeck = readJSON("decks/defense.deck.json");
const allDecks = [aggroDeck, mizaiDeck, comboDeck, transDeck, dispatchDeck, bloodDeck, ambushDeck, defenseDeck];

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
const validCostTypes = new Set(["休整", "退场", "无", "复合", "休整自身"]);
const validMainRoles = new Set(["强攻", "防御", "资源", "控制", "支援", "伏击"]);

function hasDuplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function checkIdPattern(id, pattern, label) {
  if (!pattern.test(id)) {
    errors.push(`${label} id "${id}" does not match required naming pattern`);
  }
}

// Check each deck references valid IDs
for (const deck of allDecks) {
  checkIdPattern(deck.id, /^deck_[a-z]+_\d{3}$/, "Deck");

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

  const deckCharacters = deck.characterIds
    .map((cid) => characters.find((c) => c.id === cid))
    .filter(Boolean);
  for (const duplicatedSkill of hasDuplicateValues(deckCharacters.map((c) => c.skillName))) {
    errors.push(`Deck ${deck.id} has duplicate character skillName: ${duplicatedSkill}`);
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
  checkIdPattern(body.id, /^body_[a-z]+_\d{3}$/, "Body");
  if (body.hp !== 7) {
    errors.push(`Body "${body.id}" hp is ${body.hp}, expected 7`);
  }

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
    if (ef.type === "mega" && ef.name && !ef.name.includes(body.name)) {
      errors.push(`Body "${body.id}" Mega name "${ef.name}" must include body name "${body.name}"`);
    }
  }
}

// Check each character has required fields
const charRequiredFields = [
  "id", "name", "cardType", "deck", "mainRole", "tags", "cost", "timing", "skillName", "effectText",
];
for (const char of characters) {
  checkIdPattern(char.id, /^char_\d{3}_[a-z0-9]+(?:-[a-z0-9]+)*_[a-z0-9]+(?:-[a-z0-9]+)*$/, "Character");

  for (const field of charRequiredFields) {
    if (char[field] === undefined || char[field] === null) {
      errors.push(`Character "${char.id}" missing required field: ${field}`);
    }
  }

  if (char.name?.includes("·")) {
    errors.push(`Character "${char.id}" name uses forbidden separator "·"; use "-"`);
  }
  if (char.name && !char.name.includes("-")) {
    errors.push(`Character "${char.id}" name must include "-" separator`);
  }
  if (char.cardType !== "角色") {
    errors.push(`Character "${char.id}" cardType is "${char.cardType}", expected "角色"`);
  }
  if (char.mainRole && !validMainRoles.has(char.mainRole)) {
    errors.push(`Character "${char.id}" has invalid mainRole: ${char.mainRole}`);
  }
  if (!Array.isArray(char.tags)) {
    errors.push(`Character "${char.id}" tags must be an array`);
  }
  if (char.cost?.type && !validCostTypes.has(char.cost.type)) {
    errors.push(`Character "${char.id}" has invalid cost.type: ${char.cost.type}`);
  }
  if (char.cost?.type === "休整" && typeof char.cost.amount !== "number") {
    errors.push(`Character "${char.id}" cost.type 休整 requires numeric amount`);
  }
  if (char.cost?.type === "退场" && !char.cost.text) {
    errors.push(`Character "${char.id}" cost.type 退场 requires text`);
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
