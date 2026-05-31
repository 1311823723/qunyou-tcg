const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const MAT_WIDTH = 4096;
const MAT_HEIGHT = 2048;

function zone(x, y, width, height, label, sublabel, options = {}) {
  const stroke = options.stroke ?? "#d8b75c";
  const fill = options.fill ?? "rgba(8, 12, 24, 0.46)";
  const labelSize = options.labelSize ?? 46;
  const sublabelSize = options.sublabelSize ?? 24;
  const dash = options.dash ? `stroke-dasharray="${options.dash}"` : "";

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="${fill}" stroke="${stroke}" stroke-opacity="${options.strokeOpacity ?? 0.62}" stroke-width="${options.strokeWidth ?? 4}" ${dash}/>
    <text x="${x + width / 2}" y="${y + height / 2 - 8}" text-anchor="middle" font-size="${labelSize}" font-weight="900" fill="${options.labelColor ?? "#f5eddc"}" stroke="#090d18" stroke-width="6" paint-order="stroke">${label}</text>
    ${sublabel ? `<text x="${x + width / 2}" y="${y + height / 2 + 36}" text-anchor="middle" font-size="${sublabelSize}" font-weight="800" fill="${options.sublabelColor ?? stroke}">${sublabel}</text>` : ""}
  `;
}

function smallSlot(x, y, label, color) {
  return zone(x, y, 250, 220, label, "", {
    stroke: color,
    fill: "rgba(7, 10, 21, 0.50)",
    labelSize: 32,
    strokeWidth: 3,
    dash: "18 14",
  });
}

function playerSeat(prefix, y, accent, secondary) {
  const x = 190;
  return `
    <g>
      <rect x="${x}" y="${y}" width="3716" height="690" rx="52" fill="rgba(8, 12, 24, 0.34)" stroke="${accent}" stroke-opacity="0.58" stroke-width="5"/>
      <path d="M${x + 142} ${y + 96} C${x + 880} ${y - 22}, ${x + 2540} ${y - 16}, ${x + 3576} ${y + 94}" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="16"/>
      <path d="M${x + 144} ${y + 610} C${x + 1100} ${y + 734}, ${x + 2440} ${y + 736}, ${x + 3572} ${y + 598}" fill="none" stroke="${secondary}" stroke-opacity="0.20" stroke-width="16"/>
      <text x="${x + 1858}" y="${y + 72}" text-anchor="middle" font-size="50" font-weight="900" fill="${accent}" stroke="#080b16" stroke-width="7" paint-order="stroke">${prefix}</text>

      ${zone(x + 402, y + 116, 420, 250, "角色区 1", "出场角色", { stroke: accent, labelSize: 38 })}
      ${zone(x + 864, y + 116, 420, 250, "角色区 2", "出场角色", { stroke: accent, labelSize: 38 })}
      ${zone(x + 1326, y + 116, 420, 250, "角色区 3", "出场角色", { stroke: accent, labelSize: 38 })}
      ${zone(x + 1788, y + 116, 420, 250, "角色区 4", "出场角色", { stroke: accent, labelSize: 38 })}

      ${zone(x + 402, y + 428, 300, 210, "本体", "MEGA 背面", { stroke: "#d8b75c", labelSize: 38 })}
      ${zone(x + 744, y + 428, 300, 210, "体力牌", "HP / DAMAGE", { stroke: "#ff6a6a", labelSize: 36 })}
      ${zone(x + 1086, y + 428, 300, 210, "角色牌堆", "抽角色", { stroke: "#9d6cff", labelSize: 34 })}
      ${zone(x + 1428, y + 428, 300, 210, "退场区", "REMOVED", { stroke: "#a98c6d", labelSize: 36 })}
    </g>
  `;
}

function centerDecks(y, accent) {
  return `
    <g>
      ${zone(2470, y, 300, 220, "手牌堆", "抽牌", { stroke: "#58c7e8", labelSize: 36, fill: "rgba(5, 10, 18, 0.66)" })}
      ${zone(2814, y, 300, 220, "弃牌区", "DISCARD", { stroke: "#a98c6d", labelSize: 36, fill: "rgba(5, 10, 18, 0.66)" })}
      <path d="M2420 ${y + 110} H2324" stroke="${accent}" stroke-opacity="0.44" stroke-width="5" stroke-linecap="round"/>
      <text x="2290" y="${y + 122}" text-anchor="end" font-size="28" font-weight="800" fill="${accent}">中线牌堆</text>
    </g>
  `;
}

function renderTablemat() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${MAT_WIDTH}" height="${MAT_HEIGHT}" viewBox="0 0 ${MAT_WIDTH} ${MAT_HEIGHT}">
  <defs>
    <radialGradient id="centerGlow" cx="50%" cy="50%" r="64%">
      <stop offset="0%" stop-color="#37214a"/>
      <stop offset="42%" stop-color="#111b2d"/>
      <stop offset="100%" stop-color="#060812"/>
    </radialGradient>
    <linearGradient id="goldLine" x1="0%" x2="100%" y1="0%" y2="0%">
      <stop offset="0%" stop-color="#d8b75c" stop-opacity="0"/>
      <stop offset="18%" stop-color="#d8b75c" stop-opacity="0.72"/>
      <stop offset="50%" stop-color="#fff0a6" stop-opacity="0.92"/>
      <stop offset="82%" stop-color="#d8b75c" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#d8b75c" stop-opacity="0"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
    <pattern id="grain" width="160" height="160" patternUnits="userSpaceOnUse">
      <rect width="160" height="160" fill="transparent"/>
      <circle cx="18" cy="42" r="1.8" fill="#ffffff" opacity="0.10"/>
      <circle cx="92" cy="20" r="1.2" fill="#d8b75c" opacity="0.10"/>
      <circle cx="132" cy="114" r="1.4" fill="#9d6cff" opacity="0.10"/>
      <path d="M12 132 C50 112, 80 118, 142 92" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="2"/>
    </pattern>
  </defs>

  <rect width="4096" height="2048" fill="url(#centerGlow)"/>
  <rect width="4096" height="2048" fill="url(#grain)"/>
  <rect x="54" y="54" width="3988" height="1940" rx="70" fill="none" stroke="#d8b75c" stroke-opacity="0.42" stroke-width="8"/>
  <rect x="82" y="82" width="3932" height="1884" rx="54" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3"/>

  <g filter="url(#softShadow)">
    <g transform="rotate(180 2048 1024)">
      ${playerSeat("玩家 B", 1208, "#58c7e8", "#56d986")}
      ${centerDecks(1054, "#58c7e8")}
    </g>
    ${playerSeat("玩家 A", 1208, "#ff7ab8", "#9d6cff")}
    ${centerDecks(1054, "#ff7ab8")}
  </g>

  <g>
    <rect x="1848" y="900" width="400" height="248" rx="80" fill="rgba(5, 8, 18, 0.48)" stroke="#d8b75c" stroke-opacity="0.54" stroke-width="6"/>
    <circle cx="2048" cy="1024" r="104" fill="rgba(216,183,92,0.09)" stroke="#d8b75c" stroke-opacity="0.50" stroke-width="6"/>
    <text x="2048" y="996" text-anchor="middle" font-size="60" font-weight="900" fill="#fff0a6" stroke="#080b16" stroke-width="8" paint-order="stroke">群友杀</text>
    <text x="2048" y="1062" text-anchor="middle" font-size="38" font-weight="900" fill="#f5eddc" stroke="#080b16" stroke-width="6" paint-order="stroke">TCG</text>
  </g>

  <path d="M342 116 L3754 116" stroke="url(#goldLine)" stroke-width="5"/>
  <path d="M342 1932 L3754 1932" stroke="url(#goldLine)" stroke-width="5"/>
  <text x="2048" y="1960" text-anchor="middle" font-size="24" font-weight="800" fill="#827a99">LOCAL TABLETOP SIMULATOR MAT · 4096 x 2048</text>
</svg>
`;
}

async function writeTablemat(outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(renderTablemat())).png().toFile(outPath);
}

module.exports = {
  MAT_WIDTH,
  MAT_HEIGHT,
  renderTablemat,
  writeTablemat,
};
