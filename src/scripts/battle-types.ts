export type CatalogCard = {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  imagePath?: string;
  extraImagePath?: string;
  extraName?: string;
  extraSubtitle?: string;
  extraText?: string;
  megaMax?: number;
};

export type CatalogDeck = {
  id: string;
  name: string;
  archetype: string;
  bodyId: string;
  theme: string;
  blurb: string;
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
  ready: boolean;
  connected: boolean;
  health?: number;
  megaProgress?: number;
  bodyFlipped?: boolean;
  body?: CardView;
  hand: CardView[];
  handCount?: number;
  characterHand: CardView[];
  characterHandCount?: number;
  characterDeckCount: number;
  characterSlots: Array<CardView | MarkerView | null>;
  retired: CardView[];
  banished: CardView[];
};

export type GameView = {
  started: boolean;
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  handDeckCount: number;
  handDiscard: CardView[];
  resolving: CardView[];
  logs: Array<{ id: string; text: string; at: number }>;
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

export type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "error"; error: string }
  | {
      type: "inspection";
      inspectionId: string;
      viewerId: string;
      title: string;
      cards: CardView[];
      allowedActions: InspectionAction[];
    }
  | { type: "roomEnded" };

export type PreservedUI = {
  scrollLeft: Record<string, number>;
  logOpen: boolean;
};
