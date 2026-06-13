import assert from "node:assert/strict";

const base = process.env.BATTLE_BASE || "http://127.0.0.1:8787";
const owner = { nickname: "生命周期测试A", token: `owner-${crypto.randomUUID()}`, deckId: "deck_aggro_001" };
const guest = { nickname: "生命周期测试B", token: `guest-${crypto.randomUUID()}`, deckId: "deck_mizai_001" };
const step = (label) => console.log(`[battle-smoke] ${label}`);

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, result: await response.json() };
}

function client(code, player) {
  const url = new URL(`${base.replace(/^http/, "ws")}/rooms/${code}/connect`);
  url.searchParams.set("token", player.token);
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
  const waitFor = (predicate, timeout = 8000) => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("Timed out waiting for WebSocket message"));
      }, timeout);
    });
  };
  const send = (type, payload = {}, options = {}) => {
    const actionId = options.actionId || crypto.randomUUID();
    socket.send(JSON.stringify({
      type,
      actionId,
      baseRevision: options.baseRevision ?? revision,
      payload,
    }));
    return actionId;
  };
  return { socket, messages, waitFor, send, get revision() { return revision; } };
}

const blockedOrigin = await fetch(`${base}/rooms`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://example.invalid",
  },
  body: JSON.stringify(owner),
});
assert.equal(blockedOrigin.status, 403);
step("disallowed browser origin rejected");

const created = await post("/rooms", owner);
step("room created");
assert.equal(created.response.status, 200);
const code = created.result.roomCode;
assert.match(code, /^[A-Z0-9]{6}$/);
assert.equal((await post(`/rooms/${code}/join`, guest)).response.status, 200);

const a = client(code, owner);
const b = client(code, guest);
await Promise.all([
  new Promise((resolve) => a.socket.addEventListener("open", resolve, { once: true })),
  new Promise((resolve) => b.socket.addEventListener("open", resolve, { once: true })),
]);
await Promise.all([
  a.waitFor((message) => message.type === "snapshot"),
  b.waitFor((message) => message.type === "snapshot"),
]);

a.send("player:ready", { ready: true });
await b.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.players.some((player) => player.id !== message.snapshot.you && player.ready),
);
b.send("player:ready", { ready: true });
const [startedA, startedB] = await Promise.all([
  a.waitFor((message) => message.type === "snapshot" && message.snapshot.game.started),
  b.waitFor((message) => message.type === "snapshot" && message.snapshot.game.started),
]);
step("game started");
const ownerView = startedA.snapshot.players.find((player) => player.id === startedA.snapshot.you);
const guestView = startedB.snapshot.players.find((player) => player.id === startedB.snapshot.you);
const originalBodyId = ownerView.body.instanceId;
const ownerOpponent = startedA.snapshot.players.find((player) => player.id !== startedA.snapshot.you);
const guestOpponent = startedB.snapshot.players.find((player) => player.id !== startedB.snapshot.you);

b.send("health:set", { playerId: ownerView.id, value: 5 });
await Promise.all([
  a.waitFor((message) =>
    message.type === "snapshot"
    && message.snapshot.players.find((player) => player.id === ownerView.id)?.health === 5,
  ),
  b.waitFor((message) =>
    message.type === "snapshot"
    && message.snapshot.players.find((player) => player.id === ownerView.id)?.health === 5,
  ),
]);
step("opponent health adjustment synchronized");

for (const opponent of [ownerOpponent, guestOpponent]) {
  assert.equal(opponent.handCount, 5);
  assert.equal(opponent.characterHandCount, 4);
  assert.ok(opponent.hand.every((card) => !("instanceId" in card) && !("definitionId" in card)));
  assert.ok(opponent.characterHand.every((card) => !("instanceId" in card) && !("definitionId" in card)));
}

const third = await post(`/rooms/${code}/join`, {
  nickname: "第三人",
  token: `third-${crypto.randomUUID()}`,
  deckId: "deck_combo_001",
});
assert.equal(third.response.status, 409);
step("private snapshots and third-player rejection verified");

