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

export function normalizeBattleSnapshot(snapshot) {
  return {
    ...snapshot,
    players: snapshot.players.map((player) => {
      const hand = cards(player.hand);
      const characterHand = cards(player.characterHand);
      const handCount = count(player.handCount, hand.length);
      const characterHandCount = count(player.characterHandCount, characterHand.length);
      const isOpponent = player.id !== snapshot.you;

      return {
        ...player,
        hand: isOpponent ? padPrivateCards(hand, handCount, player.id) : hand,
        handCount,
        characterHand: isOpponent
          ? padPrivateCards(characterHand, characterHandCount, player.id)
          : characterHand,
        characterHandCount,
      };
    }),
  };
}
