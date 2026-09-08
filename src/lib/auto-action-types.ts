/** Observer-safe interaction descriptions. These describe, never authorize, a command. */
export type AutoActionPayload = Record<string, string | number | boolean | string[]>;
export interface AutoLegalAction {
  type: string;
  payload?: AutoActionPayload;
  selection?: { kind: "cards" | "skill-cost" | "order"; cardInstanceIds: string[]; min: number; max: number };
  interaction?: {
    label?: string;
    effectText?: string;
    costModifiers?: string[];
    targetTiming?: "resolution";
    quickPlay?: boolean;
    target?: { playerId: string; slotIndex?: number };
    cost?: { kind: "rest" | "retire" | "none" | "choice"; amount?: number; fixedIds?: string[]; options?: Array<{ label: string; payload: AutoActionPayload }> };
  };
}
export type AutoUnavailableReasons = Record<string, string>;

/** Viewer-safe, display-only explanations. Never include instance IDs or hidden names. */
export interface AutoBlocker {
  code: "timing" | "usage" | "cost" | "reveal" | "locked" | "target" | "condition";
  message: string;
}
export interface AutoEventCause {
  kind: "skill" | "skill-cost" | "rest-reward" | "card" | "effect";
  sourcePlayerId?: string;
}
export interface AutoPublicEvent {
  id: string; type: string; sourcePlayerId?: string; targetPlayerId?: string;
  amount?: number; cause?: AutoEventCause;
  characterDefinitionId?: string; cardDefinitionId?: string;
}
