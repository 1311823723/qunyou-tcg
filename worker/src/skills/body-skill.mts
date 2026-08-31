import type {
  AutoBattleEvent,
  AutoPlayerState,
  AutoPrompt,
  AutoRoomState,
  PendingBodyTrigger,
  PendingBodyTriggerKind,
} from "../auto-types";
import type { BattleLogTarget, CardInstance } from "../types";

export interface BodyTriggerSpec {
  kind: PendingBodyTriggerKind;
  context?: PendingBodyTrigger["context"];
}

export interface BodySkillRuntimeContext {
  readonly state: AutoRoomState;
  readonly player: AutoPlayerState;
  opponent(): AutoPlayerState | undefined;
  skillName(extraForm?: boolean): string;
  usage(scope: "turn" | "game", suffix: string): number;
  incrementUsage(scope: "turn" | "game", suffix: string, amount?: number): number;
  enqueueTrigger(kind: PendingBodyTriggerKind, eventId: string, context?: PendingBodyTrigger["context"]): void;
  setPrompt(prompt: Omit<AutoPrompt, "id">): void;
  clearPrompt(promptId: string): void;
  draw(count: number): number;
  takeTopHandCards(count: number): CardInstance[];
  discardHandCard(owner: AutoPlayerState, instanceId: string): CardInstance | undefined;
  gainHandCard(card: CardInstance): void;
  discardLooseCard(card: CardInstance): void;
  handName(definitionId: string): string;
  characterName(definitionId: string): string;
  logTrait(): void;
  addLog(message: string, actorId?: string, target?: BattleLogTarget): void;
  emitEvent(type: string, details?: Omit<AutoBattleEvent, "id" | "type" | "turnNumber">): void;
  shuffle<T>(items: T[]): T[];
  deployTopCharacter(): { card: CardInstance; slotIndex: number } | undefined;
  restOwnCharacter(instanceId: string): boolean;
  startJudgment(purpose: "blood-body"): void;
  discardRandom(owner: AutoPlayerState): CardInstance | undefined;
  heal(count: number): number;
  legalStrikeCards(): CardInstance[];
  startBodyStrike(targetPlayerId: string, cardInstanceId: string): void;
}

export interface BodySkillModule {
  readonly bodyId: string;
  progressDelta(player: AutoPlayerState, event: AutoBattleEvent): number;
  collectTrigger(context: BodySkillRuntimeContext, event: AutoBattleEvent): BodyTriggerSpec | undefined;
  extraStrikeAllowance?(player: AutoPlayerState): number;
  onPhaseEntered?(context: BodySkillRuntimeContext, phase: AutoRoomState["phase"], previousPlayer: AutoPlayerState): void;
  canActivateExtra?(context: BodySkillRuntimeContext): boolean;
  activateExtra?(context: BodySkillRuntimeContext): void;
  resolveJudgment?(context: BodySkillRuntimeContext, card: CardInstance, color: "红色" | "黑色"): boolean;
  preventDamage?(context: BodySkillRuntimeContext, amount: number): boolean;
  openPrompt(context: BodySkillRuntimeContext, trigger: PendingBodyTrigger): boolean;
  resolveChoice(
    context: BodySkillRuntimeContext,
    prompt: NonNullable<AutoRoomState["prompt"]>,
    payload: Record<string, unknown>,
  ): boolean;
}

export function selectedCardIds(payload: Record<string, unknown>) {
  return Array.isArray(payload.cardInstanceIds)
    ? payload.cardInstanceIds.map((id) => String(id || "").trim().slice(0, 80))
    : [];
}

export function choiceValue(payload: Record<string, unknown>, max = 400) {
  return String(payload.value || "").trim().slice(0, max);
}

export function bodyTraitLogText(nickname: string, skillName: string, mega = false) {
  return `${nickname}的${mega ? "Mega 特性" : "特性"}【${skillName}】触发`;
}
