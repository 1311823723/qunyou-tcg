import type { CardInstance } from "../../types";
import type { BodySkillModule, BodySkillRuntimeContext } from "../body-skill.mts";
import { choiceValue, selectedCardIds } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

function permutations<T>(items: T[]): T[][] {
  return items.length <= 1
    ? [items]
    : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function openSortPrompt(context: BodySkillRuntimeContext, revealedByOpponent: boolean) {
  const cards: CardInstance[] = [];
  while (cards.length < 3 && context.player.characterDeck.length) {
    const card = context.player.characterDeck.pop();
    if (card) cards.push(card);
  }
  if (!cards.length) return false;
  const options: Array<{ value: string; label: string }> = [{ value: "pass", label: "不发动（原顺序放回）" }];
  const indexes = cards.map((_, index) => index);
  for (const order of permutations(indexes)) options.push({
    value: `b:-1|o:${order.join(",")}`,
    label: `牌堆顶顺序：${order.map((index) => context.characterName(cards[index].definitionId)).join(" → ")}`,
  });
  if (cards.length > 1) for (const bottom of indexes) {
    const rest = indexes.filter((index) => index !== bottom);
    for (const order of permutations(rest)) options.push({
      value: `b:${bottom}|o:${order.join(",")}`,
      label: `${context.characterName(cards[bottom].definitionId)}置底；顶部：${order.map((index) => context.characterName(cards[index].definitionId)).join(" → ")}`,
    });
  }
  context.setPrompt({
    kind: "body-skill", playerId: context.player.id, title: context.skillName(),
    message: "观看角色牌堆顶3张，可将至多1张置底，并选择其余牌的顶部顺序。",
    selectableCards: cards, options,
    context: { action: "dispatch-sort", cardIds: cards.map((card) => card.instanceId), revealedByOpponent },
  });
  return true;
}

export const dispatchBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.dispatch,

  progressDelta(_player, event) { return event.type === "character_revealed" ? 1 : 0; },

  collectTrigger(_context, event) {
    return event.type === "character_revealed" ? { kind: "dispatch-reveal" } : undefined;
  },

  canActivateExtra() { return true; },

  activateExtra(context) {
    const roles = context.player.characterSlots.flatMap((slot) => slot && "instanceId" in slot ? [slot] : []);
    const min = context.player.characterSlots.includes(null) ? 0 : 1;
    context.setPrompt({
      kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
      message: `选择要洗回角色牌堆的角色（${min ? "至少1张" : "可不选"}）。`,
      min, max: roles.length, cardInstanceIds: roles.map((card) => card.instanceId), selectableCards: roles,
      context: { action: "dispatch-z-select" },
    });
  },

  openPrompt(context, trigger) {
    if (trigger.kind !== "dispatch-reveal" || context.usage("turn", "dispatch") >= 1 || !context.player.characterDeck.length) return false;
    return openSortPrompt(context, trigger.context?.sourcePlayerId !== context.player.id);
  },

  resolveChoice(context, prompt, payload) {
    const action = String(prompt.context?.action || "");
    const value = choiceValue(payload);
    const selectedIds = selectedCardIds(payload);
    if (action === "dispatch-sort") {
      const cards = prompt.selectableCards || [];
      let bottom = -1;
      let order = cards.map((_, index) => index);
      if (value !== "pass") {
        const match = value.match(/^b:(-?\d+)\|o:([\d,]*)$/);
        if (!match) throw new Error("牌堆顺序选择无效。");
        bottom = Number(match[1]);
        order = match[2] ? match[2].split(",").map(Number) : [];
        const expected = cards.map((_, index) => index).filter((index) => index !== bottom).sort();
        if (JSON.stringify([...order].sort()) !== JSON.stringify(expected)) throw new Error("牌堆顺序不完整。");
      }
      if (bottom >= 0) context.player.characterDeck.unshift(cards[bottom]);
      for (const index of [...order].reverse()) context.player.characterDeck.push(cards[index]);
      context.clearPrompt(prompt.id);
      if (value === "pass") return true;
      context.incrementUsage("turn", "dispatch");
      if (prompt.context?.revealedByOpponent === true) {
        context.draw(1);
        if (context.player.hand.length) context.setPrompt({
          kind: "body-skill", playerId: context.player.id, title: context.skillName(), message: "对手角色明置：请弃置1张手牌。",
          min: 1, max: 1, cardInstanceIds: context.player.hand.map((card) => card.instanceId), selectableCards: context.player.hand,
          context: { action: "dispatch-discard" },
        });
      }
      return true;
    }
    if (action === "dispatch-discard") {
      if (selectedIds.length !== 1 || !prompt.cardInstanceIds?.includes(selectedIds[0])) throw new Error("请选择1张手牌弃置。");
      if (!context.discardHandCard(context.player, selectedIds[0])) throw new Error("手牌已变化。");
      context.clearPrompt(prompt.id);
      return true;
    }
    if (action === "dispatch-z-select") {
      if (selectedIds.length < Number(prompt.min || 0) || selectedIds.length > Number(prompt.max || 0)
        || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !prompt.cardInstanceIds?.includes(id))) {
        throw new Error("换阵角色选择无效。");
      }
      const returning: CardInstance[] = [];
      for (let index = 0; index < context.player.characterSlots.length; index += 1) {
        const slot = context.player.characterSlots[index];
        if (slot && "instanceId" in slot && selectedIds.includes(slot.instanceId)) {
          context.player.characterSlots[index] = null;
          slot.faceDown = undefined;
          returning.push(slot);
        }
      }
      context.player.characterDeck = context.shuffle([...context.player.characterDeck, ...returning]);
      const deployed: CardInstance[] = [];
      for (let count = 0; count < selectedIds.length + 1; count += 1) {
        const result = context.deployTopCharacter();
        if (!result) break;
        deployed.push(result.card);
      }
      context.setPrompt({
        kind: "body-skill", playerId: context.player.id, title: context.skillName(true),
        message: "可立即明置以此法上阵的1张角色，使其下一次【休整X】费用-1。",
        min: 0, max: 1, cardInstanceIds: deployed.map((card) => card.instanceId), selectableCards: deployed,
        options: [{ value: "none", label: "不立即明置" }], context: { action: "dispatch-z-reveal" },
      });
      return true;
    }
    if (action !== "dispatch-z-reveal") return false;
    if (selectedIds.length > 1 || (selectedIds[0] && !prompt.cardInstanceIds?.includes(selectedIds[0]))) throw new Error("至多选择1张换阵角色。");
    if (selectedIds[0]) {
      const role = context.player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === selectedIds[0]);
      if (!role || !("instanceId" in role)) throw new Error("换阵角色已不在场。");
      role.faceDown = false;
      context.emitEvent("character_revealed", {
        sourcePlayerId: context.player.id, targetPlayerId: context.player.id, characterDefinitionId: role.definitionId,
      });
      context.addLog(`${context.player.nickname}因Z招式立即明置了【${context.characterName(role.definitionId)}】`, context.player.id, {
        zone: "characterSlot", ownerId: context.player.id,
      });
      context.state.turnModifiers.push({
        id: crypto.randomUUID(), ownerId: context.player.id, kind: "body-next-skill-cost-rest-one", count: 1,
        characterInstanceId: role.instanceId,
      });
    }
    context.clearPrompt(prompt.id);
    return true;
  },
};
