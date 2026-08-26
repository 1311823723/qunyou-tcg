import characters from "../../../../data/cards/characters.json" with { type: "json" };
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
} from "../character-skill.mts";

export const AMBUSH_CHARACTER_IDS = {
  avenger: "char_034_xiaoapan_avenger",
  silentHunter: "char_035_xiaoapan_silent-hunter",
  nameless: "char_074_huihuan_nameless",
  loverXiangcai: "char_071_xiangcai_lover",
  birdEater: "char_097_horus-lupercal_bird-eater",
  silencer: "char_098_qindi_silencer",
  loverGuamao: "char_072_guamao_lover",
  identityThief: "char_101_pangpanghali_identity-thief",
  falcon: "char_104_player_falcon",
  professional: "char_105_tutu_professional",
  vulture: "char_106_qindi_vulture",
  engineer: "char_107_daidaishou_engineer",
  birdwatcher: "char_108_tutu_birdwatcher",
} as const;

const characterById = new Map(characters.map((card) => [card.id, card]));

const avenger = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.avenger,
  trigger: { event: "character_retired", relation: "target_self" },
  canActivate: (context) => context.event?.characterDefinitionId !== AMBUSH_CHARACTER_IDS.avenger,
  effect(context) {
    context.damageOpponent(context.event?.sourcePlayerId === context.opponent()?.id ? 2 : 1);
  },
});

const silentHunter = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.silentHunter,
  trigger: { event: "action_used", relation: "source_opponent" },
  canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && !item.cancelled),
  effect(context) {
    if (!context.banishCurrentHand()) throw new Error("当前行动牌已不在结算中。");
  },
});

const nameless = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.nameless,
  trigger: { event: "character_revealed", relation: "source_opponent" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot
    && slot.definitionId === context.event?.characterDefinitionId && slot.faceDown === false)),
  effect(context) {
    const index = context.opponent()?.characterSlots.findIndex((slot) => slot && "instanceId" in slot
      && slot.definitionId === context.event?.characterDefinitionId && slot.faceDown === false) ?? -1;
    context.restOpponentCharacter(index);
  },
});

const loverXiangcai = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.loverXiangcai,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    const applied = context.damageOpponent(2);
    const loverVisible = context.player.characterSlots.some((slot) => slot && "instanceId" in slot
      && slot.definitionId === AMBUSH_CHARACTER_IDS.loverGuamao && slot.faceDown === false);
    if (applied !== undefined && !loverVisible) context.drawOpponent(1);
  },
});

const birdEater = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.birdEater,
  trigger: { event: "health_recovered", relation: "target_opponent" },
  effect(context) {
    const target = context.opponent();
    const reduction = Math.min(1, Number(context.event?.amount || 0));
    if (target && reduction > 0) target.health = Math.max(0, target.health - reduction);
    context.heal(1);
  },
});

const silencer = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.silencer,
  trigger: { event: "second_skill_used", relation: "source_opponent" },
  canActivate: () => false,
  effect() {},
});

const loverGuamao: CharacterSkillModule = {
  cardId: AMBUSH_CHARACTER_IDS.loverGuamao,
  trigger: { event: "character_retired", relation: "target_self" },
  canActivate: (context) => context.event?.characterDefinitionId !== AMBUSH_CHARACTER_IDS.loverGuamao,
  activate(context) {
    const enhanced = context.event?.characterDefinitionId === AMBUSH_CHARACTER_IDS.loverXiangcai
      && context.player.retired.some((card) => card.instanceId === context.role.instanceId);
    if (enhanced) {
      const roles = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot ? [{ slot, index }] : []) || [];
      context.setPrompt("lover-rest-two", {
        title: "殉情清算", message: "选择对手至多2张角色休整。", min: 0, max: Math.min(2, roles.length),
        cardInstanceIds: roles.map(({ slot }) => slot.instanceId), selectableCards: roles.map(({ slot }) => slot),
        options: [{ value: "none", label: "不休整角色" }],
      });
      return;
    }
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown === false
      ? [{ value: String(index), label: characterById.get(slot.definitionId)?.name || `角色位 ${index + 1}` }] : []) || [];
    if (!options.length) return;
    context.setPrompt("lover-lock", { title: "殉情清算", message: "选择1张已明置角色，本回合不能发动技能。", options });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "lover-lock") {
      context.lockOpponentCharacterSkill(Number(choiceValue(payload)));
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step !== "lover-rest-two") return false;
    const ids = choiceValue(payload) === "none" ? [] : selectedCardIds(payload);
    if (ids.length > 2 || ids.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("至多选择2张对手角色。");
    for (const id of ids) {
      const index = context.opponent()?.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === id) ?? -1;
      context.restOpponentCharacter(index);
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};

