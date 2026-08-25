import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.BATTLE_BASE || "http://127.0.0.1:8787";
const characters = JSON.parse(fs.readFileSync(new URL("../../data/cards/characters.json", import.meta.url), "utf8"));
const automation = JSON.parse(fs.readFileSync(new URL("../../data/cards/character_automation.json", import.meta.url), "utf8"));
const activeCharacterIds = characters.filter((card) => automation[card.id]?.trigger.event === "play_phase").slice(0, 16).map((card) => card.id);
const customDeck = { bodyId: "body_aggro_001", characterIds: activeCharacterIds };
const host = { nickname: "自动测试A", token: `auto-host-${crypto.randomUUID()}`, deckId: "custom", customDeck };
const guest = { nickname: "自动测试B", token: `auto-guest-${crypto.randomUUID()}`, deckId: "custom", customDeck };

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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "snapshot") revision = message.snapshot.revision;
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
          reject(new Error("Timed out waiting for automatic room message"));
        }, timeout);
      });
    },
    get revision() { return revision; },
  };
}

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
assert.equal(startedA.snapshot.game.phase, "preparation");
assert.equal(startedA.snapshot.players.find((player) => player.id === "p1").hand.length, 5);
assert.ok(startedB.snapshot.players.find((player) => player.id === "p1").hand.every((card) => card.faceDown && !card.definitionId));

const currentId = startedA.snapshot.game.currentPlayerId;
const current = currentId === "p1" ? a : b;
const currentSnapshot = currentId === "p1" ? startedA.snapshot : startedB.snapshot;
current.send("phase:advance");
const drawPhase = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > currentSnapshot.revision && message.snapshot.game.phase === "draw");
assert.equal(drawPhase.snapshot.players.find((player) => player.id === currentId).hand.length, 7);

current.send("phase:advance");
const playPhase = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > drawPhase.snapshot.revision && message.snapshot.game.phase === "play");
const currentPlayer = playPhase.snapshot.players.find((player) => player.id === currentId);
const skillInstanceId = playPhase.snapshot.game.legalSkillInstanceIds[0];
assert.ok(skillInstanceId, "a play-phase role should be available for assisted resolution");
const skillCard = currentPlayer.characterSlots.find((card) => card?.instanceId === skillInstanceId);
const skillDefinition = characters.find((card) => card.id === skillCard.definitionId);
const costCharacterIds = skillDefinition.cost.type === "休整自身"
  ? [skillInstanceId]
  : skillDefinition.cost.type === "休整" && skillDefinition.cost.amount > 0
    ? currentPlayer.characterSlots.filter((card) => card?.instanceId).slice(0, skillDefinition.cost.amount).map((card) => card.instanceId)
    : [];
current.send("skill:activate", { instanceId: skillInstanceId, costCharacterIds });
const assisted = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > playPhase.snapshot.revision && message.snapshot.game.prompt?.kind === "assisted-skill");
current.send("assisted:finish");
const afterSkill = await current.waitFor((message) => message.type === "snapshot" && message.snapshot.revision > assisted.snapshot.revision && !message.snapshot.game.prompt);
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

a.send("room:end");
await Promise.all([a.waitFor((message) => message.type === "roomEnded"), b.waitFor((message) => message.type === "roomEnded")]);
a.socket.close();
b.socket.close();
spectator.socket.close();
console.log("[auto-smoke] automatic room lifecycle verified");
