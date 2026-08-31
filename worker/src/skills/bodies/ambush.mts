import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

export const ambushBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.ambush,

  progressDelta(player, event) {
    return event.type === "skill_used" && event.sourcePlayerId === player.id && event.metadata?.mainRole === "伏击" ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (event.type !== "skill_used" || event.sourcePlayerId !== context.player.id
      || event.metadata?.mainRole !== "伏击" || event.metadata?.leftFieldForCost !== true) return undefined;
    return { kind: "ambush-refill" };
  },

  onPhaseEntered(context, phase) {
    const window = context.player.bodyState.ambushWindow;
    if (phase !== "preparation" || context.state.currentPlayerId !== context.player.id || !window
      || context.state.turnNumber < window.expiresAtTurnNumber) return;
    context.player.bodyState.ambushWindow = undefined;
    context.addLog(`${context.player.nickname}的【万劫暗夜】持续时间结束`, context.player.id, { zone: "body", ownerId: context.player.id });
  },

  canActivateExtra() { return true; },

  activateExtra(context) {
    context.player.bodyState.ambushWindow = { remaining: 2, expiresAtTurnNumber: context.state.turnNumber + 2 };
    context.addLog(`${context.player.nickname}的退场伏击角色在下个回合开始前可至多免费发动2次`, context.player.id, {
      zone: "retired", ownerId: context.player.id,
    });
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "ambush-refill" || context.usage("turn", "ambush-refill") >= 1
      || !context.player.characterSlots.includes(null) || !context.player.characterDeck.length) return false;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "己方伏击角色因支付费用离场，是否暗置补位1张角色？",
      options: [{ value: "deploy", label: "暗置补位" }, { value: "pass", label: "不发动" }],
      context: { action: "ambush-refill", triggerId: trigger.id },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    if (prompt.context?.action !== "ambush-refill") return false;
    const value = choiceValue(payload);
    if (value !== "deploy" && value !== "pass") throw new Error("补位选择无效。");
    context.clearPrompt(prompt.id);
    if (value === "pass") return true;
    context.incrementUsage("turn", "ambush-refill");
    const deployed = context.deployTopCharacter();
    if (!deployed) throw new Error("角色区已满或角色牌堆为空。");
    context.addLog(`${context.player.nickname}因本体技能暗置上阵1张角色`, context.player.id, {
      zone: "characterSlot", ownerId: context.player.id, slotIndex: deployed.slotIndex,
    });
    return true;
  },
};
