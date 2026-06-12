import type { CardInstance, PlayerState, ZoneName } from "./types";

export type LocatedCard = {
  card: CardInstance;
  owner: PlayerState;
  zone: ZoneName;
  index: number;
};

export function isPrivateLocation(located: LocatedCard) {
  if (["hand", "characterHand", "characterDeck"].includes(located.zone)) return true;
  if (located.zone === "characterSlot" || located.zone === "banished") return Boolean(located.card.faceDown);
  return false;
}

export function isPublicLocation(located: LocatedCard) {
  return !isPrivateLocation(located) && located.zone !== "handDeck";
}

export function assertCardCanEnter(card: CardInstance, target: string) {
  const handTargets = new Set([
    "resolving",
    "handDiscard",
    "handDeckTop",
    "handDeckBottom",
    "opponentHand",
    "hand",
    "handMarker",
  ]);
  const characterTargets = new Set([
    "characterHand",
    "characterDeckBottom",
    "retired",
    "banished",
    "characterSlot",
  ]);
  if (handTargets.has(target) && card.kind !== "hand") throw new Error("该目标区域只接受手牌。");
  if (characterTargets.has(target) && card.kind !== "character") throw new Error("该目标区域只接受角色牌。");
  if (!handTargets.has(target) && !characterTargets.has(target)) throw new Error("目标区域无效。");
}

export function zoneLabel(zone: string) {
  return ({
    hand: "手牌区",
    characterHand: "角色手牌",
    characterDeck: "角色牌堆",
    characterDeckBottom: "角色牌堆底",
    retired: "退场区",
    banished: "移出游戏区",
    handDeck: "共用牌堆",
    handDeckTop: "共用牌堆顶",
    handDeckBottom: "共用牌堆底",
    handDiscard: "手牌弃牌区",
    resolving: "结算区",
    characterSlot: "角色区",
    opponentHand: "对手手牌区",
    handMarker: "暗置标记区",
  } as Record<string, string>)[zone] || zone;
}
