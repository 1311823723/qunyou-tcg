import type { AutoPlayerState } from "../auto-types";
import { aggroBodySkill } from "./bodies/aggro.mts";
import { ambushBodySkill } from "./bodies/ambush.mts";
import { bloodBodySkill } from "./bodies/blood.mts";
import { comboBodySkill } from "./bodies/combo.mts";
import { defenseBodySkill } from "./bodies/defense.mts";
import { dispatchBodySkill } from "./bodies/dispatch.mts";
import { mizaiBodySkill } from "./bodies/mizai.mts";
import { transBodySkill } from "./bodies/trans.mts";
import type { BodySkillModule } from "./body-skill.mts";

const modules = [
  aggroBodySkill,
  mizaiBodySkill,
  comboBodySkill,
  transBodySkill,
  dispatchBodySkill,
  bloodBodySkill,
  ambushBodySkill,
  defenseBodySkill,
] satisfies BodySkillModule[];
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
