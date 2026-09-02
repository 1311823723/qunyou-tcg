import type { BodySkillModule, BodySkillRuntimeContext } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

const validInspectionKinds = new Set(["handDeckTop", "opponentHand"]);

function openDiscardPrompt(context: BodySkillRuntimeContext, mega: boolean, triggerId?: string) {
  const opponent = context.opponent();
  if (!opponent?.hand.length) return false;
  context.logTrait();
  context.addLog(
    `${opponent.nickname}展示了全部手牌：${opponent.hand.map((card) => context.handLabel(card)).join("、")}`,
    context.player.id,
    { zone: "hand", ownerId: opponent.id },
  );
  context.setPrompt({
    kind: "body-skill",
    playerId: context.player.id,
    title: context.skillName(mega),
    message: mega ? "选择对手1张手牌令其弃置，然后摸1张手牌。" : "选择对手1张手牌令其弃置。",
    min: 1,
    max: 1,
    cardInstanceIds: opponent.hand.map((card) => card.instanceId),
    selectableCards: opponent.hand,
    context: { action: "mizai-discard", opponentId: opponent.id, mega, triggerId },
  });
  return true;
}

export const mizaiBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.mizai,

  progressDelta(player, event) {
    return event.type === "inspection"
      && event.sourcePlayerId === player.id
      && validInspectionKinds.has(String(event.metadata?.inspectionKind || "")) ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (event.type !== "inspection"
      || event.sourcePlayerId !== context.player.id
      || !validInspectionKinds.has(String(event.metadata?.inspectionKind || ""))) return undefined;
    return { kind: "mizai-inspection" };
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "mizai-inspection") return false;
    const limit = context.player.bodyState.flipped ? 2 : 1;
    if (context.usage("turn", "mizai") >= limit) return false;
    if (context.player.bodyState.flipped) return openDiscardPrompt(context, true, trigger.id);
    const options = [{ value: "draw", label: "摸1张" }];
    if (context.opponent()?.hand.length) options.push({ value: "discard", label: "展示并弃置对手1张" });
    options.push({ value: "pass", label: "不发动" });
    context.setPrompt({
      kind: "body-skill",
      playerId: context.player.id,
      title: context.skillName(),
      message: "你完成了一次有效观看，选择本体特性效果。",
      options,
      context: { action: "mizai-choice", triggerId: trigger.id, ...trigger.context },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    if (action === "mizai-choice") {
      if (value === "pass") {
        context.clearPrompt(prompt.id);
        return true;
      }
      if (value === "draw") {
        context.incrementUsage("turn", "mizai");
        context.clearPrompt(prompt.id);
        context.logTrait();
        context.draw(1);
        return true;
      }
      if (value === "discard") {
        context.clearPrompt(prompt.id);
        if (!openDiscardPrompt(context, false)) throw new Error("对手没有可弃置的手牌。");
        return true;
      }
      throw new Error("窥心选择无效。");
    }
    if (action !== "mizai-discard") return false;
    const selectedIds = selectedCardIds(payload);
    const opponent = context.opponent();
    if (!opponent || selectedIds.length !== 1 || !prompt.cardInstanceIds?.includes(selectedIds[0])) throw new Error("请选择对手1张展示的手牌。");
    const card = context.discardHandCard(opponent, selectedIds[0]);
    if (!card) throw new Error("手牌状态已变化。");
    context.incrementUsage("turn", "mizai");
    context.addLog(`${context.player.nickname}令${opponent.nickname}弃置了【${context.handName(card.definitionId)}】`, context.player.id, { zone: "handDiscard" });
    context.clearPrompt(prompt.id);
    if (prompt.context?.mega === true) context.draw(1);
    return true;
  },
};
