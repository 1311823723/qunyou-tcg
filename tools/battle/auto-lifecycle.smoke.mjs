import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.BATTLE_BASE || "http://127.0.0.1:8787";
const characters = JSON.parse(fs.readFileSync(new URL("../../data/cards/characters.json", import.meta.url), "utf8"));
const host = { nickname: "自动测试A", token: `auto-host-${crypto.randomUUID()}`, deckId: process.env.AUTO_HOST_DECK || "deck_combo_001" };
const guest = { nickname: "自动测试B", token: `auto-guest-${crypto.randomUUID()}`, deckId: process.env.AUTO_GUEST_DECK || "deck_mizai_001" };

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

function client(code, identity, spectator = false) {
  const url = new URL(`${base.replace(/^http/, "ws")}/auto/rooms/${code}/connect`);
  url.searchParams.set("token", identity.token);
  if (spectator) {
    url.searchParams.set("spectator", "true");
    url.searchParams.set("nickname", identity.nickname);
  }
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let revision = 0;
  let latestSnapshot;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "snapshot") { revision = message.snapshot.revision; latestSnapshot = message.snapshot; }
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
      socket.send(JSON.stringify({ type, payload, actionId: crypto.randomUUID(), protocolVersion: 2, baseRevision: revision }));
    },
    waitFor(predicate, timeout = 8000) {
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
          reject(new Error(`Timed out waiting for automatic room message. Recent: ${recent || "none"}`));
        }, timeout);
      });
    },
    get revision() { return revision; },
    get snapshot() { return latestSnapshot; },
  };
}

const rejectedCustom = await post("/auto/rooms", {
  nickname: "自选拒绝测试",
  token: `auto-custom-${crypto.randomUUID()}`,
  deckId: "custom",
  customDeck: { bodyId: "body_combo_001", characterIds: characters.slice(0, 16).map((card) => card.id) },
});
assert.equal(rejectedCustom.response.status, 400);

const rejectedLocked = await post("/auto/rooms", {
  nickname: "锁定预组测试",
  token: `auto-locked-${crypto.randomUUID()}`,
  deckId: "deck_trans_001",
});
assert.equal(rejectedLocked.response.status, 400);

const created = await post("/auto/rooms", host);
assert.equal(created.response.status, 200);
assert.equal(created.body.mode, "auto");
const code = created.body.roomCode;
assert.match(code, /^[A-Z0-9]{6}$/);

const meta = await fetch(`${base}/rooms/${code}/meta`).then((response) => response.json());
assert.equal(meta.mode, "auto");

const joined = await post(`/auto/rooms/${code}/join`, guest);
assert.equal(joined.response.status, 200);

const a = client(code, host);
const b = client(code, guest);
await Promise.all([
  new Promise((resolve) => a.socket.addEventListener("open", resolve, { once: true })),
  new Promise((resolve) => b.socket.addEventListener("open", resolve, { once: true })),
]);
await Promise.all([a.waitFor((message) => message.type === "snapshot"), b.waitFor((message) => message.type === "snapshot")]);
a.send("player:ready", { ready: true });
await a.waitFor((message) => message.type === "snapshot" && message.snapshot.players.find((player) => player.id === "p1")?.ready);
b.send("player:ready", { ready: true });
const [startedA, startedB] = await Promise.all([
  a.waitFor((message) => message.type === "snapshot" && message.snapshot.game.started),
  b.waitFor((message) => message.type === "snapshot" && message.snapshot.game.started),
]);
assert.equal(startedA.snapshot.mode, "auto");
assert.equal(startedA.snapshot.players.find((player) => player.id === "p1").deckId, host.deckId);
assert.equal(startedA.snapshot.players.find((player) => player.id === "p2").deckId, guest.deckId);
assert.equal(startedA.snapshot.game.phase, "preparation");
assert.ok([...startedA.snapshot.game.legalActions, ...startedB.snapshot.game.legalActions]
  .some((action) => action.type === "phase:advance" || action.type === "skill:activate"));
assert.equal(startedA.snapshot.players.find((player) => player.id === "p1").hand.length, 5);
for (const snapshot of [startedA.snapshot, startedB.snapshot]) {
  assert.ok(snapshot.players.every((player) => player.characterSlots.filter(Boolean).length === 2),
    "each player should begin with exactly two occupied character slots");
  assert.ok(snapshot.players.every((player) => player.characterSlots.filter(Boolean).every((card) => card.faceDown)),
    "all opening characters should begin face-down");
}
assert.ok(startedA.snapshot.players.every((player) => player.bodyState.progressMax > 0));
assert.ok(startedA.snapshot.players.every((player) => player.bodyState.progress === 0));
assert.ok(startedA.snapshot.players.every((player) => player.bodyState.flipped === false && player.bodyState.extraFormUsed === false));
assert.ok(startedB.snapshot.players.find((player) => player.id === "p1").hand.every((card) => card.faceDown && !card.definitionId));

const byPlayerId = (id) => id === "p1" ? a : b;
let settled = startedA;
while (settled.snapshot.game.prompt?.kind === "character-trigger") {
  const actor = byPlayerId(settled.snapshot.game.prompt.playerId);
  const revision = settled.snapshot.revision;
  actor.send("choice:submit", { value: "pass" });
  settled = await a.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > revision);
}

const currentId = settled.snapshot.game.currentPlayerId;
const current = currentId === "p1" ? a : b;
const currentSnapshot = settled.snapshot;
current.send("phase:advance");
const drawPhase = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > currentSnapshot.revision && message.snapshot.game.phase === "draw");
assert.equal(drawPhase.snapshot.players.find((player) => player.id === currentId).hand.length, 7);