const identityThief = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.identityThief,
  trigger: { event: "skill_resolved", relation: "source_opponent" },
  canActivate: (context) => context.event?.metadata?.revealedFromFaceDown === true,
  effect(context) {
    const target = context.opponent();
    const instanceId = String(context.event?.metadata?.characterInstanceId || "");
    const role = target?.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === instanceId);
    if (!target || !role || !("instanceId" in role)) return;
    role.faceDown = true;
    context.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: context.player.id, kind: "aggro-reveal-lock", count: 1,
      targetPlayerId: target.id, targetCharacterInstanceId: role.instanceId,
      expiresAtTurnNumber: context.state.turnNumber + 1, sourceDefinitionId: AMBUSH_CHARACTER_IDS.identityThief,
    });
  },
});

const falcon = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.falcon,
  trigger: { event: "strike_dodged", relation: "target_self" },
  canActivate: () => false,
  effect() {},
});

const professional = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.professional,
  trigger: { event: "high_cost_skill_used", relation: "source_opponent" },
  canActivate: () => false,
  effect() {},
});

const vulture = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.vulture,
  trigger: { event: "hand_discarded", relation: "target_opponent" },
  canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceIds),
  effect(context) {
    const ids = String(context.event?.metadata?.cardInstanceIds || "").split(",").filter(Boolean);
    context.gainFromHandDiscard(ids.filter((id) => context.state.handDiscard.some((card) => card.instanceId === id)));
  },
});

const engineer = immediateCharacterSkill({
  cardId: AMBUSH_CHARACTER_IDS.engineer,
  trigger: { event: "skill_cost_rest_after", relation: "target_self" },
  canActivate(context) {
    return characterById.get(context.event?.characterDefinitionId || "")?.mainRole === "伏击"
      && context.event?.characterDefinitionId !== AMBUSH_CHARACTER_IDS.engineer;
  },
  effect(context) {
    const definitionId = context.event?.characterDefinitionId;
    const index = context.player.characterDeck.findIndex((card) => card.definitionId === definitionId);
    if (index < 0) return;
    const [card] = context.player.characterDeck.splice(index, 1);
    context.player.characterDeck.push(card);
  },
});

const birdwatcher: CharacterSkillModule = {
  cardId: AMBUSH_CHARACTER_IDS.birdwatcher,
  trigger: { event: "deployment", relation: "source_self" },
  activate(context) {
    const cards = context.takeTopHandCards(0);
    void cards;
    const roles = context.player.characterDeck.splice(Math.max(0, context.player.characterDeck.length - 2), 2).reverse();
    const options = [{ value: "keep", label: "保持原顺序" }];
    if (roles.length === 2) {
      options.push({ value: "swap", label: "交换顶部顺序" });
      options.push({ value: "bottom:0", label: `将【${characterById.get(roles[0].definitionId)?.name || roles[0].definitionId}】置底` });
      options.push({ value: "bottom:1", label: `将【${characterById.get(roles[1].definitionId)?.name || roles[1].definitionId}】置底` });
    }
    context.setPrompt("birdwatcher-order", {
      title: "高处侦察", message: "观看角色牌堆顶2张，可将至多1张置底。",
      selectableCards: roles, options,
    }, { roleIds: roles.map((card) => card.instanceId) });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "birdwatcher-order") return false;
    const roles = prompt.selectableCards || [];
    const value = choiceValue(payload);
    let top = [...roles];
    if (value === "swap") top.reverse();
    else if (value.startsWith("bottom:")) {
      const index = Number(value.slice(7));
      const bottom = top.splice(index, 1)[0];
      if (!bottom) throw new Error("置底选择无效。");
      context.player.characterDeck.unshift(bottom);
    } else if (value !== "keep") throw new Error("牌堆顺序选择无效。");
    for (const card of [...top].reverse()) context.player.characterDeck.push(card);
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const ambushCharacterSkills = [
  avenger, silentHunter, nameless, loverXiangcai, birdEater, silencer, loverGuamao,
  identityThief, falcon, professional, vulture, engineer, birdwatcher,
] satisfies CharacterSkillModule[];
