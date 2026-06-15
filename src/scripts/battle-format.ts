export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

export function suitSymbol(suit: string) {
  return ({ "黑桃": "♠", "红桃": "♥", "梅花": "♣", "方块": "♦" } as Record<string, string>)[suit] || suit;
}

export function handCardImagePath(definitionId: string, suit?: string, rank?: string) {
  return handCardImagePathForRoot("/cards", definitionId, suit, rank);
}

export function handCardHighResImagePath(definitionId: string, suit?: string, rank?: string) {
  return handCardImagePathForRoot("/cards-hd", definitionId, suit, rank);
}

function handCardImagePathForRoot(root: string, definitionId: string, suit?: string, rank?: string) {
  if (!suit || !rank) return undefined;
  const suitSlug = ({ "黑桃": "spade", "红桃": "heart", "梅花": "club", "方块": "diamond" } as Record<string, string>)[suit];
  if (!suitSlug) return undefined;
  return `${root}/hand_cards/${definitionId}_${suitSlug}_${rank.toLowerCase()}.webp`;
}
