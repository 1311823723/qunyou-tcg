import characters from "../../../../data/cards/characters.json" with { type: "json" };
import { HAND_IDS, handIsLocked } from "../../auto-engine.mts";
import {
  choiceValue,
  selectedCardIds,
  type CharacterSkillModule,
} from "../character-skill.mts";

export const DISPATCH_CHARACTER_IDS = {
  judge: "char_055_xiaoapan_judge",
  watcher: "char_033_weixiaokele_watcher",
  morphling: "char_081_aichitun_morphling",
  embalmer: "char_082_aichitun_embalmer",
  detective: "char_083_aichitun_detective",
  formationWatcher: "char_084_keke_watcher",
  sheriff: "char_086_aichitun_sheriff",
} as const;

const characterById = new Map(characters.map((card) => [card.id, card]));

const judge: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.judge,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => context.canUseBasic(HAND_IDS.strike) || context.canUseBasic(HAND_IDS.aid),
  activate(context) {
    const options = [];
    if (context.canUseBasic(HAND_IDS.strike)) options.push({ value: HAND_IDS.strike, label: "宣言【出刀】" });
    if (context.canUseBasic(HAND_IDS.aid)) options.push({ value: HAND_IDS.aid, label: "宣言【急救】" });
    context.setPrompt("judge-declare", { title: "我全都要", message: "宣言1种当前可使用的基础牌。", options });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "judge-declare") {
      const definitionId = choiceValue(payload);
      if (![HAND_IDS.strike, HAND_IDS.aid].includes(definitionId as never) || !context.canUseBasic(definitionId)) throw new Error("宣言的基础牌当前不能使用。");
      const opponent = context.opponent();
      if (!opponent) throw new Error("对手不存在。");
      const options = [{ value: "allow", label: `视为对手使用【${context.handName(definitionId)}】` }];
      if (opponent.hand.length) options.push({ value: "give", label: "交给对手1张手牌" });
      context.setPrompt("judge-opponent", { title: "审判选择", message: `${context.player.nickname}宣言了【${context.handName(definitionId)}】。`, options }, { definitionId }, opponent.id);
      return true;
    }
    if (step === "judge-opponent") {
      const definitionId = String(context.continuation?.data?.definitionId || "");
      const value = choiceValue(payload);
      if (value === "allow") {
        context.clearPrompt(prompt.id);
        context.useVirtualBasic(definitionId);
        return true;
      }
      const opponent = context.opponent();
      if (value !== "give" || !opponent?.hand.length) throw new Error("审判选择已无效。");
      context.setPrompt("judge-give", {
        title: "交出手牌", message: `选择1张手牌交给${context.player.nickname}。`, min: 1, max: 1,
        cardInstanceIds: opponent.hand.map((card) => card.instanceId), selectableCards: opponent.hand,
      }, { definitionId }, opponent.id);
      return true;
    }
    if (step !== "judge-give") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请交出1张手牌。");
    context.gainOpponentHand(ids[0]);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const watcher: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.watcher,
  trigger: { event: "play_phase", relation: "source_self" },
  activate(context) {
    context.setPrompt("watcher-stance", {
      title: "姿态流转", message: "选择本回合的姿态。", options: [
        { value: "rage", label: "怒：下次【出刀】伤害+1" },
        { value: "calm", label: "静：下次使用行动牌时摸1张牌" },
      ],
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "watcher-stance") return false;
    const value = choiceValue(payload);
    if (value === "rage") context.boostNextStrikeDamage(1);
    else if (value === "calm") context.addModifier({ kind: "combo-next-action-draw", count: 1, sourceDefinitionId: DISPATCH_CHARACTER_IDS.watcher });
    else throw new Error("姿态选择无效。");
    context.clearPrompt(prompt.id);
    return true;
  },
};

