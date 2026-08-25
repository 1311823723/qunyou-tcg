import assert from "node:assert/strict";

const base = process.env.BATTLE_BASE || "http://127.0.0.1:8787";
const BOMBER_ID = "char_010_weixiaokele_bomber";
const AGGRO_DECK_ID = "deck_aggro_001";

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : {} };
}

function client(code, identity) {
  const url = new URL(`${base.replace(/^http/, "ws")}/auto/rooms/${code}/connect`);
  url.searchParams.set("token", identity.token);
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let revision = 0;
  let latestSnapshot;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "snapshot") {
      revision = message.snapshot.revision;
      latestSnapshot = message.snapshot;
    }
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  });
  return {
    socket,
    send(type, payload = {}) {
      socket.send(JSON.stringify({
        type,
        payload,
        actionId: crypto.randomUUID(),
        protocolVersion: 2,
        baseRevision: revision,
      }));
    },
    waitFor(predicate, timeout = 10000) {
      const existing = [...messages].reverse().find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          const recent = messages.slice(-8).map((message) => message.type === "snapshot"
            ? `snapshot:r${message.snapshot.revision}:${message.snapshot.game.phase}:${message.snapshot.game.prompt?.kind || "idle"}`
            : message.type === "error" ? `error:${message.error}` : message.type).join(", ");
          reject(new Error(`Timed out waiting for bomber lifecycle message. Recent: ${recent || "none"}`));
        }, timeout);
      });
    },
    get revision() { return revision; },
    get snapshot() { return latestSnapshot; },
  };
}

function clientFor(room, playerId) {
  return playerId === "p1" ? room.a : room.b;
}

async function syncRoom(room, revision) {
  await Promise.all([
    room.a.waitFor((message) => message.type === "snapshot" && message.snapshot.revision >= revision),
    room.b.waitFor((message) => message.type === "snapshot" && message.snapshot.revision >= revision),
  ]);
}

async function command(room, playerId, type, payload = {}) {
  const actor = clientFor(room, playerId);
  const previousRevision = actor.snapshot.revision;
  actor.send(type, payload);
  const message = await actor.waitFor((candidate) => candidate.type === "snapshot" && candidate.snapshot.revision > previousRevision);
  await syncRoom(room, message.snapshot.revision);
  return message.snapshot;
}

async function settlePrompts(room) {
  let snapshot = room.a.snapshot;
  for (let count = 0; count < 30 && snapshot.game.prompt; count += 1) {
    const publicPrompt = snapshot.game.prompt;
    const prompt = clientFor(room, publicPrompt.playerId).snapshot.game.prompt;
    assert.ok(prompt, "the deciding player should receive the full prompt");
    if (prompt.kind === "discard") {
      snapshot = await command(room, prompt.playerId, "choice:submit", {
        cardInstanceIds: (prompt.cardInstanceIds || []).slice(0, Number(prompt.min || 0)),
      });
      continue;
    }
    if (["character-trigger", "damage-before", "body-skill"].includes(prompt.kind)) {
      const pass = prompt.options?.find((option) => option.value === "pass");
      assert.ok(pass, `${prompt.kind} should provide a pass option during this smoke test`);
      snapshot = await command(room, prompt.playerId, "choice:submit", { value: "pass" });
      continue;
    }
    throw new Error(`Unexpected prompt while advancing bomber lifecycle: ${prompt.kind}`);
  }
  assert.equal(snapshot.game.prompt, undefined, "all optional and mandatory phase prompts should be settled");
  return snapshot;
}

async function progressTo(room, playerId, phase) {
  for (let count = 0; count < 40; count += 1) {
    const snapshot = await settlePrompts(room);
    if (snapshot.game.currentPlayerId === playerId && snapshot.game.phase === phase) return snapshot;
    assert.equal(snapshot.game.winnerId, undefined, "the lifecycle test should not end the game early");
    await command(room, snapshot.game.currentPlayerId, "phase:advance");
  }
  throw new Error(`Could not reach ${playerId}'s ${phase} phase`);
}

