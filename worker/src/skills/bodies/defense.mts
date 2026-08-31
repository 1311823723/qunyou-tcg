import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

export const defenseBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.defense,

  progressDelta(player, event) {
    if (event.type === "strike_dodged" && event.sourcePlayerId === player.id) return 1;
    return event.type === "damage_prevented" && event.sourcePlayerId === player.id && event.targetPlayerId === player.id ? 1 : 0;
  },

  collectTrigger(context, event) {
    if ((event.type === "strike_dodged" && event.sourcePlayerId === context.player.id)
      || (event.type === "damage_prevented" && event.sourcePlayerId === context.player.id && event.targetPlayerId === context.player.id)) {
      return { kind: "defense-reward" };
    }
    return undefined;
  },

  preventDamage(context, amount) {
    if (!context.player.bodyState.flipped || context.player.bodyState.extraFormUsed || context.player.health - amount > 0) return false;
    context.player.bodyState.extraFormUsed = true;
    context.emitEvent("damage_prevented", {
      sourcePlayerId: context.player.id, targetPlayerId: context.player.id, amount, metadata: { bodyZMove: true },
    });
    const recovered = context.heal(2);
    context.addLog(`${context.player.nickname}发动了Z招式【${context.skillName(true)}】，防止致命伤害并回复 ${recovered} 点体力`, context.player.id, {
      zone: "body", ownerId: context.player.id,
    });
    return true;
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "defense-reward" || context.usage("turn", "defense") >= 3) return false;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "你成功抵消、防止或减少了伤害，是否摸1张手牌并观看对手1张暗置角色？",
      options: [{ value: "reward", label: "摸牌并观看" }, { value: "pass", label: "不发动" }],
      context: { action: "defense-reward", triggerId: trigger.id },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    if (action === "defense-reward") {
      if (value !== "reward" && value !== "pass") throw new Error("守势循环选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "pass") return true;
      context.incrementUsage("turn", "defense");
      context.logTrait();
      context.draw(1);
      const opponent = context.opponent();
      const hidden = opponent?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown ? [{ slot, index }] : []) || [];
      if (hidden.length) context.setPrompt({
        kind: "body-skill", playerId: context.player.id, title: context.skillName(), message: "选择观看对手1张暗置角色。",
        options: hidden.map(({ index }) => ({ value: String(index), label: `观看角色位 ${index + 1}` })),
        context: { action: "defense-inspect", opponentId: opponent?.id },
      });
      return true;
    }
    if (action === "defense-inspect") {
      const opponent = context.opponent();
      const slot = opponent?.characterSlots[Number(value)];
      if (!slot || !("instanceId" in slot) || !slot.faceDown) throw new Error("该角色已不是暗置状态。");
      context.setPrompt({
        kind: "body-skill", playerId: context.player.id, title: `${context.skillName()}·观看`, message: "你观看了这张暗置角色。",
        selectableCards: [slot], options: [{ value: "done", label: "完成" }], context: { action: "defense-inspect-done" },
      });
      return true;
    }
    if (action !== "defense-inspect-done") return false;
    if (value !== "done") throw new Error("请完成观看。");
    context.clearPrompt(prompt.id);
    return true;
  },
};
