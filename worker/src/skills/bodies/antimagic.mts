import type { BodySkillModule, BodySkillRuntimeContext } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

function visibleOpponentSlots(context: BodySkillRuntimeContext) {
  return context.opponent()?.characterSlots.flatMap((slot, index) =>
    slot && "instanceId" in slot && !slot.faceDown ? [{ slot, index }] : []) || [];
}

export const antimagicBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.antimagic,

  progressDelta(player, event) {
    return event.type === "antimagic_strike" && event.sourcePlayerId === player.id ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (context.player.bodyState.flipped) return undefined;
    if (event.type === "skill_resolved" && event.sourcePlayerId && event.sourcePlayerId !== context.player.id) {
      if (context.player.bodyState.antiMagicMark || context.usage("turn", "antimagic-acquire") > 0) return undefined;
      return { kind: "antimagic-acquire" };
    }
    return undefined;
  },

  canActivateExtra(context) {
    return context.player.bodyState.flipped && (context.player.bodyState.dynamaxEnergy || 0) > 0;
  },

  activateExtra(context) {
    if (!context.player.bodyState.flipped || (context.player.bodyState.dynamaxEnergy || 0) < 1) throw new Error("极巨能量不足。");
    const slots = visibleOpponentSlots(context);
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
      message: "消耗1点极巨能量，选择黑色分割或反魔领域。",
      options: [
        { value: "slash", label: "黑色分割：下一张【出刀】伤害+1" },
        ...(slots.length ? [{ value: "field", label: "反魔领域：封锁1名明置角色" }] : []),
      ], context: { action: "antimagic-mega", slots: slots.map(({ index }) => String(index)) },
    });
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "antimagic-acquire" || context.player.bodyState.flipped || context.player.bodyState.antiMagicMark || context.usage("turn", "antimagic-acquire") > 0) return false;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "对手角色技能已结算，是否获得1枚【反魔】标记？",
      options: [{ value: "gain", label: "获得反魔" }, { value: "pass", label: "不获得" }],
      context: { action: "antimagic-acquire" },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    if (action === "antimagic-acquire") {
      if (!["gain", "pass"].includes(value)) throw new Error("反魔标记选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "gain") {
        context.incrementUsage("turn", "antimagic-acquire");
        context.player.bodyState.antiMagicMark = true;
        context.logTrait();
        context.addLog(`${context.player.nickname}获得1枚【反魔】标记`, context.player.id, { zone: "body", ownerId: context.player.id });
      }
      return true;
    }
    if (action === "antimagic-field") {
      const index = Number(value);
      const target = context.opponent();
      const slot = target?.characterSlots[index];
      if (!target || !slot || !("instanceId" in slot) || slot.faceDown) throw new Error("只能封锁对手已明置角色。");
      context.player.bodyState.dynamaxEnergy = Math.max(0, (context.player.bodyState.dynamaxEnergy || 0) - 1);
      context.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: context.player.id, kind: "defense-skill-lock", count: 1, targetPlayerId: target.id, targetCharacterInstanceId: slot.instanceId, expiresAtTurnNumber: context.state.turnNumber + 1 });
      context.clearPrompt(prompt.id); context.logTrait(); return true;
    }
    if (action !== "antimagic-mega") return false;
    if (!context.player.bodyState.flipped || (context.player.bodyState.dynamaxEnergy || 0) < 1) throw new Error("极巨能量不足。");
    if (value === "slash") {
      context.player.bodyState.dynamaxEnergy = Math.max(0, (context.player.bodyState.dynamaxEnergy || 0) - 1);
      context.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: context.player.id, kind: "antimagic-next-strike", count: 1 });
      context.clearPrompt(prompt.id);
      context.logTrait();
      return true;
    }
    if (value === "field") {
      const slots = visibleOpponentSlots(context);
      context.setPrompt({
        kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
        message: "选择1名对手已明置角色，直到你的下个回合开始不能发动技能。",
        options: slots.map(({ index }) => ({ value: String(index), label: `封锁角色位 ${index + 1}` })),
        context: { action: "antimagic-field" },
      });
      return true;
    }
    throw new Error("极巨技能选择无效。");
  },
};
