import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

export const aggroBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.aggro,

  progressDelta(player, event) {
    if (event.type !== "damage_after" || event.sourcePlayerId !== player.id) return 0;
    return Math.max(0, Number(event.amount || 0));
  },

  collectTrigger(context, event) {
    if (event.type !== "damage_after" || event.sourcePlayerId !== context.player.id || Number(event.amount || 0) <= 0) return undefined;
    if (context.incrementUsage("turn", "aggro-damage-events") > 1) return undefined;
    return { kind: "aggro-draw" };
  },

  extraStrikeAllowance(player) {
    return player.bodyState.flipped ? 2 : 1;
  },

  onPhaseEntered(context, phase) {
    if (phase !== "end" || !context.player.bodyState.flipped || !context.state.currentPlayerId) return;
    context.enqueueTrigger("aggro-mega-end-strike", `end:${context.state.turnNumber}`, {
      targetPlayerId: context.state.currentPlayerId,
    });
  },

  openPrompt(context, trigger) {
    if (trigger.kind === "aggro-draw") {
      context.setPrompt({
        kind: "body-skill",
        playerId: context.player.id,
        title: context.skillName(),
        message: "你本回合首次造成伤害，是否摸1张手牌？",
        options: [{ value: "draw", label: "摸1张" }, { value: "pass", label: "不发动" }],
        context: { action: "aggro-draw", triggerId: trigger.id, ...trigger.context },
      });
      return true;
    }
    if (trigger.kind !== "aggro-mega-end-strike") return false;
    const usable = context.legalStrikeCards();
    if (!usable.length) return false;
    context.setPrompt({
      kind: "body-skill",
      playerId: context.player.id,
      title: context.skillName(true),
      message: "是否在此结束阶段对该玩家使用一张【出刀】？若未造成伤害，你失去1点体力。",
      min: 0,
      max: 1,
      cardInstanceIds: usable.map((card) => card.instanceId),
      selectableCards: usable,
      options: [{ value: "pass", label: "不使用" }],
      context: { action: "aggro-mega-strike", targetPlayerId: trigger.context?.targetPlayerId },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    const selectedIds = selectedCardIds(payload);
    if (action === "aggro-draw") {
      if (value !== "draw" && value !== "pass") throw new Error("本体特性选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "draw") {
        context.logTrait();
        context.draw(1);
      }
      return true;
    }
    if (action !== "aggro-mega-strike") return false;
    if (value === "pass" && !selectedIds.length) {
      context.clearPrompt(prompt.id);
      return true;
    }
    if (selectedIds.length !== 1 || !prompt.cardInstanceIds?.includes(selectedIds[0])) throw new Error("请选择1张【出刀】。");
    const targetPlayerId = String(prompt.context?.targetPlayerId || "");
    context.clearPrompt(prompt.id);
    context.logTrait();
    context.startBodyStrike(targetPlayerId, selectedIds[0]);
    return true;
  },
};
