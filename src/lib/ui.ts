import type { CharacterCost } from "./cards";

export const ROLE_VAR: Record<string, string> = {
  "强攻": "role-attack",
  "防御": "role-defend",
  "资源": "role-resource",
  "控制": "role-control",
  "支援": "role-support",
  "伏击": "role-ambush",
};

/** CSS variable mapping for role accent colors (used in inline styles) */
export const ROLE_COLORS_CSS: Record<string, string> = {
  "强攻": "var(--color-role-attack)",
  "防御": "var(--color-role-defend)",
  "资源": "var(--color-role-resource)",
  "控制": "var(--color-role-control)",
  "支援": "var(--color-role-support)",
  "伏击": "var(--color-role-ambush)",
};

export function roleVar(mainRole: string): string {
  return ROLE_VAR[mainRole] ?? "role-neutral";
}

export function formatCharacterCost(cost: CharacterCost): string {
  if (cost.type === "休整") return `休整 ${cost.amount ?? 1}`;
  if (cost.type === "退场") return cost.text ?? "退场自身";
  if (cost.type === "复合") return cost.text ?? "复合";
  return cost.type;
}

export function costKind(cost: CharacterCost): "rest" | "exit" | "compound" | "other" {
  if (cost.type === "休整") return "rest";
  if (cost.type === "退场") return "exit";
  if (cost.type === "复合") return "compound";
  return "other";
}

export function splitCharacterName(name: string): { prefix: string; suffix: string } {
  const dashIdx = name.indexOf("-");
  if (dashIdx > 0) {
    return { prefix: name.slice(0, dashIdx), suffix: name.slice(dashIdx + 1) };
  }
  return { prefix: "", suffix: name };
}

export const ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  爆杀流: ["强攻", "连杀", "爆发", "卖血", "退场"],
};

export const ARCHETYPE_RISKS: Record<string, string> = {
  爆杀流: "怕断【杀】、怕被【闪】、资源消耗大",
};

export const ARCHETYPE_BLURB: Record<string, string> = {
  爆杀流: "找【杀】、强化【杀】、造成伤害、触发 Mega、继续压血",
};
