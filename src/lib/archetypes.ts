import archetypes from "../../data/archetypes.json";

export interface Archetype {
  id: string;
  name: string;
  keywords: string[];
  risks: string;
  blurb: string;
}

export const allArchetypes: Archetype[] = archetypes as Archetype[];

/** Look up an archetype by its Chinese name (e.g. "爆杀流") */
export function getArchetype(name: string): Archetype | undefined {
  return allArchetypes.find((a) => a.name === name);
}

/** Get archetype keywords by name, or empty array if not found */
export function getArchetypeKeywords(name: string): string[] {
  return getArchetype(name)?.keywords ?? [];
}

/** Get archetype blurb by name, or empty string if not found */
export function getArchetypeBlurb(name: string): string {
  return getArchetype(name)?.blurb ?? "";
}

/** Get archetype risks by name, or empty string if not found */
export function getArchetypeRisks(name: string): string {
  return getArchetype(name)?.risks ?? "";
}
