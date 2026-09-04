import { HAND_IDS, handIsLocked } from "../../auto-engine.mts";
import type { CardInstance } from "../../types";
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
  type CharacterSkillRuntimeContext,
} from "../character-skill.mts";

export const BLOOD_CHARACTER_IDS = {
  ironclad: "char_020_baizi_ironclad",
  edgar: "char_022_weixiaokele_goblin",
  desertButcher: "char_052_fengyaojing_desert-butcher",
  beeMedic: "char_073_xiaoapan_bee-medic",
  vigilante: "char_087_qindi_vigilante",
  serialKiller: "char_088_horus-lupercal_serial-killer",
  canadian: "char_089_kabishou_canadian",
  medium: "char_090_miaosila_medium",
  vulture: "char_091_zongzi_vulture",
  detective: "char_092_player_detective",
  snitch: "char_093_tutu_snitch",
  astral: "char_094_daidaishou_astral",
  prophet: "char_095_pangpanghali_prophet",
  politician: "char_096_kabishou_politician",
} as const;

function isRed(card: CardInstance) {
  return card.joker === "big" || ["红桃", "方块"].includes(card.suit || "");
}

function judgmentIsBlack(context: CharacterSkillRuntimeContext) {
  return context.event?.metadata?.color === "黑色";
}

const ironclad = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.ironclad,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    context.loseHealth(1, "【恶魔形态】");
    context.boostNextStrikeDamage(1);
    context.addModifier({ kind: "blood-next-strike-dodge-draw", count: 1, sourceDefinitionId: BLOOD_CHARACTER_IDS.ironclad });
  },
});

const edgar = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.edgar,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    context.addModifier({
      kind: "blood-strike-heal-strong", count: 1, sourceDefinitionId: BLOOD_CHARACTER_IDS.edgar,
      expiresAtTurnNumber: context.state.turnNumber + 1,
    });
  },
});

const desertButcher = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.desertButcher,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    context.boostNextStrikeDamage(1);
    const hasWarwick = context.player.characterSlots.some((slot) => slot && "instanceId" in slot
      && slot.faceDown === false && slot.definitionId === "char_053_xiaoka_zaun-beast");
    context.addModifier({
      kind: "blood-next-strike-heal-conditional", count: hasWarwick ? 2 : 1,
      sourceDefinitionId: BLOOD_CHARACTER_IDS.desertButcher,
    });
  },
});

const beeMedic = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.beeMedic,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.health < context.player.maxHealth,
  effect: (context) => { context.heal(1); },
});

const vigilante: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.vigilante,
  trigger: { event: "damage_after", relation: "target_self" },
  canActivate: (context) => context.player.hand.some(isRed) && !handIsLocked(context.state, context.player.id, HAND_IDS.strike),
  activate(context) {
    const cards = context.player.hand.filter(isRed);
    context.setPrompt("vigilante-red", {
      title: "正义回击", message: "弃置1张红色手牌，视为对伤害来源使用1张【出刀】。",
      min: 1, max: 1, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "vigilante-red") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张红色手牌。");
    context.clearPrompt(prompt.id);
    context.useVirtualStrike(ids[0]);
    return true;
  },
};

const serialKiller = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.serialKiller,
  trigger: { event: "health_lost_after", relation: "target_self" },
  canActivate: (context) => (context.state.usageCounters[`health-reduction-events:${context.state.turnNumber}:${context.player.id}`] || 0) === 2,
  effect(context) {
    context.loseOpponentHealth(1, "【终局名单】");
    context.heal(1);
  },
});

