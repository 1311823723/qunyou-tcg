export const DECLARATION_VALUES = {
  suit: ["黑桃", "红桃", "梅花", "方块"],
  rank: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "小王", "大王"],
  face: ["正面", "反面"],
  characterRole: ["强攻", "防御", "资源", "控制", "支援", "伏击"],
} as const;

export const DECLARATION_LABELS = {
  suit: "花色",
  rank: "点数",
  face: "正反面",
  characterRole: "角色类型",
  handCard: "手牌",
} as const;

export type DeclarationCategory = keyof typeof DECLARATION_LABELS;

type NamedCardLookup = {
  get(id: string): { name: string } | undefined;
};

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

export function resolveDeclaration(payload: Record<string, unknown>, handCards: NamedCardLookup) {
  const category = cleanText(payload.category, 30) as DeclarationCategory;
  const value = cleanText(payload.value, 80);

  if (category === "handCard") {
    const handCard = handCards.get(value);
    if (!handCard) throw new Error("声明的手牌不存在。");
    return { category, categoryLabel: DECLARATION_LABELS[category], value, displayValue: handCard.name };
  }

  const allowedValues = DECLARATION_VALUES[category as keyof typeof DECLARATION_VALUES];
  if (!allowedValues || !(allowedValues as readonly string[]).includes(value)) {
    throw new Error("声明选项无效。");
  }
  return { category, categoryLabel: DECLARATION_LABELS[category], value, displayValue: value };
}
