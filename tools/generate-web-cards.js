const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const TTS_EXPORT = path.join(__dirname, "..", "exports", "tts", "cards");
const OUTPUTS = [
  {
    root: path.join(__dirname, "..", "public", "cards"),
    width: 250,
    quality: 80,
    smartSubsample: false,
    label: "table",
  },
  {
    root: path.join(__dirname, "..", "public", "cards-hd"),
    width: 750,
    quality: 86,
    smartSubsample: true,
    label: "preview",
  },
];

async function optimizeCard(srcPath, destPath, { width, quality, smartSubsample }) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const next = await sharp(srcPath)
    .resize(width)
    .webp({ quality, smartSubsample })
    .toBuffer();
  if (fs.existsSync(destPath) && fs.readFileSync(destPath).equals(next)) return false;
  fs.writeFileSync(destPath, next);
  return true;
}

function pruneOutputDir(destDir, expectedFiles) {
  if (!fs.existsSync(destDir)) return;
  for (const filename of fs.readdirSync(destDir)) {
    if (!filename.endsWith(".webp")) continue;
    const filePath = path.resolve(destDir, filename);
    if (!expectedFiles.has(filePath)) fs.unlinkSync(filePath);
  }
}

async function processDir(subDir) {
  const srcDir = path.join(TTS_EXPORT, subDir);
  if (!fs.existsSync(srcDir)) {
    console.log(`  Skip ${subDir} (not found)`);
    return [];
  }

  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".png"));
  const results = [];
  for (const output of OUTPUTS) {
    const destDir = path.join(output.root, subDir);
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const file of files) {
    const src = path.join(srcDir, file);
    try {
      for (const output of OUTPUTS) {
        const dest = path.join(output.root, subDir, file.replace(/\.png$/, ".webp"));
        await optimizeCard(src, dest, output);
      }
      results.push(file);
    } catch (err) {
      console.error(`  Failed: ${file} — ${err.message}`);
    }
  }

  for (const output of OUTPUTS) {
    const destDir = path.join(output.root, subDir);
    const expected = new Set(files.map((file) => (
      path.resolve(destDir, file.replace(/\.png$/, ".webp"))
    )));
    pruneOutputDir(destDir, expected);
  }

  return results;
}

async function main() {
  console.log("Generating table and high-resolution web cards from TTS exports...");

  const characters = await processDir("characters");
  console.log(`  Characters: ${characters.length}`);

  const bodies = await processDir("bodies");
  console.log(`  Bodies: ${bodies.length}`);

  const handCards = await processDir("hand_cards");
  console.log(`  Hand cards: ${handCards.length}`);

  const total = characters.length + bodies.length + handCards.length;
  console.log(`Done. ${total} cards × ${OUTPUTS.length} sizes`);
  for (const output of OUTPUTS) {
    console.log(`  ${output.label}: ${output.width}px → ${output.root}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
