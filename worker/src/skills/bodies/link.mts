import type { BodySkillModule, BodySkillRuntimeContext } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";
import type { CardInstance } from "../../types";

function field(context: BodySkillRuntimeContext) {
  return context.player.characterSlots.filter((slot): slot is CardInstance => Boolean(slot && "instanceId" in slot));
}

function finish(context: BodySkillRuntimeContext, promptId: string) {
  context.clearPrompt(promptId);
  if (context.player.bodyState.flipped && context.player.bodyState.dynamaxEnergy === 0) {
    context.player.bodyState.dynamaxEnding = true;
  }
}

function requestSwap(context: BodySkillRuntimeContext, extra: boolean) {
  const cards = field(context);
  if (!cards.length) return false;
  context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(extra),
    message: "选择己方场上1张角色置于牌堆底并换手（不视为休整）。", min: 1, max: 1,
    cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards,
    context: { action: "link-field", extra } });
  return true;
}

export const linkBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.link,
  progressDelta: (_player, event) => event.type === "link_used" && event.sourcePlayerId === _player.id ? 1 : 0,
  collectTrigger(context, event) {
    if (event.sourcePlayerId !== context.player.id) return;
    const body = context.player.bodyState;
    if (event.type === "skill_used") {
      if (body.linkHistory?.turnNumber !== context.state.turnNumber) {
        body.linkHistory = { turnNumber: context.state.turnNumber, roles: [], activations: {} };
      }
      const role = String(event.metadata?.mainRole || "");
      if (!role) return;
      body.linkHistory.activations[event.id] = body.linkHistory.roles.some((previous) => previous !== role);
      if (!body.linkHistory.roles.includes(role)) body.linkHistory.roles.push(role);
      return;
    }
    if (event.type !== "skill_resolved") return;
    const activationId = String(event.metadata?.activationId || "");
    const history = body.linkHistory;
    const eligible = history?.turnNumber === context.state.turnNumber && history.activations[activationId] === true;
    if (history) delete history.activations[activationId];
    if (!eligible) return;
    if (body.flipped ? (body.dynamaxEnergy || 0) <= 0 : context.state.currentPlayerId !== context.player.id || context.usage("turn", "link-used") > 0) return;
    return { kind: "link-swap", context: { extra: body.flipped, activationId } };
  },
  openPrompt(context, trigger) {
    if (trigger.kind !== "link-swap") return false;
    const extra = trigger.context?.extra === true;
    const body = context.player.bodyState;
    if (extra !== body.flipped || (extra ? (body.dynamaxEnergy || 0) <= 0 : context.usage("turn", "link-used") > 0 || context.state.currentPlayerId !== context.player.id)) return false;
    context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(extra),
      message: extra ? "消耗1点极巨能量，摸1张并进行精准换手？" : "已串联不同定位的角色技能，选择本回合的换手收益。",
      options: extra ? [{ value: "activate", label: "消耗1能量发动" }, { value: "pass", label: "保留能量" }]
        : [{ value: "draw", label: "摸1张" }, ...(field(context).length ? [{ value: "swap", label: "换手1张角色" }] : []), { value: "pass", label: "不发动" }],
      context: { action: "link-start", extra } });
    return true;
  },
  resolveChoice(context, prompt, payload) {
    const action = prompt.context?.action;
    if (typeof action !== "string" || !action.startsWith("link-")) return false;
    const value = choiceValue(payload);
    const extra = prompt.context?.extra === true;
    if (action === "link-start") {
      if (!prompt.options?.some((option) => option.value === value)) throw new Error("连携选择无效。");
      context.clearPrompt(prompt.id);
      if (value === "pass") return true;
      if (extra) {
        if (!context.player.bodyState.flipped || (context.player.bodyState.dynamaxEnergy || 0) < 1) throw new Error("极巨能量不足。");
        context.player.bodyState.dynamaxEnergy = Math.max(0, (context.player.bodyState.dynamaxEnergy || 0) - 1);
        context.addLog(`${context.player.nickname}发动极巨技能【${context.skillName(true)}】，消耗1点极巨能量`, context.player.id);
      } else {
        if (context.usage("turn", "link-used") > 0) throw new Error("本回合已发动魅影换手。");
        context.incrementUsage("turn", "link-used");
        context.logTrait();
        context.emitEvent("link_used", { sourcePlayerId: context.player.id });
      }
      if (extra || value === "draw") context.draw(1);
      if ((extra || value === "swap") && requestSwap(context, extra)) return true;
      finish(context, prompt.id);
      return true;
    }
    if (action === "link-field") {
      const ids = selectedCardIds(payload);
      const index = context.player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === ids[0]);
      if (ids.length !== 1 || index < 0 || !prompt.cardInstanceIds?.includes(ids[0])) throw new Error("请选择1张仍在场上的己方角色。");
      const card = context.player.characterSlots[index] as CardInstance;
      context.player.characterSlots[index] = null;
      card.faceDown = true;
      context.player.characterDeck.unshift(card);
      context.clearPrompt(prompt.id);
      context.addLog(`${context.player.nickname}将角色位${index + 1}的角色置于牌堆底换手（不视为休整）`, context.player.id, { zone: "characterSlot", ownerId: context.player.id, slotIndex: index });
      const cards: CardInstance[] = [];
      while (cards.length < (extra ? 3 : 1) && context.player.characterDeck.length) cards.push(context.player.characterDeck.pop()!);
      if (!extra) {
        if (cards[0]) context.deployCharacterAt!(cards[0], index);
        finish(context, prompt.id);
      } else {
        context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
          message: "选择1张暗置上阵，其余将在下一步排列至牌堆底。", min: 1, max: 1,
          selectableCards: cards, cardInstanceIds: cards.map((entry) => entry.instanceId),
          context: { action: "link-pick", extra: true, slotIndex: index } });
      }
      return true;
    }
    if (action === "link-pick") {
      const ids = selectedCardIds(payload);
      const cards = prompt.selectableCards || [];
      const selected = cards.find((card) => card.instanceId === ids[0]);
      if (ids.length !== 1 || !selected) throw new Error("请选择1张候选角色。");
      const remaining = cards.filter((card) => card !== selected);
      // Hold the chosen card until ordering finishes, so deployment triggers cannot interrupt the private selection.
      if (remaining.length > 1) {
        context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
          message: "排列其余角色，先选的更接近牌堆顶，最后选的位于最底。", min: remaining.length, max: remaining.length,
          cardInstanceIds: remaining.map((card) => card.instanceId), selectableCards: remaining,
          context: { action: "link-order", extra: true, slotIndex: prompt.context?.slotIndex, selected, orderSelection: true } });
      } else {
        context.player.characterDeck.unshift(...remaining.slice().reverse());
        context.clearPrompt(prompt.id);
        context.deployCharacterAt!(selected, Number(prompt.context?.slotIndex));
        finish(context, prompt.id);
      }
      return true;
    }
    if (action === "link-order") {
      const ids = selectedCardIds(payload);
      const cards = prompt.selectableCards || [];
      if (ids.length !== cards.length || new Set(ids).size !== cards.length || ids.some((id) => !cards.some((card) => card.instanceId === id))) throw new Error("请为所有剩余角色排序。");
      context.player.characterDeck.unshift(...ids.map((id) => cards.find((card) => card.instanceId === id)!).reverse());
      context.clearPrompt(prompt.id);
      context.deployCharacterAt!(prompt.context?.selected as CardInstance, Number(prompt.context?.slotIndex));
      finish(context, prompt.id);
      return true;
    }
    return false;
  },
};
