import { EXTRA_FORM_CONDITION_LABELS, EXTRA_FORM_LABELS, allBodies, allCharacters, allHandCards, resolveBodyCard } from "./cards";
import { allDecks } from "./decks";
import { getArchetypeBlurb } from "./archetypes";
import { getBodyArt, getCharacterArt } from "./card-art";
import { formatCharacterCost } from "./ui";

const ARCHETYPE_THEME_SLUG: Record<string, string> = {
  "爆杀流": "aggro",
  "密裁": "mizai",
  "锦囊流": "combo",
  "拟态流": "trans",
  "调度流": "dispatch",
  "卖血流": "blood",
  "伏击流": "ambush",
  "防御流": "defense",
};

const EXTRA_FORM_FILE_SLUGS: Record<string, string> = {
  mega: "mega",
  "z-move": "z_move",
  terastal: "terastal",
  dynamax: "dynamax",
};

function getExtraFormFileSlug(type?: string) {
  return type ? (EXTRA_FORM_FILE_SLUGS[type] ?? "extra") : "extra";
}

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
  /** 战斗演出人物图或独立原画 */
  portraitPath?: string;
  /** 额外形态战斗演出人物图 */
  extraPortraitPath?: string;
  extraName?: string;
  /** 额外形态技能描述 */
  extraSubtitle?: string;
  /** 额外形态效果文本 */
  extraText?: string;
  extraFormType?: string;
  extraFormLabel?: string;
  extraConditionLabel?: string;
  megaMax?: number;
  megaCondition?: string;
  timing?: string;
  costText?: string;
  mainRole?: string;
  tags?: string[];
  skillName?: string;
  archetype?: string;
  hp?: number;
}

export function getBattleCatalog() {
  const cards: Record<string, BattleCatalogCard> = {};

  for (const rawBody of allBodies) {
    const body = resolveBodyCard(rawBody);
    const art = getBodyArt(body.id);
    const extraFormFileSlug = getExtraFormFileSlug(body.extraForm?.type);
    cards[body.id] = {
      id: body.id,
      name: body.name,
      kind: "body",
      subtitle: `${body.archetype} · ${body.skillName}`,
      text: body.effectText,
      skillName: body.skillName,
      archetype: body.archetype,
      hp: body.hp,
      imagePath: `/cards/bodies/${body.id}_front.webp`,
      highResImagePath: `/cards-hd/bodies/${body.id}_front.webp`,
      extraImagePath: `/cards/bodies/${body.id}_${extraFormFileSlug}_back.webp`,
      extraHighResImagePath: `/cards-hd/bodies/${body.id}_${extraFormFileSlug}_back.webp`,
      portraitPath: art?.front ? `/battle-portraits/${body.id}_front.webp` : undefined,
      extraPortraitPath: art?.extra ? `/battle-portraits/${body.id}_mega.webp` : undefined,
      extraName: body.extraForm?.name,
      extraSubtitle: body.extraForm ? `${body.archetype} · ${body.extraForm.skillName}` : undefined,
      extraText: body.extraForm?.effectText,
      extraFormType: body.extraForm?.type,
      extraFormLabel: body.extraForm ? EXTRA_FORM_LABELS[body.extraForm.type] : undefined,
      extraConditionLabel: body.extraForm ? EXTRA_FORM_CONDITION_LABELS[body.extraForm.type] : undefined,
      megaMax: body.extraFormProgressMax,
      megaCondition: body.extraForm?.condition,
    };
  }

  for (const card of allCharacters) {
    const art = getCharacterArt(card.id);
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "character",
      subtitle: `${card.mainRole} · ${card.skillName}`,
      text: card.effectText,
      mainRole: card.mainRole,
      tags: card.tags,
      skillName: card.skillName,
      timing: card.timing,
      costText: formatCharacterCost(card.cost),
      imagePath: `/cards/characters/${card.id}.webp`,
      highResImagePath: `/cards-hd/characters/${card.id}.webp`,
      portraitPath: art?.src,
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
