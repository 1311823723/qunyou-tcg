import characters from "../../../../data/cards/characters.json" with { type: "json" };
import { HAND_IDS } from "../../auto-engine.mts";
import {
  choiceValue,
  immediateCharacterSkill,
  selectedCardIds,
  type CharacterSkillModule,
} from "../character-skill.mts";

export const AGGRO_CHARACTER_IDS = {
  kekeAssassin: "char_001_keke_assassin",
  weixiaokeleAssassin: "char_002_weixiaokele_assassin",
  sheriff: "char_003_qindi_sheriff",
  pelican: "char_004_horus-lupercal_pelican",
  jester: "char_005_aichitun_jester",
  weixiaokeleNinja: "char_006_weixiaokele_ninja",
  baiziNinja: "char_007_baizi_ninja",
  baiziHitman: "char_008_baizi_hitman",
  weixiaokeleHitman: "char_009_weixiaokele_hitman",
  weixiaokeleBomber: "char_010_weixiaokele_bomber",
  baiziBomber: "char_011_baizi_bomber",
  birdEater: "char_012_baizi_bird-eater",
  morphling: "char_013_weixiaokele_morphling",
  partyDuck: "char_014_baizi_party-duck",
  lobbyist: "char_015_weixiaokele_lobbyist",
  gravy: "char_016_baizi_gravy",
} as const;

const characterById = new Map(characters.map((card) => [card.id, card]));
const mainRoles = ["强攻", "防御", "资源", "控制", "支援", "伏击"];
const suits = ["黑桃", "红桃", "梅花", "方块"];

const kekeAssassin: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.kekeAssassin,
  trigger: { event: "damage_after", relation: "target_self" },
  activate(context) {
    context.setPrompt("declare-suit", {
      title: "暗影裁决",
      message: "宣言一种花色，然后随机展示对手1张手牌。",
      options: suits.map((value) => ({ value, label: value })),
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "declare-suit") return false;
    const suit = choiceValue(payload);
    if (!suits.includes(suit)) throw new Error("宣言花色无效。");
    const card = context.randomOpponentHand();
    context.clearPrompt(prompt.id);
    if (!card) return true;
    context.addLog(`${context.player.nickname}宣言${suit}，对手随机展示了【${context.handName(card.definitionId)}】`, context.player.id, { zone: "hand", ownerId: context.opponent()?.id });
    if (card.suit === suit) context.damageOpponent(1);
    return true;
  },
};

const weixiaokeleAssassin: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.weixiaokeleAssassin,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown)),
  activate(context) {
    context.setPrompt("declare-main-role", {
      title: "身份识破",
      message: "先宣言一种角色定位。",
      options: mainRoles.map((value) => ({ value, label: value })),
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step === "declare-main-role") {
      const declared = choiceValue(payload);
      if (!mainRoles.includes(declared)) throw new Error("宣言定位无效。");
      const opponent = context.opponent();
      const options = opponent?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown
        ? [{ value: String(index), label: `对手角色位 ${index + 1}` }]
        : []) || [];
      if (!options.length) throw new Error("对手已没有暗置角色。");
      context.setPrompt("reveal-role", { title: "身份识破", message: `已宣言${declared}，选择1张暗置角色明置。`, options }, { declared });
      return true;
    }
    if (context.continuation?.step !== "reveal-role") return false;
    const index = Number(choiceValue(payload));
    const declared = String(context.continuation.data?.declared || "");
    const role = context.revealOpponentCharacter(index);
    context.clearPrompt(prompt.id);
    if (characterById.get(role.definitionId)?.mainRole === declared) context.damageOpponent(1);
    else context.drawOpponent(1);
    return true;
  },
};

const sheriff = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.sheriff,
  trigger: { event: "opponent_preparation", relation: "source_opponent" },
  canActivate: (context) => context.role.faceDown === false,
  effect(context) {
    context.addModifier({
      kind: "aggro-sheriff-recoil",
      count: 1,
      sourceDefinitionId: AGGRO_CHARACTER_IDS.sheriff,
      targetPlayerId: context.opponent()?.id,
      characterInstanceId: context.role.instanceId,
      expiresAtTurnNumber: context.state.turnNumber + 1,
    });
    context.damageOpponent(1);
  },
});

const pelican: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.pelican,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot
      ? [{ value: String(index), label: `对手角色位 ${index + 1}` }]
      : []) || [];
    context.setPrompt("pelican-banish", { title: "暂时吞没", message: "选择1张对手角色移出游戏。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "pelican-banish") return false;
    const role = context.banishOpponentCharacterUntilNextPreparation(Number(choiceValue(payload)));
    context.clearPrompt(prompt.id);
    if (role.faceDown === false) context.damageOpponent(1);
    return true;
  },
};

const jester = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.jester,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    const discarded = context.discardRandomOpponent(2);
    context.drawOpponent(1);
    if (discarded.some((card) => card.definitionId === HAND_IDS.strike)) context.damageOpponent(1);
  },
});

const weixiaokeleNinja = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.weixiaokeleNinja,
  trigger: { event: "strike_used", relation: "source_self" },
  canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && item.sourcePlayerId === context.player.id),
  effect(context) {
    if (!context.makeCurrentStrikeUndodgeable(true)) throw new Error("当前【出刀】已不在结算中。");
  },
});

const baiziNinja: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.baiziNinja,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown
      ? [{ value: String(index), label: `对手角色位 ${index + 1}` }]
      : []) || [];
    context.setPrompt("lock-reveal", { title: "雾隐封锁", message: "选择1张暗置角色，本回合不能明置。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "lock-reveal") return false;
    context.lockOpponentCharacterReveal(Number(choiceValue(payload)));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const baiziHitman = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.baiziHitman,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    context.damageOpponent(1, { after: "return-self-if-target-health-at-most-3" });
  },
});

