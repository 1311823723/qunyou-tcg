import handCardDefinitions from "../../data/cards/hand_cards.json" with { type: "json" };
import type { CardInstance } from "./types";
import type {
  AutoPlayerState,
  AutoPrompt,
  AutoRoomState,
  BattlePhase,
  HandResolutionItem,
  ResolutionItem,
} from "./auto-types";
import { extraStrikeAllowance } from "./skills/body-registry.mts";

export const AUTO_STATE_VERSION = 3;
export const PHASES: BattlePhase[] = ["preparation", "draw", "play", "deployment", "discard", "end"];

export const HAND_IDS = {
  strike: "hand_basic_001",
  dodge: "hand_basic_002",
  aid: "hand_basic_003",
  impersonate: "hand_basic_004",
  draw: "hand_trick_001",
  sabotage: "hand_trick_002",
  steal: "hand_trick_003",
  crisis: "hand_trick_004",
  inspire: "hand_trick_005",
  deploy: "hand_trick_006",
  inspect: "hand_trick_007",
  recall: "hand_trick_008",
  counter: "hand_trick_009",
  meeting: "hand_trick_010",
} as const;

const handById = new Map(handCardDefinitions.map((card) => [card.id, card]));

export function handLimit(player: AutoPlayerState, state?: AutoRoomState) {
  const revealed = player.characterSlots.filter((slot) => slot && "instanceId" in slot && slot.faceDown === false).length;
  const penalty = state?.turnModifiers
    .filter((modifier) => modifier.kind === "blood-hand-limit-down" && modifier.targetPlayerId === player.id)
    .reduce((total, modifier) => total + modifier.count, 0) || 0;
  return Math.max(0, Math.min(Math.max(0, player.health), 4) + Math.min(revealed, 2) - penalty);
}

export function opponentOf(state: AutoRoomState, playerId: string) {
  return state.players.find((player) => player.id !== playerId);
}

export function playerById(state: AutoRoomState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}

export function handName(definitionId: string) {
  return handById.get(definitionId)?.name || definitionId;
}

export function recycleHandDiscard(state: AutoRoomState, shuffle: <T>(items: T[]) => T[]) {
  if (state.handDeck.length || !state.handDiscard.length) return false;
  state.handDeck = shuffle(state.handDiscard.map((card) => ({ ...card, ownerId: undefined })));
  state.handDiscard = [];
  return true;
}