a.messages.length = 0;
b.messages.length = 0;
const ownerCharacter = ownerView.characterHand[0];
a.send("card:move", {
  instanceId: ownerCharacter.instanceId,
  targetZone: "characterSlot",
  targetIndex: 0,
  faceDown: true,
});
const [ownerRoleSnapshot, hiddenRoleSnapshot] = await Promise.all([
  a.waitFor((message) => {
    if (message.type !== "snapshot") return false;
    const me = message.snapshot.players.find((player) => player.id === message.snapshot.you);
    return me?.characterSlots[0]?.instanceId === ownerCharacter.instanceId;
  }),
  b.waitFor((message) => {
    if (message.type !== "snapshot") return false;
    const opponent = message.snapshot.players.find((player) => player.id !== message.snapshot.you);
    return Boolean(opponent?.characterSlots[0]?.faceDown);
  }),
]);
const hiddenRole = hiddenRoleSnapshot.snapshot.players
  .find((player) => player.id !== hiddenRoleSnapshot.snapshot.you)
  .characterSlots[0];
assert.equal(hiddenRole.instanceId, undefined);
assert.equal(hiddenRole.definitionId, undefined);
assert.ok(hiddenRoleSnapshot.snapshot.game.logs.some((log) =>
  log.text.includes("一张角色牌从角色手牌移动到角色区")
));
assert.ok(hiddenRoleSnapshot.snapshot.game.logs.every((log) => !log.text.includes(ownerCharacter.definitionId)));

a.messages.length = 0;
a.send("character:declareSkill", { instanceId: ownerCharacter.instanceId });
const declaredSkill = await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.logs.some((log) =>
    log.text.includes("声明发动角色")
    && log.text.includes("类型：")
    && log.text.includes("发动时机：")
    && log.text.includes("消耗：")
    && log.text.includes("效果：")
  ),
);
const declarationLog = declaredSkill.snapshot.game.logs.find((log) => log.text.includes("声明发动角色"));
assert.ok(declarationLog.text.includes("技能【"));
step("character skill declaration logged with full details");

b.messages.length = 0;
b.send("card:inspect", {
  ownerId: ownerView.id,
  zone: "characterSlot",
  slotIndex: 0,
});
const roleInspection = await b.waitFor((message) => message.type === "inspection");
assert.equal(roleInspection.viewerId, guestView.id);
assert.deepEqual(roleInspection.allowedActions, []);
assert.ok(roleInspection.cards[0].definitionId);
step("face-down role redaction and positional inspection verified");

a.messages.length = 0;
b.messages.length = 0;
a.send("hand:randomSelect", { ownerId: guestView.id });
const [revealedA, revealedB] = await Promise.all([
  a.waitFor((message) => message.type === "inspection"),
  b.waitFor((message) => message.type === "inspection"),
]);
assert.deepEqual(
  revealedA.cards.map(({ instanceId: _instanceId, ...card }) => card),
  revealedB.cards,
);
assert.match(revealedA.title, /(黑桃|红桃|梅花|方块).+【.+】/);
assert.equal(revealedA.viewerId, startedA.snapshot.you);
assert.deepEqual(revealedA.allowedActions, ["handDeckTop", "handDeckBottom", "handDiscard", "hand"]);
assert.equal(revealedB.viewerId, startedA.snapshot.you);
assert.deepEqual(revealedB.allowedActions, []);
assert.equal(revealedB.cards[0].instanceId, undefined);
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.logs.some((log) => /(黑桃|红桃|梅花|方块).+【.+】/.test(log.text)),
);
step("random reveal verified");

step("non-viewer move rejected");

