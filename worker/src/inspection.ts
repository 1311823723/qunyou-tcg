import type {
  CardInstance,
  InspectionAction,
  InspectionGrant,
  RoomState,
} from "./types";

export const INSPECTION_TTL_MS = 60_000;

export function pruneInspections(state: RoomState, now = Date.now()) {
  state.inspections = state.inspections.filter((grant) => grant.expiresAt > now);
}

export function createInspectionGrant(
  state: RoomState,
  viewerId: string,
  cards: CardInstance[],
  allowedActions: InspectionAction[],
  now = Date.now(),
): InspectionGrant {
  pruneInspections(state, now);
  const grant: InspectionGrant = {
    id: crypto.randomUUID(),
    viewerId,
    cardInstanceIds: cards.map((card) => card.instanceId),
    allowedActions,
    expiresAt: now + INSPECTION_TTL_MS,
  };
  state.inspections.push(grant);
  return grant;
}

export function requireInspectionGrant(
  state: RoomState,
  inspectionId: string,
  viewerId: string,
  cardInstanceId: string,
  action: string,
  now = Date.now(),
) {
  pruneInspections(state, now);
  const grant = state.inspections.find((item) => item.id === inspectionId);
  if (
    !grant
    || grant.viewerId !== viewerId
    || !grant.cardInstanceIds.includes(cardInstanceId)
    || !grant.allowedActions.includes(action as InspectionAction)
  ) {
    throw new Error("查看授权无效或已经过期。");
  }
  return grant;
}

export function consumeInspectionGrant(state: RoomState, inspectionId: string) {
  state.inspections = state.inspections.filter((grant) => grant.id !== inspectionId);
}
