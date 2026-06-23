export type CatalogCard = {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  imagePath?: string;
  highResImagePath?: string;
  extraImagePath?: string;
  extraHighResImagePath?: string;
  portraitPath?: string;
  extraPortraitPath?: string;
  extraName?: string;
  extraSubtitle?: string;
  extraText?: string;
  extraFormType?: string;
  extraFormLabel?: string;
  extraConditionLabel?: string;
  megaMax?: number;
  megaCondition?: string;
  timing?: string;
  costText?: string;
  mainRole?: string;
  tags?: string[];
  skillName?: string;
  archetype?: string;
  hp?: number;
};

export type CatalogDeck = {
  id: string;
  name: string;
  archetype: string;
  bodyId: string;
  theme: string;
  blurb: string;
  characterIds: string[];
  roleDistribution: Record<string, number>;
  tagDistribution: Record<string, number>;
};

export type CustomDeckConfig = {
  bodyId: string;
  characterIds: string[];
};

export type Catalog = {
  cards: Record<string, CatalogCard>;
  decks: CatalogDeck[];
};

export type CardView = {
  instanceId?: string;
  definitionId?: string;
  ownerId?: string;
  faceDown?: boolean;
  revealed?: boolean;
  suit?: string;
  rank?: string;
  slotIndex?: number;
};

export type MarkerView = { id: string; label: string; ownerId: string };

export type PlayerView = {
  id: string;
  nickname: string;
  deckId?: string;
  customDeck?: CustomDeckConfig;
  ready: boolean;
  connected: boolean;
  health?: number;
  megaProgress?: number;
  bodyFlipped?: boolean;
  body?: CardView;
  hand: CardView[];
  handCount?: number;
  characterDeckCount: number;
  characterSlots: Array<CardView | MarkerView | null>;
  retired: CardView[];
  banished: CardView[];
};

export type BattleLog = {
  id: string;
  text: string;
  at: number;
  actorId?: string;
  kind?: "action" | "inspection" | "system";
  target?: {
    zone: string;
    ownerId?: string;
    slotIndex?: number;
  };
};

export type GameView = {
  started: boolean;
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  handDeckCount: number;
  handDiscard: CardView[];
  resolving: CardView[];
  logs: BattleLog[];
};

export type Snapshot = {
  roomCode: string;
  you: string;
  revision: number;
  pendingRestart?: {
    id: string;
    requestedBy: string;
    expiresAt: number;
  };
  players: PlayerView[];
  game: GameView;
};

export type InspectionAction = "handDeckTop" | "handDeckBottom" | "handDiscard" | "hand";

export type AnimationMode = "on" | "off";

export type VisualEffectEvent = {
  type: "visualEffect";
  eventId: string;
  revision: number;
  effect: "turnStart" | "characterFlip" | "characterSkill" | "bodyMega";
  actorId?: string;
  ownerId: string;
  definitionId?: string;
  slotIndex?: number;
  faceDown?: boolean;
};

export type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "actionAck"; actionId: string; revision: number; duplicate?: boolean }
  | { type: "error"; error: string; actionId?: string; revision?: number; category?: string }
  | {
      type: "inspection";
      inspectionId: string;
      viewerId: string;
      title: string;
      cards: CardView[];
      allowedActions: InspectionAction[];
    }
  | VisualEffectEvent
  | { type: "roomEnded" };

export type PreservedUI = {
  scrollLeft: Record<string, number>;
  logOpen: boolean;
  logFilter: "all" | "mine" | "opponent" | "inspection";
  activeRegion: string;
  rootScrollTop: number;
};
