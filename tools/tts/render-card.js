const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const sharp = require("sharp");
const {
  CARD_WIDTH,
  CARD_HEIGHT,
  ROLE_COLORS,
  ROLE_DARK_COLORS,
  ROLE_TRIM_COLORS,
  SUIT_META,
} = require("./constants");

const HAND_TITLE_FONT_PATH = path.join(__dirname, "assets", "fonts", "SourceHanSerifCN-Heavy.otf");
const HAND_TITLE_FONT_FACE = fs.existsSync(HAND_TITLE_FONT_PATH)
  ? `<style>@font-face{font-family:'Qunyou Hand Title';src:url('${pathToFileURL(HAND_TITLE_FONT_PATH).href}') format('opentype');font-weight:900;}</style>`
  : "";

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

function extraFormLabel(type) {
  return {
    mega: "Mega",
    "z-move": "Z招式",
    terastal: "钛晶化",
    dynamax: "极巨化",
  }[type] ?? "额外形态";
}

function splitTitledName(name, fallbackName = "", fallbackTitle = "额外形态") {
  const clean = String(name ?? "").replace(/^Mega\s+/i, "");
  const idx = clean.indexOf("-");
  if (idx > 0) {
    return { title: clean.slice(0, idx), name: clean.slice(idx + 1) };
  }
  return { title: fallbackTitle, name: clean || fallbackName };
}

