import type { AutoPlayerState } from "../auto-types";
import { aggroBodySkill } from "./bodies/aggro.mts";
import { comboBodySkill } from "./bodies/combo.mts";
import { mizaiBodySkill } from "./bodies/mizai.mts";
import type { BodySkillModule } from "./body-skill.mts";

const modules = [aggroBodySkill, mizaiBodySkill, comboBodySkill] satisfies BodySkillModule[];
const registry = new Map(modules.map((module) => [module.bodyId, module]));

export function bodySkillForId(bodyId: string) {
  return registry.get(bodyId);
}

export function extraStrikeAllowance(player: AutoPlayerState) {
  return bodySkillForId(player.body?.definitionId || "")?.extraStrikeAllowance?.(player) || 0;
}

export function registeredBodySkillIds() {
  return [...registry.keys()];
}
