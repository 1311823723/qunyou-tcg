import type { BodyMarker, CardInstance } from "./types";

export function addCounterMarker(
  markers: BodyMarker[],
  ownerId: string,
  label: string,
  count: number,
  createId: () => string,
) {
  const existing = markers.find((marker) => marker.kind === "counter" && marker.label === label);
  if (existing?.kind === "counter") {
    const previous = existing.count;
    existing.count = Math.min(99, existing.count + count);
    return { marker: existing, previous, created: false };
  }
  const marker: BodyMarker = { id: createId(), kind: "counter", label, ownerId, count };
  markers.push(marker);
  return { marker, previous: 0, created: true };
}

export function appendCardMarker(
  markers: BodyMarker[],
  ownerId: string,
  label: string,
  card: CardInstance,
  createId: () => string,
  markerId?: string,
) {
  const existing = markerId
    ? markers.find((marker) => marker.id === markerId)
    : markers.find((marker) => marker.kind === "cards" && marker.label === label);
  if (existing && existing.kind !== "cards") throw new Error("同名数量标记不能存放卡牌。");
  if (existing?.kind === "cards") {
    existing.cards.push(card);
    return existing;
  }
  const marker: BodyMarker = { id: createId(), kind: "cards", label, ownerId, cards: [card] };
  markers.push(marker);
  return marker;
}

export function takeCardMarker(markers: BodyMarker[], markerId: string, instanceId?: string) {
  const markerIndex = markers.findIndex((marker) => marker.id === markerId && marker.kind === "cards");
  const marker = markers[markerIndex];
  if (markerIndex < 0 || marker.kind !== "cards" || marker.cards.length === 0) return undefined;
  const cardIndex = instanceId
    ? marker.cards.findIndex((card) => card.instanceId === instanceId)
    : marker.cards.length - 1;
  if (cardIndex < 0) return undefined;
  const [card] = marker.cards.splice(cardIndex, 1);
  if (marker.cards.length === 0) markers.splice(markerIndex, 1);
  return { card, label: marker.label };
}
