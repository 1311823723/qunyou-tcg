import { allBodies, allCharacters, allHandCards, resolveBodyCard } from "./cards";
import { allDecks } from "./decks";
import { getBodyArt, getCharacterArt } from "./card-art";

export interface BattleCatalogCard {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  art?: string;
  extraArt?: string;
  extraName?: string;
  megaMax?: number;
}

export function getBattleCatalog() {
  const cards: Record<string, BattleCatalogCard> = {};

  for (const rawBody of allBodies) {
    const body = resolveBodyCard(rawBody);
    const art = getBodyArt(body.id);
    cards[body.id] = {
      id: body.id,
      name: body.name,
      kind: "body",
      subtitle: `${body.archetype} · ${body.skillName}`,
      text: body.effectText,
      art: art?.front?.src,
      extraArt: art?.extra?.src,
      extraName: body.extraForm?.name,
      megaMax: body.extraFormProgressMax,
    };
  }

  for (const card of allCharacters) {
    const art = getCharacterArt(card.id);
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "character",
      subtitle: `${card.mainRole} · ${card.skillName}`,
      text: `${card.timing}｜${card.effectText}`,
      art: art?.src,
    };
  }

  for (const card of allHandCards) {
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "hand",
      subtitle: `${card.handType} · ${card.timing}`,
      text: card.effectText,
    };
  }

  return {
    cards,
    decks: allDecks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      archetype: deck.archetype,
      bodyId: deck.bodyId,
    })),
  };
}
