import bodies from "../../data/cards/bodies.json";
import megas from "../../data/cards/megas.json";
import characters from "../../data/cards/characters.json";
import handCards from "../../data/cards/hand_cards.json";

export interface CardEntry {
  suit: string;
  rank: string;
}

export interface BodyCard {
  id: string;
  name: string;
  cardType: "本体";
  hp: number;
  archetype: string;
  affinityTags: string[];
  skillName: string;
  effectText: string;
  megaCondition: string;
  notes?: string;
}

export interface MegaCard {
  id: string;
  name: string;
  cardType: "Mega";
  bodyId: string;
  skillName: string;
  effectText: string;
  notes?: string;
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
export const allMegas: MegaCard[] = megas as MegaCard[];
export const allCharacters: CharacterCard[] = characters as CharacterCard[];
export const allHandCards: HandCard[] = handCards as HandCard[];

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

export function getMegaById(id: string): MegaCard | undefined {
  return allMegas.find((m) => m.id === id);
}

export function getCharacterById(id: string): CharacterCard | undefined {
  return allCharacters.find((c) => c.id === id);
}

export function getCharactersByIds(ids: string[]): CharacterCard[] {
  return ids.map((id) => allCharacters.find((c) => c.id === id)).filter(Boolean) as CharacterCard[];
}

export function getMegaByBodyId(bodyId: string): MegaCard | undefined {
  return allMegas.find((m) => m.bodyId === bodyId);
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

export const ROLE_COLORS: Record<string, string> = {
  "强攻": "role-attack",
  "防御": "role-defend",
  "资源": "role-resource",
  "控制": "role-control",
  "支援": "role-support",
  "伏击": "role-ambush",
};
