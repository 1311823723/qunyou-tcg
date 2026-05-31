const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  CARD_WIDTH,
  CARD_HEIGHT,
  SHEET_COLUMNS,
  SHEET_ROWS,
  SHEET_MAX_CARDS,
} = require("./constants");

function chunkCards(cards) {
  const chunks = [];
  for (let i = 0; i < cards.length; i += SHEET_MAX_CARDS) {
    chunks.push(cards.slice(i, i + SHEET_MAX_CARDS));
  }
  return chunks;
}

async function makeSheet(cards, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const composites = cards.map((card, index) => ({
    input: card.filePath,
    left: (index % SHEET_COLUMNS) * CARD_WIDTH,
    top: Math.floor(index / SHEET_COLUMNS) * CARD_HEIGHT,
  }));

  await sharp({
    create: {
      width: CARD_WIDTH * SHEET_COLUMNS,
      height: CARD_HEIGHT * SHEET_ROWS,
      channels: 4,
      background: "#070711",
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}

async function makeSheets({ cards, baseName, outDir, manifestType, back, pairedBackCards }) {
  const sheetEntries = [];
  const chunks = chunkCards(cards);
  const backChunks = pairedBackCards ? chunkCards(pairedBackCards) : [];

  for (let index = 0; index < chunks.length; index++) {
    const num = String(index + 1).padStart(3, "0");
    const file = `${baseName}_${num}.png`;
    const outPath = path.join(outDir, file);
    await makeSheet(chunks[index], outPath);

    let pairedBackFile = null;
    if (pairedBackCards) {
      pairedBackFile = `${baseName}_${num}_backs.png`;
      await makeSheet(backChunks[index], path.join(outDir, pairedBackFile));
    }

    sheetEntries.push({
      id: `${baseName}_${num}`,
      type: manifestType,
      file: `sheets/${file}`,
      back: pairedBackFile ? `sheets/${pairedBackFile}` : back,
      uniqueBack: Boolean(pairedBackFile),
      columns: SHEET_COLUMNS,
      rows: SHEET_ROWS,
      count: chunks[index].length,
      cards: chunks[index].map((card, slot) => ({
        slot,
        id: card.id,
        name: card.name,
        file: card.relativeFile,
        ...(card.extra ?? {}),
      })),
    });
  }

  return sheetEntries;
}

module.exports = {
  makeSheets,
};
