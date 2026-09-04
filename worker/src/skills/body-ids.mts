import type { AutoPlayerState } from "../auto-types";

export const BODY_IDS = {
  link: "body_link_001",
  aggro: "body_aggro_001",
  mizai: "body_mizai_001",
  combo: "body_combo_001",
  trans: "body_trans_001",
  dispatch: "body_dispatch_001",
  blood: "body_blood_001",
  ambush: "body_ambush_001",
  defense: "body_defense_001",
} as const;

export function bodyId(player: AutoPlayerState) {
  return player.body?.definitionId || "";
}

export function bodyUsageKey(scope: "turn" | "game", turnNumber: number, playerId: string, suffix: string) {
  return `body:${scope}:${scope === "turn" ? `${turnNumber}:` : ""}${playerId}:${suffix}`;
}
