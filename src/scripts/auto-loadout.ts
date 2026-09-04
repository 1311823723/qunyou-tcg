import type { Catalog, CustomDeckConfig } from "./battle-types";

export const AUTO_CUSTOM_DECK_KEY = "qunyou-auto-custom-deck-v1";
export const AUTO_LOADOUT_KEY = "qunyou-auto-loadout-v1";

export function autoBodyCards(catalog: Catalog) {
  const ids = new Set(catalog.decks.filter((deck) => deck.autoReady).map((deck) => deck.bodyId));
  return Object.values(catalog.cards).filter((card) => card.kind === "body" && ids.has(card.id));
}

export function validAutoCustomDeck(catalog: Catalog, value: unknown): value is CustomDeckConfig {
  if (!value || typeof value !== "object") return false;
  const deck = value as Partial<CustomDeckConfig>;
  return autoBodyCards(catalog).some((card) => card.id === deck.bodyId)
    && Array.isArray(deck.characterIds) && deck.characterIds.length === 16
    && new Set(deck.characterIds).size === 16
    && deck.characterIds.every((id) => catalog.cards[id]?.kind === "character" && catalog.cards[id]?.automationLevel === "full");
}

export function resolveAutoLoadout(catalog: Catalog, value: unknown): { deckId: string; customDeck?: CustomDeckConfig } {
  const saved = value && typeof value === "object" ? value as { deckId?: string; customDeck?: unknown } : {};
  if (saved.deckId === "custom" && validAutoCustomDeck(catalog, saved.customDeck)) return { deckId: "custom", customDeck: saved.customDeck };
  return { deckId: catalog.decks.find((deck) => deck.autoReady && deck.id === saved.deckId)?.id || catalog.decks.find((deck) => deck.autoReady)?.id || "" };
}