function hpBadgeSvg(hp, cx, cy, options = {}) {
  const accent = options.accent ?? "#ead28a";
  const numberColor = options.numberColor ?? "#ffd98a";
  const circleFill = options.circleFill ?? "url(#sealGlow)";
  const innerCircle = options.innerCircle !== false
    ? `<circle cx="${cx}" cy="${cy}" r="38" fill="rgba(0,0,0,0.38)" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>`
    : "";
  const labelWidth = options.labelWidth ?? 84;
  const labelHeight = options.labelHeight ?? 30;
  const labelX = cx - labelWidth / 2;
  const labelY = cy + 36;

  return `
    <g filter="url(#inkShadow)">
      <circle cx="${cx}" cy="${cy}" r="52" fill="${circleFill}" stroke="${accent}" stroke-width="5"/>
      ${innerCircle}
      <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="42" font-weight="900" fill="${numberColor}">${escapeXml(hp)}</text>
      <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}" rx="${labelHeight / 2}" fill="rgba(10,9,12,0.94)" stroke="${accent}" stroke-width="3"/>
      <text x="${cx}" y="${labelY + 21}" text-anchor="middle" font-size="17" font-weight="900" fill="#f8f3e8">体力</text>
    </g>
  `;
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
        <linearGradient id="artToPanelFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${paper}" stop-opacity="0"/>
          <stop offset="0.58" stop-color="${paper}" stop-opacity="0.26"/>
          <stop offset="1" stop-color="${paper}" stop-opacity="0.72"/>
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
    ${hpBadgeSvg(card.hp, 103, 102, { accent: "#ead28a", numberColor: "#ffd98a" })}
    ${verticalText(card.name, 658, 250, card.name.length > 4 ? 40 : 46, { fill: "#ffffff", stroke: "#17100a", strokeWidth: 5, gap: card.name.length > 4 ? 44 : 54 })}
    ${verticalText(card.archetype, 618, 128, 22, { fill: "#ffe59a", gap: 26 })}
    <g transform="translate(54 644)">${tagsSvg(tags, 0, 0, { fill: "rgba(0,0,0,0.38)", stroke: "rgba(255,255,255,0.34)", max: 5 })}</g>
    <g filter="url(#shadow)">
      <path d="M52 706 H698 L674 992 H76 Z" fill="url(#textParchment)" stroke="#ffffff" stroke-opacity="0.62" stroke-width="2"/>
      <path d="M68 728 H682" stroke="${accent}" stroke-opacity="0.42" stroke-width="4"/>
      <rect x="76" y="738" width="188" height="44" rx="7" fill="${accent}"/>
      <text x="170" y="769" text-anchor="middle" font-size="23" font-weight="900" fill="#ffffff">${escapeXml(card.skillName)}</text>
      ${fitTextBlock(card.effectText, 84, 818, 574, 100, 27, 17, { fill: "#25201b", weight: 700, lineRatio: 1.30 })}
      ${card.extraForm?.condition ? fitTextBlock(`${extraFormLabel(card.extraForm.type)}条件：${card.extraForm.condition}`, 84, 945, 584, 40, 18, 15, { fill: "#7b5318", weight: 900, lineRatio: 1.20 }) : ""}
    </g>
    <text x="375" y="1014" text-anchor="middle" font-size="15" font-weight="700" fill="#b8ad96">${escapeXml(card.id)}</text>
  `;
  return cardShell(inner, { accent, secondary: "#18395c", variant: "body", paper: "#ede5d4" });
}

function renderBodyMega(card) {
  const extra = card.extraForm;
  const tags = card.affinityTags ?? [];
  const formLabel = extraFormLabel(extra.type);
  const megaDisplayName = splitTitledName(extra.name, card.name, formLabel);
  const inner = `
    ${artStage(`${formLabel}原画预留`, "mega", { x: 28, y: 28, width: 694, height: 964, accent: "#d8b75c", imageDataUri: card.__ttsMegaArt })}
    <path d="M42 56 C120 20, 190 32, 246 78 L206 126 C154 88, 98 98, 48 132 Z" fill="rgba(216,183,92,0.24)" stroke="#d8b75c" stroke-width="4"/>
    <text x="136" y="91" text-anchor="middle" font-size="30" font-weight="900" fill="#fff0a6">${escapeXml(formLabel)}</text>
    ${hpBadgeSvg(card.hp, 103, 162, {
      accent: "#d8b75c",
      numberColor: "#fff0a6",
      circleFill: "#1c1308",
      innerCircle: false,
    })}
    ${verticalText(megaDisplayName.name, 670, 216, megaDisplayName.name.length > 4 ? 34 : 40, { fill: "#fff8cf", stroke: "#1b1005", strokeWidth: 5, gap: megaDisplayName.name.length > 4 ? 40 : 50 })}
    ${verticalText(megaDisplayName.title, 626, 188, megaDisplayName.title.length > 4 ? 23 : 27, { fill: "#d8b75c", stroke: "#1b1005", strokeWidth: 3, gap: megaDisplayName.title.length > 4 ? 28 : 34 })}
    ${verticalText(card.archetype, 586, 116, 20, { fill: "#d8b75c", gap: 24 })}
    <g transform="translate(54 642)">${tagsSvg(tags, 0, 0, { fill: "rgba(31,18,3,0.54)", stroke: "rgba(216,183,92,0.50)", color: "#fff3c4", max: 5 })}</g>
    <g filter="url(#shadow)">
      <path d="M46 704 H704 L676 992 H74 Z" fill="rgba(23,14,8,0.72)" stroke="#d8b75c" stroke-opacity="0.68" stroke-width="3"/>
      <rect x="78" y="732" width="430" height="46" rx="7" fill="#d8b75c"/>
      <text x="293" y="765" text-anchor="middle" font-size="24" font-weight="900" fill="#221506">${escapeXml(extra.skillName)}</text>
      ${fitTextBlock(extra.effectText, 84, 812, 578, 162, 26, 16, { fill: "#fff8e8", weight: 700, lineRatio: 1.26 })}
    </g>
    <text x="375" y="1014" text-anchor="middle" font-size="15" font-weight="800" fill="#bca15d">${escapeXml(card.id)} · ${escapeXml(extra.type)} back</text>
  `;
  return cardShell(inner, { accent: "#d8b75c", secondary: "#4d2d66", variant: "mega", paper: "#f4ecd5" });
}

function renderCharacter(card) {
  const roleColor = ROLE_COLORS[card.mainRole] ?? "#ffd98a";
  const roleDarkColor = ROLE_DARK_COLORS[card.mainRole] ?? "#4b2d1c";
  const roleTrimColor = ROLE_TRIM_COLORS[card.mainRole] ?? "#ffe08a";
  const { prefix, suffix } = splitCharacterName(card.name);
  const costText = formatCost(card.cost);
  const costFontSize = costText.length >= 9 ? 12 : costText.length >= 7 ? 15 : 19;
  const railSide = card.layoutVariant === "right-rail" ? "right" : "left";
  const railX = railSide === "right" ? 624 : 26;
  const artX = railSide === "right" ? 26 : 126;
  const roleInfoX = railSide === "right" ? 74 : 676;
  const cardIdX = artX + 299;
  const panelX = artX;
  const skillX = panelX + 24;
  const costX = panelX + 230;
  const timingX = panelX + 360;
  const inner = `
    <rect x="${railX}" y="26" width="100" height="998" fill="${roleDarkColor}" stroke="${roleTrimColor}" stroke-opacity="0.70" stroke-width="3"/>
    <g opacity="0.17">
      <path d="M${railX + 16} 80 C${railX + 70} 116, ${railX + 16} 158, ${railX + 76} 206" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
      <path d="M${railX + 16} 306 C${railX + 70} 342, ${railX + 16} 384, ${railX + 76} 432" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
      <path d="M${railX + 16} 532 C${railX + 70} 568, ${railX + 16} 610, ${railX + 76} 658" fill="none" stroke="${roleTrimColor}" stroke-width="3"/>
    </g>
    ${artStage("角色原画预留", "character", { x: artX, y: 26, width: 598, height: 960, accent: roleColor, imageDataUri: card.__ttsArt })}
    <rect x="${artX}" y="696" width="598" height="62" fill="url(#artToPanelFade)"/>
    <circle cx="${railX + 50}" cy="92" r="42" fill="url(#sealGlow)" stroke="${roleTrimColor}" stroke-width="4"/>
    <text x="${railX + 50}" y="104" text-anchor="middle" font-size="29" font-weight="900" fill="#fff0a6">${escapeXml(card.mainRole.slice(0, 1))}</text>
    ${prefix ? verticalText(prefix, railX + 50, 206, 25, { fill: roleTrimColor, stroke: "#160b09", strokeWidth: 4, gap: 36 }) : ""}
    ${verticalText(suffix, railX + 50, prefix ? 396 : 248, suffix.length > 4 ? 36 : 42, { fill: "#ffffff", stroke: roleDarkColor, strokeWidth: 5, gap: suffix.length > 4 ? 46 : 58 })}
    <rect x="${railX + 29}" y="868" width="42" height="48" rx="3" fill="rgba(255,255,255,0.08)" stroke="${roleTrimColor}" stroke-opacity="0.68"/>
    ${verticalText(card.source || "通用", railX + 50, 896, 17, { fill: roleTrimColor, gap: 20 })}
    ${verticalText(card.mainRole, roleInfoX, 104, 24, { fill: roleTrimColor, stroke: "#0b0b12", strokeWidth: 4, gap: 38 })}
    <g transform="translate(${artX + 24} 678)">${tagsSvg(card.tags, 0, 0, { fill: "rgba(0,0,0,0.45)", stroke: "rgba(255,255,255,0.32)", max: 4 })}</g>
    <g filter="url(#shadow)">
      <path d="M${panelX} 746 H${panelX + 598} V986 H${panelX} Z" fill="url(#textParchment)" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>
      <rect x="${skillX}" y="770" width="190" height="42" rx="7" fill="${roleColor}"/>
      <text x="${skillX + 95}" y="800" text-anchor="middle" font-size="22" font-weight="900" fill="#ffffff">${escapeXml(card.skillName)}</text>
      <rect x="${costX}" y="770" width="112" height="42" rx="7" fill="#312a24" fill-opacity="0.84"/>
      <text x="${costX + 56}" y="800" text-anchor="middle" font-size="${costFontSize}" font-weight="900" fill="#ffe59a">${escapeXml(costText)}</text>
      ${fitTextBlock(card.timing, timingX, 800, 196, 38, 20, 16, { fill: "#534333", weight: 800 })}
      ${fitTextBlock(card.effectText, skillX, 848, 530, 104, 25, 18, { fill: "#25201b", weight: 700 })}
    </g>
    <text x="${cardIdX}" y="1014" text-anchor="middle" font-size="15" font-weight="700" fill="#b8ad96">${escapeXml(card.id)}</text>
  `;
  return cardShell(inner, { accent: roleColor, secondary: "#172b38", variant: "character", paper: "#eee9dd" });
}

function handCornerFlourish(x, y, rotation, accent) {
  return `
    <g transform="translate(${x} ${y}) rotate(${rotation})" fill="none" stroke="${accent}" stroke-linecap="round">
      <path d="M0 56 V12 Q0 0 12 0 H56" stroke-width="3"/>
      <path d="M10 48 V19 Q10 10 19 10 H48" stroke-width="1.2" opacity="0.72"/>
      <path d="M17 39 C17 25 25 17 39 17 C31 22 28 28 28 39 C25 33 22 33 17 39 Z" stroke-width="1.4"/>
      <circle cx="10" cy="10" r="3" fill="${accent}" stroke="none"/>
    </g>
  `;
}

function handRosette(cx, cy, accent) {
  return `
    <g transform="translate(${cx} ${cy})" fill="none" stroke="${accent}">
      <path d="M-18 0 C-8-3 -5-8 0-18 C5-8 8-3 18 0 C8 3 5 8 0 18 C-5 8-8 3-18 0 Z" opacity="0.74"/>
      <circle r="3" fill="${accent}" stroke="none"/>
    </g>
  `;
}

function renderHand(card) {
  const suit = SUIT_META[card.suit] ?? { symbol: card.suit, color: "#f4f0e8" };
  const isAction = card.handType === "行动";
  const accent = isAction ? "#aa7cff" : "#7bcbd2";
  const trim = isAction ? "#d8c0ff" : "#a5e5e4";
  const dark = isAction ? "#24173b" : "#0b3039";
  const secondary = isAction ? "#160f24" : "#10252c";
  const suitInk = card.suit === "红桃" || card.suit === "方块" ? "#b82f4d" : "#10252d";
  const titleLength = Array.from(card.name ?? "").length;
  const titleSize = titleLength <= 2 ? 70 : titleLength === 3 ? 62 : titleLength === 4 ? 54 : 46;
  const titleSpacing = titleLength <= 2 ? 5 : titleLength === 3 ? 2 : 0;
  const tagLabel = (card.tags ?? []).slice(0, 2).join("·") || "通用";
  const tagSize = tagLabel.length > 5 ? 15 : tagLabel.length > 3 ? 17 : 20;
  const artImage = card.__ttsArt
    ? `<image href="${card.__ttsArt}" x="54" y="220" width="642" height="467" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="54" y="220" width="642" height="467" fill="#0a0d16"/><text x="375" y="450" text-anchor="middle" font-size="34" font-weight="900" fill="${accent}">手牌原画预留</text>`;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
      <defs>
        ${HAND_TITLE_FONT_FACE}
        <linearGradient id="handNight" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#071117"/><stop offset="0.5" stop-color="${secondary}"/><stop offset="1" stop-color="#05080c"/>
        </linearGradient>
        <linearGradient id="handSilver" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#f0f4ed"/><stop offset="0.32" stop-color="${trim}"/><stop offset="0.7" stop-color="${accent}"/><stop offset="1" stop-color="#dceeea"/>
        </linearGradient>
        <linearGradient id="handPaper" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#f4f0e5"/><stop offset="0.55" stop-color="#e8e1d3"/><stop offset="1" stop-color="#d7cdbb"/>
        </linearGradient>
        <linearGradient id="handHeader" x1="0" y1="0" x2="1" y2="0">
          <stop stop-color="#091d25"/><stop offset="0.5" stop-color="${dark}"/><stop offset="1" stop-color="#081a21"/>
        </linearGradient>
        <linearGradient id="handArtFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.62" stop-color="#071117" stop-opacity="0"/><stop offset="1" stop-color="#071117" stop-opacity="0.76"/>
        </linearGradient>
        <pattern id="handWeave" width="72" height="36" patternUnits="userSpaceOnUse">
          <path d="M-18 18 C0-6 18-6 36 18 S72 42 90 18 M-18 18 C0 42 18 42 36 18 S72-6 90 18" fill="none" stroke="${trim}" stroke-opacity="0.12"/>
          <circle cx="36" cy="18" r="3" fill="none" stroke="#e6f6f4" stroke-opacity="0.14"/>
        </pattern>
        <pattern id="handDamask" width="96" height="96" patternUnits="userSpaceOnUse">
          <path d="M48 5 C43 25 27 27 18 40 C31 37 41 42 48 53 C55 42 65 37 78 40 C69 27 53 25 48 5 Z M48 91 C43 71 27 69 18 56 C31 59 41 54 48 43 C55 54 65 59 78 56 C69 69 53 71 48 91 Z" fill="none" stroke="${trim}" stroke-opacity="0.08" stroke-width="1.4"/>
        </pattern>
        <clipPath id="handArtClip"><path d="M54 220 H696 V672 L681 687 H69 L54 672 Z"/></clipPath>
        <filter id="handShadow"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000" flood-opacity="0.5"/></filter>
      </defs>
      <rect width="750" height="1050" fill="#030609"/>
      <rect x="10" y="10" width="730" height="1030" rx="18" fill="url(#handNight)" stroke="#244b54" stroke-width="4"/>
      <rect x="21" y="21" width="708" height="1008" rx="12" fill="none" stroke="url(#handSilver)" stroke-width="2"/>
      <rect x="31" y="31" width="688" height="988" fill="url(#handDamask)" stroke="${accent}" stroke-opacity="0.42"/>
      ${handCornerFlourish(31, 31, 0, trim)}
      ${handCornerFlourish(719, 31, 90, trim)}
      ${handCornerFlourish(719, 1019, 180, trim)}
      ${handCornerFlourish(31, 1019, 270, trim)}
      <path d="M92 24 H658 M92 1026 H658" stroke="#d9eeeb" stroke-opacity="0.55"/>
      <circle cx="75" cy="24" r="3" fill="${trim}"/><circle cx="675" cy="24" r="3" fill="${trim}"/>

      <path d="M42 54 L66 38 H684 L708 54 V198 H42 Z" fill="url(#handHeader)" stroke="${accent}" stroke-width="2.5"/>
      <path d="M58 62 H692 V182 H58 Z" fill="url(#handWeave)" stroke="#d5eeeb" stroke-opacity="0.35"/>
      <path d="M188 54 V194 M572 54 V194" stroke="${trim}" stroke-opacity="0.34"/>
      <path d="M218 72 H542 M218 164 H542" stroke="#d6ece9" stroke-opacity="0.22"/>
      ${handRosette(380, 70, trim)}${handRosette(380, 166, trim)}

      <path d="M62 50 H166 L184 68 V172 L166 190 H62 L48 176 V64 Z" fill="#e5ebe6" stroke="url(#handSilver)" stroke-width="4" filter="url(#handShadow)"/>
      <path d="M73 62 H154 L170 78 V160 L154 176 H73 L62 165 V73 Z" fill="none" stroke="#315a64" stroke-width="1.5"/>
      <text x="116" y="119" text-anchor="middle" font-family="Georgia, serif" font-size="60" font-weight="700" fill="${suitInk}">${escapeXml(card.rank)}</text>
      <text x="116" y="165" text-anchor="middle" font-size="41" fill="${suitInk}">${escapeXml(suit.symbol)}</text>

      <text x="380" y="135" text-anchor="middle" font-family="'Qunyou Hand Title', 'Songti SC', serif" font-size="${titleSize}" font-weight="900" letter-spacing="${titleSpacing}" fill="#f3f0e7" stroke="#071117" stroke-width="1.2" paint-order="stroke">${escapeXml(card.name)}</text>

      <path d="M588 50 H688 L702 64 V176 L688 190 H588 L574 176 V64 Z" fill="${dark}" stroke="url(#handSilver)" stroke-width="3" filter="url(#handShadow)"/>
      <path d="M600 64 H676 L688 76 V164 L676 176 H600 L588 164 V76 Z" fill="url(#handWeave)" stroke="${trim}" stroke-opacity="0.42"/>
      <text x="638" y="105" text-anchor="middle" font-family="'Qunyou Hand Title', 'Songti SC', serif" font-size="24" font-weight="900" fill="#e7f3ee">${escapeXml(card.handType)}</text>
      <path d="M608 119 H668" stroke="${accent}"/><circle cx="638" cy="119" r="3" fill="#d6efeb"/>
      <text x="638" y="151" text-anchor="middle" font-size="${tagSize}" font-weight="800" fill="${trim}">${escapeXml(tagLabel)}</text>

      <g filter="url(#handShadow)">
        <path d="M48 214 H702 V675 L684 693 H66 L48 675 Z" fill="#05090d" stroke="${accent}" stroke-width="4"/>
        <g clip-path="url(#handArtClip)">${artImage}<rect x="54" y="220" width="642" height="467" fill="url(#handArtFade)"/></g>
        <path d="M64 232 V265 M64 232 H97 M686 232 V265 M686 232 H653" fill="none" stroke="#d9eeeb" stroke-width="2" opacity="0.65"/>
      </g>

      <g filter="url(#handShadow)">
        <path d="M54 720 L72 704 H678 L696 720 V982 L678 998 H72 L54 982 Z" fill="url(#handPaper)" stroke="${accent}" stroke-width="3"/>
        <path d="M68 730 L82 716 H668 L682 730 V970 L668 984 H82 L68 970 Z" fill="none" stroke="#48565a" stroke-opacity="0.28"/>
        <path d="M94 718 H260 L274 732 L260 774 H94 L78 758 Z" fill="${dark}" stroke="${accent}" stroke-width="2"/>
        <text x="176" y="755" text-anchor="middle" font-size="20" font-weight="900" fill="${trim}">使用时机</text>
        <path d="M286 728 H650" stroke="#7ca3a5" stroke-opacity="0.42"/>
        ${fitTextBlock(card.timing, 300, 758, 350, 34, 23, 16, { fill: "#3b352d", weight: 800, lineRatio: 1.2 })}
        ${fitTextBlock(card.effectText, 88, 824, 574, 126, 27, 18, { fill: "#27231f", weight: 700, lineRatio: 1.45 })}
        <path d="M88 956 H662" stroke="#786e5f" stroke-opacity="0.22"/>
        <text x="375" y="980" text-anchor="middle" font-size="13" font-weight="700" fill="#81786a">${escapeXml(card.physicalId)}</text>
      </g>
    </svg>
  `;
}

