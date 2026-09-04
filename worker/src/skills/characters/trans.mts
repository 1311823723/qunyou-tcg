import { HAND_IDS, handIsLocked } from "../../auto-engine.mts";
import {
  choiceValue,
  selectedCardIds,
  type CharacterSkillModule,
} from "../character-skill.mts";

export const TRANS_CHARACTER_IDS = {
  frostDefect: "char_017_huihuan_defect-robot",
  darkDefect: "char_018_baizi_defect-robot",
  plasmaDefect: "char_019_dong_defect-robot",
  medium: "char_027_weixiaokele_medium",
  silentHunter: "char_032_weixiaokele_silent-hunter",
} as const;

function chargeOptions(count: number, dischargeLabel: string) {
  return [
    ...(count < 3 ? [{ value: "charge", label: "放置1枚充能球" }] : []),
    ...(count > 0 ? [{ value: "discharge", label: dischargeLabel }] : []),
  ];
}

const frostDefect: CharacterSkillModule = {
  cardId: TRANS_CHARACTER_IDS.frostDefect,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  activate(context) {
    const count = context.markerCount("充能球");
    context.setPrompt("frost-choice", {
      title: "充能球-冰霜", message: `当前充能球：${count}/3`,
      options: chargeOptions(count, "移去1枚，获得一次伤害-1"),
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "frost-choice") return false;
    const value = choiceValue(payload);
    if (value === "charge") {
      if (context.markerCount("充能球") >= 3) throw new Error("充能球已达上限。");
      context.addCounterMarker("充能球", 1);
    } else if (value === "discharge") {
      if (!context.removeCounterMarker("充能球", 1)) throw new Error("没有可移去的充能球。");
      context.addModifier({
        kind: "damage-shield", count: 1, sourceDefinitionId: TRANS_CHARACTER_IDS.frostDefect,
        expiresAtTurnNumber: context.state.turnNumber + 2,
      });
    } else throw new Error("冰霜充能球选择无效。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

const darkDefect: CharacterSkillModule = {
  cardId: TRANS_CHARACTER_IDS.darkDefect,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => context.markerCount("充能球") < 3 || !handIsLocked(context.state, context.player.id, HAND_IDS.strike),
  activate(context) {
    const count = context.markerCount("充能球");
    context.setPrompt("dark-choice", {
      title: "充能球-黑暗", message: `当前充能球：${count}/3`,
      options: [
        ...(count < 3 ? [{ value: "charge", label: "放置1枚充能球" }] : []),
        ...Array.from({ length: handIsLocked(context.state, context.player.id, HAND_IDS.strike) ? 0 : count }, (_, index) => ({ value: `discharge:${index + 1}`, label: `移去${index + 1}枚，视为使用伤害${index + 1}的【出刀】` })),
      ],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "dark-choice") return false;
    const value = choiceValue(payload);
    if (value === "charge") {
      if (context.markerCount("充能球") >= 3) throw new Error("充能球已达上限。");
      context.addCounterMarker("充能球", 1);
    } else {
      const match = value.match(/^discharge:(\d)$/);
      const amount = Number(match?.[1] || 0);
      if (!amount || context.markerCount("充能球") < amount) throw new Error("黑暗充能球选择无效。");
      context.removeCounterMarker("充能球", amount);
      context.clearPrompt(prompt.id);
      context.useVirtualBasic(HAND_IDS.strike, { damage: amount });
      return true;
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};

const plasmaDefect: CharacterSkillModule = {
  cardId: TRANS_CHARACTER_IDS.plasmaDefect,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  activate(context) {
    const count = context.markerCount("充能球");
    context.setPrompt("plasma-choice", {
      title: "充能球-等离子", message: `当前充能球：${count}/3`,
      options: chargeOptions(count, "移去1枚，下一个角色技能费用降低"),
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "plasma-choice") return false;
    const value = choiceValue(payload);
    if (value === "charge") {
      if (context.markerCount("充能球") >= 3) throw new Error("充能球已达上限。");
      context.addCounterMarker("充能球", 1);
    } else if (value === "discharge") {
      if (!context.removeCounterMarker("充能球", 1)) throw new Error("没有可移去的充能球。");
      context.addModifier({ kind: "trans-next-skill-cost-down", count: 1, sourceDefinitionId: TRANS_CHARACTER_IDS.plasmaDefect });
    } else throw new Error("等离子充能球选择无效。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

const medium: CharacterSkillModule = {
  cardId: TRANS_CHARACTER_IDS.medium,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.retired.length > 0 && context.player.characterSlots.some((slot) => slot === null),
  activate(context) {
    context.setPrompt("medium-revive", {
      title: "亡魂附身", message: "选择1张己方退场角色暗置上阵。", min: 1, max: 1,
      cardInstanceIds: context.player.retired.map((card) => card.instanceId), selectableCards: context.player.retired,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "medium-revive") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张退场角色。");
    const revived = context.reviveOwnRetired(ids[0]);
    context.addModifier({
      kind: "trans-revived-character", count: 1, characterInstanceId: revived.instanceId,
      sourceDefinitionId: TRANS_CHARACTER_IDS.medium,
    });
    context.clearPrompt(prompt.id);
    return true;
  },
};

const silentHunter: CharacterSkillModule = {
  cardId: TRANS_CHARACTER_IDS.silentHunter,
  trigger: { event: "strike_damage_after", relation: "source_self" },
  canActivate: (context) => Number(context.event?.amount || 0) > 0
    && context.state.handDiscard.some((card) => card.definitionId === HAND_IDS.strike),
  activate(context) {
    const cards = context.state.handDiscard.filter((card) => card.definitionId === HAND_IDS.strike);
    context.setPrompt("silent-hunter-strike", {
      title: "刀刃风暴", message: "选择弃牌堆中的1张【出刀】加入手牌。", min: 1, max: 1,
      cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "silent-hunter-strike") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张【出刀】。");
    context.gainFromHandDiscard(ids);
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const transCharacterSkills: CharacterSkillModule[] = [
  frostDefect,
  darkDefect,
  plasmaDefect,
  medium,
  silentHunter,
];
