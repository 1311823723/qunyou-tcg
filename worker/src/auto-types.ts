import type {
  BattleLog,
  BodyMarker,
  CardInstance,
  CustomDeckConfig,
  Marker,
  SocketAttachment,
} from "./types";

export type BattleMode = "classic" | "auto";
export type BattlePhase = "preparation" | "draw" | "play" | "deployment" | "discard" | "end";

export type AutoPromptKind =
  | "response"
  | "dying"
  | "discard"
  | "crisis-choice"
  | "reveal-choice"
  | "recall"
  | "assisted-skill"
  | "body-skill"
  | "character-skill"
  | "character-trigger"
  | "damage-before"
  | "marker-effect";

export interface AutoPrompt {
  id: string;
  kind: AutoPromptKind;
  playerId: string;
  title: string;
  message: string;
  min?: number;
  max?: number;
  cardInstanceIds?: string[];
  selectableCards?: CardInstance[];
  options?: Array<{ value: string; label: string }>;
  context?: Record<string, unknown>;
}

export interface HandResolutionItem {
  kind: "hand";
  id: string;
  sourcePlayerId: string;
  card: CardInstance;
  definitionId: string;
  resolvedAs?: string;
  targetPlayerId?: string;
  targetSlotIndex?: number;
  countersItemId?: string;
  cancelledByPlayerId?: string;
  cancellationReason?: "dodge" | "counter" | "meeting" | "skill";
  cancelled?: boolean;
  wasRespondedTo?: boolean;
  /** The responder has played a response, used a response skill, or passed. */
  responseWindowClosed?: boolean;
  damageDealt?: number;
  damagePending?: boolean;
  cannotDodge?: boolean;
  returnCharacterOnDamageInstanceId?: string;
  damageBonus?: number;
  bodyEffect?: "aggro-mega-strike";
  drawSourceOnDodge?: boolean;
  healSourceOnDamageAtLeast?: number;
  healSourceIfHealthNotHigher?: boolean;
  healSourceOnAnyDamage?: boolean;
  bloodAfterResolved?: boolean;
  banishOnResolve?: boolean;
  virtual?: boolean;
  restTargetSlotOnDamage?: number;
  requiredDodges?: number;
  dodgesPlayed?: number;
  desertButcherEnhanced?: boolean;
  huntRestOnDamage?: boolean;
  skillCompletion?: { activationId: string; sourcePlayerId: string; definitionId: string };
  riderCompletionPlayerId?: string;
}

export interface CharacterSkillResolutionItem {
  kind: "character-skill";
  id: string;
  sourcePlayerId: string;
  sourceInstanceId: string;
  definitionId: string;
  handlerId: string;
  activationId?: string;
  eventId?: string;
  triggerEvent?: AutoBattleEvent;
  resumeResponse?: boolean;
  responseStage?: "source" | "target";
  remainingResponseSkillInstanceIds?: string[];
  dyingPromptContext?: Record<string, unknown>;
  revealedFromFaceDown?: boolean;
  cancelledByRider?: boolean;
  riderCompletionPlayerId?: string;
}

export type ResolutionItem = HandResolutionItem | CharacterSkillResolutionItem;

export interface SkillContinuation {
  handlerId: string;
  activationId?: string;
  sourceDefinitionId: string;
  sourceInstanceId: string;
  step: string;
  eventId?: string;
  triggerEvent?: AutoBattleEvent;
  data?: Record<string, unknown>;
}

export type { AutoLegalAction } from "../../src/lib/auto-action-types";

export interface TurnModifier {
  id: string;
  ownerId: string;
  kind:
    | "next-skill-cost-rest-one"
    | "extra-strike"
    | "damage-shield"
    | "body-next-skill-cost-rest-one"
    | "combo-next-action-draw"
    | "combo-counter-action-draw"
    | "combo-next-other-skill-damage"
    | "combo-declare-hand-type"
    | "combo-direct-disrupt"
    | "aggro-sheriff-recoil"
    | "aggro-return-character"
    | "aggro-reveal-lock"
    | "aggro-bomb"
    | "aggro-next-strike-damage"
    | "aggro-copy-character-skill"
    | "mizai-strike-block"
    | "mizai-next-strike-undodgeable"
    | "mizai-prediction"
    | "blood-next-strike-dodge-draw"
    | "blood-strike-heal-strong"
    | "blood-next-strike-heal-conditional"
    | "blood-hand-limit-down"
    | "blood-stored-card"
    | "defense-protected-hand"
    | "defense-skill-lock"
    | "trans-next-skill-cost-down"
    | "trans-revived-character"
    | "extra-vine"
    | "extra-decoy"
    | "extra-hand-lock"
    | "extra-next-damage"
    | "extra-hunt-strike"
    | "extra-hunt-rest";
  count: number;
  characterInstanceId?: string;
  sourceDefinitionId?: string;
  targetCardInstanceId?: string;
  targetPlayerId?: string;
  targetCharacterInstanceId?: string;
  targetSlotIndex?: number;
  markerId?: string;
  storedFaceDown?: boolean;
  copiedDefinitionId?: string;
  declaredHandType?: "basic" | "action";
  predictedDamage?: boolean;
  expiresAtTurnNumber?: number;
}

