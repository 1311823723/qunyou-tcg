import characters from "../../../../data/cards/characters.json" with { type: "json" };
import type { MainRole } from "../../auto-types";
import type { BodySkillModule } from "../body-skill.mts";
import { choiceValue } from "../body-skill.mts";
import { BODY_IDS } from "../body-ids.mts";

const roles: MainRole[] = ["强攻", "防御", "资源", "控制", "支援", "伏击"];
const roleByCharacter = new Map(characters.map((card) => [card.id, card.mainRole as MainRole]));

export function emptyRiderCards(): Record<MainRole, "absent" | "normal" | "final"> {
  return Object.fromEntries(roles.map((role) => [role, "absent"])) as Record<MainRole, "absent" | "normal" | "final">;
}

export const roamingBodySkill: BodySkillModule = {
  bodyId: BODY_IDS.roaming,
  progressDelta: (player, event) => event.type === "rider_used" && event.sourcePlayerId === player.id && event.metadata?.version === "normal" ? 1 : 0,
  collectTrigger(context, event) {
    if (context.player.bodyState.flipped || event.type !== "skill_resolved" || event.sourcePlayerId === context.player.id) return;
    const role = roleByCharacter.get(String(event.characterDefinitionId || ""));
    if (!role) return;
    const cards = context.player.bodyState.riderCards || emptyRiderCards();
    context.player.bodyState.riderCards = cards;
    const sourceInstanceId = String(event.metadata?.characterInstanceId || "");
    const sourceStillInField = Boolean(sourceInstanceId && context.opponent()?.characterSlots.some((slot) =>
      slot && "instanceId" in slot && slot.instanceId === sourceInstanceId));
    if (sourceStillInField && cards["伏击"] === "normal" && context.player.bodyState.riderAcquiredEventIds?.["伏击"] !== event.id
      && context.usage("turn", "rider-used") === 0) {
      return { kind: "kgy-ambush", context: {
        role: "伏击",
        sourceInstanceId,
        characterDefinitionId: String(event.characterDefinitionId || ""),
        ...(cards[role] === "absent" && context.usage("turn", "rider-acquired") === 0 ? { acquireRole: role } : {}),
      } };
    }
    if (cards[role] !== "absent" || context.usage("turn", "rider-acquired") > 0) return;
    return { kind: "kgy-acquire", context: { role } };
  },
  openPrompt(context, trigger) {
    if (trigger.kind === "kgy-acquire") {
      const role = String(trigger.context?.role || "") as MainRole;
      if (!roles.includes(role) || context.player.bodyState.flipped || context.usage("turn", "rider-acquired") > 0
        || context.player.bodyState.riderCards?.[role] !== "absent") return false;
      context.setPrompt({ kind: "body-skill", playerId: context.player.id, title: context.skillName(),
        message: `对手的${role}角色技能已经结算，是否获得【${role}骑士卡】？`,
        options: [{ value: "acquire", label: `获得${role}骑士卡` }, { value: "pass", label: "暂不获得" }],
        context: { action: "kgy-acquire", role, eventId: trigger.eventId } });
      return true;
    }
    return false;
  },
  resolveChoice(context, prompt, payload) {
    if (prompt.context?.action !== "kgy-acquire") return false;
    const value = choiceValue(payload);
    if (value !== "acquire" && value !== "pass") throw new Error("骑士卡获取选择无效。");
    context.clearPrompt(prompt.id);
    if (value === "pass") return true;
    const role = String(prompt.context?.role || "") as MainRole;
    if (!roles.includes(role) || context.player.bodyState.flipped || context.usage("turn", "rider-acquired") > 0
      || context.player.bodyState.riderCards?.[role] !== "absent") throw new Error("现在不能获得该骑士卡。");
    context.player.bodyState.riderCards![role] = "normal";
    context.player.bodyState.riderAcquiredEventIds ||= {};
    context.player.bodyState.riderAcquiredEventIds[role] = String(prompt.context?.eventId || "");
    context.incrementUsage("turn", "rider-acquired");
    context.logTrait();
    context.addLog(`${context.player.nickname}获得了【${role}骑士卡】`, context.player.id, { zone: "body", ownerId: context.player.id });
    return true;
  },
  onDynamaxEnter(context) {
    context.player.bodyState.riderCards = Object.fromEntries(roles.map((role) => [role, "final"])) as Record<MainRole, "final">;
    context.player.bodyState.riderAcquiredEventIds = {};
    context.addLog(`${context.player.nickname}获得了全部六种FINAL骑士卡`, context.player.id, { zone: "body", ownerId: context.player.id });
  },
  onDynamaxExit(context) {
    const cards = context.player.bodyState.riderCards || emptyRiderCards();
    for (const role of roles) if (cards[role] === "final") cards[role] = "normal";
    context.addLog(`${context.player.nickname}将剩余FINAL骑士卡变回普通骑士卡`, context.player.id, { zone: "body", ownerId: context.player.id });
  },
};
