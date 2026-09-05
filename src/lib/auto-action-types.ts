/** Observer-safe interaction descriptions. These describe, never authorize, a command. */
export type AutoActionPayload = Record<string, string | number | boolean | string[]>;
export interface AutoLegalAction {
  type: string;
  payload?: AutoActionPayload;
  selection?: { kind: "cards" | "skill-cost" | "order"; cardInstanceIds: string[]; min: number; max: number };
  interaction?: {
    label?: string;
    quickPlay?: boolean;
    target?: { playerId: string; slotIndex?: number };
    cost?: { kind: "rest" | "retire" | "none" | "choice"; amount?: number; fixedIds?: string[]; options?: Array<{ label: string; payload: AutoActionPayload }> };
  };
}
export type AutoUnavailableReasons = Record<string, string>;