export interface PendingJudgment {
  id: string;
  playerId: string;
  purpose: "blood-body" | "blood-prophet" | "defense-birdwatcher" | "generic";
  stage: "revealed" | "resolved";
  cardInstanceId: string;
  resumeResponsePlayerId?: string;
}

export interface PendingDamage {
  id: string;
  eventId: string;
  targetPlayerId: string;
  sourcePlayerId?: string;
  amount: number;
  cardDefinitionId?: string;
  continuation?: Record<string, unknown>;
}

export interface BodyRuntimeState {
  progress: number;
  progressMax: number;
  flipped: boolean;
  extraFormUsed: boolean;
  trackedCharacterInstanceIds: string[];
  dynamaxEnergy?: number;
  dynamaxHealth?: number;
  dynamaxEnding?: boolean;
  riderCards?: Record<MainRole, RiderCardState>;
  riderAcquiredEventIds?: Partial<Record<MainRole, string>>;
  linkHistory?: { turnNumber: number; roles: string[]; activations: Record<string, boolean> };
  ambushWindow?: {
    remaining: number;
    expiresAtTurnNumber: number;
  };
}

export type MainRole = "强攻" | "防御" | "资源" | "控制" | "支援" | "伏击";
export type RiderCardState = "absent" | "normal" | "final";

export type PendingBodyTriggerKind =
  | "link-swap"
  | "aggro-draw"
  | "aggro-mega-end-strike"
  | "mizai-inspection"
  | "combo-action"
  | "trans-deploy"
  | "dispatch-reveal"
  | "blood-judgment"
  | "ambush-refill"
  | "defense-reward"
  | "kgy-acquire"
  | "kgy-ambush";

export interface PendingBodyTrigger {
  id: string;
  kind: PendingBodyTriggerKind;
  playerId: string;
  eventId: string;
  context?: Record<string, string | number | boolean | string[] | undefined>;
}

export interface AutoBattleEvent {
  id: string;
  type: string;
  turnNumber: number;
  sourcePlayerId?: string;
  targetPlayerId?: string;
  cardDefinitionId?: string;
  characterDefinitionId?: string;
  amount?: number;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface AutoPlayerState {
  id: string;
  token: string;
  nickname: string;
  deckId?: string;
  customDeck?: CustomDeckConfig;
  ready: boolean;
  disconnectedAt?: number;
  health: number;
  maxHealth: number;
  body?: CardInstance;
  bodyState: BodyRuntimeState;
  hand: CardInstance[];
  characterDeck: CardInstance[];
  characterSlots: Array<CardInstance | Marker | null>;
  markers: BodyMarker[];
  retired: CardInstance[];
  banished: CardInstance[];
}

export interface AutoRoomState {
  stateVersion: number;
  mode: "auto";
  roomCode: string;
  createdAt: number;
  lastActivityAt: number;
  started: boolean;
  startedAt?: number;
  players: AutoPlayerState[];
  spectators: string[];
  handDeck: CardInstance[];
  handDiscard: CardInstance[];
  handBanished: CardInstance[];
  resolving: CardInstance[];
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  phase: BattlePhase;
  stack: ResolutionItem[];
  prompt?: AutoPrompt;
  responsePlayerId?: string;
  consecutivePasses: number;
  usageCounters: Record<string, number>;
  turnModifiers: TurnModifier[];
  deployedThisPhase: number;
  recentEvents: AutoBattleEvent[];
  pendingBodyTriggers: PendingBodyTrigger[];
  pendingJudgments: PendingJudgment[];
  pendingDamages: PendingDamage[];
  pendingInspection?: { prompt: AutoPrompt; eventId: string; ownerId: string; instanceId: string; slotIndex: number; prevented?: boolean };
  winnerId?: string;
  revision: number;
  logs: BattleLog[];
  processedActionIds: string[];
}

export type AutoSocketAttachment = SocketAttachment;

export interface AutoClientMessage {
  type: string;
  actionId: string;
  protocolVersion?: number;
  baseRevision?: number;
  payload?: Record<string, unknown>;
}