current.send("phase:advance");
const playPhase = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > drawPhase.snapshot.revision && message.snapshot.game.phase === "play");
const currentPlayer = playPhase.snapshot.players.find((player) => player.id === currentId);
const skillInstanceId = playPhase.snapshot.game.legalSkillInstanceIds[0];
let afterSkill = playPhase;
if (skillInstanceId) {
  const skillCard = currentPlayer.characterSlots.find((card) => card?.instanceId === skillInstanceId);
  const skillDefinition = characters.find((card) => card.id === skillCard.definitionId);
  assert.equal(skillCard.faceDown, true, "an opening character should reveal as part of skill activation");
  const costCharacterIds = skillDefinition.cost.type === "休整自身"
    ? [skillInstanceId]
    : skillDefinition.cost.type === "休整" && skillDefinition.cost.amount > 0
      ? currentPlayer.characterSlots.filter((card) => card?.instanceId).slice(0, skillDefinition.cost.amount).map((card) => card.instanceId)
      : [];
  current.send("skill:activate", { instanceId: skillInstanceId, costCharacterIds });
  afterSkill = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > playPhase.snapshot.revision);
  while (afterSkill.snapshot.game.prompt?.kind === "character-skill") {
    const prompt = afterSkill.snapshot.game.prompt;
    const revision = afterSkill.snapshot.revision;
    const actor = byPlayerId(prompt.playerId);
    await actor.waitFor((message) => message.type === "snapshot" && message.snapshot.revision >= revision);
    const simpleOption = prompt.options?.find((option) => ["allow", "done", "none", "pass"].includes(option.value)) || prompt.options?.[0];
    const payload = simpleOption
      ? { value: simpleOption.value }
      : { cardInstanceIds: (prompt.cardInstanceIds || []).slice(0, Number(prompt.min || 0)) };
    actor.send("choice:submit", payload);
    afterSkill = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > revision);
  }
  assert.ok(afterSkill.snapshot.game.logs.some((log) => log.text.includes("发动了角色")));
  const resolvedPlayer = afterSkill.snapshot.players.find((player) => player.id === currentId);
  for (const id of costCharacterIds) {
    assert.equal(resolvedPlayer.characterSlots.some((card) => card?.instanceId === id), false,
      "characters paid as a rest cost should leave the character area");
  }
  const resolvedSkillCard = resolvedPlayer.characterSlots.find((card) => card?.instanceId === skillInstanceId);
  if (resolvedSkillCard) assert.equal(resolvedSkillCard.faceDown, false,
    "a skill source that remains in play should be face-up after activation");
  if (skillDefinition.cost.type === "退场") {
    assert.ok(resolvedPlayer.retired.some((card) => card.instanceId === skillInstanceId),
      "a skill with a retire cost should move its source to the retired area");
  }
  console.log(`[auto-smoke] opening two-role skill activated: ${skillDefinition.name} / ${skillDefinition.skillName}`);
} else {
  assert.notEqual(process.env.AUTO_REQUIRE_SKILL, "1", "the current player's two opening roles did not include a play-phase skill");
  console.log("[auto-smoke] opening two-role skill skipped: the current player's opening roles have no play-phase action");
}
const afterSkillPlayer = afterSkill.snapshot.players.find((player) => player.id === currentId);
const playable = afterSkillPlayer.hand.find((card) => afterSkill.snapshot.game.legalHandCardIds.includes(card.instanceId) && card.definitionId !== "hand_trick_004");
assert.ok(playable, "the current player should have at least one hand card usable by the authoritative server");
current.send("hand:play", {
  instanceId: playable.instanceId,
  ...(playable.definitionId === "hand_basic_004" ? { resolvedAs: "hand_basic_003" } : {}),
  ...(playable.definitionId === "hand_trick_007" ? { targetSlotIndex: 0 } : {}),
});
let afterPlay = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > afterSkill.snapshot.revision);
while (afterPlay.snapshot.game.prompt?.kind === "response") {
  const responder = afterPlay.snapshot.game.prompt.playerId === "p1" ? a : b;
  const previousRevision = afterPlay.snapshot.revision;
  await responder.waitFor((message) => message.type === "snapshot"
    && message.snapshot.revision >= previousRevision
    && message.snapshot.game.prompt?.kind === "response");
  responder.send("response:pass");
  afterPlay = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > previousRevision);
}
assert.equal(afterPlay.snapshot.players.find((player) => player.id === currentId).hand.some((card) => card.instanceId === playable.instanceId), false);
assert.ok(afterPlay.snapshot.game.handDiscard.some((card) => card.instanceId === playable.instanceId));

const watcher = { nickname: "自动观战", token: `auto-watch-${crypto.randomUUID()}` };
const spectator = client(code, watcher, true);
await new Promise((resolve) => spectator.socket.addEventListener("open", resolve, { once: true }));
const watched = await spectator.waitFor((message) => message.type === "snapshot" && message.snapshot.isSpectator);
assert.ok(watched.snapshot.players.every((player) => player.hand.every((card) => card.faceDown && !card.definitionId)));
assert.ok(watched.snapshot.players.every((player) => player.bodyState.trackedCharacterInstanceIds.length === 0));
assert.deepEqual(watched.snapshot.game.legalActions, []);

a.send("room:end");
await Promise.all([a.waitFor((message) => message.type === "roomEnded"), b.waitFor((message) => message.type === "roomEnded")]);
a.socket.close();
b.socket.close();
spectator.socket.close();
console.log("[auto-smoke] automatic room lifecycle verified");