const canadian: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.canadian,
  trigger: { event: "judgment_resolved", relation: "any" },
  canActivate: (context) => Boolean(context.currentJudgmentCard()),
  activate(context) {
    const card = context.currentJudgmentCard();
    if (!card) return;
    context.gainFromHandDiscard([card.instanceId]);
    context.setPrompt("canadian-discard", {
      title: "遗言取证", message: "判定牌已加入手牌，请弃置1张手牌。",
      min: 1, max: 1, cardInstanceIds: context.player.hand.map((item) => item.instanceId), selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "canadian-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请弃置1张手牌。");
    context.discardOwnHand(ids);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const medium: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.medium,
  trigger: { event: "damage_after", relation: "target_self" },
  activate(context) {
    const max = Math.min(2, context.player.hand.length);
    context.setPrompt("medium-cycle", {
      title: "灵魂换流", message: "选择至多2张手牌置于牌堆底，然后摸等量手牌。",
      min: 0, max, cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
      options: [{ value: "none", label: "不置入手牌" }],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "medium-cycle") return false;
    const ids = choiceValue(payload) === "none" ? [] : selectedCardIds(payload);
    if (ids.length > Number(prompt.max || 0) || ids.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("换流选牌无效。");
    const cards = ids.map((id) => {
      const index = context.player.hand.findIndex((card) => card.instanceId === id);
      if (index < 0) throw new Error("选中的手牌已不存在。");
      return context.player.hand.splice(index, 1)[0];
    });
    context.putHandDeckBottom(cards);
    context.draw(cards.length);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const vulture = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.vulture,
  trigger: { event: "hand_discarded", relation: "source_self" },
  canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceIds),
  effect(context) {
    const ids = String(context.event?.metadata?.cardInstanceIds || "").split(",").filter(Boolean);
    const existing = ids.filter((id) => context.state.handDiscard.some((card) => card.instanceId === id));
    const cards = context.gainFromHandDiscard(existing);
    for (const card of cards) {
      if (isRed(card)) context.heal(1);
      else context.gainRandomOpponentHand();
    }
  },
});

const detective: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.detective,
  trigger: { event: "judgment_resolved", relation: "source_self" },
  canActivate: (context) => judgmentIsBlack(context) && Boolean(context.opponent()?.hand.length),
  activate(context) {
    const opponent = context.opponent();
    context.setPrompt("detective-store", {
      title: "黑箱扣押", message: "选择1张手牌正面朝下置于你的本体旁，当前回合结束时收回。",
      min: 1, max: 1, cardInstanceIds: opponent?.hand.map((card) => card.instanceId), selectableCards: opponent?.hand,
    }, {}, opponent?.id);
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "detective-store") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌封存。");
    context.storeOpponentHandCard(ids[0], "黑箱扣押");
    context.clearPrompt(prompt.id);
    return true;
  },
};

const snitch = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.snitch,
  trigger: { event: "damage_after", relation: "target_self" },
  canActivate: (context) => Boolean(context.event?.sourcePlayerId && context.event.sourcePlayerId !== context.player.id),
  effect(context) {
    const target = context.opponent();
    if (!target) return;
    context.addModifier({
      kind: "blood-hand-limit-down", count: 2, targetPlayerId: target.id,
      sourceDefinitionId: BLOOD_CHARACTER_IDS.snitch, expiresAtTurnNumber: context.state.turnNumber,
    });
  },
});

const astral: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.astral,
  trigger: { event: "judgment_revealed", relation: "any" },
  canActivate: (context) => context.player.hand.length > 0 && Boolean(context.currentJudgmentCard()),
  activate(context) {
    context.setPrompt("astral-replace", {
      title: "星轨改判", message: "选择1张手牌替换当前判定牌。",
      min: 1, max: 1, cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "astral-replace") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张改判牌。");
    context.replaceCurrentJudgment(ids[0]);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const prophet = immediateCharacterSkill({
  cardId: BLOOD_CHARACTER_IDS.prophet,
  trigger: { event: "health_recovered", relation: "target_self" },
  effect: (context) => { context.startJudgment("blood-prophet"); },
});

const politician: CharacterSkillModule = {
  cardId: BLOOD_CHARACTER_IDS.politician,
  trigger: { event: "judgment_resolved", relation: "any" },
  canActivate: (context) => context.player.hand.length > 0 && Boolean(context.currentJudgmentCard()),
  activate(context) {
    const original = context.currentJudgmentCard();
    context.setPrompt("politician-discard", {
      title: "二次表决", message: "弃置1张手牌，然后进行第二次判定。",
      min: 1, max: 1, cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
    }, { originalCardId: original?.instanceId });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "politician-discard") {
      const ids = selectedCardIds(payload);
      if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请弃置1张手牌。");
      context.discardOwnHand(ids);
      const candidate = context.drawJudgmentCandidate();
      const originalId = String(context.continuation?.data?.originalCardId || "");
      if (!candidate) {
        context.clearPrompt(prompt.id);
        return true;
      }
      const original = context.state.handDiscard.find((card) => card.instanceId === originalId);
      context.setPrompt("politician-choose", {
        title: "二次表决", message: "选择两次判定中的1张作为最终结果。",
        selectableCards: [original, candidate].filter(Boolean) as CardInstance[],
        options: [
          ...(original ? [{ value: original.instanceId, label: "保留第一次判定" }] : []),
          { value: candidate.instanceId, label: "采用第二次判定" },
        ],
      });
      return true;
    }
    if (step !== "politician-choose") return false;
    context.chooseJudgmentCandidate(choiceValue(payload));
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const bloodCharacterSkills = [
  ironclad, edgar, desertButcher, beeMedic, vigilante, serialKiller, canadian,
  medium, vulture, detective, snitch, astral, prophet, politician,
] satisfies CharacterSkillModule[];
