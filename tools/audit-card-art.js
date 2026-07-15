const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "data", "card-art.json");
const TTS_ART_DIR = path.join(ROOT_DIR, "tools", "tts", "assets", "art");
const WEB_ART_DIR = path.join(ROOT_DIR, "src", "assets", "card-art-web");
const SOURCE_ART_DIR = path.join(ROOT_DIR, "src", "assets", "card-art-source");

function parseArgs(argv) {
  const args = new Set(argv);
  const known = new Set(["--json", "--strict-sources", "--verbose"]);
  for (const arg of args) {
    if (!known.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    json: args.has("--json"),
    strictSources: args.has("--strict-sources"),
    verbose: args.has("--verbose") || args.has("--strict-sources"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, extensions);
    return extensions.has(path.extname(entry.name).toLowerCase()) ? [filePath] : [];
  });
}

function relative(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function collectReferences(manifest) {
  const references = new Map();
  const add = (slug, category, id, slot) => {
    if (!slug) return;
    const existing = references.get(slug) ?? [];
    existing.push({ category, id, ...(slot ? { slot } : {}) });
    references.set(slug, existing);
  };

  for (const [id, art] of Object.entries(manifest.bodies ?? {})) {
    add(art.front, "bodies", id, "front");
    add(art.extra, "bodies", id, "extra");
  }
  for (const [id, slug] of Object.entries(manifest.characters ?? {})) {
    add(slug, "characters", id);
  }
  for (const [id, slug] of Object.entries(manifest.hands ?? {})) {
    add(slug, "hand-cards", id);
  }
  return references;
}

function expectedSourcePath(slug, references) {
  const categories = new Set(references.map((reference) => reference.category));
  const category = categories.size === 1 ? [...categories][0] : "shared";
  return path.join(SOURCE_ART_DIR, category, `${slug}.png`);
}

function slugSet(dir, extension) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir)
      .filter((filename) => filename.endsWith(extension))
      .map((filename) => filename.slice(0, -extension.length)),
  );
}

function buildReport(manifest) {
  const references = collectReferences(manifest);
  const referencedSlugs = new Set(references.keys());
  const ttsSlugs = slugSet(TTS_ART_DIR, ".png");
  const webSlugs = slugSet(WEB_ART_DIR, ".webp");
  const sourceFiles = listFiles(SOURCE_ART_DIR, new Set([".png", ".jpg", ".jpeg", ".webp"]));
  const expectedSources = new Map();
  const sharedSources = [];

  for (const [slug, slugReferences] of references) {
    const expected = expectedSourcePath(slug, slugReferences);
    expectedSources.set(relative(expected), slug);
    if (new Set(slugReferences.map((reference) => reference.category)).size > 1) {
      sharedSources.push(slug);
    }
  }

  const approvedSourceFiles = sourceFiles.map(relative).sort();
  const missingSources = [...expectedSources.keys()]
    .filter((filePath) => !fs.existsSync(path.join(ROOT_DIR, filePath)))
    .sort();
  const unexpectedSources = approvedSourceFiles
    .filter((filePath) => !expectedSources.has(filePath))
    .sort();

  return {
    referencedCount: referencedSlugs.size,
    runtime: {
      missingTts: [...referencedSlugs].filter((slug) => !ttsSlugs.has(slug)).sort(),
      missingWeb: [...referencedSlugs].filter((slug) => !webSlugs.has(slug)).sort(),
      unusedTts: [...ttsSlugs].filter((slug) => !referencedSlugs.has(slug)).sort(),
      unusedWeb: [...webSlugs].filter((slug) => !referencedSlugs.has(slug)).sort(),
    },
    sources: {
      approvedCount: expectedSources.size - missingSources.length,
      expectedCount: expectedSources.size,
      missing: missingSources,
      unexpected: unexpectedSources,
      shared: sharedSources.sort(),
    },
  };
}

function printList(label, values) {
  if (values.length === 0) return;
  console.log(`\n${label} (${values.length})`);
  for (const value of values) console.log(`  - ${value}`);
}

function printReport(report, verbose) {
  console.log("Card art audit");
  console.log(`  Referenced assets: ${report.referencedCount}`);
  console.log(`  Approved source coverage: ${report.sources.approvedCount}/${report.sources.expectedCount}`);
  console.log(`  Missing TTS PNG: ${report.runtime.missingTts.length}`);
  console.log(`  Missing web WebP: ${report.runtime.missingWeb.length}`);
  console.log(`  Unused TTS PNG: ${report.runtime.unusedTts.length}`);
  console.log(`  Unused web WebP: ${report.runtime.unusedWeb.length}`);

  printList("Missing TTS assets", report.runtime.missingTts);
  printList("Missing web assets", report.runtime.missingWeb);
  printList("Unused TTS assets", report.runtime.unusedTts);
  printList("Unused web assets", report.runtime.unusedWeb);
  if (verbose) {
    printList("Approved sources not archived yet", report.sources.missing);
  } else if (report.sources.missing.length > 0) {
    console.log(`\nApproved sources not archived yet: ${report.sources.missing.length}`);
    console.log("  Run npm run art:audit -- --verbose to list legacy source gaps.");
  }
  printList("Unexpected files in approved source directories", report.sources.unexpected);
  printList("Assets shared across source categories", report.sources.shared);
}

function hasRuntimeErrors(report) {
  return report.runtime.missingTts.length > 0
    || report.runtime.missingWeb.length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(readJson(MANIFEST_PATH));
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report, args.verbose);

  if (hasRuntimeErrors(report) || (args.strictSources && report.sources.missing.length > 0)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
