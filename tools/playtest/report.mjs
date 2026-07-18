export const MATCH_HEADERS = [
  "date",
  "version",
  "player1Deck",
  "player2Deck",
  "firstPlayer",
  "winner",
  "turns",
  "player1EndHealth",
  "player2EndHealth",
  "problemCards",
  "notes",
];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field) throw new Error("双引号必须出现在字段开头。");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("存在未闭合的双引号字段。");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function integer(value, label, line, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`第 ${line} 行 ${label} 必须是 ${minimum}–${maximum} 的整数。`);
  }
  return parsed;
}

export function parseMatchRecords(text, deckIds) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("实战记录缺少表头。");
  const headers = rows[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
  if (headers.length !== MATCH_HEADERS.length || headers.some((header, index) => header !== MATCH_HEADERS[index])) {
    throw new Error(`实战记录表头必须为：${MATCH_HEADERS.join(",")}`);
  }

  return rows.slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row, index) => {
      const line = index + 2;
      if (row.length !== MATCH_HEADERS.length) {
        throw new Error(`第 ${line} 行应有 ${MATCH_HEADERS.length} 个字段，实际为 ${row.length} 个。`);
      }
      const record = Object.fromEntries(MATCH_HEADERS.map((header, column) => [header, row[column].trim()]));
      const parsedDate = new Date(`${record.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date)
        || Number.isNaN(parsedDate.getTime())
        || parsedDate.toISOString().slice(0, 10) !== record.date) {
        throw new Error(`第 ${line} 行 date 必须是有效的 YYYY-MM-DD。`);
      }
      if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(record.version)) {
        throw new Error(`第 ${line} 行 version 必须是完整语义版本。`);
      }
      for (const field of ["player1Deck", "player2Deck"]) {
        if (!deckIds.has(record[field])) throw new Error(`第 ${line} 行 ${field} 不是已知预组 ID。`);
      }
      if (!["p1", "p2"].includes(record.firstPlayer)) throw new Error(`第 ${line} 行 firstPlayer 必须是 p1 或 p2。`);
      if (!["p1", "p2", "draw"].includes(record.winner)) throw new Error(`第 ${line} 行 winner 必须是 p1、p2 或 draw。`);

      return {
        ...record,
        turns: integer(record.turns, "turns", line, 1, 999),
        player1EndHealth: integer(record.player1EndHealth, "player1EndHealth", line, 0, 7),
        player2EndHealth: integer(record.player2EndHealth, "player2EndHealth", line, 0, 7),
        problemCards: [...new Set(record.problemCards.split(";").map((value) => value.trim()).filter(Boolean))],
      };
    });
}

function percentage(wins, decisiveGames) {
  return decisiveGames ? `${(wins / decisiveGames * 100).toFixed(1)}%` : "—";
}

export function buildPlaytestReport(records, deckNames = new Map()) {
  const deckStats = new Map();
  const matchups = new Map();
  const problems = new Map();
  let firstPlayerWins = 0;
  let draws = 0;
  let totalTurns = 0;

  const ensureDeck = (id) => {
    if (!deckStats.has(id)) deckStats.set(id, { games: 0, wins: 0, losses: 0, draws: 0 });
    return deckStats.get(id);
  };

  for (const record of records) {
    totalTurns += record.turns;
    const p1 = ensureDeck(record.player1Deck);
    const p2 = ensureDeck(record.player2Deck);
    p1.games += 1;
    p2.games += 1;
    if (record.winner === "draw") {
      draws += 1;
      p1.draws += 1;
      p2.draws += 1;
    } else {
      const p1Won = record.winner === "p1";
      (p1Won ? p1 : p2).wins += 1;
      (p1Won ? p2 : p1).losses += 1;
      if (record.winner === record.firstPlayer) firstPlayerWins += 1;
    }

    const pair = [record.player1Deck, record.player2Deck].sort();
    const matchupKey = pair.join("::");
    const matchup = matchups.get(matchupKey) ?? { decks: pair, games: 0, draws: 0, wins: new Map() };
    matchup.games += 1;
    if (record.winner === "draw") matchup.draws += 1;
    else {
      const winnerDeck = record.winner === "p1" ? record.player1Deck : record.player2Deck;
      matchup.wins.set(winnerDeck, (matchup.wins.get(winnerDeck) ?? 0) + 1);
    }
    matchups.set(matchupKey, matchup);

    for (const card of record.problemCards) problems.set(card, (problems.get(card) ?? 0) + 1);
  }

  return {
    games: records.length,
    draws,
    averageTurns: records.length ? totalTurns / records.length : 0,
    firstPlayerWins,
    firstPlayerDecisiveGames: records.length - draws,
    deckStats,
    matchups,
    problems,
    deckNames,
  };
}

function deckLabel(report, id) {
  return report.deckNames.get(id) ? `${report.deckNames.get(id)} (${id})` : id;
}

export function formatPlaytestReport(report) {
  const lines = [
    "# 实战数据报告",
    "",
    `- 有效对局：${report.games}`,
    `- 先手胜率（不含平局）：${percentage(report.firstPlayerWins, report.firstPlayerDecisiveGames)}`,
    `- 平均回合数：${report.games ? report.averageTurns.toFixed(1) : "—"}`,
    `- 平局：${report.draws}`,
    "",
    "## 预组胜率",
    "",
  ];

  if (!report.deckStats.size) {
    lines.push("尚无对局记录。");
  } else {
    lines.push("| 预组 | 对局 | 胜 | 负 | 平 | 胜率（不含平局） |", "|---|---:|---:|---:|---:|---:|");
    for (const [deckId, stats] of [...report.deckStats].sort((left, right) => right[1].games - left[1].games || left[0].localeCompare(right[0]))) {
      lines.push(`| ${deckLabel(report, deckId)} | ${stats.games} | ${stats.wins} | ${stats.losses} | ${stats.draws} | ${percentage(stats.wins, stats.wins + stats.losses)} |`);
    }
  }

  lines.push("", "## 对局组合", "");
  if (!report.matchups.size) lines.push("尚无对局组合。");
  else {
    lines.push("| 组合 | 对局 | 胜负 | 平局 |", "|---|---:|---|---:|");
    for (const matchup of [...report.matchups.values()].sort((left, right) => right.games - left.games)) {
      const [left, right] = matchup.decks;
      const result = left === right
        ? `${deckLabel(report, left)} 胜 ${matchup.wins.get(left) ?? 0}`
        : `${deckLabel(report, left)} ${matchup.wins.get(left) ?? 0} : ${matchup.wins.get(right) ?? 0} ${deckLabel(report, right)}`;
      lines.push(`| ${deckLabel(report, left)} vs ${deckLabel(report, right)} | ${matchup.games} | ${result} | ${matchup.draws} |`);
    }
  }

  lines.push("", "## 高频问题卡", "");
  if (!report.problems.size) lines.push("尚未记录问题卡。");
  else {
    lines.push("| 卡牌 | 涉及对局 |", "|---|---:|");
    for (const [card, count] of [...report.problems].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
      lines.push(`| ${card.replaceAll("|", "\\|")} | ${count} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
