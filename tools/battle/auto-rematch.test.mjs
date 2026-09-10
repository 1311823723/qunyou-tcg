import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoBattleRoom, roomRuntime } from './fixtures/auto-room-runtime.mjs';

async function endedRoom() {
  const runtime = await roomRuntime();
  runtime.room.env.BATTLE_LOBBY = { getByName: () => ({ async upsertRoom() {} }) };
  runtime.room.startGame();
  runtime.state.winnerId = 'p1';
  return runtime;
}

test('rematch requires an ended match and the other seated player’s consent', async () => {
  const r = await endedRoom();
  const initial = JSON.stringify(r.state.players);
  await r.command('p1', 'room:rematchRequest', { mode: 'same-decks' });
  const id = r.state.rematch.id;
  assert.equal(JSON.stringify(r.state.players), initial);
  await assert.rejects(r.command('p1', 'room:rematchRespond', { requestId: id, accept: true }), /对手回应/);
  await assert.rejects(r.command('p2', 'room:rematchCancel', { requestId: id }), /自己/);
  await assert.rejects(r.command('p2', 'room:rematchRequest', { mode: 'change-decks' }), /已有/);
  await r.command('p2', 'room:rematchRespond', { requestId: id, accept: false });
  assert.equal(r.state.rematch, undefined);
  assert.equal(r.state.winnerId, 'p1');
  await assert.rejects(r.command('p1', 'phase:advance'), /本局已结束/);
  r.state.winnerId = undefined;
  await assert.rejects(r.command('p1', 'room:rematchRequest', { mode: 'same-decks' }), /结束后/);
});

test('same-deck rematch rebuilds all match state and deduplicates acceptance', async () => {
  const r = await endedRoom();
  const oldIds = new Set([...r.state.handDeck, ...r.state.players.flatMap(p => [...p.hand, ...p.characterDeck, ...p.characterSlots.filter(Boolean)])].map(c => c.instanceId));
  const profiles = r.state.players.map(p => [p.id, p.token, p.nickname, p.deckId]);
  r.state.pendingInspection = { eventId: 'stale' };
  r.state.responsePlayerId = 'p2'; r.state.consecutivePasses = 9;
  r.state.turnModifiers.push({ id: 'stale' });
  await r.command('p1', 'room:rematchRequest', { mode: 'same-decks' });
  await r.command('p2', 'room:rematchRespond', { requestId: r.state.rematch.id, accept: true });
  assert.deepEqual(r.state.players.map(p => [p.id,p.token,p.nickname,p.deckId]), profiles);
  assert.equal(r.state.winnerId, undefined); assert.equal(r.state.rematch, undefined);
  assert.equal(r.state.pendingInspection, undefined); assert.equal(r.state.responsePlayerId, undefined);
  assert.equal(r.state.consecutivePasses, 0); assert.deepEqual(r.state.turnModifiers, []);
  assert.equal(r.state.turnNumber, 1); assert.equal(r.state.started, true);
  for (const p of r.state.players) {
    assert.equal(p.health, 7); assert.equal(p.hand.length, 5); assert.equal(p.characterDeck.length, 14);
    assert.equal(p.characterSlots.filter(Boolean).length, 2);
    assert.ok([...p.hand, ...p.characterDeck, ...p.characterSlots.filter(Boolean)].every(c => !oldIds.has(c.instanceId)));
  }
  assert.equal(r.state.handDeck.length, 44);
  const socket = r.sockets[1];
  const ack = socket.messages.findLast(m => m.type === 'actionAck');
  const revision = r.state.revision;
  await r.room.webSocketMessage(socket, JSON.stringify({ type: 'room:rematchRespond', actionId: ack.actionId, baseRevision: revision - 1, payload: { accept: true } }));
  assert.equal(r.state.revision, revision);
  assert.equal(socket.messages.at(-1).duplicate, true);
});

test('change-decks agreement returns both players to an empty waiting room before readiness', async () => {
  const r = await endedRoom();
  await r.command('p2', 'room:rematchRequest', { mode: 'change-decks' });
  await r.command('p1', 'room:rematchRespond', { requestId: r.state.rematch.id, accept: true });
  assert.equal(r.state.started, false); assert.equal(r.state.winnerId, undefined);
  assert.equal(r.state.startedAt, undefined); assert.deepEqual(r.state.handDeck, []);
  assert.ok(r.state.players.every(p => !p.ready && p.hand.length === 0 && p.characterDeck.length === 0));
  await r.command('p1', 'player:selectDeck', { deckId: 'deck_aggro_001' });
  await r.command('p1', 'player:ready', { ready: true });
  assert.equal(r.state.started, false);
  await r.command('p2', 'player:ready', { ready: true });
  assert.equal(r.state.started, true); assert.equal(r.state.players[0].deckId, 'deck_aggro_001');
});

test('pending rematch survives storage restore, remains spectator-safe and cancels on disconnect', async () => {
  const r = await endedRoom();
  await r.command('p1', 'room:rematchRequest', { mode: 'same-decks' });
  let initializing;
  const saved = JSON.parse(JSON.stringify(r.state));
  const ctx = { storage: { async get() { return saved; }, async put() {}, async setAlarm() {} },
    blockConcurrencyWhile(fn) { initializing = fn(); }, getWebSockets: () => r.sockets };
  const restored = new AutoBattleRoom(ctx, r.room.env); await initializing;
  assert.deepEqual(restored.snapshotFor('p2').game.rematch, r.state.rematch);
  assert.deepEqual(restored.snapshotFor('spectator', true).game.legalActions, []);
  await r.command('spectator', 'room:rematchRespond', { requestId: r.state.rematch.id, accept: true }).then(() => assert.fail('spectator accepted'), error => assert.match(error.message, /观战者/));
  await restored.webSocketClose(r.sockets[0]);
  assert.equal(restored.state.rematch, undefined);
  await assert.rejects(restored.applyAction(restored.state.players[1], { type: 'room:rematchRequest', payload: { mode: 'same-decks' } }), /双方在线/);
});
