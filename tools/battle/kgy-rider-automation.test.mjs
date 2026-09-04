import assert from "node:assert/strict";
import test from "node:test";
import { AutoBattleRoom, hand, roomRuntime, role } from "./fixtures/auto-room-runtime.mjs";

const KGY = "body_roaming_001";
const ROLE = {
  强攻: "char_003_qindi_sheriff",
  防御: "char_016_baizi_gravy",
  资源: "char_012_baizi_bird-eater",
  控制: "char_002_weixiaokele_assassin",
  支援: "char_013_weixiaokele_morphling",
  伏击: "char_001_keke_assassin",
};

async function kgyRoom(ownerRoles = [], opponentRoles = []) {
  const r = await roomRuntime(ownerRoles, opponentRoles);
  r.owner.body = { instanceId: "body-kgy", definitionId: KGY, ownerId: "p1", kind: "body", faceDown: false };
  r.owner.bodyState = r.room.newBodyState(KGY);
  return r;
}

function resolveOpponentSkill(r, mainRole, definitionId = ROLE[mainRole], activationId = crypto.randomUUID(), characterInstanceId = "") {
  r.room.emitEvent("skill_used", { sourcePlayerId: "p2", characterDefinitionId: definitionId, metadata: { mainRole } });
  r.room.emitEvent("skill_resolved", { sourcePlayerId: "p2", characterDefinitionId: definitionId, metadata: { activationId, characterInstanceId } });
  r.room.openNextSkillTrigger();
  return activationId;
}

test("正面每回合获得一次骑士卡，放弃不消耗机会且同定位不重复", async () => {
  const r = await kgyRoom();
  resolveOpponentSkill(r, "资源");
  assert.equal(r.state.prompt?.context?.action, "kgy-acquire");
  await r.choose({ value: "pass" });
  assert.equal(r.owner.bodyState.riderCards.资源, "absent");

  resolveOpponentSkill(r, "资源", ROLE.资源, "second-activation");
  await r.choose({ value: "acquire" });
  assert.equal(r.owner.bodyState.riderCards.资源, "normal");

  resolveOpponentSkill(r, "控制");
  assert.equal(r.state.prompt, undefined, "成功获得后，本回合不再询问其他定位");
});

test("普通资源骑士卡支付同定位退场费用并摸2张，费用不产生退场事件", async () => {
  const r = await kgyRoom([ROLE.资源]);
  r.owner.bodyState.riderCards.资源 = "normal";
  const cost = r.owner.characterSlots[0];
  const before = r.owner.hand.length;
  await r.command("p1", "rider:activate", { riderId: "rider_resource", costCharacterIds: [cost.instanceId] });
  assert.equal(r.owner.hand.length, before + 2);
  assert.equal(r.owner.characterSlots[0], null);
  assert.equal(r.owner.retired.at(-1)?.instanceId, cost.instanceId);
  assert.equal(r.owner.bodyState.riderCards.资源, "absent");
  assert.equal(r.owner.bodyState.progress, 1);
  assert.equal(r.state.recentEvents.some((event) => event.type === "character_retired"), false);
});

