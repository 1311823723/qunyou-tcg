const fs = require("fs");
const path = require("path");
const {
  DATA_DIR,
  EXPORT_DIR,
  CARD_WIDTH,
  CARD_HEIGHT,
  SHEET_COLUMNS,
  SHEET_ROWS,
  SHEET_MAX_CARDS,
  SUIT_META,
} = require("./constants");
const {
  renderBodyFront,
  renderBodyMega,
  renderCharacter,
  renderHand,
  renderBack,
  writeSvgAsPng,
} = require("./render-card");
const { makeSheets } = require("./make-sheets");
const { writeImportGuide } = require("./write-import-guide");
const { MAT_WIDTH, MAT_HEIGHT, writeTablemat } = require("./render-tablemat");

const ART_DIR = path.join(__dirname, "assets", "art");
const CARD_ART = readJson("card-art.json");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, relativePath), "utf8"));
}

function relFromExport(filePath) {
  return path.relative(EXPORT_DIR, filePath).split(path.sep).join("/");
}

function cleanExportDir() {
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function cleanCardExportDir() {
  const cardsDir = path.join(EXPORT_DIR, "cards");
  fs.rmSync(cardsDir, { recursive: true, force: true });
  fs.mkdirSync(cardsDir, { recursive: true });
}

function readDecks() {
  const decksDir = path.join(DATA_DIR, "decks");
  return fs.readdirSync(decksDir)
    .filter((filename) => filename.endsWith(".deck.json"))
    .sort()
    .map((filename) => ({
      ...JSON.parse(fs.readFileSync(path.join(decksDir, filename), "utf8")),
      sourceFile: `data/decks/${filename}`,
    }));
}

function handPhysicalId(card, entry) {
  const suit = SUIT_META[entry.suit]?.slug ?? entry.suit;
  return `${card.id}_${suit}_${String(entry.rank).toLowerCase()}`;
}

function extraFormFileSlug(type) {
  return {
    mega: "mega",
    "z-move": "z_move",
    terastal: "terastal",
    dynamax: "dynamax",
  }[type] ?? "extra";
}

function artDataUri(filename) {
  if (!filename) return undefined;
  const artFilename = path.extname(filename) ? filename : `${filename}.png`;
  const filePath = path.join(ART_DIR, artFilename);
  if (!fs.existsSync(filePath)) return undefined;
  const ext = path.extname(artFilename).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function renderCards() {
  const bodies = readJson("cards/bodies.json");
  const characters = readJson("cards/characters.json");
  const handCards = readJson("cards/hand_cards.json");

  const rendered = {
    bodyFronts: [],
    bodyBacks: [],
    characters: [],
    hands: [],
  };

  for (const body of bodies) {
    const art = CARD_ART.bodies[body.id];
    const bodyForRender = {
      ...body,
      __ttsArt: artDataUri(art?.front),
      __ttsMegaArt: artDataUri(art?.extra),
    };
    const frontPath = path.join(EXPORT_DIR, "cards", "bodies", `${body.id}_front.png`);
    const backPath = path.join(
      EXPORT_DIR,
      "cards",
      "bodies",
      `${body.id}_${extraFormFileSlug(body.extraForm?.type)}_back.png`,
    );
    await writeSvgAsPng(renderBodyFront(bodyForRender), frontPath);
    await writeSvgAsPng(renderBodyMega(bodyForRender), backPath);
    rendered.bodyFronts.push({
      id: body.id,
      name: body.name,
      filePath: frontPath,
      relativeFile: relFromExport(frontPath),
      extra: { formName: body.extraForm?.name, formType: body.extraForm?.type },
    });
    rendered.bodyBacks.push({
      id: `${body.id}:${body.extraForm?.type ?? "extra"}`,
      name: body.extraForm?.name ?? `额外形态 ${body.name}`,
      filePath: backPath,
      relativeFile: relFromExport(backPath),
    });
  }

  for (const card of characters) {
    const cardForRender = {
      ...card,
      __ttsArt: artDataUri(CARD_ART.characters[card.id]),
    };
    const filePath = path.join(EXPORT_DIR, "cards", "characters", `${card.id}.png`);
    await writeSvgAsPng(renderCharacter(cardForRender), filePath);
    rendered.characters.push({
      id: card.id,
      name: card.name,
      filePath,
      relativeFile: relFromExport(filePath),
      extra: {
        deck: card.deck,
        mainRole: card.mainRole,
      },
    });
  }

  for (const card of handCards) {
    for (const entry of card.cards) {
      const physicalId = handPhysicalId(card, entry);
      const physicalCard = {
        ...card,
        ...entry,
        physicalId,
      };
      const filePath = path.join(EXPORT_DIR, "cards", "hand_cards", `${physicalId}.png`);
      await writeSvgAsPng(renderHand(physicalCard), filePath);
      rendered.hands.push({
        id: physicalId,
        name: card.name,
        filePath,
        relativeFile: relFromExport(filePath),
        extra: {
          sourceId: card.id,
          handType: card.handType,
          suit: entry.suit,
          rank: entry.rank,
        },
      });
    }
  }

  return rendered;
}

async function renderBacks() {
  const backs = {
    character: path.join(EXPORT_DIR, "backs", "back_character.png"),
    hand: path.join(EXPORT_DIR, "backs", "back_hand.png"),
  };
  await writeSvgAsPng(renderBack("character"), backs.character);
  await writeSvgAsPng(renderBack("hand"), backs.hand);
  return {
    character: relFromExport(backs.character),
    hand: relFromExport(backs.hand),
  };
}

async function renderTableAssets() {
  const tablemat = path.join(EXPORT_DIR, "table", "tablemat_1v1.png");
  await writeTablemat(tablemat);
  return {
    tablemat: {
      file: relFromExport(tablemat),
      width: MAT_WIDTH,
      height: MAT_HEIGHT,
    },
  };
}

function copyPresetDecks(decks, characterCards) {
  const characterById = new Map(characterCards.map((card) => [card.id, card]));
  const presetRoot = path.join(EXPORT_DIR, "preset_decks");

  return decks.map((deck) => {
    const outDir = path.join(presetRoot, deck.id);
    fs.mkdirSync(outDir, { recursive: true });

    const cards = deck.characterIds.map((characterId, index) => {
      const card = characterById.get(characterId);
      if (!card) {
        throw new Error(`Preset deck ${deck.id} references missing character ${characterId}`);
      }

      const filePath = path.join(outDir, `${String(index + 1).padStart(2, "0")}_${card.id}.png`);
      fs.copyFileSync(card.filePath, filePath);
      return {
        id: card.id,
        name: card.name,
        file: relFromExport(filePath),
      };
    });

    return {
      id: deck.id,
      name: deck.name,
      archetype: deck.archetype,
      bodyId: deck.bodyId,
      folder: relFromExport(outDir),
      count: cards.length,
      cards,
      sourceFile: deck.sourceFile,
    };
  });
}

async function main() {
  const cardsOnly = process.argv.includes("--cards-only");
  if (cardsOnly) cleanCardExportDir();
  else cleanExportDir();

  const cards = await renderCards();
  if (cardsOnly) {
    console.log("TTS card render complete");
    console.log(`  Bodies/extra forms: ${cards.bodyFronts.length}`);
    console.log(`  Characters: ${cards.characters.length}`);
    console.log(`  Hand cards: ${cards.hands.length}`);
    return;
  }

  const decks = readDecks();
  const backs = await renderBacks();
  const table = await renderTableAssets();
  const presetDecks = copyPresetDecks(decks, cards.characters);
  const sheetsDir = path.join(EXPORT_DIR, "sheets");
  const sheets = [];

  sheets.push(...await makeSheets({
    cards: cards.bodyFronts,
    pairedBackCards: cards.bodyBacks,
    baseName: "bodies_megas",
    outDir: sheetsDir,
    manifestType: "本体/额外形态",
  }));

  sheets.push(...await makeSheets({
    cards: cards.characters,
    baseName: "characters",
    outDir: sheetsDir,
    manifestType: "角色",
    back: backs.character,
  }));

  sheets.push(...await makeSheets({
    cards: cards.hands,
    baseName: "hand_cards",
    outDir: sheetsDir,
    manifestType: "手牌",
    back: backs.hand,
  }));

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      bodies: "data/cards/bodies.json",
      characters: "data/cards/characters.json",
      handCards: "data/cards/hand_cards.json",
      decks: decks.map((deck) => deck.sourceFile),
    },
    cardSize: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    },
    sheetSize: {
      columns: SHEET_COLUMNS,
      rows: SHEET_ROWS,
      maxCards: SHEET_MAX_CARDS,
    },
    backs,
    table,
    presetDecks,
    counts: {
      bodies: cards.bodyFronts.length,
      bodyMegaBacks: cards.bodyBacks.length,
      characters: cards.characters.length,
      handCards: cards.hands.length,
      presetDecks: presetDecks.length,
      totalFrontCards: cards.bodyFronts.length + cards.characters.length + cards.hands.length,
    },
    sheets,
  };

  fs.writeFileSync(path.join(EXPORT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeImportGuide(path.join(EXPORT_DIR, "docs", "tts-import-guide.md"), manifest);

  console.log("TTS export complete");
  console.log(`  Output: ${EXPORT_DIR}`);
  console.log(`  Bodies/extra forms double-sided: ${cards.bodyFronts.length}`);
  console.log(`  Characters: ${cards.characters.length}`);
  console.log(`  Hand cards: ${cards.hands.length}`);
  console.log(`  Sheets: ${sheets.length}`);
  console.log(`  Tablemat: ${table.tablemat.file}`);
  console.log(`  Preset decks: ${presetDecks.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
