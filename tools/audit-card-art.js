const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "data", "card-art.json");
const TTS_ART_DIR = path.join(ROOT_DIR, "tools", "tts", "assets", "art");
const WEB_ART_DIR = path.join(ROOT_DIR, "src", "assets", "card-art-web");
const SOURCE_ART_DIR = path.join(ROOT_DIR, "src", "assets", "card-art-source");
const BACKLOG_PATH = path.join(ROOT_DIR, "docs", "card-art-source-backlog.md");

function parseArgs(argv) {
  const args = new Set(argv);
  const known = new Set(["--json", "--strict-sources", "--verbose", "--write-source-backlog"]);
  for (const arg of args) {
    if (!known.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    json: args.has("--json"),
    strictSources: args.has("--strict-sources"),
    verbose: args.has("--verbose") || args.has("--strict-sources"),
    writeSourceBacklog: args.has("--write-source-backlog"),
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

function totalBytes(files) {
  return files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

function exactDuplicateGroups(files) {
  const byHash = new Map();
  for (const filePath of files) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    const group = byHash.get(hash) ?? [];
    group.push(filePath);
    byHash.set(hash, group);
  }
  return [...byHash.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([hash, group]) => ({
      hash,
      bytesPerFile: fs.statSync(group[0]).size,
      reclaimableBytes: fs.statSync(group[0]).size * (group.length - 1),
      files: group.map(relative).sort(),
    }))
    .sort((left, right) => right.reclaimableBytes - left.reclaimableBytes);
}

function buildReport(manifest) {
  const references = collectReferences(manifest);
  const referencedSlugs = new Set(references.keys());
  const ttsSlugs = slugSet(TTS_ART_DIR, ".png");
  const webSlugs = slugSet(WEB_ART_DIR, ".webp");
  const sourceFiles = listFiles(SOURCE_ART_DIR, new Set([".png", ".jpg", ".jpeg", ".webp"]));
  const ttsFiles = listFiles(TTS_ART_DIR, new Set([".png", ".jpg", ".jpeg", ".webp"]));
  const webFiles = listFiles(WEB_ART_DIR, new Set([".webp", ".png", ".jpg", ".jpeg"]));
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
  const legacyRuntimeOnly = missingSources.map((filePath) => {
    const slug = expectedSources.get(filePath);
    return {
      slug,
      expectedSource: filePath,
      references: references.get(slug) ?? [],
      hasTts: ttsSlugs.has(slug),
      hasWeb: webSlugs.has(slug),
    };
  });
  const duplicateGroups = exactDuplicateGroups([...sourceFiles, ...ttsFiles]);

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
      legacyRuntimeOnly,
    },
    assets: {
      source: { files: sourceFiles.length, bytes: totalBytes(sourceFiles) },
      ttsArt: { files: ttsFiles.length, bytes: totalBytes(ttsFiles) },
      webArt: { files: webFiles.length, bytes: totalBytes(webFiles) },
      totalBytes: totalBytes(sourceFiles) + totalBytes(ttsFiles) + totalBytes(webFiles),
      exactDuplicates: {
        groups: duplicateGroups,
        groupCount: duplicateGroups.length,
        reclaimableBytes: duplicateGroups.reduce((total, group) => total + group.reclaimableBytes, 0),
      },
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
  console.log(`  Source art: ${report.assets.source.files} files / ${formatBytes(report.assets.source.bytes)}`);
  console.log(`  TTS runtime art: ${report.assets.ttsArt.files} files / ${formatBytes(report.assets.ttsArt.bytes)}`);
  console.log(`  Web art: ${report.assets.webArt.files} files / ${formatBytes(report.assets.webArt.bytes)}`);
  console.log(`  Exact duplicate groups: ${report.assets.exactDuplicates.groupCount} / ${formatBytes(report.assets.exactDuplicates.reclaimableBytes)} reclaimable`);

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
  if (verbose) {
    printList(
      "Exact duplicate files (report only; do not delete automatically)",
      report.assets.exactDuplicates.groups.flatMap((group) => [
        `${formatBytes(group.bytesPerFile)} each / ${group.hash.slice(0, 12)}`,
        ...group.files.map((filePath) => `  ${filePath}`),
      ]),
    );
  }
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function writeSourceBacklog(report) {
  const rows = report.sources.legacyRuntimeOnly.map((item) => {
    const references = item.references
      .map((reference) => `${reference.id}${reference.slot ? `:${reference.slot}` : ""}`)
      .join("、");
    const runtime = [item.hasTts ? "TTS" : "", item.hasWeb ? "Web" : ""].filter(Boolean).join(" + ") || "缺失";
    return `| ${markdownCell(item.slug)} | ${markdownCell(references)} | \`${markdownCell(item.expectedSource)}\` | ${runtime} |`;
  });
  const markdown = `# 原画源文件待归档清单

> 由 \`npm run art:audit:backlog\` 生成。此清单只记录缺口，不允许用 TTS 派生 PNG 冒充原始源文件。

- 正式源图覆盖率：${report.sources.approvedCount}/${report.sources.expectedCount}
- 待归档旧原画：${report.sources.legacyRuntimeOnly.length}
- 运行时 TTS/Web 缺失：${report.runtime.missingTts.length}/${report.runtime.missingWeb.length}

| 原画 slug | 卡牌引用 | 期望源文件位置 | 当前运行资产 |
|---|---|---|---|
${rows.join("\n")}
`;
  fs.writeFileSync(BACKLOG_PATH, markdown);
  console.log(`Wrote ${relative(BACKLOG_PATH)}`);
}

function hasRuntimeErrors(report) {
  return report.runtime.missingTts.length > 0
    || report.runtime.missingWeb.length > 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(readJson(MANIFEST_PATH));
  if (args.writeSourceBacklog) writeSourceBacklog(report);
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
