import { EXTRA_FORM_CONDITION_LABELS, EXTRA_FORM_LABELS, allBodies, allCharacters, allHandCards, allRiderCards, resolveBodyCard } from "./cards";
import { allDecks } from "./decks";
import { getArchetypeBlurb } from "./archetypes";
import { getBodyArt, getCharacterArt } from "./card-art";
import { costKind, formatCharacterCost } from "./ui";
import characterAutomation from "../../data/cards/character_automation.json";
import characterImplementation from "../../data/cards/character_implementation.json";

const ARCHETYPE_THEME_SLUG: Record<string, string> = {
  "爆杀流": "aggro",
  "密裁": "mizai",
  "行动流": "combo",
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
  kind: "body" | "character" | "hand" | "rider";
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
  extraTiming?: string;
  costText?: string;
  extraCostText?: string;
  costKind?: "rest" | "exit" | "compound" | "other";
  mainRole?: string;
  tags?: string[];
  skillName?: string;
  archetype?: string;
  hp?: number;
  automationLevel?: "assisted" | "full";
  automationTrigger?: string;
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
      costKind: costKind(card.cost),
      imagePath: `/cards/characters/${card.id}.webp`,
      highResImagePath: `/cards-hd/characters/${card.id}.webp`,
      portraitPath: art?.src,
      automationLevel: characterAutomation[card.id as keyof typeof characterAutomation]?.level as "assisted" | "full" | undefined,
      automationTrigger: characterAutomation[card.id as keyof typeof characterAutomation]?.trigger.event,
    };
  }

  for (const card of allHandCards) {
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "hand",
      subtitle: `${card.handType} · ${card.timing}`,
      text: card.effectText,
      tags: card.tags,
      timing: card.timing,
    };
  }

  for (const card of allRiderCards) {
    const riderCostText = (energy: number) => `消耗此卡，退场己方场上1张相同主定位角色${energy ? `，并消耗${energy}点极巨能量` : ""}`;
    cards[card.id] = {
      id: card.id,
      name: card.name,
      kind: "rider",
      subtitle: `${card.mainRole} · ${card.call}`,
      text: card.normal.effectText,
      timing: card.normal.timing,
      mainRole: card.mainRole,
      tags: [card.tag],
      skillName: card.call,
      extraName: `FINAL ${card.name}`,
      extraSubtitle: `${card.mainRole} · FINAL ${card.call}`,
      extraText: card.final.effectText,
      extraTiming: card.final.timing,
      costText: riderCostText(card.normal.cost.dynamaxEnergy),
      extraCostText: riderCostText(card.final.cost.dynamaxEnergy),
    };
  }

  return {
    cards,
    decks: allDecks.map((deck) => {
      // 计算角色定位分布
      const roleDistribution: Record<string, number> = {};
      const tagDistribution: Record<string, number> = {};

      for (const charId of deck.characterIds) {
        const charCard = cards[charId];
        if (charCard) {
          // 统计定位
          const role = charCard.mainRole || "";
          if (role) {
            roleDistribution[role] = (roleDistribution[role] || 0) + 1;
          }
          // 统计标签
          for (const tag of charCard.tags || []) {
            tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
          }
        }
      }
      const autoImplemented = deck.characterIds.filter((id) => characterImplementation[id as keyof typeof characterImplementation]?.automation === "implemented").length;
      const autoBlocked = deck.characterIds.some((id) => characterImplementation[id as keyof typeof characterImplementation]?.review === "needs_confirmation");

      return {
        id: deck.id,
        name: deck.name,
        archetype: deck.archetype,
        bodyId: deck.bodyId,
        theme: ARCHETYPE_THEME_SLUG[deck.archetype] ?? "neutral",
        blurb: getArchetypeBlurb(deck.archetype),
        characterIds: deck.characterIds,
        roleDistribution,
        tagDistribution,
        autoImplemented,
        autoTotal: deck.characterIds.length,
        autoReady: autoImplemented === deck.characterIds.length && !autoBlocked,
      };
    }),
  };
}
