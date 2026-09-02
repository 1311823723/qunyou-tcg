import characters from "../../../../data/cards/characters.json" with { type: "json" };
import { HAND_IDS, effectiveDefinition, isHandResolutionItem } from "../../auto-engine.mts";
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
} from "../character-skill.mts";

export const DEFENSE_CHARACTER_IDS = {
  falcon: "char_023_arthur_falcon",
  highPriest: "char_025_baizi_high-priest",
  bodyguardAichitun: "char_085_aichitun_bodyguard",
  bodyguardQindi: "char_109_qindi_bodyguard",
  canadian: "char_110_pangpanghali_canadian",
  adventurer: "char_111_horus-lupercal_adventurer",
  locksmith: "char_112_miaosila_locksmith",
  bodyguardZongzi: "char_114_zongzi_bodyguard",
  mimic: "char_115_player_mimic",
  vigilanteTutu: "char_116_tutu_vigilante",
  medium: "char_117_daidaishou_medium",
  birdwatcher: "char_118_qindi_birdwatcher",
  politician: "char_119_pangpanghali_politician",
  astral: "char_120_player_astral",
} as const;

const characterById = new Map(characters.map((card) => [card.id, card]));

const falcon: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.falcon,
  trigger: { event: "strike_dodged", relation: "source_self" },
  activate(context) {
    const opponent = context.opponent();
    if (!opponent?.hand.length) {
      context.draw(1);
      return;
    }
    context.setPrompt("falcon-discard", {
      title: "俯冲反击", message: "选择1张手牌弃置。",
      min: 1, max: 1, cardInstanceIds: opponent.hand.map((card) => card.instanceId), selectableCards: opponent.hand,
    }, {}, opponent.id);
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "falcon-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请弃置1张手牌。");
    context.discardOpponentHand(ids);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const highPriest = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.highPriest,
  trigger: { event: "damage_before", relation: "target_self" },
  effect(context) {
    if (context.counterCurrentHand()) {
      context.emitEvent("damage_prevented", { sourcePlayerId: context.player.id, targetPlayerId: context.player.id, amount: 1 });
      context.draw(1);
    }
  },
});

const bodyguardAichitun = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.bodyguardAichitun,
  trigger: { event: "character_leave_before", relation: "target_self" },
  canActivate: (context) => context.event?.metadata?.characterInstanceId !== context.role.instanceId,
  effect(context) {
    const restored = context.restorePreventedCharacter();
    if (!restored) return;
    if (restored.faceDown === false) restored.faceDown = true;
    context.draw(1);
  },
});

const bodyguardQindi: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.bodyguardQindi,
  trigger: { event: "damage_before", relation: "target_self" },
  canActivate: (context) => context.player.characterSlots.some((slot) => slot && "instanceId" in slot && slot.instanceId !== context.role.instanceId),
  activate(context) {
    const options = context.player.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.instanceId !== context.role.instanceId
      ? [{ value: String(index), label: `休整角色位 ${index + 1}` }] : []);
    context.setPrompt("qindi-bodyguard-rest", { title: "双重人墙", message: "休整另一张己方角色，防止此次伤害。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "qindi-bodyguard-rest") return false;
    context.restOwnCharacter(Number(choiceValue(payload)));
    if (context.counterCurrentHand()) context.emitEvent("damage_prevented", { sourcePlayerId: context.player.id, targetPlayerId: context.player.id, amount: 1 });
    context.heal(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const canadian = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.canadian,
  trigger: { event: "strike_damage_after", relation: "target_self" },
  effect(context) {
    const opponent = context.opponent();
    if (!opponent) return;
    context.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: opponent.id, kind: "mizai-strike-block", count: 1,
      sourceDefinitionId: DEFENSE_CHARACTER_IDS.canadian, expiresAtTurnNumber: context.state.turnNumber + 1,
    });
  },
});

const adventurer = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.adventurer,
  trigger: { event: "damage_before", relation: "target_self" },
  canActivate: (context) => context.event?.cardDefinitionId !== HAND_IDS.strike,
  effect(context) {
    context.addModifier({ kind: "damage-shield", count: 1, sourceDefinitionId: DEFENSE_CHARACTER_IDS.adventurer });
  },
});

const locksmith: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.locksmith,
  trigger: { event: "hand_lost_before", relation: "target_self" },
  canActivate: (context) => context.player.hand.length > 0,
  activate(context) {
    context.setPrompt("locksmith-protect", {
      title: "私人物证", message: "选择并展示1张手牌，该牌不能因此失去。",
      min: 1, max: 1, cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "locksmith-protect") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌。");
    context.protectOwnHandCard(ids[0]);
    context.addLog(`${context.player.nickname}展示并保护了1张手牌`, context.player.id, { zone: "hand", ownerId: context.player.id });
    context.clearPrompt(prompt.id);
    return true;
  },
};

const bodyguardZongzi = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.bodyguardZongzi,
  trigger: { event: "skill_targeted_character", relation: "target_self" },
  effect(context) {
    context.counterCurrentHand();
  },
});

