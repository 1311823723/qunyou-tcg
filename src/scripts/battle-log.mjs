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
  if (["handDeck", "handDeckTop", "handDeckBottom", "handDiscard", "resolving", "turn", "restart"].includes(target.zone)) {
    return "battle-center";
  }
  if (target.zone === "hand" && target.ownerId === viewerId) return "battle-hand-self";
  if (target.ownerId) return target.ownerId === viewerId ? "battle-player-self" : "battle-player-opponent";
  return "battle-center";
}
