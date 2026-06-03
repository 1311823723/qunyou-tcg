const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "data", "card-art.json");
const TTS_ART_DIR = path.join(ROOT_DIR, "tools", "tts", "assets", "art");
const WEB_ART_DIR = path.join(ROOT_DIR, "src", "assets", "card-art-web");

function printHelp() {
  console.log(`
Usage:
  npm run art:use -- --id <cardId> --source <image> --name <asset-name> [--slot front|extra] [--keep-old]
  npm run art:use -- --prune-unused

Examples:
  npm run art:use -- --id char_052_fengyaojing_desert-butcher --source ./new-art.png --name fengyaojing-desert-butcher-v3
  npm run art:use -- --id body_combo_001 --slot extra --source ./mega.png --name guamao-body-mega-v2
  npm run art:use -- --prune-unused
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--keep-old") {
      args.keepOld = true;
    } else if (arg === "--prune-unused") {
      args.pruneUnused = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeSlug(slug) {
  return slug.trim().replace(/\.(png|jpe?g|webp)$/i, "");
}

function validateSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    throw new Error("--name must use lowercase letters, numbers, and hyphens, for example guamao-body-mega-v2");
  }
}

function collectReferencedSlugs(manifest) {
  const slugs = new Set();
  for (const art of Object.values(manifest.bodies ?? {})) {
    if (art.front) slugs.add(art.front);
    if (art.extra) slugs.add(art.extra);
  }
  for (const slug of Object.values(manifest.characters ?? {})) {
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function updateManifest(manifest, id, slot, slug) {
  if (id.startsWith("body_")) {
    const bodySlot = slot ?? "front";
    if (!["front", "extra"].includes(bodySlot)) {
      throw new Error("Body cards only support --slot front or --slot extra");
    }
    manifest.bodies ??= {};
    const previous = manifest.bodies[id]?.[bodySlot];
    manifest.bodies[id] = {
      ...(manifest.bodies[id] ?? {}),
      [bodySlot]: slug,
    };
    return previous;
  }

  if (id.startsWith("char_")) {
    if (slot) {
      throw new Error("Character cards do not use --slot");
    }
    manifest.characters ??= {};
    const previous = manifest.characters[id];
    manifest.characters[id] = slug;
    return previous;
  }

  throw new Error("--id must start with body_ or char_");
}

function removeIfUnreferenced(slug, referencedSlugs, newSlug) {
  if (!slug || slug === newSlug || referencedSlugs.has(slug)) return [];

  const removed = [];
  for (const filePath of [
    path.join(TTS_ART_DIR, `${slug}.png`),
    path.join(WEB_ART_DIR, `${slug}.webp`),
  ]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removed.push(path.relative(ROOT_DIR, filePath));
    }
  }
  return removed;
}

function pruneUnusedAssets(manifest) {
  const referencedSlugs = collectReferencedSlugs(manifest);
  const removed = [];
  for (const [dir, ext] of [[TTS_ART_DIR, ".png"], [WEB_ART_DIR, ".webp"]]) {
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir)) {
      if (!filename.endsWith(ext)) continue;
      const slug = filename.slice(0, -ext.length);
      if (referencedSlugs.has(slug)) continue;
      const filePath = path.join(dir, filename);
      fs.unlinkSync(filePath);
      removed.push(path.relative(ROOT_DIR, filePath));
    }
  }
  return removed;
}

async function writeAssets(sourcePath, slug) {
  const pngPath = path.join(TTS_ART_DIR, `${slug}.png`);
  const webpPath = path.join(WEB_ART_DIR, `${slug}.webp`);
  fs.mkdirSync(TTS_ART_DIR, { recursive: true });
  fs.mkdirSync(WEB_ART_DIR, { recursive: true });

  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source image does not exist: ${sourcePath}`);
  }

  const sourceEqualsPngTarget = resolvedSource === pngPath;
  if (!sourceEqualsPngTarget) {
    await sharp(resolvedSource).png().toFile(pngPath);
  }
  await sharp(pngPath).webp({ quality: 90 }).toFile(webpPath);

  return {
    png: path.relative(ROOT_DIR, pngPath),
    webp: path.relative(ROOT_DIR, webpPath),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const manifest = readJson(MANIFEST_PATH);

  if (args.pruneUnused) {
    const removed = pruneUnusedAssets(manifest);
    console.log("Unused card art pruned");
    if (removed.length === 0) {
      console.log("  No unused PNG/WebP assets found");
    } else {
      for (const filePath of removed) console.log(`  - ${filePath}`);
    }
    return;
  }

  if (!args.id || !args.source || !args.name) {
    printHelp();
    throw new Error("--id, --source, and --name are required");
  }

  const slug = normalizeSlug(args.name);
  validateSlug(slug);

  const previous = updateManifest(manifest, args.id, args.slot, slug);
  const written = await writeAssets(args.source, slug);
  writeJson(MANIFEST_PATH, manifest);

  const removed = args.keepOld
    ? []
    : removeIfUnreferenced(previous, collectReferencedSlugs(manifest), slug);

  console.log("Card art registered");
  console.log(`  Card: ${args.id}${args.slot ? ` (${args.slot})` : ""}`);
  console.log(`  Asset: ${slug}`);
  console.log(`  TTS PNG: ${written.png}`);
  console.log(`  WebP: ${written.webp}`);
  if (removed.length > 0) {
    console.log("  Removed old unreferenced assets:");
    for (const filePath of removed) console.log(`    - ${filePath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