async function closeRoom(room) {
  if (room.a.socket.readyState === WebSocket.OPEN) {
    const endedA = room.a.waitFor((message) => message.type === "roomEnded");
    const endedB = room.b.waitFor((message) => message.type === "roomEnded");
    room.a.send("room:end");
    await Promise.all([endedA, endedB]);
  }
  room.a.socket.close();
  room.b.socket.close();
}

async function findBomberOpening(label) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const host = { nickname: `${label}A`, token: `bomb-host-${crypto.randomUUID()}`, deckId: AGGRO_DECK_ID };
    const guest = { nickname: `${label}B`, token: `bomb-guest-${crypto.randomUUID()}`, deckId: AGGRO_DECK_ID };
    const created = await post("/auto/rooms", host);
    if (created.response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 7000));
      attempt -= 1;
      continue;
    }
    assert.equal(created.response.status, 200);
    const code = created.body.roomCode;
    const joined = await post(`/auto/rooms/${code}/join`, guest);
    assert.equal(joined.response.status, 200);
    const room = { code, host, guest, a: client(code, host), b: client(code, guest) };
    await Promise.all([
      new Promise((resolve) => room.a.socket.addEventListener("open", resolve, { once: true })),
      new Promise((resolve) => room.b.socket.addEventListener("open", resolve, { once: true })),
    ]);
    await Promise.all([
      room.a.waitFor((message) => message.type === "snapshot"),
      room.b.waitFor((message) => message.type === "snapshot"),
    ]);
    await command(room, "p1", "player:ready", { ready: true });
    const started = await command(room, "p2", "player:ready", { ready: true });
    assert.equal(started.game.started, true);
    for (const snapshot of [room.a.snapshot, room.b.snapshot]) {
      assert.ok(snapshot.players.every((player) => player.characterSlots.filter(Boolean).length === 2));
      assert.ok(snapshot.players.every((player) => player.characterSlots.filter(Boolean).every((card) => card.faceDown)));
    }
    const p1HasBomber = room.a.snapshot.players.find((player) => player.id === "p1").characterSlots
      .some((card) => card?.definitionId === BOMBER_ID);
    const p2HasBomber = room.b.snapshot.players.find((player) => player.id === "p2").characterSlots
      .some((card) => card?.definitionId === BOMBER_ID);
    if (p1HasBomber || p2HasBomber) {
      const sourceCandidates = [p1HasBomber ? "p1" : undefined, p2HasBomber ? "p2" : undefined].filter(Boolean);
      const sourceId = sourceCandidates.includes(started.game.currentPlayerId)
        ? started.game.currentPlayerId
        : sourceCandidates[0];
      console.log(`[bomb-smoke] ${label}: found bomber in two-role opening after ${attempt} room(s)`);
      return { ...room, sourceId, targetId: sourceId === "p1" ? "p2" : "p1" };
    }
    await closeRoom(room);
  }
  throw new Error("Could not find an opening two-role hand containing 爆炸王-微笑尅乐");
}

async function activateBomber(room) {
  await progressTo(room, room.sourceId, "play");
  const sourceClient = clientFor(room, room.sourceId);
  const sourcePlayer = sourceClient.snapshot.players.find((player) => player.id === room.sourceId);
  const bomber = sourcePlayer.characterSlots.find((card) => card?.definitionId === BOMBER_ID);
  assert.ok(bomber?.instanceId, "bomber should still occupy an opening character slot");
  assert.equal(bomber.faceDown, true);
  assert.ok(sourceClient.snapshot.game.legalSkillInstanceIds.includes(bomber.instanceId));
  const costRole = sourcePlayer.characterSlots.find((card) => card?.instanceId && card.instanceId !== bomber.instanceId);
  assert.ok(costRole?.instanceId, "the other opening role should be available to pay rest 1");

  let snapshot = await command(room, room.sourceId, "skill:activate", {
    instanceId: bomber.instanceId,
    costCharacterIds: [costRole.instanceId],
  });
  assert.equal(snapshot.game.prompt?.kind, "character-skill");
  assert.equal(snapshot.game.prompt?.context?.continuation?.step, "place-bomb");
  const targetSlotIndex = Number(snapshot.game.prompt.options?.[0]?.value);
  assert.ok(Number.isInteger(targetSlotIndex));
  snapshot = await command(room, room.sourceId, "choice:submit", { value: String(targetSlotIndex) });

  const resolvedSource = snapshot.players.find((player) => player.id === room.sourceId);
  const resolvedBomber = resolvedSource.characterSlots.find((card) => card?.instanceId === bomber.instanceId);
  assert.equal(resolvedBomber?.faceDown, false, "bomber should be face-up after activation");
  assert.equal(resolvedSource.characterSlots.some((card) => card?.instanceId === costRole.instanceId), false,
    "the selected rest cost should leave the character area");
  const target = snapshot.players.find((player) => player.id === room.targetId);
  const marker = target.characterSlots[targetSlotIndex];
  assert.ok(marker && !("instanceId" in marker) && marker.label === "炸弹", "bomb should occupy the selected empty slot");
  assert.ok(snapshot.game.logs.some((log) => log.text.includes("放置了「炸弹」")));
  return { markerId: marker.id, targetSlotIndex };
}