test("普通支援借助费用空位连续暗置上阵至多2张", async () => {
  const r = await kgyRoom([ROLE.支援, ROLE.强攻, ROLE.防御]);
  r.owner.bodyState.riderCards.支援 = "normal";
  r.owner.characterDeck = [role("support-next-a", ROLE.控制), role("support-next-b", ROLE.伏击)];
  await r.command("p1", "rider:activate", { riderId: "rider_support", costCharacterIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.owner.characterSlots.filter(Boolean).length, 4);
  assert.equal(r.owner.characterSlots.some((card) => card?.instanceId === "support-next-a" && card.faceDown), true);
  assert.equal(r.owner.characterSlots.some((card) => card?.instanceId === "support-next-b" && card.faceDown), true);
});

test("普通防御骑士卡将伤害减1，错误定位不能支付费用", async () => {
  const r = await kgyRoom([ROLE.防御, ROLE.资源]);
  r.owner.bodyState.riderCards.防御 = "normal";
  const before = r.owner.health;
  assert.equal(r.room.applyDamage(r.owner, 2, "p2"), undefined);
  assert.equal(r.state.prompt?.context?.action, "kgy-defense");
  await assert.rejects(() => r.choose({ cardInstanceIds: [r.owner.characterSlots[1].instanceId] }), /防御角色/);
  await r.choose({ cardInstanceIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.owner.health, before - 1);
});

test("普通强攻骑士卡强化真实出刀且保留对手闪避响应", async () => {
  const r = await kgyRoom([ROLE.强攻]);
  r.owner.bodyState.riderCards.强攻 = "normal";
  r.owner.hand = [hand("strike", "hand_basic_001")];
  await r.command("p1", "hand:play", { instanceId: "strike" });
  assert.equal(r.state.prompt?.context?.action, "kgy-attack");
  await r.choose({ cardInstanceIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.state.prompt?.kind, "response");
  assert.match(r.state.prompt?.message || "", /出刀/);
  await r.command("p2", "response:pass");
  assert.equal(r.opponent.health, 5);
});

test("普通控制置底明置角色，FINAL控制将明置角色退场", async () => {
  const normal = await kgyRoom([ROLE.控制], [ROLE.强攻]);
  normal.owner.bodyState.riderCards.控制 = "normal";
  const normalTarget = normal.opponent.characterSlots[0];
  await normal.command("p1", "rider:activate", { riderId: "rider_control", costCharacterIds: [normal.owner.characterSlots[0].instanceId] });
  await normal.choose({ value: "0" });
  assert.equal(normal.opponent.characterSlots[0], null);
  assert.equal(normal.opponent.characterDeck[0]?.instanceId, normalTarget.instanceId);

  const final = await kgyRoom([ROLE.控制], [ROLE.强攻]);
  final.owner.bodyState.flipped = true;
  final.owner.bodyState.extraFormUsed = true;
  final.owner.bodyState.dynamaxEnergy = 3;
  final.owner.bodyState.riderCards.控制 = "final";
  const finalTarget = final.opponent.characterSlots[0];
  await final.command("p1", "rider:activate", { riderId: "rider_control", costCharacterIds: [final.owner.characterSlots[0].instanceId] });
  await final.choose({ value: "0" });
  assert.equal(final.opponent.retired.at(-1)?.instanceId, finalTarget.instanceId);
  assert.equal(final.owner.bodyState.dynamaxEnergy, 2);
});

test("FINAL资源摸4弃1且普通与FINAL共享每回合一次额度", async () => {
  const r = await kgyRoom([ROLE.资源, ROLE.支援]);
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxEnergy = 3;
  r.owner.bodyState.riderCards = { 强攻: "final", 防御: "final", 资源: "final", 控制: "final", 支援: "final", 伏击: "final" };
  const before = r.owner.hand.length;
  await r.command("p1", "rider:activate", { riderId: "rider_resource", costCharacterIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.owner.hand.length, before + 4);
  await r.choose({ cardInstanceIds: [r.owner.hand[0].instanceId] });
  assert.equal(r.owner.hand.length, before + 3);
  await assert.rejects(() => r.command("p1", "rider:activate", { riderId: "rider_support", costCharacterIds: [r.owner.characterSlots[1].instanceId] }), /本回合已经使用过骑士卡/);
});

test("普通伏击在对手技能结算后将发动者洗回牌堆", async () => {
  const r = await kgyRoom([ROLE.伏击], [ROLE.强攻]);
  r.owner.bodyState.riderCards.伏击 = "normal";
  const source = r.opponent.characterSlots[0];
  resolveOpponentSkill(r, "强攻", source.definitionId, crypto.randomUUID(), source.instanceId);
  assert.equal(r.state.prompt?.context?.action, "kgy-ambush");
  await r.choose({ cardInstanceIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.opponent.characterSlots[0], null);
  assert.equal(r.opponent.characterDeck.some((card) => card.instanceId === source.instanceId), true);
  assert.equal(r.state.prompt?.context?.action, "kgy-acquire", "处理伏击卡后仍可获得本次技能对应的强攻骑士卡");
});

test("技能发动者已离场时不询问普通伏击，但仍可获得其定位骑士卡", async () => {
  const r = await kgyRoom([ROLE.伏击], [ROLE.支援]);
  r.owner.bodyState.riderCards.伏击 = "normal";
  const source = r.opponent.characterSlots[0];
  r.opponent.characterSlots[0] = null;
  r.opponent.retired.push(source);
  resolveOpponentSkill(r, "支援", source.definitionId, crypto.randomUUID(), source.instanceId);
  assert.equal(r.state.prompt?.context?.action, "kgy-acquire");
  assert.equal(r.state.prompt?.context?.role, "支援");
});

test("极巨化取得六张FINAL，FINAL支援可回收刚支付的角色，最后效果后降级", async () => {
  const r = await kgyRoom([ROLE.支援]);
  r.owner.bodyState.progress = 4;
  r.state.phase = "preparation";
  r.room.onPhaseEntered("preparation", r.opponent);
  await r.choose({ value: "activate" });
  assert.equal(r.owner.bodyState.flipped, true);
  assert.equal(r.owner.bodyState.dynamaxEnergy, 3);
  assert.deepEqual(new Set(Object.values(r.owner.bodyState.riderCards)), new Set(["final"]));

  r.owner.bodyState.dynamaxEnergy = 1;
  r.state.phase = "play";
  const costId = r.owner.characterSlots[0].instanceId;
  await r.command("p1", "rider:activate", { riderId: "rider_support", costCharacterIds: [costId] });
  assert.equal(r.state.prompt?.context?.action, "kgy-support-return");
  assert.equal(r.state.prompt?.cardInstanceIds.includes(costId), true);
  assert.equal(r.owner.bodyState.flipped, true, "多步效果未完成前不翻回");
  await r.choose({ cardInstanceIds: [costId] });
  assert.equal(r.owner.bodyState.flipped, false);
  assert.equal(r.owner.characterDeck.some((card) => card.instanceId === costId), true);
  assert.equal(r.owner.bodyState.riderCards.支援, "absent");
  assert.equal(r.owner.bodyState.riderCards.强攻, "normal");
});

test("FINAL伏击在费用后令角色技能失效，并于结算完成后退出极巨化", async () => {
  const r = await kgyRoom([ROLE.伏击], [ROLE.强攻]);
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxEnergy = 1;
  r.owner.bodyState.dynamaxHealth = 2;
  r.owner.bodyState.riderCards.伏击 = "final";
  const source = r.opponent.characterSlots[0];
  const item = {
    kind: "character-skill", id: "skill-item", sourcePlayerId: "p2", sourceInstanceId: source.instanceId,
    definitionId: source.definitionId, handlerId: source.definitionId, activationId: "activation",
  };
  r.state.stack.push(item);
  assert.equal(r.room.openKgyFinalAmbushWindow(item), true);
  await r.choose({ cardInstanceIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.state.stack.length, 0);
  assert.equal(r.owner.bodyState.flipped, false);
  assert.equal(r.owner.bodyState.dynamaxEnergy, 0);
});

test("FINAL强攻视为使用不计次数的2伤出刀，整张牌结算后才退出极巨化", async () => {
  const r = await kgyRoom([ROLE.强攻]);
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxEnergy = 1;
  r.owner.bodyState.riderCards.强攻 = "final";
  const before = r.opponent.health;
  await r.command("p1", "rider:activate", { riderId: "rider_attack", costCharacterIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.owner.bodyState.flipped, true, "响应窗口内不应提前翻回正面");
  assert.equal(r.state.prompt?.kind, "response");
  await r.command("p2", "response:pass");
  assert.equal(r.opponent.health, before - 2);
  assert.equal(r.state.usageCounters[`turn:${r.state.turnNumber}:p1:strike`] || 0, 0);
  assert.equal(r.owner.bodyState.flipped, false);
});

test("FINAL防御防止整次伤害，最后1点能量在防止完成后结束极巨化", async () => {
  const r = await kgyRoom([ROLE.防御]);
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxEnergy = 1;
  r.owner.bodyState.dynamaxHealth = 2;
  r.owner.bodyState.riderCards.防御 = "final";
  const before = r.owner.health;
  assert.equal(r.room.applyDamage(r.owner, 3, "p2"), undefined);
  await r.choose({ cardInstanceIds: [r.owner.characterSlots[0].instanceId] });
  assert.equal(r.owner.health, before);
  assert.equal(r.owner.bodyState.flipped, false);
  assert.equal(r.owner.bodyState.dynamaxHealth, 0);
});

test("骑士卡状态对双方和观战者公开，但不泄露暗置角色", async () => {
  const r = await kgyRoom([ROLE.资源]);
  r.owner.bodyState.riderCards.资源 = "normal";
  r.owner.characterSlots[0].faceDown = true;
  const opponentView = r.room.snapshotFor("p2", false);
  const spectatorView = r.room.snapshotFor("spectator", true);
  assert.equal(opponentView.players[0].bodyState.riderCards.资源, "normal");
  assert.equal(spectatorView.players[0].bodyState.riderCards.资源, "normal");
  assert.equal(opponentView.players[0].characterSlots[0].definitionId, undefined);
  assert.equal(spectatorView.players[0].characterSlots[0].definitionId, undefined);
});

test("旧自动房间恢复时补齐骑士卡状态", async () => {
  const source = await kgyRoom();
  const legacy = structuredClone(source.state);
  legacy.stateVersion = 4;
  delete legacy.players[0].bodyState.riderCards;
  delete legacy.players[0].bodyState.riderAcquiredEventIds;
  let initialization;
  const ctx = {
    storage: { async get() { return legacy; }, async put() {}, async setAlarm() {} },
    blockConcurrencyWhile(fn) { initialization = fn(); },
    getWebSockets: () => [],
  };
  const env = { BATTLE_LOBBY: { getByName: () => ({ async upsertRoom() {} }) } };
  const restored = new AutoBattleRoom(ctx, env);
  await initialization;
  assert.equal(restored.state.stateVersion, 5);
  assert.deepEqual(restored.state.players[0].bodyState.riderCards, {
    强攻: "absent", 防御: "absent", 资源: "absent", 控制: "absent", 支援: "absent", 伏击: "absent",
  });
  assert.deepEqual(restored.state.players[0].bodyState.riderAcquiredEventIds, {});
});