const morphling: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.morphling,
  trigger: { event: "play_phase", relation: "source_self" },
  usageLimit: { scope: "turn", count: 1 },
  canActivate: (context) => context.player.hand.length > 0
    && context.player.characterDeck.length > 0
    && context.player.characterSlots.some((slot) => slot === null),
  activate(context) {
    context.setPrompt("morphling-discard", {
      title: "临时替身", message: "弃置1张手牌，从角色牌堆顶暗置上阵1张角色。", min: 1, max: 1,
      cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "morphling-discard") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请弃置1张手牌。");
    context.discardOwnHand(ids);
    context.deployTopCharacters(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const embalmer: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.embalmer,
  trigger: { event: "character_retired", relation: "target_self" },
  canActivate: (context) => context.event?.characterDefinitionId !== DISPATCH_CHARACTER_IDS.embalmer
    && context.player.characterDeck.length > 0
    && context.player.characterSlots.some((slot) => slot === null),
  activate(context) {
    context.deployTopCharacters(2);
  },
};

const detective: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.detective,
  trigger: { event: "skill_resolved", relation: "source_opponent" },
  onInspectionPrevented(context) { context.draw(1); },
  canActivate: (context) => context.event?.metadata?.revealedFromFaceDown === true
    && Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown)),
  activate(context) {
    const hidden = context.opponent()?.characterSlots.flatMap((slot) => slot && "instanceId" in slot && slot.faceDown ? [slot] : []) || [];
    context.setPrompt("detective-select", {
      title: "锁定嫌疑", message: "选择1张对手的暗置角色观看。", min: 1, max: 1,
      cardInstanceIds: hidden.map((card) => card.instanceId),
    });
  },
  resolveChoice(context, prompt, payload) {
    const step = context.continuation?.step;
    if (step === "detective-select") {
      const ids = selectedCardIds(payload);
      if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张暗置角色。");
      const role = context.opponent()?.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === ids[0]);
      if (!role || !("instanceId" in role) || !role.faceDown) throw new Error("所选角色已不是暗置状态。");
      context.setPrompt("detective-view", {
        title: "锁定嫌疑", message: "你观看了这张暗置角色。", selectableCards: [role],
        options: [{ value: "done", label: "完成" }],
      }, { inspectedInstanceId: role.instanceId });
      return true;
    }
    if (step !== "detective-view" || choiceValue(payload) !== "done") return false;
    const role = prompt.selectableCards?.[0];
    context.emitEvent("inspection", {
      sourcePlayerId: context.player.id, targetPlayerId: context.opponent()?.id,
      characterDefinitionId: role?.definitionId, metadata: { inspectionKind: "characterRole" },
    });
    context.draw(1);
    context.clearPrompt(prompt.id);
    return true;
  },
};

const formationWatcher: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.formationWatcher,
  trigger: { event: "character_deployed", relation: "target_self" },
  canActivate: (context) => Number(context.event?.amount || 0) === 2
    && context.player.characterSlots.some((slot) => slot && "instanceId" in slot
      && context.state.usageCounters[`deployed:${context.state.turnNumber}:${context.player.id}:${slot.instanceId}`]),
  activate(context) {
    const deployed = context.player.characterSlots.flatMap((slot) => slot && "instanceId" in slot
      && context.state.usageCounters[`deployed:${context.state.turnNumber}:${context.player.id}:${slot.instanceId}`] ? [slot] : []);
    context.setPrompt("formation-reveal", {
      title: "预见阵型", message: "选择本回合上阵的1张角色并将其明置。", min: 1, max: 1,
      cardInstanceIds: deployed.map((card) => card.instanceId), selectableCards: deployed,
    });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "formation-reveal") return false;
    const ids = selectedCardIds(payload);
    if (ids.length !== 1 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择本回合上阵的1张角色。");
    const role = context.player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === ids[0]);
    if (!role || !("instanceId" in role)) throw new Error("所选角色已不在角色区。");
    role.faceDown = false;
    context.addModifier({
      kind: "body-next-skill-cost-rest-one", count: 1,
      characterInstanceId: role.instanceId, sourceDefinitionId: DISPATCH_CHARACTER_IDS.formationWatcher,
    });
    context.emitEvent("character_revealed", {
      sourcePlayerId: context.player.id, targetPlayerId: context.player.id,
      characterDefinitionId: role.definitionId, metadata: { characterInstanceId: role.instanceId },
    });
    context.clearPrompt(prompt.id);
    return true;
  },
};

const sheriff: CharacterSkillModule = {
  cardId: DISPATCH_CHARACTER_IDS.sheriff,
  trigger: { event: "play_phase", relation: "source_self" },
  canActivate: (context) => !handIsLocked(context.state, context.player.id, HAND_IDS.strike)
    && Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot && slot.faceDown === false)),
  activate(context) {
    const options = context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown === false
      ? [{ value: String(index), label: characterById.get(slot.definitionId)?.name || `角色位 ${index + 1}` }] : []) || [];
    context.setPrompt("sheriff-target", { title: "当场执法", message: "选择1张对手已明置角色。", options });
  },
  resolveChoice(context, prompt, payload) {
    if (context.continuation?.step !== "sheriff-target") return false;
    const slotIndex = Number(choiceValue(payload));
    const target = context.opponent()?.characterSlots[slotIndex];
    if (!Number.isInteger(slotIndex) || !target || !("instanceId" in target) || target.faceDown !== false) throw new Error("只能选择对手已明置角色。");
    context.clearPrompt(prompt.id);
    context.useVirtualBasic(HAND_IDS.strike, { restTargetSlotOnDamage: slotIndex });
    return true;
  },
};

export const dispatchCharacterSkills: CharacterSkillModule[] = [
  judge,
  watcher,
  morphling,
  embalmer,
  detective,
  formationWatcher,
  sheriff,
];