async function testRemoval() {
  const room = await findBomberOpening("主动拆弹");
  try {
    const bomb = await activateBomber(room);
    await progressTo(room, room.targetId, "play");
    const targetClient = clientFor(room, room.targetId);
    const targetBefore = targetClient.snapshot.players.find((player) => player.id === room.targetId);
    const action = targetClient.snapshot.game.legalActions.find((candidate) => candidate.type === "bomb:remove"
      && candidate.payload?.markerId === bomb.markerId);
    assert.ok(action, "the target should receive a legal bomb removal action during its play phase");
    const costRole = targetBefore.characterSlots.find((card) => card?.instanceId);
    assert.ok(costRole?.instanceId);
    const healthBefore = targetBefore.health;
    const handBefore = targetBefore.hand.length;
    const snapshot = await command(room, room.targetId, "bomb:remove", {
      markerId: bomb.markerId,
      costCharacterIds: [costRole.instanceId],
    });
    const targetAfter = snapshot.players.find((player) => player.id === room.targetId);
    assert.equal(targetAfter.characterSlots[bomb.targetSlotIndex], null);
    assert.equal(targetAfter.characterSlots.some((card) => card?.instanceId === costRole.instanceId), false);
    assert.equal(targetAfter.health, healthBefore);
    assert.equal(targetAfter.hand.length, handBefore);
    assert.ok(snapshot.game.logs.some((log) => log.text.includes("拆除了「炸弹」")));
    console.log("[bomb-smoke] active removal path verified");
  } finally {
    await closeRoom(room);
  }
}

async function testExplosion() {
  const room = await findBomberOpening("延时爆炸");
  try {
    const bomb = await activateBomber(room);
    await progressTo(room, room.targetId, "play");
    await progressTo(room, room.sourceId, "preparation");
    const targetClient = clientFor(room, room.targetId);
    const targetBefore = targetClient.snapshot.players.find((player) => player.id === room.targetId);
    const healthBefore = targetBefore.health;
    const handBefore = targetBefore.hand.length;
    const snapshot = await progressTo(room, room.sourceId, "play");
    const targetAfter = snapshot.players.find((player) => player.id === room.targetId);
    assert.equal(targetAfter.characterSlots[bomb.targetSlotIndex], null);
    assert.equal(targetAfter.health, healthBefore - 1);
    assert.equal(targetAfter.hand.length, handBefore - 1);
    assert.ok(snapshot.game.logs.some((log) => log.text.includes("「炸弹」爆炸")));
    const randomDiscard = snapshot.game.logs.some((log) => log.text.includes("随机弃置了1张手牌"));
    console.log(`[bomb-smoke] delayed explosion path verified; discard mode: ${randomDiscard ? "random" : "chosen"}`);
    return randomDiscard;
  } finally {
    await closeRoom(room);
  }
}

await testRemoval();
const randomDiscard = await testExplosion();
console.log(`[bomb-smoke] bomber lifecycle verified${randomDiscard ? "; formal-text mismatch confirmed: discard is currently random" : ""}`);
