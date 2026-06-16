export const BATTLE_LOG_FILTERS = ["all", "mine", "opponent", "inspection"];

export function filterBattleLogs(logs, filter, viewerId) {
  if (filter === "inspection") return logs.filter((log) => log.kind === "inspection");
  if (filter === "mine") {
    return logs.filter((log) => log.kind !== "inspection" && log.actorId === viewerId);
  }
  if (filter === "opponent") {
    return logs.filter((log) => log.kind !== "inspection" && log.actorId && log.actorId !== viewerId);
  }
  return logs;
}

export function battleLogTargetKey(target, viewerId) {
  if (!target?.zone) return undefined;
  const ownerSuffix = target.ownerId ? `@${target.ownerId}` : "";
  if (target.zone === "characterSlot" && Number.isInteger(target.slotIndex)) {
    return `characterSlot:${target.slotIndex}${ownerSuffix}`;
  }
  const zoneKeys = {
    handDeck: "handDeckTop",
    handDeckTop: "handDeckTop",
    handDeckBottom: "handDeckTop",
    handDiscard: "handDiscard",
    resolving: "resolving",
    hand: `${target.ownerId && target.ownerId !== viewerId ? "opponentHand" : "hand"}${ownerSuffix || (viewerId ? `@${viewerId}` : "")}`,
    characterDeck: `characterDeckBottom${ownerSuffix}`,
    characterDeckBottom: `characterDeckBottom${ownerSuffix}`,
    characterDeckShuffle: `characterDeckBottom${ownerSuffix}`,
    retired: `retired${ownerSuffix}`,
    banished: `banished${ownerSuffix}`,
  };
  return zoneKeys[target.zone];
}

export function battleLogRegionId(target, viewerId) {
  if (!target?.zone) return undefined;
  if (["handDeck", "handDeckTop", "handDeckBottom", "handDiscard", "resolving", "turn", "restart", "room"].includes(target.zone)) {
    return "battle-center";
  }
  if (target.zone === "hand" && target.ownerId === viewerId) return "battle-hand-self";
  if (target.ownerId) return target.ownerId === viewerId ? "battle-player-self" : "battle-player-opponent";
  return "battle-center";
}

export function formatBattleLog(log) {
  const text = log?.text || "";
  if (log?.kind === "inspection" || /查看|随机展示/.test(text)) return { badge: "查看", tone: "inspection", text };
  if (log?.kind === "system" || /牌局开始|牌局已重新开始|规则更新|加入了房间/.test(text)) return { badge: "系统", tone: "system", text };
  const skill = text.match(/^(.+?) 声明发动角色【(.+?)】的技能【(.+?)】(?:｜(.+))?$/);
  if (skill) {
    return {
      badge: "技能",
      tone: "skill",
      text: `${skill[1]} 声明【${skill[3]}】`,
      detail: `角色：${skill[2]}${skill[4] ? `｜${skill[4]}` : ""}`,
    };
  }
  const discard = text.match(/^(.+?) 弃置了(.+)$/);
  if (discard) return { badge: "弃置", tone: "discard", text: `${discard[1]} 弃置 ${discard[2]}` };
  const rest = text.match(/^(.+?) 休整了(.+?)，置于角色牌堆底$/);
  if (rest) return { badge: "休整", tone: "move", text: `${rest[1]} 休整 ${rest[2]}` };
  const flip = text.match(/^(.+?) (明置|暗置)了(.+)$/);
  if (flip) return { badge: flip[2], tone: flip[2] === "明置" ? "reveal" : "move", text: `${flip[1]} ${flip[2]} ${flip[3]}` };
  const move = text.match(/^(.+?) 将(.+?)从(.+?)移动到(.+)$/);
  if (move) return { badge: "移动", tone: "move", text: `${move[1]} 将 ${move[2]} -> ${move[4]}`, detail: `来源：${move[3]}` };
  if (/摸了/.test(text)) return { badge: "摸牌", tone: "draw", text };
  if (/上阵/.test(text)) return { badge: "上阵", tone: "deploy", text };
  if (/翻至额外形态|翻至正面/.test(text)) return { badge: "本体", tone: "body", text };
  if (/结束了回合/.test(text)) return { badge: "回合", tone: "turn", text };
  if (/体力调整|Mega 能量调整/.test(text)) return { badge: "数值", tone: "counter", text };
  return { badge: "操作", tone: "action", text };
}
