import { allBodies, allCharacters, allHandCards, resolveBodyCard } from "./cards";
import { allDecks } from "./decks";
import { getArchetypeBlurb } from "./archetypes";
import { formatCharacterCost } from "./ui";

const ARCHETYPE_THEME_SLUG: Record<string, string> = {
  "爆杀流": "aggro",
  "密裁": "mizai",
  "锦囊流": "combo",
  "拟态流": "trans",
};

export interface BattleCatalogCard {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  /** TTS 卡牌渲染图（完整卡面） */
  imagePath?: string;
  /** 点击放大后按需加载的高清卡面 */
  highResImagePath?: string;
  /** 本体额外形态卡图 */
  extraImagePath?: string;
  /** 本体额外形态高清卡图 */
  extraHighResImagePath?: string;
  extraName?: string;
  /** Mega 技能描述 */
  extraSubtitle?: string;
  /** Mega 效果文本 */
  extraText?: string;
  megaMax?: number;
  megaCondition?: string;
  timing?: string;
  costText?: string;
}

export function getBattleCatalog() {
  const cards: Record<string, BattleCatalogCard> = {};

  for (const rawBody of allBodies) {
    const body = resolveBodyCard(rawBody);
    cards[body.id] = {
      id: body.id,
      name: body.name,
      kind: "body",
      subtitle: `${body.archetype} · ${body.skillName}`,
      text: body.effectText,
      imagePath: `/cards/bodies/${body.id}_front.webp`,
      highResImagePath: `/cards-hd/bodies/${body.id}_front.webp`,
      extraImagePath: `/cards/bodies/${body.id}_mega_back.webp`,
      extraHighResImagePath: `/cards-hd/bodies/${body.id}_mega_back.webp`,
      extraName: body.extraForm?.name,
      extraSubtitle: body.extraForm ? `${body.archetype} · ${body.extraForm.skillName}` : undefined,
      extraText: body.extraForm?.effectText,
      megaMax: body.extraFormProgressMax,
      megaCondition: body.extraForm?.condition,
    };
  }

  for (const card of allCharacters) {
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "character",
      subtitle: `${card.mainRole} · ${card.skillName}`,
      text: card.effectText,
      timing: card.timing,
      costText: formatCharacterCost(card.cost),
      imagePath: `/cards/characters/${card.id}.webp`,
      highResImagePath: `/cards-hd/characters/${card.id}.webp`,
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
      theme: ARCHETYPE_THEME_SLUG[deck.archetype] ?? "neutral",
      blurb: getArchetypeBlurb(deck.archetype),
    })),
  };
}
