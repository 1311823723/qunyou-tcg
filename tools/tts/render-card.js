const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  CARD_WIDTH,
  CARD_HEIGHT,
  ROLE_COLORS,
  ROLE_DARK_COLORS,
  ROLE_TRIM_COLORS,
  SUIT_META,
} = require("./constants");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitCharacterName(name) {
  const idx = name.indexOf("-");
  if (idx > 0) return { prefix: name.slice(0, idx), suffix: name.slice(idx + 1) };
  return { prefix: "", suffix: name };
}

function formatCost(cost = {}) {
  if (cost.type === "休整") return `休整 ${cost.amount ?? 1}`;
  if (cost.type === "退场") return cost.text ?? "退场自身";
  if (cost.type === "休整自身") return cost.text ?? "休整自身";
  if (cost.type === "复合") return cost.text ?? "复合";
  return cost.type ?? "无";
}

function wrapText(text, maxUnits) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  const lines = [];
  let line = "";
  let units = 0;

  for (const char of value) {
    const charUnits = /[A-Za-z0-9]/.test(char) ? 0.56 : 1;
    if (units + charUnits > maxUnits && line) {
      lines.push(line);
      line = char;
      units = charUnits;
    } else {
      line += char;
      units += charUnits;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapTextPreserveBreaks(text, maxUnits) {
  return String(text ?? "")
    .split(/\n+/)
    .flatMap((paragraph) => wrapText(paragraph, maxUnits));
}

function textBlock(text, x, y, maxUnits, fontSize, lineHeight, options = {}) {
  const lines = wrapText(text, maxUnits).slice(0, options.maxLines ?? 12);
  const weight = options.weight ?? 500;
  const fill = options.fill ?? "#f4f0e8";
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
  )).join("");
}

