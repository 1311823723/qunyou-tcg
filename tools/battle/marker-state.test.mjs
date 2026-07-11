import assert from "node:assert/strict";
import test from "node:test";
import { addCounterMarker, appendCardMarker, takeCardMarker } from "../../worker/src/marker-state.mts";

test("same-name counter markers merge and stop at the technical maximum", () => {
  const markers = [];
  const first = addCounterMarker(markers, "p1", "充能球", 3, () => "marker-1");
  const second = addCounterMarker(markers, "p1", "充能球", 98, () => "unused");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.previous, 3);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].count, 99);
});

test("card markers preserve physical cards and remove the requested card", () => {
  const markers = [];
  const first = { instanceId: "card-1", definitionId: "sha", kind: "hand", ownerId: "p1", faceDown: true };
  const second = { instanceId: "card-2", definitionId: "shan", kind: "hand", ownerId: "p1", faceDown: true };
  appendCardMarker(markers, "p1", "藤蔓", first, () => "vines");
  appendCardMarker(markers, "p1", "藤蔓", second, () => "unused", "vines");
  assert.equal(markers[0].cards.length, 2);

  const removed = takeCardMarker(markers, "vines", "card-1");
  assert.equal(removed.card.instanceId, "card-1");
  assert.equal(markers[0].cards[0].instanceId, "card-2");

  takeCardMarker(markers, "vines");
  assert.deepEqual(markers, []);
});