a.messages.length = 0;
a.send("card:inspect", { ownerId: guestView.id, zone: "hand" });
const fullInspection = await a.waitFor((message) => message.type === "inspection" && message.cards.length === 5);
const [firstInspected] = fullInspection.cards;
a.send("card:move", {
  instanceId: firstInspected.instanceId,
  targetZone: "handDiscard",
  inspectionId: fullInspection.inspectionId,
});
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.handDiscard.some((card) => card.instanceId === firstInspected.instanceId),
);
const discardSnapshot = a.messages.find((message) =>
  message.type === "snapshot"
  && message.snapshot.game.handDiscard.some((card) => card.instanceId === firstInspected.instanceId),
);
assert.ok(discardSnapshot.snapshot.game.logs.some((log) =>
  log.text.includes("弃置了")
  && /(黑桃|红桃|梅花|方块).+【.+】/.test(log.text)
));
step("discard log includes suit, rank and card name");

a.messages.length = 0;
const roleInSlot = ownerRoleSnapshot.snapshot.players
  .find((player) => player.id === declaredSkill.snapshot.you)
  .characterSlots[0];
a.send("card:move", {
  instanceId: roleInSlot.instanceId,
  targetZone: "characterDeckBottom",
});
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.logs.some((log) =>
    log.text.includes("休整了角色牌【")
    && log.text.includes("置于角色牌堆底")
  ),
);
step("character rest log includes character name");

a.messages.length = 0;
const deckCountBeforeRecycle = a.revision;
a.send("deck:recycleDiscard");
const recycledDiscard = await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.revision > deckCountBeforeRecycle
  && message.snapshot.game.handDiscard.length === 0
  && message.snapshot.game.handDeckCount === 43,
);
assert.ok(recycledDiscard.snapshot.game.logs.some((log) =>
  log.text.includes("将手牌弃牌区的 1 张牌洗混并放到共用牌堆底")
));
step("hand discard recycled to shared deck bottom");

a.messages.length = 0;
const ownerAfterRecycle = recycledDiscard.snapshot.players
  .find((player) => player.id === recycledDiscard.snapshot.you);
const resolvingCard = ownerAfterRecycle.hand[0];
a.send("card:move", {
  instanceId: resolvingCard.instanceId,
  targetZone: "resolving",
});
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.resolving.some((card) => card.instanceId === resolvingCard.instanceId),
);

a.messages.length = 0;
a.send("resolving:discardAll");
const clearedResolving = await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.game.resolving.length === 0
  && message.snapshot.game.handDiscard.some((card) => card.instanceId === resolvingCard.instanceId),
);
assert.ok(clearedResolving.snapshot.game.logs.some((log) =>
  log.text.includes("将结算区的 1 张牌全部弃置：")
  && /(黑桃|红桃|梅花|方块).+【.+】/.test(log.text)
));
step("resolving zone bulk discard verified");

a.send("card:inspect", { ownerId: guestView.id, zone: "hand" });
const secondInspection = await a.waitFor((message) =>
  message.type === "inspection"
  && message.inspectionId !== fullInspection.inspectionId
  && message.cards.length === 4,
);
a.messages.length = 0;
a.send("card:move", {
  instanceId: secondInspection.cards[0].instanceId,
  targetZone: "handDiscard",
  inspectionId: fullInspection.inspectionId,
});
await a.waitFor((message) => message.type === "error" && /授权/.test(message.error));
step("inspection grant consumption verified");

const staleRevision = a.revision - 1;
a.messages.length = 0;
a.send("health:set", { value: 2 }, { baseRevision: staleRevision });
await a.waitFor((message) => message.type === "error" && /状态已更新/.test(message.error));
step("stale revision rejected");

const duplicateActionId = crypto.randomUUID();
a.messages.length = 0;
a.send("health:set", { value: 2 }, { actionId: duplicateActionId });
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.players.find((player) => player.id === message.snapshot.you)?.health === 2,
);
a.send("health:set", { value: 6 }, { actionId: duplicateActionId });
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal(
  a.messages.filter((message) => message.type === "snapshot").at(-1)
    .snapshot.players.find((player) => player.id === a.messages.filter((message) => message.type === "snapshot").at(-1).snapshot.you).health,
  2,
);
step("duplicate action ignored");

a.messages.length = 0;
b.messages.length = 0;
a.send("room:restartRequest");
const requested = await b.waitFor((message) => message.type === "snapshot" && message.snapshot.pendingRestart);
b.send("room:restartRespond", {
  requestId: requested.snapshot.pendingRestart.id,
  accept: false,
});
await a.waitFor((message) => message.type === "snapshot" && !message.snapshot.pendingRestart);
step("restart rejection verified");

