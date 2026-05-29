import aggroDeck from "../../data/decks/aggro.deck.json";
import { getBodyById, getMegaById, getCharactersByIds } from "./cards";
import type { BodyCard, MegaCard, CharacterCard } from "./cards";

export interface DeckData {
  id: string;
  name: string;
  archetype: string;
  bodyId: string;
  megaId: string;
  characterIds: string[];
  notes?: string;
}

export interface ResolvedDeck {
  deck: DeckData;
  body: BodyCard | undefined;
  mega: MegaCard | undefined;
  characters: CharacterCard[];
}

export const allDecks: DeckData[] = [aggroDeck as DeckData];

export function resolveDeck(deck: DeckData): ResolvedDeck {
  return {
    deck,
    body: getBodyById(deck.bodyId),
    mega: getMegaById(deck.megaId),
    characters: getCharactersByIds(deck.characterIds),
  };
}

export function getDeckById(id: string): DeckData | undefined {
  return allDecks.find((d) => d.id === id);
}

/** Compute role distribution for a deck */
export function getRoleDistribution(characters: CharacterCard[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of characters) {
    dist[c.mainRole] = (dist[c.mainRole] || 0) + 1;
  }
  return dist;
}

/** Compute tag distribution for a deck */
export function getTagDistribution(characters: CharacterCard[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of characters) {
    for (const tag of c.tags) {
      dist[tag] = (dist[tag] || 0) + 1;
    }
  }
  return dist;
}