function fitTextBlock(text, x, y, width, height, startFontSize, minFontSize, options = {}) {
  const fill = options.fill ?? "#f4f0e8";
  const weight = options.weight ?? 500;
  const lineRatio = options.lineRatio ?? 1.38;

  for (let fontSize = startFontSize; fontSize >= minFontSize; fontSize--) {
    const lineHeight = Math.round(fontSize * lineRatio);
    const maxUnits = Math.max(8, Math.floor(width / (fontSize * 0.96)));
    const lines = wrapTextPreserveBreaks(text, maxUnits);
    const maxLines = Math.max(1, Math.floor(height / lineHeight));
    if (lines.length <= maxLines || fontSize === minFontSize) {
      return lines.map((line, index) => (
        `<text x="${x}" y="${y + index * lineHeight}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
      )).join("");
    }
  }

  return "";
}

function tagsSvg(tags, x, y, options = {}) {
  let cursor = x;
  const gap = options.gap ?? 8;
  const fill = options.fill ?? "rgba(12,12,18,0.66)";
  const stroke = options.stroke ?? "rgba(255,255,255,0.24)";
  const color = options.color ?? "#f4f0e8";
  return (tags ?? []).slice(0, options.max ?? 6).map((tag) => {
    const width = Math.max(58, tag.length * 22 + 28);
    const svg = `
      <rect x="${cursor}" y="${y}" width="${width}" height="34" rx="8" fill="${fill}" stroke="${stroke}" />
      <text x="${cursor + width / 2}" y="${y + 24}" text-anchor="middle" font-size="18" font-weight="800" fill="${color}">${escapeXml(tag)}</text>
    `;
    cursor += width + gap;
    return svg;
  }).join("");
}

function verticalText(text, x, y, fontSize, options = {}) {
  const chars = Array.from(String(text ?? ""));
  const fill = options.fill ?? "#f4f0e8";
  const weight = options.weight ?? 900;
  const gap = options.gap ?? Math.round(fontSize * 1.05);
  return chars.map((char, index) => (
    `<text x="${x}" y="${y + index * gap}" text-anchor="middle" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" stroke="${options.stroke ?? "none"}" stroke-width="${options.strokeWidth ?? 0}" paint-order="stroke">${escapeXml(char)}</text>`
  )).join("");
}

function artStage(label, variant, options = {}) {
  const accent = options.accent ?? (variant === "mega" ? "#d8b75c" : variant === "body" ? "#58c7e8" : "#9d6cff");
  const x = options.x ?? 122;
  const y = options.y ?? 42;
  const width = options.width ?? 588;
  const height = options.height ?? 666;
  const opacity = variant === "mega" ? 0.32 : 0.22;
  const imageAlign = options.imageAlign ?? "xMidYMid";
  const image = options.imageDataUri
    ? `<image href="${options.imageDataUri}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${imageAlign} slice"/>`
    : "";
  const placeholder = options.imageDataUri
    ? ""
    : `
      <text x="${x + width / 2}" y="${y + height / 2 - 16}" text-anchor="middle" font-size="34" font-weight="900" fill="${accent}" fill-opacity="0.82">${escapeXml(label)}</text>
      <text x="${x + width / 2}" y="${y + height / 2 + 30}" text-anchor="middle" font-size="20" font-weight="800" fill="#f4f0e8" fill-opacity="0.46">ART PLACEHOLDER</text>
    `;
  const overlayOpacity = options.imageDataUri ? 0.18 : 1;
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#0a0d16"/>
      ${image}
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#artSky)" opacity="${overlayOpacity}"/>
      <path d="M${x + 10} ${y + height - 74} C${x + 150} ${y + height - 155}, ${x + 294} ${y + height - 15}, ${x + width - 8} ${y + height - 126} L${x + width - 8} ${y + height} L${x + 10} ${y + height} Z" fill="#ffffff" fill-opacity="0.08"/>
      <path d="M${x + 28} ${y + height - 40} C${x + 190} ${y + height - 116}, ${x + 390} ${y + height - 22}, ${x + width - 32} ${y + height - 92}" fill="none" stroke="${accent}" stroke-opacity="${opacity}" stroke-width="12"/>
      <path d="M${x + 68} ${y + 130} C${x + 170} ${y + 22}, ${x + 392} ${y + 60}, ${x + width - 70} ${y + 18}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="4"/>
      <rect x="${x + 28}" y="${y + 28}" width="${width - 56}" height="${height - 56}" fill="none" stroke="${accent}" stroke-opacity="0.22" stroke-width="3" stroke-dasharray="16 13"/>
      ${placeholder}
    </g>
  `;
}

function cardShell(inner, options = {}) {
  const accent = options.accent ?? "#ff5a35";
  const secondary = options.secondary ?? "#9d6cff";
  const isMega = options.variant === "mega";
  const paper = options.paper ?? "#eee8d8";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
      <defs>
        <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${isMega ? "#3a2b11" : "#151827"}"/>
          <stop offset="0.52" stop-color="#070711"/>
          <stop offset="1" stop-color="${secondary}"/>
        </linearGradient>
        <linearGradient id="artSky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#081326"/>
          <stop offset="0.35" stop-color="${secondary}" stop-opacity="0.62"/>
          <stop offset="0.72" stop-color="#111827"/>
          <stop offset="1" stop-color="${accent}" stop-opacity="0.36"/>
        </linearGradient>
        <linearGradient id="textParchment" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${paper}" stop-opacity="0.92"/>
          <stop offset="0.62" stop-color="#f8f4e8" stop-opacity="0.76"/>
          <stop offset="1" stop-color="#d8d1c2" stop-opacity="0.88"/>
        </linearGradient>
        <radialGradient id="sealGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
          <stop offset="1" stop-color="${accent}" stop-opacity="0.08"/>
        </radialGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.45"/>
        </filter>
        <filter id="inkShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.72"/>
        </filter>
      </defs>
      <rect width="750" height="1050" fill="#05050a"/>
      <rect x="12" y="12" width="726" height="1026" rx="18" fill="url(#cardBg)" stroke="${accent}" stroke-opacity="${isMega ? "0.92" : "0.58"}" stroke-width="5"/>
      <path d="M28 28 H722 V1022 H28 Z" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="2"/>
      <g opacity="0.16">
        <path d="M38 184 C104 154, 86 92, 164 70" fill="none" stroke="${accent}" stroke-width="5"/>
        <path d="M590 70 C668 110, 614 160, 714 178" fill="none" stroke="${accent}" stroke-width="5"/>
        <path d="M74 940 C154 900, 176 986, 256 936" fill="none" stroke="#ffffff" stroke-width="4"/>
      </g>
      <g font-family="'Noto Serif SC', 'Songti SC', 'Noto Sans SC', 'PingFang SC', serif">
        ${inner}
      </g>
    </svg>
  `;
}

function renderBodyFront(card) {
  const tags = card.affinityTags ?? [];
  const accent = "#43b9d6";
  const inner = `
    ${artStage("本体原画预留", "body", { x: 34, y: 34, width: 682, height: 958, accent, imageDataUri: card.__ttsArt })}
    <g filter="url(#inkShadow)">
      <path d="M594 70 C632 48, 686 58, 706 94 C682 120, 642 116, 608 102 Z" fill="rgba(12,20,28,0.72)" stroke="${accent}" stroke-width="3"/>
      <text x="650" y="103" text-anchor="middle" font-size="23" font-weight="900" fill="#f4f0e8">本体</text>
    </g>
    <circle cx="103" cy="102" r="52" fill="url(#sealGlow)" stroke="#ead28a" stroke-width="5"/>
    <circle cx="103" cy="102" r="38" fill="rgba(0,0,0,0.38)" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
    <text x="103" y="115" text-anchor="middle" font-size="42" font-weight="900" fill="#ffd98a">${escapeXml(card.hp)}</text>
    <text x="103" y="154" text-anchor="middle" font-size="18" font-weight="900" fill="#f4f0e8">体力</text>
    <text x="658" y="270" text-anchor="middle" writing-mode="tb" font-size="${card.name.length > 4 ? 41 : 48}" font-weight="900" fill="#ffffff" stroke="#17100a" stroke-width="5" paint-order="stroke">${escapeXml(card.name)}</text>
    <text x="618" y="138" text-anchor="middle" writing-mode="tb" font-size="22" font-weight="900" fill="#ffe59a">${escapeXml(card.archetype)}</text>
    <g transform="translate(54 644)">${tagsSvg(tags, 0, 0, { fill: "rgba(0,0,0,0.38)", stroke: "rgba(255,255,255,0.34)", max: 5 })}</g>
    <g filter="url(#shadow)">
      <path d="M52 706 H698 L674 992 H76 Z" fill="url(#textParchment)" stroke="#ffffff" stroke-opacity="0.62" stroke-width="2"/>
      <path d="M68 728 H682" stroke="${accent}" stroke-opacity="0.42" stroke-width="4"/>
      <rect x="76" y="738" width="188" height="44" rx="7" fill="${accent}"/>
      <text x="170" y="769" text-anchor="middle" font-size="23" font-weight="900" fill="#ffffff">${escapeXml(card.skillName)}</text>
      ${fitTextBlock(card.effectText, 84, 818, 574, 100, 27, 17, { fill: "#25201b", weight: 700, lineRatio: 1.30 })}
      ${card.extraForm?.condition ? fitTextBlock(`Mega 条件：${card.extraForm.condition}`, 84, 945, 584, 40, 18, 15, { fill: "#7b5318", weight: 900, lineRatio: 1.20 }) : ""}
    </g>
    <text x="375" y="1014" text-anchor="middle" font-size="15" font-weight="700" fill="#b8ad96">${escapeXml(card.id)}</text>
  `;
  return cardShell(inner, { accent, secondary: "#18395c", variant: "body", paper: "#ede5d4" });
}

function renderBodyMega(card) {
  const extra = card.extraForm;
  const tags = card.affinityTags ?? [];
  const megaDisplayName = extra.name.replace(/^Mega\s+/i, "");
  const inner = `
    ${artStage("Mega 原画预留", "mega", { x: 28, y: 28, width: 694, height: 964, accent: "#d8b75c", imageDataUri: card.__ttsMegaArt })}
    <path d="M42 56 C120 20, 190 32, 246 78 L206 126 C154 88, 98 98, 48 132 Z" fill="rgba(216,183,92,0.24)" stroke="#d8b75c" stroke-width="4"/>
    <text x="136" y="91" text-anchor="middle" font-size="30" font-weight="900" fill="#fff0a6">MEGA</text>
    <circle cx="103" cy="162" r="48" fill="#1c1308" stroke="#d8b75c" stroke-width="5"/>
    <text x="103" y="174" text-anchor="middle" font-size="42" font-weight="900" fill="#fff0a6">${escapeXml(card.hp)}</text>
    <text x="103" y="210" text-anchor="middle" font-size="17" font-weight="900" fill="#f4f0e8">体力</text>
    <text x="658" y="260" text-anchor="middle" writing-mode="tb" font-size="${megaDisplayName.length > 5 ? 37 : 44}" font-weight="900" fill="#fff8cf" stroke="#1b1005" stroke-width="5" paint-order="stroke">${escapeXml(megaDisplayName)}</text>
    <text x="618" y="120" text-anchor="middle" writing-mode="tb" font-size="22" font-weight="900" fill="#d8b75c">${escapeXml(card.archetype)}</text>
    <g transform="translate(54 642)">${tagsSvg(tags, 0, 0, { fill: "rgba(31,18,3,0.54)", stroke: "rgba(216,183,92,0.50)", color: "#fff3c4", max: 5 })}</g>
    <g filter="url(#shadow)">
      <path d="M46 704 H704 L676 992 H74 Z" fill="rgba(23,14,8,0.72)" stroke="#d8b75c" stroke-opacity="0.68" stroke-width="3"/>
      <rect x="78" y="732" width="244" height="46" rx="7" fill="#d8b75c"/>
      <text x="200" y="765" text-anchor="middle" font-size="24" font-weight="900" fill="#221506">${escapeXml(extra.skillName)}</text>
      ${fitTextBlock(extra.effectText, 84, 812, 578, 162, 26, 16, { fill: "#fff8e8", weight: 700, lineRatio: 1.26 })}
    </g>
    <text x="375" y="1014" text-anchor="middle" font-size="15" font-weight="800" fill="#bca15d">${escapeXml(card.id)} · mega back</text>
  `;
  return cardShell(inner, { accent: "#d8b75c", secondary: "#4d2d66", variant: "mega", paper: "#f4ecd5" });
}

function renderCharacter(card) {
  const roleColor = ROLE_COLORS[card.mainRole] ?? "#ffd98a";
  const roleDarkColor = ROLE_DARK_COLORS[card.mainRole] ?? "#4b2d1c";
  const roleTrimColor = ROLE_TRIM_COLORS[card.mainRole] ?? "#ffe08a";
  const { prefix, suffix } = splitCharacterName(card.name);
  const inner = `
    <rect x="26" y="26" width="100" height="998" fill="${roleDarkColor}" stroke="${roleTrimColor}" stroke-opacity="0.70" stroke-width="3"/>
    <g opacity="0.17">
      <path d="M42 80 C96 116, 42 158, 102 206" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
      <path d="M42 306 C96 342, 42 384, 102 432" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
      <path d="M42 532 C96 568, 42 610, 102 658" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
    </g>
    ${artStage("角色原画预留", "character", { x: 126, y: 26, width: 598, height: 960, accent: roleColor, imageDataUri: card.__ttsArt })}
    <circle cx="76" cy="92" r="42" fill="url(#sealGlow)" stroke="${roleTrimColor}" stroke-width="4"/>
    <text x="76" y="104" text-anchor="middle" font-size="29" font-weight="900" fill="#fff0a6">${escapeXml(card.mainRole.slice(0, 1))}</text>
    ${prefix ? verticalText(prefix, 76, 206, 25, { fill: roleTrimColor, stroke: "#160b09", strokeWidth: 4, gap: 36 }) : ""}
    ${verticalText(suffix, 76, prefix ? 396 : 248, suffix.length > 4 ? 36 : 42, { fill: "#ffffff", stroke: roleDarkColor, strokeWidth: 5, gap: suffix.length > 4 ? 46 : 58 })}
    <rect x="48" y="846" width="56" height="86" fill="rgba(255,255,255,0.08)" stroke="${roleTrimColor}" stroke-opacity="0.68"/>
    ${verticalText(card.deck || "通用", 77, 876, 17, { fill: roleTrimColor, gap: 21 })}
    <text x="676" y="104" text-anchor="middle" writing-mode="tb" font-size="24" font-weight="900" fill="${roleTrimColor}" stroke="#0b0b12" stroke-width="4" paint-order="stroke">${escapeXml(card.mainRole)}</text>
    <g transform="translate(150 678)">${tagsSvg(card.tags, 0, 0, { fill: "rgba(0,0,0,0.45)", stroke: "rgba(255,255,255,0.32)", max: 4 })}</g>
    <g filter="url(#shadow)">
      <path d="M126 746 H724 V986 H126 Z" fill="url(#textParchment)" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>
      <rect x="150" y="770" width="190" height="42" rx="7" fill="${roleColor}"/>
      <text x="245" y="800" text-anchor="middle" font-size="22" font-weight="900" fill="#ffffff">${escapeXml(card.skillName)}</text>
      <rect x="356" y="770" width="112" height="42" rx="7" fill="#312a24" fill-opacity="0.84"/>
      <text x="412" y="800" text-anchor="middle" font-size="19" font-weight="900" fill="#ffe59a">${escapeXml(formatCost(card.cost))}</text>
      ${fitTextBlock(card.timing, 486, 800, 196, 38, 20, 16, { fill: "#534333", weight: 800 })}
      ${fitTextBlock(card.effectText, 150, 848, 530, 104, 25, 18, { fill: "#25201b", weight: 700 })}
    </g>
    <text x="425" y="1014" text-anchor="middle" font-size="15" font-weight="700" fill="#b8ad96">${escapeXml(card.id)}</text>
  `;
  return cardShell(inner, { accent: roleColor, secondary: "#172b38", variant: "character", paper: "#eee9dd" });
}

function renderHand(card) {
  const suit = SUIT_META[card.suit] ?? { symbol: card.suit, color: "#f4f0e8" };
  const isTrick = card.handType === "锦囊";
  const accent = isTrick ? "#9d6cff" : "#58c7e8";
  const inner = `
    <rect x="34" y="34" width="682" height="982" fill="rgba(238,232,216,0.93)" stroke="${accent}" stroke-width="5"/>
    <rect x="58" y="58" width="116" height="158" fill="#111827" stroke="${suit.color}" stroke-opacity="0.75" stroke-width="3"/>
    <text x="116" y="126" text-anchor="middle" font-size="54" font-weight="900" fill="${suit.color}">${escapeXml(card.rank)}</text>
    <text x="116" y="186" text-anchor="middle" font-size="54" font-weight="900" fill="${suit.color}">${escapeXml(suit.symbol)}</text>
    <rect x="194" y="58" width="472" height="158" fill="#111827" fill-opacity="0.92"/>
    <text x="430" y="126" text-anchor="middle" font-size="66" font-weight="900" fill="#f4f0e8">${escapeXml(card.name)}</text>
    <text x="430" y="178" text-anchor="middle" font-size="26" font-weight="900" fill="${accent}">${escapeXml(card.handType)}</text>
    ${artStage("手牌原画预留", "hand", { x: 58, y: 246, width: 634, height: 390, accent })}
    <g transform="translate(78 654)">${tagsSvg(card.tags, 0, 0, { fill: "rgba(0,0,0,0.46)", stroke: "rgba(255,255,255,0.34)", max: 5 })}</g>
    <g filter="url(#shadow)">
      <path d="M58 720 H692 V966 H58 Z" fill="rgba(250,247,238,0.90)" stroke="${accent}" stroke-opacity="0.46" stroke-width="3"/>
      <rect x="84" y="744" width="172" height="42" rx="7" fill="${accent}"/>
      <text x="170" y="774" text-anchor="middle" font-size="22" font-weight="900" fill="#ffffff">使用时机</text>
      ${fitTextBlock(card.timing, 280, 774, 370, 38, 22, 17, { fill: "#4a3b2b", weight: 800 })}
      ${fitTextBlock(card.effectText, 84, 836, 582, 92, 30, 22, { fill: "#25201b", weight: 700 })}
    </g>
    <text x="375" y="1000" text-anchor="middle" font-size="15" font-weight="700" fill="#7f7565">${escapeXml(card.physicalId)}</text>
  `;
  return cardShell(inner, { accent, secondary: "#1b2440", variant: "hand", paper: "#eee9dd" });
}

function renderBack(type) {
  const meta = {
    character: { label: "角色牌", accent: "#9d6cff", sub: "CHARACTER" },
    hand: { label: "手牌牌堆", accent: "#58c7e8", sub: "HAND DECK" },
  }[type] ?? { label: "群友杀 TCG", accent: "#ffd98a", sub: "QUNYOU TCG" };
  return cardShell(`
    <rect x="92" y="130" width="566" height="790" rx="40" fill="rgba(0,0,0,0.28)" stroke="${meta.accent}" stroke-opacity="0.36" stroke-width="4"/>
    <circle cx="375" cy="410" r="168" fill="${meta.accent}" fill-opacity="0.10" stroke="${meta.accent}" stroke-opacity="0.38" stroke-width="5"/>
    <text x="375" y="386" text-anchor="middle" font-size="52" font-weight="900" fill="#f4f0e8">群友杀</text>
    <text x="375" y="448" text-anchor="middle" font-size="40" font-weight="900" fill="${meta.accent}">TCG</text>
    <text x="375" y="592" text-anchor="middle" font-size="42" font-weight="900" fill="#ffd98a">${escapeXml(meta.label)}</text>
    <text x="375" y="644" text-anchor="middle" font-size="24" font-weight="800" fill="#827a99">${meta.sub}</text>
    <text x="375" y="844" text-anchor="middle" font-size="22" font-weight="700" fill="#5d566f">LOCAL TTS EXPORT</text>
  `, { accent: meta.accent, secondary: "#ff5a35", variant: "back" });
}

async function writeSvgAsPng(svg, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
}

module.exports = {
  renderBodyFront,
  renderBodyMega,
  renderCharacter,
  renderHand,
  renderBack,
  writeSvgAsPng,
};