a.messages.length = 0;
a.send("room:restartRequest");
const cancelable = await a.waitFor((message) => message.type === "snapshot" && message.snapshot.pendingRestart);
a.send("room:restartCancel", { requestId: cancelable.snapshot.pendingRestart.id });
await a.waitFor((message) => message.type === "snapshot" && !message.snapshot.pendingRestart);
step("restart cancellation verified");

a.messages.length = 0;
b.messages.length = 0;
a.send("room:restartRequest");
const [requesterPending, acceptable] = await Promise.all([
  a.waitFor((message) => message.type === "snapshot" && message.snapshot.pendingRestart),
  b.waitFor((message) => message.type === "snapshot" && message.snapshot.pendingRestart),
]);
a.send("health:set", { value: 4 });
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.revision > requesterPending.snapshot.revision
  && message.snapshot.players.find((player) => player.id === message.snapshot.you)?.health === 4,
);
b.send("room:restartRespond", {
  requestId: acceptable.snapshot.pendingRestart.id,
  accept: true,
}, { baseRevision: acceptable.snapshot.revision });
const [restartedA, restartedB] = await Promise.all([
  a.waitFor((message) =>
    message.type === "snapshot"
    && message.snapshot.game.logs.some((log) => log.text.includes("牌局已重新开始"))
  ),
  b.waitFor((message) =>
    message.type === "snapshot"
    && message.snapshot.game.logs.some((log) => log.text.includes("牌局已重新开始"))
  ),
]);
step("restart acceptance verified");
for (const message of [restartedA, restartedB]) {
  assert.equal(message.snapshot.game.started, true);
  assert.equal(message.snapshot.game.handDeckCount, 42);
  for (const player of message.snapshot.players) {
    assert.equal(player.health, 7);
    assert.equal(player.megaProgress, 0);
    assert.equal(player.hand.length, 5);
    assert.equal(player.characterHand.length, 4);
    assert.equal(player.characterDeckCount, 12);
  }
}
assert.notEqual(
  restartedA.snapshot.players.find((player) => player.id === restartedA.snapshot.you).body.instanceId,
  originalBodyId,
);

b.socket.close();
await a.waitFor((message) =>
  message.type === "snapshot"
  && message.snapshot.players.some((player) => player.id !== message.snapshot.you && !player.connected),
);
a.messages.length = 0;
a.send("room:restartRequest");
await a.waitFor((message) => message.type === "error" && /离线/.test(message.error));
step("offline restart rejected");

const bReconnect = client(code, guest);
await new Promise((resolve) => bReconnect.socket.addEventListener("open", resolve, { once: true }));
await bReconnect.waitFor((message) => message.type === "snapshot");

a.messages.length = 0;
bReconnect.messages.length = 0;
a.send("room:end");
await Promise.all([
  a.waitFor((message) => message.type === "roomEnded"),
  bReconnect.waitFor((message) => message.type === "roomEnded"),
]);
const missing = await post(`/rooms/${code}/join`, guest);
assert.equal(missing.response.status, 404);
assert.equal(missing.result.error, "房间不存在或已经过期。");
a.socket.close();
bReconnect.socket.close();

console.log(JSON.stringify({
  roomCode: code,
  hiddenCardIdsRedacted: true,
  inspectionPermissionsEnforced: true,
  staleRevisionRejected: true,
  duplicateActionIgnored: true,
  randomRevealSentToBothPlayers: true,
  opponentHealthEditable: true,
  handDiscardRecycledToDeckBottom: true,
  resolvingZoneBulkDiscarded: true,
  characterSkillDeclarationDetailed: true,
  semanticDiscardAndRestLogs: true,
  restartRequiresBothPlayers: true,
  restartDecisionToleratesNewerRevision: true,
  restartSyncedToBothPlayers: true,
  roomEndedSentToBothPlayers: true,
  roomDeleted: true,
}, null, 2));
