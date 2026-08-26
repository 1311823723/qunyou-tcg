import { aggroCharacterSkills } from "./characters/aggro.mts";
import { comboCharacterSkills } from "./characters/combo.mts";
import { bloodCharacterSkills } from "./characters/blood.mts";
import { defenseCharacterSkills } from "./characters/defense.mts";
import { ambushCharacterSkills } from "./characters/ambush.mts";
import { dispatchCharacterSkills } from "./characters/dispatch.mts";
import { mizaiCharacterSkills } from "./characters/mizai.mts";
import type { CharacterSkillModule } from "./character-skill.mts";

const modules = [...comboCharacterSkills, ...aggroCharacterSkills, ...mizaiCharacterSkills, ...bloodCharacterSkills, ...defenseCharacterSkills, ...ambushCharacterSkills, ...dispatchCharacterSkills] satisfies CharacterSkillModule[];
const registry = new Map(modules.map((module) => [module.cardId, module]));

export function characterSkillForId(cardId: string) {
  return registry.get(cardId);
}

export function registeredCharacterSkillIds() {
  return [...registry.keys()];
}
