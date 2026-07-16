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

export type JokerKind = "small" | "big";

export function jokerLabel(joker: JokerKind) {
  return joker === "big" ? "大王" : "小王";
}

export function handCardIdentityLabel(suit?: string, rank?: string, joker?: JokerKind) {
  if (joker) return jokerLabel(joker);
  return suit && rank ? `${suitSymbol(suit)}${rank}` : "";
}

export function handCardImagePath(definitionId: string, suit?: string, rank?: string, joker?: JokerKind) {
  return handCardImagePathForRoot("/cards", definitionId, suit, rank, joker);
}

export function handCardHighResImagePath(definitionId: string, suit?: string, rank?: string, joker?: JokerKind) {
  return handCardImagePathForRoot("/cards-hd", definitionId, suit, rank, joker);
}

function handCardImagePathForRoot(root: string, definitionId: string, suit?: string, rank?: string, joker?: JokerKind) {
  if (joker) return `${root}/hand_cards/${definitionId}_${joker}_joker.webp`;
  if (!suit || !rank) return undefined;
  const suitSlug = ({ "黑桃": "spade", "红桃": "heart", "梅花": "club", "方块": "diamond" } as Record<string, string>)[suit];
  if (!suitSlug) return undefined;
  return `${root}/hand_cards/${definitionId}_${suitSlug}_${rank.toLowerCase()}.webp`;
}