function renderBack(type) {
  const meta = {
    character: { label: "角色牌", accent: "#9d6cff", sub: "BAOLVTUAN TCG" },
    hand: { label: "手牌牌堆", accent: "#58c7e8", sub: "BAOLVTUAN TCG" },
  }[type] ?? { label: "宝旅团 TCG", accent: "#ffd98a", sub: "BAOLVTUAN TCG" };
  return cardShell(`
    <rect x="92" y="130" width="566" height="790" rx="40" fill="rgba(0,0,0,0.28)" stroke="${meta.accent}" stroke-opacity="0.36" stroke-width="4"/>
    <circle cx="375" cy="410" r="168" fill="${meta.accent}" fill-opacity="0.10" stroke="${meta.accent}" stroke-opacity="0.38" stroke-width="5"/>
    <text x="375" y="386" text-anchor="middle" font-size="52" font-weight="900" fill="#f4f0e8">宝旅团</text>
    <text x="375" y="448" text-anchor="middle" font-size="40" font-weight="900" fill="${meta.accent}">TCG</text>
    <text x="375" y="592" text-anchor="middle" font-size="42" font-weight="900" fill="#ffd98a">${escapeXml(meta.label)}</text>
    <text x="375" y="644" text-anchor="middle" font-size="24" font-weight="800" fill="#827a99">${meta.sub}</text>
    <text x="375" y="844" text-anchor="middle" font-size="22" font-weight="700" fill="#5d566f">LOCAL TTS EXPORT</text>
  `, { accent: meta.accent, secondary: "#ff5a35", variant: "back" });
}

async function writeSvgAsPng(svg, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const next = await sharp(Buffer.from(svg)).png().toBuffer();
  if (fs.existsSync(outPath) && fs.readFileSync(outPath).equals(next)) return false;
  fs.writeFileSync(outPath, next);
  return true;
}

module.exports = {
  renderBodyFront,
  renderBodyMega,
  renderCharacter,
  renderHand,
  renderBack,
  writeSvgAsPng,
};