export function drawCards(
  state: AutoRoomState,
  player: AutoPlayerState,
  count: number,
  shuffle: <T>(items: T[]) => T[],
) {
  let drawn = 0;
  while (drawn < count) {
    if (!state.handDeck.length && !recycleHandDiscard(state, shuffle)) break;
    const card = state.handDeck.pop();
    if (!card) break;
    card.ownerId = player.id;
    player.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

export function deployTopCharacter(player: AutoPlayerState) {
  const slotIndex = player.characterSlots.findIndex((slot) => slot === null);
  if (slotIndex < 0 || !player.characterDeck.length) return undefined;
  const card = player.characterDeck.pop();
  if (!card) return undefined;
  card.ownerId = player.id;
  card.faceDown = true;
  player.characterSlots[slotIndex] = card;
  return { card, slotIndex };
}

export function createPrompt(input: Omit<AutoPrompt, "id">): AutoPrompt {
  return { id: crypto.randomUUID(), ...input };
}

export function validPlayDefinition(definitionId: string, resolvedAs?: string) {
  if (definitionId !== HAND_IDS.impersonate) return handById.has(definitionId);
  return [HAND_IDS.strike, HAND_IDS.dodge, HAND_IDS.aid].includes(resolvedAs as never);
}

export function isHandResolutionItem(item: ResolutionItem | undefined): item is HandResolutionItem {
  return Boolean(item && item.kind === "hand");
}

export function effectiveDefinition(item: HandResolutionItem) {
  return item.definitionId === HAND_IDS.impersonate ? item.resolvedAs || "" : item.definitionId;
}

export function isActionCard(definitionId: string) {
  return handById.get(definitionId)?.handType === "行动";
}

export function canUseInPlay(state: AutoRoomState, player: AutoPlayerState, definitionId: string, resolvedAs?: string) {
  if (!state.started || state.winnerId || state.prompt || state.stack.length) return false;
  if (state.currentPlayerId !== player.id || state.phase !== "play") return false;
  const effective = definitionId === HAND_IDS.impersonate ? resolvedAs : definitionId;
  if (effective === HAND_IDS.dodge) return false;
  if (effective === HAND_IDS.strike) {
    if (state.turnModifiers.some((modifier) => modifier.ownerId === player.id && modifier.kind === "mizai-strike-block")) return false;
    const used = state.usageCounters[`turn:${state.turnNumber}:${player.id}:strike`] || 0;
    const extra = state.turnModifiers
      .filter((modifier) => modifier.ownerId === player.id && modifier.kind === "extra-strike")
      .reduce((total, modifier) => total + modifier.count, 0);
    return used < 1 + extra + extraStrikeAllowance(player);
  }
  return effective !== HAND_IDS.counter && effective !== HAND_IDS.meeting && effective !== HAND_IDS.recall;
}

export function legalResponseCards(state: AutoRoomState, player: AutoPlayerState) {
  if (!state.stack.length || state.responsePlayerId !== player.id || state.prompt?.kind !== "response") return [];
  const top = state.stack[state.stack.length - 1];
  if (!isHandResolutionItem(top)) return [];
  const effective = effectiveDefinition(top);
  return player.hand.filter((card) => {
    if (card.definitionId === HAND_IDS.impersonate) return effective === HAND_IDS.strike && top.targetPlayerId === player.id && !top.cannotDodge;
    if (card.definitionId === HAND_IDS.dodge) return effective === HAND_IDS.strike && top.targetPlayerId === player.id && !top.cannotDodge;
    if (card.definitionId === HAND_IDS.counter) return isActionCard(top.definitionId);
    if (card.definitionId === HAND_IDS.meeting) {
      return top.sourcePlayerId !== player.id && (effective === HAND_IDS.strike || isActionCard(top.definitionId));
    }
    return false;
  });
}

export function beginResponseWindow(state: AutoRoomState, item: HandResolutionItem) {
  const opponent = opponentOf(state, item.sourcePlayerId);
  if (!opponent) return;
  state.responsePlayerId = opponent.id;
  state.consecutivePasses = 0;
  state.prompt = createPrompt({
    kind: "response",
    playerId: opponent.id,
    title: "响应窗口",
    message: effectiveDefinition(item) === HAND_IDS.strike && item.targetPlayerId === opponent.id
      ? "【出刀】正对你生效。你可以打出【闪避】、【紧急会议】或发动符合时机的角色技能。"
      : `对手使用了【${handName(effectiveDefinition(item))}】。你可以打出可用的响应牌或发动符合时机的角色技能。`,
    cardInstanceIds: legalResponseCards({ ...state, prompt: undefined } as AutoRoomState, opponent).map((card) => card.instanceId),
    options: [{ value: "pass", label: "放弃响应" }],
    context: { itemId: item.id, definitionId: effectiveDefinition(item), sourcePlayerId: item.sourcePlayerId },
  });
  state.prompt.cardInstanceIds = legalResponseCards(state, opponent).map((card) => card.instanceId);
}

export function passResponseWindow(state: AutoRoomState, playerId: string) {
  if (state.prompt?.kind !== "response" || state.responsePlayerId !== playerId) throw new Error("现在不由你响应。");
  const top = state.stack[state.stack.length - 1];
  if (!isHandResolutionItem(top)) throw new Error("当前没有可响应的牌。");
  const skillOnly = state.prompt.context?.skillOnly === true;
  state.prompt = undefined;
  state.responsePlayerId = undefined;
  state.consecutivePasses = 0;
  if (skillOnly) {
    beginResponseWindow(state, top);
    return "response" as const;
  }
  top.responseWindowClosed = true;
  return "resolve" as const;
}

export function moveResolvedCardToDiscard(state: AutoRoomState, card: CardInstance) {
  const index = state.resolving.findIndex((item) => item.instanceId === card.instanceId);
  if (index >= 0) state.resolving.splice(index, 1);
  card.ownerId = undefined;
  state.handDiscard.push(card);
}

export function damage(state: AutoRoomState, target: AutoPlayerState, amount: number, sourcePlayerId?: string) {
  const applied = Math.max(0, Math.trunc(amount));
  target.health -= applied;
  if (target.health <= 0) {
    const aidCards = target.hand.filter((card) => card.definitionId === HAND_IDS.aid || card.definitionId === HAND_IDS.impersonate);
    state.prompt = createPrompt({
      kind: "dying",
      playerId: target.id,
      title: "濒死",
      message: "使用【急救】将体力回复至1点或以上，或放弃并结束对局。",
      cardInstanceIds: aidCards.map((card) => card.instanceId),
      options: [{ value: "pass", label: "放弃急救" }],
      context: { sourcePlayerId },
    });
    state.responsePlayerId = undefined;
  }
  return applied;
}

export function heal(player: AutoPlayerState, amount: number) {
  const previous = player.health;
  player.health = Math.min(player.maxHealth, player.health + Math.max(0, Math.trunc(amount)));
  return player.health - previous;
}

export function advancePhase(
  state: AutoRoomState,
  player: AutoPlayerState,
  shuffle: <T>(items: T[]) => T[],
) {
  if (state.currentPlayerId !== player.id) throw new Error("只有当前回合玩家可以推进阶段。");
  if (state.prompt || state.stack.length) throw new Error("请先完成当前结算或响应。");
  if (state.winnerId) throw new Error("对局已经结束。");
  if (state.phase === "discard" && player.hand.length > handLimit(player, state)) {
    const excess = player.hand.length - handLimit(player, state);
    state.prompt = createPrompt({
      kind: "discard",
      playerId: player.id,
      title: "弃牌阶段",
      message: `请选择 ${excess} 张手牌弃置。`,
      min: excess,
      max: excess,
      cardInstanceIds: player.hand.map((card) => card.instanceId),
    });
    return state.phase;
  }

  const index = PHASES.indexOf(state.phase);
  if (state.phase === "end") {
    const opponent = opponentOf(state, player.id);
    if (!opponent) throw new Error("对手不存在。");
    state.currentPlayerId = opponent.id;
    state.turnNumber += 1;
    state.phase = "preparation";
    state.usageCounters = Object.fromEntries(
      Object.entries(state.usageCounters).filter(([key]) => key.startsWith("skill:game:") || key.startsWith("body:game:")),
    );
    state.turnModifiers = state.turnModifiers.filter((modifier) => ["aggro-return-character", "aggro-bomb"].includes(modifier.kind)
      || (modifier.kind === "body-next-skill-cost-rest-one"
        ? !modifier.expiresAtTurnNumber || modifier.expiresAtTurnNumber > state.turnNumber
        : Boolean(modifier.expiresAtTurnNumber && modifier.expiresAtTurnNumber > state.turnNumber)));
    state.deployedThisPhase = 0;
    return state.phase;
  }

  state.phase = PHASES[index + 1];
  if (state.phase === "draw") drawCards(state, player, 2, shuffle);
  if (state.phase === "deployment") state.deployedThisPhase = 0;
  return state.phase;
}
