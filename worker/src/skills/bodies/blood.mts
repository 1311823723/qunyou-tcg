import type { CardInstance } from "../../types";
import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

function recover(context: Parameters<NonNullable<BodySkillModule["activateExtra"]>>[0], count = 1) {
  const recovered = context.heal(count);
  context.addLog(`${context.player.nickname}回复了 ${recovered} 点体力`, context.player.id, { zone: "player", ownerId: context.player.id });
}

export const bloodBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.blood,

  progressDelta(player, event) {
    return event.type === "judgment_resolved" && event.sourcePlayerId === player.id && event.metadata?.bodySkill === true ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (event.type !== "damage_after" || event.targetPlayerId !== context.player.id || Number(event.amount || 0) <= 0) return undefined;
    return { kind: "blood-judgment" };
  },

  canActivateExtra() { return true; },

  activateExtra(context) {
    const max = Math.min(3, context.player.maxHealth - context.player.health);
    const cards = [...context.state.handDiscard];
    if (!max || !cards.length) return recover(context);
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
      message: `从弃牌区选择至多 ${max} 张不同名称的牌加入手牌，然后回复1点体力。`,
      min: 0, max, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards,
      options: [{ value: "none", label: "不获得牌，直接回复" }], context: { action: "blood-z-pick" },
    });
  },

  resolveJudgment(context, _card: CardInstance, color) {
    if (color === "红色") {
      context.draw(2);
      return true;
    }
    const opponent = context.opponent();
    if (opponent?.hand.length) context.discardRandom(opponent);
    if (context.player.hand.length) context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "黑色判定：请弃置1张手牌，然后摸1张。",
      min: 1, max: 1, cardInstanceIds: context.player.hand.map((item) => item.instanceId), selectableCards: context.player.hand,
      context: { action: "blood-self-discard" },
    });
    else context.draw(1);
    return true;
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "blood-judgment" || context.usage("turn", "blood") >= 2) return false;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(),
      message: "你受到了伤害，是否发动本体技能进行判定？",
      options: [{ value: "judge", label: "进行判定" }, { value: "pass", label: "不发动" }],
      context: { action: "blood-judge", triggerId: trigger.id },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    const selectedIds = selectedCardIds(payload);
    if (action === "blood-judge") {
      if (value !== "judge" && value !== "pass") throw new Error("判定选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "judge") {
        context.incrementUsage("turn", "blood");
        context.startJudgment("blood-body");
      }
      return true;
    }
    if (action === "blood-self-discard") {
      if (selectedIds.length !== 1 || !prompt.cardInstanceIds?.includes(selectedIds[0])) throw new Error("请选择1张手牌弃置。");
      if (!context.discardHandCard(context.player, selectedIds[0])) throw new Error("手牌已变化。");
      context.clearPrompt(prompt.id);
      context.draw(1);
      return true;
    }
    if (action !== "blood-z-pick") return false;
    if (selectedIds.length > Number(prompt.max || 0) || new Set(selectedIds).size !== selectedIds.length
      || selectedIds.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("Z招式选牌无效。");
    const names = new Set<string>();
    for (const id of selectedIds) {
      const index = context.state.handDiscard.findIndex((card) => card.instanceId === id);
      if (index < 0) throw new Error("弃牌区状态已变化。");
      const card = context.state.handDiscard[index];
      if (names.has(card.definitionId)) throw new Error("选择的牌名称必须不同。");
      names.add(card.definitionId);
      context.state.handDiscard.splice(index, 1);
      context.gainHandCard(card);
    }
    const recovered = context.heal(1);
    context.clearPrompt(prompt.id);
    context.addLog(`${context.player.nickname}从弃牌区获得 ${selectedIds.length} 张牌并回复 ${recovered} 点体力`, context.player.id, { zone: "handDiscard" });
    return true;
  },
};
