import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

export const transBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.trans,

  progressDelta(player, event) {
    return event.type === "skill_used" && event.sourcePlayerId === player.id && event.metadata?.virtualCard === true ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (event.type !== "skill_used" || event.sourcePlayerId !== context.player.id || event.metadata?.virtualCard !== true) return undefined;
    return { kind: "trans-deploy" };
  },

  onPhaseEntered(context, phase) {
    if (phase !== "end") return;
    for (const instanceId of context.player.bodyState.trackedCharacterInstanceIds) context.restOwnCharacter(instanceId);
    context.player.bodyState.trackedCharacterInstanceIds = [];
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "trans-deploy") return false;
    if (context.usage("turn", "trans") >= (context.player.bodyState.flipped ? 2 : 1)) return false;
    if (!context.player.characterSlots.includes(null) || !context.player.characterDeck.length) return false;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "你完成了拟态或虚拟牌操作，是否从角色牌堆顶暗置上阵1张角色？",
      options: [{ value: "deploy", label: "暗置上阵" }, { value: "pass", label: "不发动" }],
      context: { action: "trans-deploy", triggerId: trigger.id },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    if (prompt.context?.action !== "trans-deploy") return false;
    const value = choiceValue(payload);
    if (value !== "deploy" && value !== "pass") throw new Error("上阵选择无效。");
    context.clearPrompt(prompt.id);
    if (value === "pass") return true;
    context.incrementUsage("turn", "trans");
    context.logTrait();
    const deployed = context.deployTopCharacter();
    if (!deployed) throw new Error("角色区已满或角色牌堆为空。");
    context.player.bodyState.trackedCharacterInstanceIds.push(deployed.card.instanceId);
    if (context.player.bodyState.flipped) context.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: context.player.id, kind: "body-next-skill-cost-rest-one", count: 1,
      characterInstanceId: deployed.card.instanceId, expiresAtTurnNumber: context.state.turnNumber + 1,
    });
    context.addLog(`${context.player.nickname}因本体特性暗置上阵1张角色`, context.player.id, {
      zone: "characterSlot", ownerId: context.player.id, slotIndex: deployed.slotIndex,
    });
    return true;
  },
};
