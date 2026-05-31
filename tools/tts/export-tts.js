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
const CARD_ART = {
  bodies: {
    body_mizai_001: {
      front: "keke-assassin.png",
      mega: "keke-assassin-mega.png",
    },
  },
  characters: {
    char_aggro_001: "keke-assassin.png",
  },
};

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

function handPhysicalId(card, entry) {
  const suit = SUIT_META[entry.suit]?.slug ?? entry.suit;
  return `${card.id}_${suit}_${String(entry.rank).toLowerCase()}`;
}

function artDataUri(filename) {
  if (!filename) return undefined;
  const filePath = path.join(ART_DIR, filename);
  if (!fs.existsSync(filePath)) return undefined;
  const ext = path.extname(filename).slice(1).toLowerCase();
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
      __ttsMegaArt: artDataUri(art?.mega),
    };
    const frontPath = path.join(EXPORT_DIR, "cards", "bodies", `${body.id}_front.png`);
    const backPath = path.join(EXPORT_DIR, "cards", "bodies", `${body.id}_mega_back.png`);
    await writeSvgAsPng(renderBodyFront(bodyForRender), frontPath);
    await writeSvgAsPng(renderBodyMega(bodyForRender), backPath);
    rendered.bodyFronts.push({
      id: body.id,
      name: body.name,
      filePath: frontPath,
      relativeFile: relFromExport(frontPath),
      extra: { megaName: body.extraForm?.name },
    });
    rendered.bodyBacks.push({
      id: `${body.id}:mega`,
      name: body.extraForm?.name ?? `Mega ${body.name}`,
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

async function main() {
  cleanExportDir();

  const cards = await renderCards();
  const backs = await renderBacks();
  const table = await renderTableAssets();
  const sheetsDir = path.join(EXPORT_DIR, "sheets");
  const sheets = [];

  sheets.push(...await makeSheets({
    cards: cards.bodyFronts,
    pairedBackCards: cards.bodyBacks,
    baseName: "bodies_megas",
    outDir: sheetsDir,
    manifestType: "本体/Mega",
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
    counts: {
      bodies: cards.bodyFronts.length,
      bodyMegaBacks: cards.bodyBacks.length,
      characters: cards.characters.length,
      handCards: cards.hands.length,
      totalFrontCards: cards.bodyFronts.length + cards.characters.length + cards.hands.length,
    },
    sheets,
  };

  fs.writeFileSync(path.join(EXPORT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeImportGuide(path.join(EXPORT_DIR, "docs", "tts-import-guide.md"), manifest);

  console.log("TTS export complete");
  console.log(`  Output: ${EXPORT_DIR}`);
  console.log(`  Bodies/Mega double-sided: ${cards.bodyFronts.length}`);
  console.log(`  Characters: ${cards.characters.length}`);
  console.log(`  Hand cards: ${cards.hands.length}`);
  console.log(`  Sheets: ${sheets.length}`);
  console.log(`  Tablemat: ${table.tablemat.file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
