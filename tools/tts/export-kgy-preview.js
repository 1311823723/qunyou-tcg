// Rider previews remain drafts; the body text comes from the official catalog.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { renderBodyFront, renderBodyMega, writeSvgAsPng } = require("./render-card");
const { ROLE_COLORS } = require("./constants");

const ROOT = path.resolve(__dirname, "../..");
const OUT = "/private/tmp/qunyou-character-art/body_roaming_001/card-preview";
const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lines(text, units) {
  const result = [];
  let line = "";
  let width = 0;
  for (const char of text) {
    const next = /[\x00-\x7f]/.test(char) ? 0.62 : 1;
    if (width + next > units && line) { result.push(line); line = ""; width = 0; }
    line += char;
    width += next;
  }
  if (line) result.push(line);
  return result;
}

function block(text, y, size, maxLines, color = "#eee8df") {
  const wrapped = lines(text, Math.floor(618 / size));
  assert.ok(wrapped.length <= maxLines, `Text overflow: ${text}`);
  return wrapped.map((line, i) => `<text x="66" y="${y + i * size * 1.4}" font-size="${size}" fill="${color}">${xml(line)}</text>`).join("");
}

function riderSvg(card, side) {
  const pendingRedesign = card.review === "needs_redesign";
  const mode = pendingRedesign ? { timing: "待确认", effect: "待重做。原降费方案已停用，新效果尚未确认。" } : card[side];
  const final = side === "final";
  const accent = ROLE_COLORS[card.role];
  const trim = final ? "#dfc16e" : accent;
  const costs = `消耗此卡${final ? "及1点极巨能量" : ""}，并将己方角色区内1张${card.role}角色退场。每回合至多使用1张骑士卡。`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1050" viewBox="0 0 750 1050">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1b1728"/><stop offset="1" stop-color="#080b14"/></linearGradient></defs>
    <rect width="750" height="1050" rx="26" fill="#080a10"/>
    <rect x="16" y="16" width="718" height="1018" rx="20" fill="url(#bg)" stroke="${trim}" stroke-width="4"/>
    <path d="M36 240 V36 H714 V240 M36 850 V1014 H714 V850" fill="none" stroke="${trim}" opacity=".3"/>
    <g font-family="'PingFang SC','Noto Sans SC',sans-serif">
      <text x="54" y="65" font-size="18" letter-spacing="3" fill="${trim}">KGY / RIDER CARD</text>
      <text x="698" y="65" text-anchor="end" font-size="18" fill="${trim}">${final ? "FINAL" : "NORMAL"}</text>
      <text x="52" y="131" font-size="45" font-weight="800" fill="#fff5dc">${xml(card.name)}</text>
      <text x="54" y="169" font-size="22" letter-spacing="2" fill="${accent}">${final ? "FINAL / " : ""}${xml(card.call)}</text>
      <rect x="52" y="198" width="646" height="281" rx="12" fill="${accent}" fill-opacity=".035" stroke="${accent}" stroke-opacity=".25" stroke-dasharray="5 7"/>
      <path d="M345 256 H405 L451 337 L405 418 H345 L299 337 Z" fill="none" stroke="${trim}" opacity=".3" stroke-width="2"/>
      <text x="375" y="345" text-anchor="middle" font-size="35" fill="${accent}">${xml(card.role)}</text>
      <text x="375" y="454" text-anchor="middle" font-size="17" fill="#817d8b">原画预留</text>
      <rect x="52" y="496" width="142" height="33" rx="16" fill="${accent}" fill-opacity=".15"/>
      <text x="123" y="519" text-anchor="middle" font-size="18" fill="${accent}">${xml(pendingRedesign ? "待重做" : card.tag)}</text>
      <rect x="50" y="548" width="650" height="358" rx="14" fill="#ffffff" fill-opacity=".035"/>
      <text x="66" y="581" font-size="17" fill="${trim}">发动时机</text>
      ${block(mode.timing, 615, 25, 2)}
      <path d="M66 670 H682" stroke="${trim}" opacity=".25"/>
      ${block(mode.effect, 712, 29, 5)}
      ${block(costs, 938, 19, 3, "#bfb5a3")}
      <text x="375" y="1012" text-anchor="middle" font-size="14" fill="#77717f">设计预览${mode.timingProvisional ? " · 时机暂按建议排版" : ""} / ${xml(card.id)} / ${side}</text>
    </g>
  </svg>`;
}

async function contact(files, filename, columns, tileWidth) {
  const tileHeight = tileWidth * 1.4;
  const gap = 20;
  const rows = Math.ceil(files.length / columns);
  const images = [];
  for (const [i, file] of files.entries()) images.push({
    input: await sharp(path.join(OUT, file)).resize(tileWidth, tileHeight).png().toBuffer(),
    left: gap + (i % columns) * (tileWidth + gap),
    top: gap + Math.floor(i / columns) * (tileHeight + gap),
  });
  await sharp({ create: { width: columns * (tileWidth + gap) + gap, height: rows * (tileHeight + gap) + gap, channels: 4, background: "#090b13" } }).composite(images).png().toFile(path.join(OUT, filename));
}

async function main() {
  const draft = JSON.parse(await fs.readFile(path.join(ROOT, "docs/design-drafts/kgy-cards.json"), "utf8"));
  assert.equal(draft.status, "design-preview-only");
  const bodies = JSON.parse(await fs.readFile(path.join(ROOT, "data/cards/bodies.json"), "utf8"));
  draft.body = bodies.find((body) => body.id === draft.bodyId);
  assert.ok(draft.body, `Unknown body: ${draft.bodyId}`);
  assert.equal(draft.riders.length, 6);
  assert.equal(new Set(draft.riders.map((card) => card.role)).size, 6);
  for (const [slot, property] of [["front", "__ttsArt"], ["extra", "__ttsMegaArt"]]) {
    if (draft.art?.[slot]) {
      const source = await fs.readFile(path.join(ROOT, draft.art[slot]));
      draft.body[property] = `data:image/png;base64,${source.toString("base64")}`;
    }
  }
  const bodyFiles = ["body_roaming_001_front.png", "body_roaming_001_dynamax_back.png"];
  await writeSvgAsPng(renderBodyFront(draft.body), path.join(OUT, bodyFiles[0]));
  await writeSvgAsPng(renderBodyMega(draft.body), path.join(OUT, bodyFiles[1]));
  const allFiles = [...bodyFiles];
  for (const side of ["normal", "final"]) {
    const files = [];
    for (const card of draft.riders) {
      const filename = `${card.id}_${side}.png`;
      await writeSvgAsPng(riderSvg(card, side), path.join(OUT, filename));
      files.push(filename);
      allFiles.push(filename);
    }
    await contact(files, `riders-${side}.png`, 3, 500);
  }
  await contact(bodyFiles, "body-pair.png", 2, 750);
  for (const file of allFiles) {
    const info = await sharp(path.join(OUT, file)).metadata();
    assert.equal(info.width, 750);
    assert.equal(info.height, 1050);
  }
  await fs.writeFile(path.join(OUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>KGY 双面制卡预览</title><style>body{margin:24px;background:#090b13;color:#e8dfc6;font:16px system-ui}section{display:flex;flex-wrap:wrap;gap:20px}a{flex:0 1 300px}img{width:100%;border-radius:10px}p{line-height:1.7}</style><h1>KGY 双面制卡预览</h1><p>本体双面读取正式数据，已接入原画。骑士辅助卡仍为设计预览，原画待制作，部分时机待确认。尚未接入在线自动结算。点击查看完整尺寸。</p><section>${allFiles.map((file) => `<a href="${file}"><img src="${file}" alt="${file}"></a>`).join("")}</section></html>`);
  console.log(`Verified ${allFiles.length} draft card faces (750x1050). Preview: ${OUT}/index.html`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
