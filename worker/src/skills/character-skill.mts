import type {
  AutoBattleEvent,
  AutoPlayerState,
  AutoPrompt,
  AutoRoomState,
  SkillContinuation,
  TurnModifier,
} from "../auto-types";
import type { BattleLogTarget, CardInstance } from "../types";

export type CharacterTriggerRelation = "any" | "source_self" | "source_opponent" | "target_self" | "target_opponent";

export interface CharacterSkillRuntimeContext {
  readonly state: AutoRoomState;
  readonly player: AutoPlayerState;
  readonly role: CardInstance;
  readonly event?: AutoBattleEvent;
  readonly continuation?: SkillContinuation;
  opponent(): AutoPlayerState | undefined;
  setPrompt(step: string, prompt: Omit<AutoPrompt, "id" | "kind" | "playerId" | "context">, data?: Record<string, unknown>, decisionPlayerId?: string): void;
  clearPrompt(promptId: string): void;
  draw(count: number): number;
  drawOpponent(count: number): number;
  discardOwnHand(instanceIds: string[]): CardInstance[];
  discardOpponentHand(instanceIds: string[]): CardInstance[];
  discardRandomOpponent(count: number): CardInstance[];
  gainRandomOpponentHand(): CardInstance | undefined;
  canUseBasic(definitionId: string): boolean;
  randomOpponentHand(): CardInstance | undefined;
  takeTopHandCards(count: number): CardInstance[];
  putHandDeckTop(cards: CardInstance[]): void;
  putHandDeckBottom(cards: CardInstance[]): void;
  gainFromHandDiscard(instanceIds: string[]): CardInstance[];
  shuffleFromHandDiscard(instanceIds: string[]): CardInstance[];
  addModifier(modifier: Omit<TurnModifier, "id" | "ownerId">): void;
  counterCurrentHand(): boolean;
  banishCurrentHand(): boolean;
  damageOpponent(amount: number, options?: { after?: "return-self-if-target-health-at-most-3" }): number | undefined;
  loseHealth(amount: number, reason?: string): number;
  loseOpponentHealth(amount: number, reason?: string): number;
  heal(amount: number): number;
  startJudgment(purpose?: "blood-prophet" | "defense-birdwatcher" | "generic"): void;
  currentJudgmentCard(): CardInstance | undefined;
  replaceCurrentJudgment(instanceId: string): CardInstance;
  drawJudgmentCandidate(): CardInstance | undefined;
  chooseJudgmentCandidate(instanceId: string): void;
  useVirtualStrike(instanceId: string, options?: { damage?: number; restTargetSlotOnDamage?: number }): void;
  useVirtualBasic(definitionId: string, options?: { damage?: number; restTargetSlotOnDamage?: number }): void;
  deployTopCharacters(count?: number): CardInstance[];
  reviveOwnRetired(instanceId: string): CardInstance;
  gainOpponentHand(instanceId: string): CardInstance;
  storeOpponentHandCard(instanceId: string, label: string): void;
  restOwnCharacter(slotIndex: number): void;
  protectOwnHandCard(instanceId: string): void;
  lockOpponentCharacterSkill(slotIndex: number): void;
  restorePreventedCharacter(): CardInstance | undefined;
  markerCount(label: string): number;
  addCounterMarker(label: string, amount?: number): number;
  removeCounterMarker(label: string, amount?: number): number;
  copyActionEffect(definitionId: string, targetSlotIndex?: number): boolean;
  restOpponentCharacter(slotIndex: number): void;
  revealOpponentCharacter(slotIndex: number): CardInstance;
  banishOpponentCharacterUntilNextPreparation(slotIndex: number): CardInstance;
  lockOpponentCharacterReveal(slotIndex: number): void;
  placeOpponentBomb(slotIndex: number): void;
  shuffleSelfFromRetired(): boolean;
  shuffleOwnRetired(instanceId: string): boolean;
  banishOpponentRetired(instanceId: string): boolean;
  makeCurrentStrikeUndodgeable(returnSelfOnDamage?: boolean): boolean;
  boostNextStrikeDamage(amount?: number): void;
  useOpponentBasic(instanceId: string, definitionId: string): void;
  copyOpponentCharacterSkill(slotIndex: number): void;
  dodgeCurrentStrike(): boolean;
  isActionCard(definitionId: string): boolean;
  handName(definitionId: string): string;
  handLabel(card: CardInstance, effectiveDefinitionId?: string): string;
  currentStrikeCanBeDodged(): boolean;
  addLog(message: string, actorId?: string, target?: BattleLogTarget): void;
  emitEvent(type: string, details?: Omit<AutoBattleEvent, "id" | "type" | "turnNumber">): void;
}

export interface CharacterSkillModule {
  readonly cardId: string;
  readonly trigger: {
    event: string;
    relation: CharacterTriggerRelation;
  };
  readonly usageLimit?: { scope: "turn" | "game"; count: number };
  canActivate?(context: CharacterSkillRuntimeContext): boolean;
  activate(context: CharacterSkillRuntimeContext): void;
  resolveChoice?(
    context: CharacterSkillRuntimeContext,
    prompt: AutoPrompt,
    payload: Record<string, unknown>,
  ): boolean;
}

export function immediateCharacterSkill(input: {
  cardId: string;
  trigger: CharacterSkillModule["trigger"];
  usageLimit?: CharacterSkillModule["usageLimit"];
  canActivate?: CharacterSkillModule["canActivate"];
  effect(context: CharacterSkillRuntimeContext): void;
}): CharacterSkillModule {
  return {
    cardId: input.cardId,
    trigger: input.trigger,
    ...(input.usageLimit ? { usageLimit: input.usageLimit } : {}),
    ...(input.canActivate ? { canActivate: input.canActivate } : {}),
    activate: input.effect,
  };
}

export function selectedCardIds(payload: Record<string, unknown>) {
  return Array.isArray(payload.cardInstanceIds)
    ? payload.cardInstanceIds.map((id) => String(id || "").trim().slice(0, 80))
    : [];
}

export function choiceValue(payload: Record<string, unknown>, max = 600) {
  return String(payload.value || "").trim().slice(0, max);
}
