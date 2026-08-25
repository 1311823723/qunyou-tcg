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
  | "assisted-skill";

export interface AutoPrompt {
  id: string;
  kind: AutoPromptKind;
  playerId: string;
  title: string;
  message: string;
  min?: number;
  max?: number;
  cardInstanceIds?: string[];
  options?: Array<{ value: string; label: string }>;
  context?: Record<string, unknown>;
}

export interface ResolutionItem {
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
}

export interface TurnModifier {
  id: string;
  ownerId: string;
  kind: "next-skill-cost-rest-one" | "extra-strike" | "damage-shield";
  count: number;
  expiresAtTurnNumber?: number;
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
