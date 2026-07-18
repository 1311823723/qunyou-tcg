export const DECLARATION_CATEGORIES = [
  { value: "suit", label: "花色" },
  { value: "rank", label: "点数" },
  { value: "face", label: "正反面" },
  { value: "characterRole", label: "角色类型" },
  { value: "handCard", label: "手牌" },
];

export const DECLARATION_STATIC_OPTIONS = {
  suit: ["黑桃", "红桃", "梅花", "方块"],
  rank: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "小王", "大王"],
  face: ["正面", "反面"],
  characterRole: ["强攻", "防御", "资源", "控制", "支援", "伏击"],
};

export function declarationOptions(category, handCards) {
  if (category === "handCard") {
    return handCards.map((card) => ({ value: card.id, label: card.name }));
  }
  return DECLARATION_STATIC_OPTIONS[category].map((value) => ({ value, label: value }));
}
