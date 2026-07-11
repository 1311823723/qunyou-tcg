function cards(value) {
  return Array.isArray(value) ? value : [];
}

function count(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function padPrivateCards(items, total, ownerId) {
  if (items.length >= total) return items;
  return [
    ...items,
    ...Array.from({ length: total - items.length }, () => ({ ownerId, faceDown: true })),
  ];
}

export function defaultHandLimit(player) {
  const health = Number.isFinite(player?.health) ? Math.max(0, Math.floor(player.health)) : 0;
  const revealedCharacters = cards(player?.characterSlots).filter((slot) =>
    slot && typeof slot === "object" && "instanceId" in slot && slot.faceDown === false
  ).length;
  return Math.min(health, 4) + Math.min(revealedCharacters, 2);
}

export function normalizeBattleSnapshot(snapshot) {
  return {
    ...snapshot,
    players: snapshot.players.map((player) => {
      const {
        characterHand: _legacyCharacterHand,
        characterHandCount: _legacyCharacterHandCount,
        ...currentPlayer
      } = player;
      const hand = cards(player.hand);
      const handCount = count(player.handCount, hand.length);
      const isOpponent = player.id !== snapshot.you;

      return {
        ...currentPlayer,
        hand: isOpponent ? padPrivateCards(hand, handCount, player.id) : hand,
        handCount,
        markers: Array.isArray(player.markers) ? player.markers : [],
      };
    }),
  };
}
