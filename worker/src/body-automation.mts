import type { AutoBattleEvent, AutoPlayerState, PendingBodyTriggerKind } from "./auto-types";
import { BODY_IDS } from "./skills/body-ids.mts";

export { BODY_IDS } from "./skills/body-ids.mts";

export function bodyId(player: AutoPlayerState) {
  return player.body?.definitionId || "";
}

export function bodyUsageKey(scope: "turn" | "game", turnNumber: number, playerId: string, suffix: string) {
  return `body:${scope}:${scope === "turn" ? `${turnNumber}:` : ""}${playerId}:${suffix}`;
}

// Compatibility path for body skills that have not moved into the skill registry yet.
export function bodyProgressDelta(player: AutoPlayerState, event: AutoBattleEvent) {
  const id = bodyId(player);
  if (id === BODY_IDS.trans && event.type === "skill_used" && event.sourcePlayerId === player.id && event.metadata?.virtualCard === true) return 1;
  if (id === BODY_IDS.dispatch && event.type === "character_revealed") return 1;
  if (id === BODY_IDS.blood && event.type === "judgment_resolved" && event.sourcePlayerId === player.id && event.metadata?.bodySkill === true) return 1;
  if (id === BODY_IDS.ambush && event.type === "skill_used" && event.sourcePlayerId === player.id && event.metadata?.mainRole === "伏击") return 1;
  if (id === BODY_IDS.defense) {
    if (event.type === "strike_dodged" && event.sourcePlayerId === player.id) return 1;
    if (event.type === "damage_prevented" && event.sourcePlayerId === player.id && event.targetPlayerId === player.id) return 1;
  }
  return 0;
}

export function triggerKindForBody(player: AutoPlayerState, event: AutoBattleEvent): PendingBodyTriggerKind | undefined {
  const id = bodyId(player);
  if (id === BODY_IDS.trans && event.type === "skill_used" && event.sourcePlayerId === player.id && event.metadata?.virtualCard === true) return "trans-deploy";
  if (id === BODY_IDS.dispatch && event.type === "character_revealed") return "dispatch-reveal";
  if (id === BODY_IDS.blood && event.type === "damage_after" && event.targetPlayerId === player.id && Number(event.amount || 0) > 0) return "blood-judgment";
  if (id === BODY_IDS.ambush && event.type === "skill_used" && event.sourcePlayerId === player.id
    && event.metadata?.mainRole === "伏击" && event.metadata?.leftFieldForCost === true) return "ambush-refill";
  if (id === BODY_IDS.defense && ((event.type === "strike_dodged" && event.sourcePlayerId === player.id)
    || (event.type === "damage_prevented" && event.sourcePlayerId === player.id && event.targetPlayerId === player.id))) return "defense-reward";
  return undefined;
}
