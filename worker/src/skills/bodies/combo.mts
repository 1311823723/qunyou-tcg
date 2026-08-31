import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

export const comboBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.combo,

  progressDelta(player, event) {
    return event.type === "card_used" && event.sourcePlayerId === player.id && event.metadata?.actionCard === true ? 1 : 0;
  },

  collectTrigger(context, event) {
    if (event.type !== "card_resolved" || event.sourcePlayerId !== context.player.id || event.metadata?.actionCard !== true) return undefined;
    const count = context.incrementUsage("turn", "combo-actions");
    const limit = context.player.bodyState.flipped ? 3 : 2;
    if (count > limit || (context.player.bodyState.flipped && event.metadata?.causedDamage === true)) return undefined;
    return { kind: "combo-action", context: { causedDamage: event.metadata?.causedDamage === true } };
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "combo-action") return false;
    if (!context.player.bodyState.flipped) {
      context.setPrompt({
        kind: "body-skill",
        playerId: context.player.id,
        title: context.skillName(),
        message: "你使用了本回合前两张行动牌之一，是否摸1张手牌？",
        options: [{ value: "draw", label: "摸1张" }, { value: "pass", label: "不发动" }],
        context: { action: "combo-draw", triggerId: trigger.id, ...trigger.context },
      });
      return true;
    }
    const cards = context.takeTopHandCards(2);
    if (!cards.length) return false;
    context.logTrait();
    context.setPrompt({
      kind: "body-skill",
      playerId: context.player.id,
      title: context.skillName(true),
      message: "观看牌堆顶2张，选择至多1张加入手牌，其余置入弃牌区。",
      min: 0,
      max: 1,
      cardInstanceIds: cards.map((card) => card.instanceId),
      selectableCards: cards,
      options: [{ value: "none", label: "全部弃置" }],
      context: { action: "combo-mega-pick", cardIds: cards.map((card) => card.instanceId) },
    });
    return true;
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    if (action === "combo-draw") {
      if (value !== "draw" && value !== "pass") throw new Error("本体特性选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "draw") {
        context.logTrait();
        context.draw(1);
      }
      return true;
    }
    if (action !== "combo-mega-pick") return false;
    const selectedIds = selectedCardIds(payload);
    if (selectedIds.length > 1 || (selectedIds[0] && !prompt.cardInstanceIds?.includes(selectedIds[0]))) throw new Error("至多选择1张牌。");
    for (const card of prompt.selectableCards || []) {
      if (selectedIds.includes(card.instanceId)) context.gainHandCard(card);
      else context.discardLooseCard(card);
    }
    context.clearPrompt(prompt.id);
    context.addLog(`${context.player.nickname}完成了【${context.skillName(true)}】选牌`, context.player.id, { zone: "hand" });
    return true;
  },
};
