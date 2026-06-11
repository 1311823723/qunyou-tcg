const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const TTS_EXPORT = path.join(__dirname, "..", "exports", "tts", "cards");
const OUTPUT = path.join(__dirname, "..", "public", "cards");

const WEB_WIDTH = 250;

async function optimizeCard(srcPath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await sharp(srcPath)
    .resize(WEB_WIDTH)
    .webp({ quality: 80 })
    .toFile(destPath);
}

async function processDir(subDir) {
  const srcDir = path.join(TTS_EXPORT, subDir);
  const destDir = path.join(OUTPUT, subDir);
  if (!fs.existsSync(srcDir)) {
    console.log(`  Skip ${subDir} (not found)`);
    return [];
  }

  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".png"));
  const results = [];

  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file.replace(/\.png$/, ".webp"));
    try {
      await optimizeCard(src, dest);
      results.push({ file, relativePath: `/cards/${subDir}/${file.replace(/\.png$/, ".webp")}` });
    } catch (err) {
      console.error(`  Failed: ${file} — ${err.message}`);
    }
  }

  return results;
}

async function main() {
  console.log("Generating web-optimized card images from TTS exports...");

  const characters = await processDir("characters");
  console.log(`  Characters: ${characters.length}`);

  const bodies = await processDir("bodies");
  console.log(`  Bodies: ${bodies.length}`);

  const handCards = await processDir("hand_cards");
  console.log(`  Hand cards: ${handCards.length}`);

  const total = characters.length + bodies.length + handCards.length;
  console.log(`Done. ${total} cards optimized → ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
