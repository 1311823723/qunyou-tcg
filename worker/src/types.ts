export type ZoneName =
  | "hand"
  | "characterDeck"
  | "retired"
  | "banished"
  | "body"
  | "handDeck"
  | "handDiscard"
  | "resolving"
  | "characterSlot";

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  kind: "body" | "character" | "hand";
  ownerId?: string;
  faceDown?: boolean;
  suit?: string;
  rank?: string;
}

export interface Marker {
  id: string;
  label: string;
  ownerId: string;
  card?: CardInstance;
}

export type BattleLogKind = "action" | "inspection" | "system";

export interface BattleLogTarget {
  zone: string;
  ownerId?: string;
  slotIndex?: number;
}

export interface BattleLog {
  id: string;
  text: string;
  at: number;
  actorId?: string;
  kind?: BattleLogKind;
  target?: BattleLogTarget;
}

export interface PlayerState {
  id: string;
  token: string;
  nickname: string;
  deckId?: string;
  ready: boolean;
  health: number;
  megaProgress: number;
  bodyFlipped: boolean;
  body?: CardInstance;
  hand: CardInstance[];
  characterDeck: CardInstance[];
  characterSlots: Array<CardInstance | Marker | null>;
  retired: CardInstance[];
  banished: CardInstance[];
}

export interface RoomState {
  stateVersion: number;
  roomCode: string;
  createdAt: number;
  lastActivityAt: number;
  started: boolean;
  players: PlayerState[];
  handDeck: CardInstance[];
  handDiscard: CardInstance[];
  resolving: CardInstance[];
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  revision: number;
  logs: BattleLog[];
  processedActionIds: string[];
  inspections: InspectionGrant[];
  pendingRestart?: PendingRestart;
}

export interface SocketAttachment {
  playerId: string;
}

export interface ClientMessage {
  type: string;
  actionId: string;
  protocolVersion?: number;
  baseRevision?: number;
  payload?: Record<string, unknown>;
}

export type InspectionAction = "handDeckTop" | "handDeckBottom" | "handDiscard" | "hand";

export interface InspectionGrant {
  id: string;
  viewerId: string;
  cardInstanceIds: string[];
  allowedActions: InspectionAction[];
  expiresAt: number;
}

export interface PendingRestart {
  id: string;
  requestedBy: string;
  expiresAt: number;
}

export interface InspectionResult {
  inspectionId: string;
  viewerId: string;
  title: string;
  cards: Array<Record<string, unknown>>;
  allowedActions: InspectionAction[];
  audience?: "actor" | "all";
}
