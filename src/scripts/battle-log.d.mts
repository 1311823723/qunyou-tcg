import type { BattleLog } from "./battle-types";

export const BATTLE_LOG_FILTERS: readonly string[];

export function filterBattleLogs(
  logs: BattleLog[],
  filter: "all" | "mine" | "opponent" | "inspection",
  viewerId: string,
): BattleLog[];

export function battleLogTargetKey(
  target: BattleLog["target"],
  viewerId: string,
): string | undefined;

export function battleLogRegionId(
  target: BattleLog["target"],
  viewerId: string,
): string | undefined;

export function formatBattleLog(log: BattleLog): {
  badge: string;
  tone: string;
  text: string;
  detail?: string;
};
