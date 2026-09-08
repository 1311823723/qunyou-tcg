import assert from 'node:assert/strict';
import test from 'node:test';
import { roomRuntime } from './fixtures/auto-room-runtime.mjs';

function roleOrder(player) {
  return [...player.characterSlots.filter(Boolean), ...player.characterDeck.slice().reverse()].map(card => card.definitionId);
}
function handOrder(state) {
  return [...state.players.flatMap(p => p.hand), ...state.handDeck.slice().reverse()].map(card => `${card.definitionId}:${card.suit || card.joker}:${card.rank || ''}`);
}

test('new automatic rooms independently shuffle the hand deck and both character decks before dealing', async () => {
  const hands = new Set(), firstRoles = new Set(), secondRoles = new Set();
  const openingHands = new Set(), openingFirstRoles = new Set(), openingSecondRoles = new Set();
  let handContents, ownerContents, opponentContents;
  for (let i = 0; i < 20; i++) {
    const { room, state, owner, opponent } = await roomRuntime();
    state.started = false;
    room.startGame();
    const hand = handOrder(state), first = roleOrder(owner), second = roleOrder(opponent);
    assert.equal(hand.length, 54);
    assert.equal(first.length, 16);
    assert.equal(second.length, 16);
    for (const player of state.players) {
      assert.equal(player.hand.length, 5);
      assert.equal(player.characterSlots.filter(Boolean).length, 2);
      assert.equal(player.characterDeck.length, 14);
      assert.ok(player.characterSlots.filter(Boolean).every(card => card.faceDown === true));
    }
    handContents ??= [...hand].sort(); ownerContents ??= [...first].sort(); opponentContents ??= [...second].sort();
    assert.deepEqual([...hand].sort(), handContents);
    assert.deepEqual([...first].sort(), ownerContents);
    assert.deepEqual([...second].sort(), opponentContents);
    openingHands.add(JSON.stringify(hand.slice(0, 5)));
    openingFirstRoles.add(JSON.stringify(first.slice(0, 2)));
    openingSecondRoles.add(JSON.stringify(second.slice(0, 2)));
    hands.add(JSON.stringify(hand)); firstRoles.add(JSON.stringify(first)); secondRoles.add(JSON.stringify(second));
  }
  // Test for a stuck source/order, not guaranteed differences between individual games.
  assert.ok(openingHands.size > 1, 'opening hands must vary');
  assert.ok(openingFirstRoles.size > 1, 'host opening roles must vary');
  assert.ok(openingSecondRoles.size > 1, 'guest opening roles must vary');
  assert.ok(hands.size > 1, 'hand deck must not reuse a fixed ordering across fresh rooms');
  assert.ok(firstRoles.size > 1, 'host character deck must not reuse a fixed ordering');
  assert.ok(secondRoles.size > 1, 'guest character deck must not reuse a fixed ordering');
});

test('opening deals from the shuffled tops; snapshots never reshuffle an existing automatic game', async () => {
  const { room, state } = await roomRuntime();
  const shuffled = [];
  const original = room.shuffle.bind(room);
  room.shuffle = items => { const result = original(items); shuffled.push(structuredClone(result)); return result; };
  room.startGame();
  assert.deepEqual(shuffled.map(cards => cards.length), [54, 16, 16]);
  assert.deepEqual(state.players[0].hand.map(c => c.instanceId), shuffled[0].slice(-5).reverse().map(c => c.instanceId));
  assert.deepEqual(state.players[1].hand.map(c => c.instanceId), shuffled[0].slice(-10, -5).reverse().map(c => c.instanceId));
  state.players.forEach((player, index) => {
    assert.deepEqual(player.characterSlots.filter(Boolean).map(c => c.instanceId), shuffled[index + 1].slice(-2).reverse().map(c => c.instanceId));
  });
  const before = JSON.stringify(state);
  room.snapshotFor('p1'); room.snapshotFor('p2'); room.snapshotFor('spectator', true);
  assert.equal(JSON.stringify(state), before);
  assert.equal(shuffled.length, 3);
});