// 该技能由统一伤害入口处理，确保手牌、角色和本体造成的伤害都经过同一替换窗口。
const weixiaokeleHitman: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.weixiaokeleHitman,
  trigger: { event: "damage_before_source", relation: "source_self" },
  canActivate: () => false,
  activate() {},
};

const weixiaokeleBomber: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.weixiaokeleBomber,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.includes(null)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot === null
      ? [{ value: String(index), label: `对手角色位 ${index + 1}` }]
      : []) || [];
    context.setPrompt("place-bomb", { title: "延时爆破", message: "选择1个空角色位放置炸弹。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "place-bomb") return false;
    context.placeOpponentBomb(Number(choiceValue(payload)));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const baiziBomber = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.baiziBomber,
  trigger: { event: "play_phase", relation: "source_self" },
  effect(context) {
    const otherRoles = context.player.characterSlots.filter((slot) => slot && "instanceId" in slot).length;
    context.damageOpponent(Math.min(2, otherRoles + 1));
  },
});

const birdEater: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.birdEater,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    context.setPrompt("bird-eater-own", {
      title: "退场清扫",
      message: "选择己方退场区1张角色洗回角色牌堆。",
      min: 1,
      max: 1,
      cardInstanceIds: context.player.retired.map((card) => card.instanceId),
      selectableCards: context.player.retired,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step === "bird-eater-own") {
      const [id] = selectedCardIds(payload);
      if (!id || !prompt.cardInstanceIds?.includes(id) || !context.shuffleOwnRetired(id)) throw new Error("请选择己方退场区1张角色。");
      const opponent = context.opponent();
      if (!opponent?.retired.length) {
        context.clearPrompt(prompt.id);
        return true;
      }
      context.setPrompt("bird-eater-opponent", {
        title: "退场清扫",
        message: "你可以将对手退场区1张角色移出游戏。",
        min: 0,
        max: 1,
        cardInstanceIds: opponent.retired.map((card) => card.instanceId),
        selectableCards: opponent.retired,
        options: [{ value: "none", label: "不移出" }],
      });
      return true;
    }
    if (context.continuation?.step !== "bird-eater-opponent") return false;
    const ids = choiceValue(payload) === "none" ? [] : selectedCardIds(payload);
    if (ids.length > 1 || (ids[0] && !prompt.cardInstanceIds?.includes(ids[0]))) throw new Error("对手退场区选择无效。");
    if (ids[0]) context.banishOpponentRetired(ids[0]);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const morphling: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.morphling,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown === false)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown === false
      ? [{ value: String(index), label: characterById.get(slot.definitionId)?.name || `对手角色位 ${index + 1}` }]
      : []) || [];
    context.setPrompt("copy-character", { title: "身份拟态", message: "选择1张已明置角色，获得其技能直到回合结束。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "copy-character") return false;
    context.copyOpponentCharacterSkill(Number(choiceValue(payload)));
    context.clearPrompt(prompt.id);
    return true;
  },
};

const partyDuck: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.partyDuck,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => context.player.hand.length > 0 && Boolean(context.opponent()?.hand.length),
  activate(context) {
    context.setPrompt("party-own-discard", {
      title: "派对交换",
      message: "选择自己1张手牌弃置。",
      min: 1,
      max: 1,
      cardInstanceIds: context.player.hand.map((card) => card.instanceId),
      selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step === "party-own-discard") {
      const ids = selectedCardIds(payload);
      if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择自己1张手牌。");
      const [discarded] = context.discardOwnHand(ids);
      const opponent = context.opponent();
      if (!opponent?.hand.length) throw new Error("对手已没有手牌。");
      context.setPrompt("party-opponent-discard", {
        title: "派对交换",
        message: "选择1张手牌弃置。",
        min: 1,
        max: 1,
        cardInstanceIds: opponent.hand.map((card) => card.instanceId),
        selectableCards: opponent.hand,
      }, { discardedBasic: discarded.definitionId.startsWith("hand_basic_") }, opponent.id);
      return true;
    }
    if (context.continuation?.step !== "party-opponent-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌。");
    context.discardOpponentHand(ids);
    context.clearPrompt(prompt.id);
    if (context.continuation.data?.discardedBasic === true) context.draw(1);
    return true;
  },
};

const lobbyist = immediateCharacterSkill({
  cardId: AGGRO_CHARACTER_IDS.lobbyist,
  trigger: { event: "play_phase", relation: "source_self" },
  effect: (context) => context.boostNextStrikeDamage(1),
});

const gravy: CharacterSkillModule = {
  cardId: AGGRO_CHARACTER_IDS.gravy,
  trigger: { event: "strike_targeted", relation: "target_self" },
  canActivate: (context) => context.player.hand.length > 0,
  activate(context) {
    context.setPrompt("gravy-discard", {
      title: "肉汁掩护",
      message: "弃置1张手牌，视为使用【闪避】。",
      min: 1,
      max: 1,
      cardInstanceIds: context.player.hand.map((card) => card.instanceId),
      selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "gravy-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张手牌弃置。");
    context.discardOwnHand(ids);
    if (!context.dodgeCurrentStrike()) throw new Error("当前【出刀】已经不能响应。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

export const aggroCharacterSkills = [
  kekeAssassin,
  weixiaokeleAssassin,
  sheriff,
  pelican,
  jester,
  weixiaokeleNinja,
  baiziNinja,
  baiziHitman,
  weixiaokeleHitman,
  weixiaokeleBomber,
  baiziBomber,
  birdEater,
  morphling,
  partyDuck,
  lobbyist,
  gravy,
] satisfies CharacterSkillModule[];
