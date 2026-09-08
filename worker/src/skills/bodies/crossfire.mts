import type { BodySkillModule, BodySkillRuntimeContext } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

function history(context: BodySkillRuntimeContext) {
  const current = context.player.bodyState.crossfireHistory;
  if (!current || current.turnNumber !== context.state.turnNumber) {
    context.player.bodyState.crossfireHistory = { turnNumber: context.state.turnNumber, eligibleSkillActivations: [], eligibleStrikeEvents: [] };
  }
  return context.player.bodyState.crossfireHistory!;
}

function hiddenSlots(context: BodySkillRuntimeContext) {
  return context.opponent()?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown ? [{ slot, index }] : []) || [];
}

export const crossfireBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.crossfire,

  progressDelta(player, event) {
    return event.type === "crossfire_triggered" && event.sourcePlayerId === player.id ? 1 : 0;
  },

  collectTrigger(context, event) {
    const h = history(context);
    if (event.type === "card_used" && event.sourcePlayerId === context.player.id && event.cardDefinitionId === "hand_basic_001") {
      if (h.usedSkill) h.eligibleStrikeEvents.push(event.id);
      h.usedStrike = true;
      h.lastAction = "strike";
      return undefined;
    }
    if (event.type === "skill_used" && event.sourcePlayerId === context.player.id) {
      if (h.usedStrike) h.eligibleSkillActivations.push(event.id);
      h.usedSkill = true;
      h.lastAction = "skill";
      return undefined;
    }
    if (event.type === "strike_dodged" && event.targetPlayerId === context.player.id) {
      h.eligibleStrikeEvents.shift();
      return undefined;
    }
    if (event.type === "skill_resolved" && event.sourcePlayerId === context.player.id) {
      const index = h.eligibleSkillActivations.indexOf(String(event.metadata?.activationId || ""));
      if (index < 0) return undefined;
      h.eligibleSkillActivations.splice(index, 1);
      return { kind: context.player.bodyState.flipped ? "crossfire-mega" : "crossfire-skill-draw" };
    }
    if (event.type === "damage_after" && event.sourcePlayerId === context.player.id && event.cardDefinitionId === "hand_basic_001" && Number(event.amount || 0) > 0) {
      if (!h.eligibleStrikeEvents.length) return undefined;
      h.eligibleStrikeEvents.shift();
      return { kind: context.player.bodyState.flipped ? "crossfire-mega" : "crossfire-strike-inspect" };
    }
    return undefined;
  },

  openPrompt(context, trigger) {
    if (!["crossfire-skill-draw", "crossfire-strike-inspect", "crossfire-mega"].includes(trigger.kind)) return false;
    if (trigger.kind === "crossfire-skill-draw" && context.usage("turn", "crossfire") >= 2) return false;
    if (trigger.kind === "crossfire-strike-inspect" && !hiddenSlots(context).length) return false;
    if (trigger.kind === "crossfire-mega" && (context.player.bodyState.dynamaxEnergy || 0) < 1) return false;
    const options = trigger.kind === "crossfire-skill-draw"
      ? [{ value: "draw", label: "摸1张" }, { value: "pass", label: "不发动" }]
      : trigger.kind === "crossfire-strike-inspect"
        ? [{ value: "inspect", label: "观看1张暗置角色" }, { value: "pass", label: "不发动" }]
        : [{ value: "activate", label: "消耗1点极巨能量进行判定" }, { value: "pass", label: "保留能量" }];
    context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(trigger.kind === "crossfire-mega"), message: "交叉火力已满足触发条件，是否发动？", options, context: { action: trigger.kind } });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    if (!["crossfire-skill-draw", "crossfire-strike-inspect", "crossfire-mega", "crossfire-inspect", "crossfire-inspect-done"].includes(action)) return false;
    if (value === "pass") { context.clearPrompt(prompt.id); return true; }
    if (action === "crossfire-skill-draw") {
      if (value !== "draw" || context.usage("turn", "crossfire") >= 2) throw new Error("交叉火力次数已用尽。");
      context.incrementUsage("turn", "crossfire"); context.clearPrompt(prompt.id); context.logTrait(); context.draw(1); context.emitEvent("crossfire_triggered", { sourcePlayerId: context.player.id }); return true;
    }
    if (action === "crossfire-strike-inspect") {
      if (value !== "inspect") throw new Error("交叉火力选择无效。");
      const slots = hiddenSlots(context); if (!slots.length) throw new Error("对手没有暗置角色。");
      context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(), message: "选择观看对手1张暗置角色。", options: slots.map(({ index }) => ({ value: String(index), label: `观看角色位 ${index + 1}` })), context: { action: "crossfire-inspect" } });
      return true;
    }
    if (action === "crossfire-mega") {
      if (value !== "activate" || (context.player.bodyState.dynamaxEnergy || 0) < 1) throw new Error("极巨能量不足。");
      context.player.bodyState.dynamaxEnergy = Math.max(0, (context.player.bodyState.dynamaxEnergy || 0) - 1);
      context.clearPrompt(prompt.id); context.logTrait(); context.startJudgment("crossfire-body"); return true;
    }
    if (action === "crossfire-inspect") {
      const index = Number(value); const slot = context.opponent()?.characterSlots[index];
      if (!slot || !("instanceId" in slot) || !slot.faceDown) throw new Error("该角色已不再暗置。");
      context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(), message: "你已观看该暗置角色。", selectableCards: [slot], options: [{ value: "done", label: "完成" }], context: { action: "crossfire-inspect-done" } }); return true;
    }
    if (action === "crossfire-inspect-done") { if (value !== "done") throw new Error("请完成观看。"); context.clearPrompt(prompt.id); return true; }
    return false;
  },

  resolveJudgment(context, card, color) {
    if (card.suit === "红桃" || (!card.suit && color === "红色")) context.draw(2);
    else if (card.suit === "方块") {
      const opponent = context.opponent();
      if (opponent?.hand.length) {
        const card = context.discardHandCard(opponent, opponent.hand[0].instanceId);
        if (card) context.gainHandCard(card);
      }
    } else if (card.suit === "梅花") {
      const slots = hiddenSlots(context);
      if (slots.length === 1) context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(true), message: "你已观看对手的暗置角色。", selectableCards: [slots[0].slot], options: [{ value: "done", label: "完成" }], context: { action: "crossfire-mega-club-done" } });
      else if (slots.length > 1) context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(true), message: "选择观看对手1张暗置角色。", options: slots.map(({ index }) => ({ value: String(index), label: `观看角色位 ${index + 1}` })), context: { action: "crossfire-mega-club" } });
    } else if (card.suit === "黑桃") {
      if (context.player.characterSlots.some((slot) => slot === null)) context.deployTopCharacter();
    } else if (color === "黑色") {
      const opponent = context.opponent();
      if (opponent?.hand.length) {
        const taken = context.discardHandCard(opponent, opponent.hand[0].instanceId);
        if (taken) context.gainHandCard(taken);
      }
    }
    return true;
  },
};
