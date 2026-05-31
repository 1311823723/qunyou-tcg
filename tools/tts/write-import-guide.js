const fs = require("fs");
const path = require("path");

function writeImportGuide(outPath, manifest) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const bodySheet = manifest.sheets.find((sheet) => sheet.id.startsWith("bodies_megas_"));
  const characterSheets = manifest.sheets.filter((sheet) => sheet.id.startsWith("characters_"));
  const handSheets = manifest.sheets.filter((sheet) => sheet.id.startsWith("hand_cards_"));

  const lines = [
    "# 群友杀 TCG - Tabletop Simulator 导入说明",
    "",
    "本目录由 `npm run export:tts` 生成。所有卡牌内容来自 `data/cards/*.json`，没有写入前端 UI。",
    "",
    "## 导入参数",
    "",
    "- Width: 10",
    "- Height: 7",
    "- 单张卡尺寸: 750 x 1050 px",
    "- 每张 sheet 最多 70 张卡",
    "",
    "## 本体 / Mega 双面牌",
    "",
    "本体和 Mega 是同一张卡：本体为正面，Mega 为背面。导入时请选择 Custom Deck，并开启 Unique Back。",
    "",
    bodySheet ? `- Face: \`${bodySheet.file}\`` : "- Face: `sheets/bodies_megas_001.png`",
    bodySheet ? `- Back: \`${bodySheet.back}\`` : "- Back: `sheets/bodies_megas_001_backs.png`",
    bodySheet ? `- Number: ${bodySheet.count}` : "- Number: 本体数量",
    "- Unique Back: 开启",
    "",
    "## 角色牌",
    "",
    "角色牌使用统一牌背。",
    "",
    ...characterSheets.map((sheet) => `- Face: \`${sheet.file}\`; Back: \`${sheet.back}\`; Number: ${sheet.count}`),
    "",
    "## 手牌牌堆",
    "",
    "手牌已按花色点数展开为 52 张实体牌，使用统一手牌牌背。",
    "",
    ...handSheets.map((sheet) => `- Face: \`${sheet.file}\`; Back: \`${sheet.back}\`; Number: ${sheet.count}`),
    "",
    "## 在 TTS 中操作",
    "",
    "1. 打开 Tabletop Simulator，进入房间。",
    "2. 选择 Objects -> Components -> Cards -> Custom Deck。",
    "3. 选择 Face 和 Back 图片。",
    "4. 设置 Width = 10，Height = 7，Number = 对应 sheet 的 count。",
    "5. 本体 / Mega sheet 需要开启 Unique Back；角色和手牌不需要。",
    "6. 导入后可保存对象或保存房间。",
    "",
    "## 联机分享",
    "",
    "脚本只生成本地文件。如果要给其他玩家联机使用，需要你手动上传图片到 Steam Cloud，再用 Cloud URL 重新导入并保存对象、存档或 Workshop。",
    "",
  ];

  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
}

module.exports = {
  writeImportGuide,
};
