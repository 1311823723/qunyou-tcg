import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "docs/auto-battle-character-status.md");
const characters = JSON.parse(fs.readFileSync(path.join(root, "data/cards/characters.json"), "utf8"));
const implementation = JSON.parse(fs.readFileSync(path.join(root, "data/cards/character_implementation.json"), "utf8"));
const decks = fs.readdirSync(path.join(root, "data/decks"))
  .filter((file) => file.endsWith(".deck.json"))
  .sort()
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "data/decks", file), "utf8")));

const AUTOMATION_LABELS = {
  pending: "未实现",
  in_progress: "实现中",
  implemented: "已实现",
};
const REVIEW_LABELS = {
  confirmed: "已确认",
  needs_confirmation: "待确认",
  needs_testing: "待实测",
  needs_optimization: "待优化",
};

const deckNamesByCharacter = new Map();
for (const deck of decks) {
  for (const id of deck.characterIds) {
    const names = deckNamesByCharacter.get(id) || [];
    names.push(deck.name);
    deckNamesByCharacter.set(id, names);
  }
}

function countBy(key, values) {
  return Object.fromEntries(values.map((value) => [value, characters.filter((card) => implementation[card.id]?.[key] === value).length]));
}

function report() {
  const automationCounts = countBy("automation", Object.keys(AUTOMATION_LABELS));
  const reviewCounts = countBy("review", Object.keys(REVIEW_LABELS));
  const prebuiltIds = new Set(decks.flatMap((deck) => deck.characterIds));
  const lines = [
    "# 自动对战角色技能进度",
    "",
    "> 本文档由 `npm run automation:report` 生成，请修改 `data/cards/character_implementation.json` 后重新生成。",
    "",
    "## 总览",
    "",
    `- 角色总数：${characters.length}`,
    `- 预组角色（去重）：${prebuiltIds.size}`,
    `- 非预组角色：${characters.length - prebuiltIds.size}`,
    `- 自动化：${Object.entries(AUTOMATION_LABELS).map(([key, label]) => `${label} ${automationCounts[key]}`).join(" / ")}`,
    `- 设计复核：${Object.entries(REVIEW_LABELS).map(([key, label]) => `${label} ${reviewCounts[key]}`).join(" / ")}`,
    "",
    "## 预组解锁进度",
    "",
    "| 预组 | 流派 | 已实现 | 状态 |",
    "| --- | --- | ---: | --- |",
  ];
  for (const deck of decks) {
    const implemented = deck.characterIds.filter((id) => implementation[id]?.automation === "implemented").length;
    const blocked = deck.characterIds.some((id) => implementation[id]?.review === "needs_confirmation");
    const ready = implemented === deck.characterIds.length && !blocked;
    lines.push(`| ${deck.name} | ${deck.archetype} | ${implemented}/${deck.characterIds.length} | ${ready ? "已解锁" : blocked ? "待确认" : "未解锁"} |`);
  }
  lines.push("", "## 状态清单", "");
  for (const [status, label] of Object.entries(AUTOMATION_LABELS)) {
    const cards = characters.filter((card) => implementation[card.id]?.automation === status);
    lines.push(`### ${label}（${cards.length}）`, "", cards.length ? cards.map((card) => `\`${card.id}\` ${card.name}`).join("、") : "无", "");
  }
  for (const status of ["needs_confirmation", "needs_testing", "needs_optimization"]) {
    const cards = characters.filter((card) => implementation[card.id]?.review === status);
    lines.push(`### ${REVIEW_LABELS[status]}（${cards.length}）`, "", cards.length ? cards.map((card) => `\`${card.id}\` ${card.name}`).join("、") : "无", "");
  }
  const outsidePrebuilt = characters.filter((card) => !prebuiltIds.has(card.id));
  lines.push(
    "## 卡池范围",
    "",
    `- 预组角色（去重 ${prebuiltIds.size} 张）：在下方明细的“预组”列中标明复用关系。`,
    `- 非预组角色（${outsidePrebuilt.length} 张）：${outsidePrebuilt.map((card) => `\`${card.id}\` ${card.name}`).join("、")}。`,
    "",
  );
  lines.push(
    "",
    "## 角色明细",
    "",
    "| ID | 角色 | 定位 | 预组 | 自动化 | 设计复核 | 备注 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const card of characters) {
    const status = implementation[card.id];
    lines.push(`| ${card.id} | ${card.name} | ${card.mainRole} | ${(deckNamesByCharacter.get(card.id) || ["非预组"]).join("、")} | ${AUTOMATION_LABELS[status?.automation] || "缺失"} | ${REVIEW_LABELS[status?.review] || "缺失"} | ${status?.note || ""} |`);
  }
  lines.push("");
  return lines.join("\n");
}

const next = report();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== `${next}\n`) {
    console.error("Character automation status report is stale. Run npm run automation:report.");
    process.exit(1);
  }
  console.log("Character automation status report is current.");
} else {
  fs.writeFileSync(outputPath, `${next}\n`);
  console.log(`Generated ${path.relative(root, outputPath)}.`);
}
