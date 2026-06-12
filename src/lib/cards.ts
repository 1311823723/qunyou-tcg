import bodies from "../../data/cards/bodies.json";
import characters from "../../data/cards/characters.json";
import handCards from "../../data/cards/hand_cards.json";
import { getExtraFormProgressMax } from "./body-progress";

export { getExtraFormProgressMax } from "./body-progress";

export interface CardEntry {
  suit: string;
  rank: string;
}

export interface ExtraFormData {
  type: "mega" | "z-move" | "terastal" | "dynamax";
  name: string;
  skillName: string;
  effectText: string;
  condition: string;
}

export const EXTRA_FORM_LABELS: Record<string, string> = {
  "mega": "Mega",
  "z-move": "Z招式",
  "terastal": "钛晶化",
  "dynamax": "极巨化",
};

export const EXTRA_FORM_CONDITION_LABELS: Record<string, string> = {
  "mega": "Mega 条件",
  "z-move": "Z招式发动条件",
  "terastal": "钛晶化条件",
  "dynamax": "极巨化条件",
};

export interface BodyCard {
  id: string;
  name: string;
  cardType: "本体";
  hp: number;
  archetype: string;
  affinityTags: string[];
  skillName: string;
  effectText: string;
  extraForm?: ExtraFormData;
  notes?: string;
}

export interface ResolvedBodyCard extends BodyCard {
  extraFormProgressMax?: number;
}

export interface CharacterCost {
  type: string;
  amount?: number;
  text?: string;
}

export interface CharacterCard {
  id: string;
  name: string;
  cardType: "角色";
  deck: string;
  mainRole: string;
  tags: string[];
  cost: CharacterCost;
  timing: string;
  skillName: string;
  effectText: string;
  notes?: string;
}

export interface HandCard {
  id: string;
  name: string;
  cardType: "手牌";
  handType: string;
  tags: string[];
  timing: string;
  effectText: string;
  cards: CardEntry[];
}

export const allBodies: BodyCard[] = bodies as BodyCard[];
export const allCharacters: CharacterCard[] = characters as CharacterCard[];
export const allHandCards: HandCard[] = handCards as HandCard[];

export function getBodyCount(): number {
  return allBodies.length;
}

export function getBodyWithExtraFormCount(): number {
  return allBodies.filter((b) => b.extraForm).length;
}

export const MAIN_ROLES = ["强攻", "防御", "资源", "控制", "支援", "伏击"] as const;
export const HAND_TYPES = ["基础", "锦囊"] as const;
export const ALL_SUITS = ["黑桃", "红桃", "梅花", "方块"] as const;

export const SUIT_SYMBOLS: Record<string, string> = {
  "黑桃": "♠",
  "红桃": "♥",
  "梅花": "♣",
  "方块": "♦",
};

export function isRedSuit(suit: string): boolean {
  return suit === "红桃" || suit === "方块";
}

export function getBodyById(id: string): BodyCard | undefined {
  return allBodies.find((b) => b.id === id);
}

export function resolveBodyCard(body: BodyCard): ResolvedBodyCard {
  return {
    ...body,
    extraFormProgressMax: getExtraFormProgressMax(body),
  };
}

export function getCharacterById(id: string): CharacterCard | undefined {
  return allCharacters.find((c) => c.id === id);
}

export function getCharactersByIds(ids: string[]): CharacterCard[] {
  return ids.map((id) => allCharacters.find((c) => c.id === id)).filter(Boolean) as CharacterCard[];
}

export function getHandCardTotal(): number {
  return allHandCards.reduce((s, h) => s + h.cards.length, 0);
}

export function getSuitDistribution(): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const h of allHandCards) {
    for (const c of h.cards) {
      dist[c.suit] = (dist[c.suit] || 0) + 1;
    }
  }
  return dist;
}

export const ALL_TAGS = Array.from(
  new Set(allCharacters.flatMap((c) => c.tags))
).sort();
