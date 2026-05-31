const path = require("path");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const EXPORT_DIR = path.join(ROOT_DIR, "exports", "tts");

const CARD_WIDTH = 750;
const CARD_HEIGHT = 1050;
const SHEET_COLUMNS = 10;
const SHEET_ROWS = 7;
const SHEET_MAX_CARDS = SHEET_COLUMNS * SHEET_ROWS;

const SUIT_META = {
  "黑桃": { symbol: "♠", slug: "spade", color: "#f4f0e8" },
  "红桃": { symbol: "♥", slug: "heart", color: "#ff5a72" },
  "梅花": { symbol: "♣", slug: "club", color: "#f4f0e8" },
  "方块": { symbol: "♦", slug: "diamond", color: "#ff5a72" },
};

const ROLE_COLORS = {
  "强攻": "#ff5748",
  "防御": "#4db9ff",
  "资源": "#56d986",
  "控制": "#b377ff",
  "支援": "#ffd45f",
  "伏击": "#ff7ab8",
};

const ROLE_DARK_COLORS = {
  "强攻": "#8f241b",
  "防御": "#174263",
  "资源": "#1f5a37",
  "控制": "#42215f",
  "支援": "#6f5420",
  "伏击": "#7a1f48",
};

const ROLE_TRIM_COLORS = {
  "强攻": "#ffb15a",
  "防御": "#9edcff",
  "资源": "#9af2b4",
  "控制": "#d5adff",
  "支援": "#ffe08a",
  "伏击": "#ff9bc7",
};

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  EXPORT_DIR,
  CARD_WIDTH,
  CARD_HEIGHT,
  SHEET_COLUMNS,
  SHEET_ROWS,
  SHEET_MAX_CARDS,
  SUIT_META,
  ROLE_COLORS,
  ROLE_DARK_COLORS,
  ROLE_TRIM_COLORS,
};
