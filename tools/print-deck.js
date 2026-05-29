const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");

function readJSON(filename) {
  return JSON.parse(
    fs.readFileSync(path.join(dataDir, filename), "utf-8")
  );
}

const bodies = readJSON("cards/bodies.json");
const megas = readJSON("cards/megas.json");
const characters = readJSON("cards/characters.json");
const deck = readJSON("decks/aggro.deck.json");

const body = bodies.find((b) => b.id === deck.bodyId);
const mega = megas.find((m) => m.id === deck.megaId);

console.log("=" .repeat(60));
console.log(`  预组: ${deck.name}`);
console.log(`  流派: ${deck.archetype}`);
console.log("=" .repeat(60));

console.log("\n--- 本体 ---");
if (body) {
  console.log(`  ${body.name}  HP:${body.hp}`);
  console.log(`  技能: ${body.skillName}`);
  console.log(`  效果: ${body.effectText}`);
  console.log(`  Mega条件: ${body.megaCondition}`);
}

console.log("\n--- Mega ---");
if (mega) {
  console.log(`  ${mega.name}`);
  console.log(`  技能: ${mega.skillName}`);
  console.log(`  效果: ${mega.effectText}`);
}

console.log("\n--- 角色牌 (16张) ---");
for (let i = 0; i < deck.characterIds.length; i++) {
  const cid = deck.characterIds[i];
  const char = characters.find((c) => c.id === cid);
  if (!char) {
    console.log(`  [${i + 1}] ${cid} -- NOT FOUND`);
    continue;
  }
  const costText =
    char.cost.type === "休整" ? `休整 ${char.cost.amount}` :
    char.cost.type === "退场" ? "退场自身" :
    char.cost.type === "复合" ? (char.cost.text || "复合") :
    char.cost.type;
  const tagsText = char.tags.join("、");
  console.log(`  [${String(i + 1).padStart(2)}] ${char.name}`);
  console.log(`       主定位: ${char.mainRole}  标签: ${tagsText}`);
  console.log(`       费用: ${costText}`);
  console.log(`       时机: ${char.timing}`);
  console.log(`       技能: ${char.skillName}`);
  console.log(`       效果: ${char.effectText}`);
}

console.log("\n" + "=" .repeat(60));
