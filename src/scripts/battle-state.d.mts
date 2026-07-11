import type { PlayerView, Snapshot } from "./battle-types";

export function defaultHandLimit(player: Pick<PlayerView, "health" | "characterSlots">): number;
export function normalizeBattleSnapshot(snapshot: Snapshot): Snapshot;
