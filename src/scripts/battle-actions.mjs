const ACTION_LABELS = {
  "card:draw": "已摸 1 张手牌",
  "character:deploy": "已上阵 1 张角色",
  "card:flip": "已翻转角色",
  "body:flip": "已翻转本体",
  "character:declareSkill": "已声明技能",
  "declaration:create": "声明已记录",
  "health:set": "体力已调整",
  "megaProgress:set": "Mega 已调整",
  "deck:shuffle": "牌堆已洗混",
  "deck:recycleDiscard": "弃牌已洗回牌堆底",
  "resolving:discardAll": "结算区已全部弃置",
  "turn:end": "已结束回合",
  "marker:create": "标记已创建",
  "marker:adjust": "标记数量已调整",
  "marker:rename": "标记已改名",
  "marker:remove": "标记已移除",
  "marker:card-remove": "标记牌已移去",
  "slot-marker:create": "占位标记已创建",
  "slot-marker:remove": "占位标记已移除",
  "player:ready": "准备状态已更新",
  "player:selectDeck": "预组已选择",
  "room:restartRequest": "重新开始请求已发送",
  "room:restartRespond": "重新开始回应已发送",
  "room:restartCancel": "重新开始请求已取消",
};

function moveTargetLabel(payload) {
  const targetIndex = Number.isInteger(payload.targetIndex) ? Number(payload.targetIndex) : undefined;
  return {
    resolving: "结算区",
    handDiscard: "手牌弃牌区",
    handDeckTop: "共用牌堆顶",
    handDeckBottom: "共用牌堆底",
    opponentHand: "对手手牌",
    hand: "我的手牌",
    bodyMarker: "本体标记区",
    characterDeckBottom: "角色牌堆底",
    characterDeckShuffle: "角色牌堆",
    retired: "退场区",
    banished: "移出游戏区",
    characterSlot: `角色位 ${Number(targetIndex) + 1}`,
  }[typeof payload.targetZone === "string" ? payload.targetZone : ""] || "目标区域";
}

export function actionFeedback(type, payload, cardName = "") {
  if (type === "card:move") {
    const target = moveTargetLabel(payload);
    return {
      label: `移动至${target}`,
      successMessage: cardName ? `已将${cardName}置入${target}` : `已置入${target}`,
    };
  }
  const label = ACTION_LABELS[type] || "操作已同步";
  return { label, successMessage: label };
}

export function moveTargetKey(payload) {
  const targetZone = String(payload.targetZone || "");
  const targetIndex = Number.isInteger(payload.targetIndex) ? `:${String(payload.targetIndex)}` : "";
  const targetOwner = payload.targetOwnerId ? `@${String(payload.targetOwnerId)}` : "";
  return `${targetZone}${targetIndex}${targetOwner}`;
}

export function actionTargetKey(type, payload, context = {}) {
  const you = context.you || "";
  if (type === "card:move") return moveTargetKey(payload);
  if (type === "card:draw") return you ? `hand@${you}` : "hand";
  if (type === "character:deploy") return you ? `characterDeckBottom@${you}` : "characterDeckBottom";
  if (type === "card:flip" || type === "character:declareSkill") {
    return typeof payload.instanceId === "string" ? `card:${payload.instanceId}` : undefined;
  }
  if (type === "body:flip") return you ? `body@${you}` : undefined;
  if (type === "health:set" || type === "megaProgress:set") {
    const playerId = String(payload.playerId || you);
    return playerId ? `player@${playerId}` : undefined;
  }
  if (type === "deck:shuffle") return payload.deck === "hand" ? "handDeckTop" : you ? `characterDeckBottom@${you}` : "characterDeckBottom";
  if (type === "deck:recycleDiscard") return "handDeckTop";
  if (type === "resolving:discardAll") return "handDiscard";
  if (type === "turn:end" || type === "declaration:create") return "battle-center";
  if (type.startsWith("marker:")) {
    const playerId = String(payload.playerId || context.markerOwnerId || you);
    return playerId ? `bodyMarker@${playerId}` : undefined;
  }
  if (type.startsWith("slot-marker:") && Number.isInteger(payload.slotIndex)) {
    return `characterSlot:${String(payload.slotIndex)}@${String(payload.playerId || you)}`;
  }
  return undefined;
}

export function actionLockKey(type, payload) {
  if (typeof payload.instanceId === "string" && payload.instanceId) return `card:${payload.instanceId}`;
  if ((type === "health:set" || type === "megaProgress:set") && payload.playerId) {
    return `${type}:${String(payload.playerId)}`;
  }
  if (type.startsWith("marker:") && payload.markerId) return `marker:${String(payload.markerId)}`;
  if (type.startsWith("slot-marker:") && payload.markerId) return `slot-marker:${String(payload.markerId)}`;
  return type;
}
