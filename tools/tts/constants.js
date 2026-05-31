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
};
