import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const characters = JSON.parse(fs.readFileSync(path.join(root, "data/cards/characters.json"), "utf8"));
const implementation = JSON.parse(fs.readFileSync(path.join(root, "data/cards/character_implementation.json"), "utf8"));

function eventFor(timing) {
  if (timing === "出牌阶段") return "play_phase";
  if (timing.includes("准备阶段")) return timing.includes("对手") ? "opponent_preparation" : "preparation";
  if (timing.includes("布阵阶段")) return timing.includes("对手") ? "opponent_deployment" : "deployment";
  if (timing.includes("摸牌阶段外摸牌")) return "opponent_extra_draw";
  if (timing.includes("判定牌展示")) return "judgment_revealed";
  if (timing.includes("判定结果") || timing.includes("判定结算")) return "judgment_resolved";
  if (timing.includes("成为【出刀】的目标")) return "strike_targeted";
  if (timing.includes("使用【闪避】")) return "strike_dodged";
  if (timing.includes("使用【出刀】时")) return "strike_used";
  if (timing.includes("【出刀】造成伤害后") || timing.includes("受到【出刀】造成的伤害后")) return "strike_damage_after";
  if (timing.includes("使用【出刀】")) return "strike_used";
  if (timing.includes("使用行动牌后") || timing.includes("行动牌结算后")) return "action_resolved";
  if (timing.includes("使用行动牌时")) return "action_used";
  if (timing.includes("使用行动牌")) return timing.includes("对手") || timing.includes("对方") ? "opponent_action_used" : "action_used";
  if (timing.includes("将对对手本体造成伤害时")) return "damage_before_source";
  if (timing.includes("将受到") || timing.includes("受到伤害时")) return "damage_before";
  if (timing.includes("受到伤害后") || timing.includes("造成伤害后")) return "damage_after";
  if (timing.includes("体力减少后")) return "health_lost_after";
  if (timing.includes("回复体力")) return "health_recovered";
  if (timing.includes("角色退场")) return "character_retired";
  if (timing.includes("角色上阵")) return "character_deployed";
  if (timing.includes("明置角色") || timing.includes("角色明置")) return "character_revealed";
  if (timing.includes("弃置手牌") || timing.includes("弃牌后")) return "hand_discarded";
  if (timing.includes("失去手牌")) return "hand_lost_before";
  if (timing.includes("观看")) return "inspection";
  if (timing.includes("发动技能")) return "skill_used";
  if (timing.includes("需要使用或打出基本牌")) return "basic_card_needed";
  if (timing.includes("使用手牌响应你使用的牌后")) return "card_responded";
  if (timing.includes("将因对手的牌或技能休整、退场或移出游戏时")) return "character_leave_before";
  if (timing.includes("一回合内发动第二个角色技能时")) return "second_skill_used";
  if (timing.includes("费用为【休整2】或更高的角色技能时")) return "high_cost_skill_used";
  if (timing.includes("因支付") && timing.includes("费用而休整后")) return "skill_cost_rest_after";
  if (timing.includes("成为对手角色技能的目标时")) return "skill_targeted_character";
  if (timing.includes("防止或减少伤害后")) return "damage_prevented";
  if (timing.includes("本体成为手牌的目标时")) return "body_targeted_by_hand";
  return "manual_event";
}

function relationFor(timing) {
  if (timing.includes("任意")) return "any";
  if (timing.includes("对手因你的")) return "source_self";
  if (timing.includes("你的本体成为") || timing.includes("你受到") || timing.includes("你的本体受到") || timing.includes("你将受到") || timing.includes("令你") || timing.includes("对你使用") || timing.includes("你的任意角色退场") || timing.includes("你的另一张角色退场") || timing.includes("你回复体力")) return "target_self";
  if (timing.includes("对手本体受到") || timing.includes("对手回复") || timing.includes("对手弃置") || timing.includes("对手角色退场")) return "target_opponent";
  if (timing.includes("当对手") || timing.includes("当对方") || timing.startsWith("对手")) return "source_opponent";
  if (timing.includes("当你") || timing.includes("你的本体使用") || timing.includes("你使用") || timing.includes("你回复") || timing.includes("你的角色") || timing.includes("己方")) return "source_self";
  return "any";
}

function actionsFor(effect) {
  const actions = new Set();
  if (/摸|加入手牌|获得.*牌/.test(effect)) actions.add("draw");
  if (/防止.*伤害|伤害-1|减少.*伤害|免疫.*伤害/.test(effect)) actions.add("prevent_damage");
  if (/(?:对(?:对手|对方|其)本体|对对方)造成\s*[一二三四五\dX]+\s*点?伤害|改为造成\s*[一二三四五\dX]+\s*点?伤害/.test(effect)) actions.add("damage");
  if (/回复.*体力/.test(effect)) actions.add("heal");
  if (/上阵/.test(effect)) actions.add("deploy");
  if (/判定/.test(effect)) actions.add("judge");
  if (/观看|查看/.test(effect)) actions.add("inspect");
  if (/休整|退场|移出游戏|洗回|置于.*牌堆/.test(effect)) actions.add("move");
  if (/标记|充能球/.test(effect)) actions.add("marker");
  if (/额外.*【出刀】/.test(effect)) actions.add("extra_strike");
  if (/视为.*使用.*【出刀】|伤害\+1|伤害改为X|不能被【闪避】/.test(effect)) actions.add("manual");
  return [...actions.size ? actions : ["manual"]];
}

function usageLimit(effect) {
  const turn = effect.match(/每回合(?:限|至多)([一二三四五\d]+)次/);
  if (turn) return { scope: "turn", count: ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }[turn[1]] || Number(turn[1]) || 1) };
  if (/每局限一次/.test(effect)) return { scope: "game", count: 1 };
  return undefined;
}

const registry = Object.fromEntries(characters.map((card) => {
  const limit = usageLimit(card.effectText);
  return [card.id, {
    level: implementation[card.id]?.automation === "implemented" ? "full" : "assisted",
    trigger: {
      event: eventFor(card.timing),
      relation: relationFor(card.timing),
      ...(card.timing.includes("己方伏击角色") ? { targetMainRole: "伏击" } : {}),
      ...(card.timing.includes("己方防御角色") ? { targetMainRole: "防御" } : {}),
      timingText: card.timing,
    },
    ...(limit ? { usageLimit: limit } : {}),
    assistedActions: actionsFor(card.effectText),
  }];
}));

fs.writeFileSync(path.join(root, "data/cards/character_automation.json"), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Generated automation metadata for ${characters.length} characters.`);