const mimic: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.mimic,
  trigger: { event: "strike_targeted", relation: "target_self" },
  activate(context) {
    const opponent = context.opponent();
    context.setPrompt("mimic-guess", {
      title: "真假难辨", message: "猜测对手的手牌中是否有【闪避】。",
      options: [{ value: "yes", label: "有【闪避】" }, { value: "no", label: "没有【闪避】" }],
    }, {}, opponent?.id);
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "mimic-guess") return false;
    const hasDodge = context.player.hand.some((card) => card.definitionId === HAND_IDS.dodge);
    const guessed = choiceValue(payload) === "yes";
    context.addLog(`${context.player.nickname}展示了所有手牌：${context.player.hand.map((card) => context.handLabel(card)).join("、") || "无"}`, context.player.id, { zone: "hand", ownerId: context.player.id });
    if (guessed !== hasDodge) {
      if (context.counterCurrentHand()) context.emitEvent("damage_prevented", { sourcePlayerId: context.player.id, targetPlayerId: context.player.id, amount: 1 });
    } else context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const vigilanteTutu: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.vigilanteTutu,
  trigger: { event: "damage_prevented", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown === false)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown === false
      ? [{ value: String(index), label: characterById.get(slot.definitionId)?.name || `角色位 ${index + 1}` }] : []) || [];
    context.setPrompt("vigilante-lock", { title: "警戒反击", message: "选择对手1张已明置角色，本回合不能发动技能。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "vigilante-lock") return false;
    context.lockOpponentCharacterSkill(Number(choiceValue(payload)));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const medium = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.medium,
  trigger: { event: "skill_cost_rest_after", relation: "target_self" },
  canActivate(context) {
    const definition = characterById.get(context.event?.characterDefinitionId || "");
    return definition?.mainRole === "防御" && context.event?.characterDefinitionId !== DEFENSE_CHARACTER_IDS.medium;
  },
  effect(context) {
    const definitionId = context.event?.characterDefinitionId;
    const index = context.player.characterDeck.findIndex((card) => card.definitionId === definitionId);
    if (index < 0) return;
    const [card] = context.player.characterDeck.splice(index, 1);
    context.player.characterDeck.push(card);
  },
});

const birdwatcher = immediateCharacterSkill({
  cardId: DEFENSE_CHARACTER_IDS.birdwatcher,
  trigger: { event: "body_targeted_by_hand", relation: "target_self" },
  effect(context) {
    context.startJudgment("defense-birdwatcher");
  },
});

const politician: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.politician,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    const opponent = context.opponent();
    const canDiscard = (opponent?.hand.length || 0) >= 2;
    context.setPrompt("politician-offer", {
      title: "停战提案", message: "是否弃置2张手牌，令对手的减伤效果失效？",
      options: [...(canDiscard ? [{ value: "discard", label: "弃置2张手牌" }] : []), { value: "allow", label: "允许减伤生效" }],
    }, {}, opponent?.id);
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "politician-offer") {
      if (choiceValue(payload) === "discard") {
        const opponent = context.opponent();
        if (!opponent || opponent.hand.length < 2) throw new Error("对手手牌不足2张。");
        context.setPrompt("politician-discard", {
          title: "停战提案", message: "选择2张手牌弃置。", min: 2, max: 2,
          cardInstanceIds: opponent.hand.map((card) => card.instanceId), selectableCards: opponent.hand,
        }, {}, opponent.id);
        return true;
      }
      if (choiceValue(payload) !== "allow") throw new Error("停战选择无效。");
      context.addModifier({
        kind: "damage-shield", count: 1, sourceDefinitionId: DEFENSE_CHARACTER_IDS.politician,
        expiresAtTurnNumber: context.state.turnNumber + 2,
      });
      context.clearPrompt(prompt.id);
      return true;
    }
    if (step !== "politician-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 2 || ids.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("请选择2张手牌。");
    context.discardOpponentHand(ids);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const astral: CharacterSkillModule = {
  cardId: DEFENSE_CHARACTER_IDS.astral,
  trigger: { event: "preparation", relation: "source_self" },
  activate(context) {
    const hidden = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown
      ? [{ slot, index }] : []) || [];
    const revealable = hidden.filter(({ slot }) => ["强攻", "伏击"].includes(characterById.get(slot.definitionId)?.mainRole || ""));
    context.setPrompt("astral-inspect", {
      title: "灵体出窍", message: "观看对手所有暗置角色，可将其中1张强攻或伏击角色明置。",
      selectableCards: hidden.map(({ slot }) => slot),
      options: [...revealable.map(({ slot, index }) => ({ value: String(index), label: `明置【${characterById.get(slot.definitionId)?.name || slot.definitionId}】` })), { value: "none", label: "不明置" }],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "astral-inspect") return false;
    const value = choiceValue(payload);
    if (value !== "none") {
      const role = context.opponent()?.characterSlots[Number(value)];
      if (!role || !("instanceId" in role) || !role.faceDown
        || !["强攻", "伏击"].includes(characterById.get(role.definitionId)?.mainRole || "")) throw new Error("只能明置观看到的强攻或伏击角色。");
      role.faceDown = false;
      context.addLog(`${context.player.nickname}令对手的【${characterById.get(role.definitionId)?.name || role.definitionId}】静默明置`, context.player.id, { zone: "characterSlot", ownerId: context.opponent()?.id, slotIndex: Number(value) });
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const defenseCharacterSkills = [
  falcon, highPriest, bodyguardAichitun, bodyguardQindi, canadian, adventurer,
  locksmith, bodyguardZongzi, mimic, vigilanteTutu, medium, birdwatcher, politician, astral,
] satisfies CharacterSkillModule[];
