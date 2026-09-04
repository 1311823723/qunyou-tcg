import assert from "node:assert/strict";
import test from "node:test";
import characters from "../../data/cards/characters.json" with { type: "json" };
import bodies from "../../data/cards/bodies.json" with { type: "json" };
import implementation from "../../data/cards/character_implementation.json" with { type: "json" };
import { HAND_IDS as H, advancePhase, canUseInPlay, legalResponseCards, handIsLocked } from "../../worker/src/auto-engine.mts";
import { EXTRA_CHARACTER_IDS as E } from "../../worker/src/skills/characters/extra.mts";
import { registeredCharacterSkillIds, characterSkillForId } from "../../worker/src/skills/character-registry.mts";
import { roomRuntime, role, hand, validAutoLoadout } from "./fixtures/auto-room-runtime.mjs";

const filler = "char_006_weixiaokele_ninja";
async function settle(r) { for (let i = 0; r.state.prompt && i < 30; i++) { if (!["response", "character-trigger"].includes(r.state.prompt.kind)) return; await r.pass(); } }
function saveAndRestore(r) { r.room.state = structuredClone(r.state); }

test("120角色均有模块；自选允许8个正式预组本体，拒绝3个新本体与非法卡组", () => {
  assert.equal(registeredCharacterSkillIds().length, 120);
  for (const card of characters) { assert.ok(characterSkillForId(card.id)); assert.equal(implementation[card.id].automation, "implemented"); }
  const deck = { bodyId: "body_combo_001", characterIds: characters.slice(0, 16).map((c) => c.id) };
  assert.equal(validAutoLoadout("custom", deck), true);
  for (const body of bodies) assert.equal(validAutoLoadout("custom", { ...deck, bodyId: body.id }), !["body_roaming_001", "body_antimagic_001", "body_crossfire_001"].includes(body.id), body.id);
  for (const ids of [deck.characterIds.slice(0, 15), [...deck.characterIds, E.warlock], Array(16).fill(E.warlock), ["unknown", ...deck.characterIds.slice(1)]]) assert.equal(validAutoLoadout("custom", { ...deck, characterIds: ids }), false);
});

test("19角色均拒绝错误时机；取消触发不支付费用", async () => {
  for (const id of Object.values(E)) {
    const r = await roomRuntime([id]); r.state.phase = "discard"; r.state.currentPlayerId = "p2";
    await assert.rejects(() => r.activate(), /时机|结算|当前|选择/);
    assert.equal(r.owner.characterSlots[0].definitionId, id);
  }
  const r = await roomRuntime([E.snitch]); r.opponent.hand.push(hand("loot", H.aid, "p2"));
  r.room.emitEvent("cards_drawn", { sourcePlayerId: "p2", targetPlayerId: "p2", amount: 1, metadata: { outsideDrawPhase: true } }); r.room.openNextSkillTrigger();
  await r.pass(); assert.ok(r.owner.characterSlots[0]); assert.equal(r.owner.hand.length, 0);
});

test("术士校验休整2及弃2，出刀分支2伤，减伤响应完成后才摸牌", async () => {
  const r = await roomRuntime([E.warlock, filler]); r.owner.hand.push(hand("strike", H.strike), hand("aid", H.aid));
  await assert.rejects(() => r.command("p1", "skill:activate", { instanceId: "p1-role-0", costCharacterIds: ["p1-role-0"] }), /费用|数量|选择/);
  assert.equal(r.owner.characterSlots.filter(Boolean).length, 2);
  await r.activate(); const before = r.owner.hand.length;
  await assert.rejects(() => r.choose({ cardInstanceIds: ["strike", "strike"] }), /无效/);
  await r.choose({ cardInstanceIds: ["strike", "aid"] });
  assert.equal(r.opponent.health, 5); assert.equal(r.owner.hand.length, before - 1);
});

test("术士濒死中暂停后续摸牌，重连急救后只摸一次；失败则不摸", async () => {
  for (const rescue of [false, true]) {
    const r = await roomRuntime([E.warlock, filler]);
    r.owner.hand.push(hand("cost1", H.draw), hand("cost2", H.aid));
    r.opponent.health = 1; r.opponent.hand.push(hand("rescue", H.aid, "p2"));
    await r.activate(); const count = r.owner.hand.length;
    await r.choose({ cardInstanceIds: ["cost1", "cost2"] });
    assert.equal(r.state.prompt.kind, "dying"); assert.equal(r.owner.hand.length, count - 2);
    saveAndRestore(r);
    if (rescue) await r.choose({ instanceId: "rescue" }); else await r.pass();
    assert.equal(r.owner.hand.length, count - (rescue ? 1 : 2));
    assert.equal(r.state.winnerId, rescue ? undefined : "p1");
  }
});

test("封锁急救、撤回和角色转化出刀不能绕过；未付费失败保持状态", async () => {
  const r = await roomRuntime([]);
  for (const definitionId of [H.aid, H.recall, H.strike]) r.state.turnModifiers.push({ id: definitionId, kind: "extra-hand-lock", ownerId: "p2", targetPlayerId: "p1", copiedDefinitionId: definitionId, count: 1 });
  r.owner.hand.push(hand("aid", H.aid), hand("revoke", H.recall), hand("material", H.draw));
  assert.throws(() => r.room.useVirtualStrike(r.owner, "material"), /封锁/);
  assert.equal(r.room.openRecallForResolved("p1", "old", H.draw), false);
  r.owner.health = 1; r.room.applyDamage(r.owner, 1, "p2");
  assert.deepEqual(r.state.prompt.cardInstanceIds, []);
  await assert.rejects(() => r.choose({ instanceId: "aid" }), /封锁/);
  assert.equal(r.owner.health, 0); assert.equal(r.owner.hand.length, 3);
});

test("直接伤害技能在濒死救回后仅完成一次，不重复触发技能结算事件", async () => {
  const r = await roomRuntime(["char_063_dong_assassin"]);
  r.opponent.health = 1; r.opponent.hand.push(hand("rescue", H.aid, "p2"));
  const resolved = [];
  const emit = r.room.emitEvent.bind(r.room);
  r.room.emitEvent = (type, details) => { if (type === "skill_resolved") resolved.push(details); return emit(type, details); };
  r.room.emitEvent("card_resolved", { sourcePlayerId: "p2", cardDefinitionId: H.draw, metadata: { actionCard: true } });
  r.room.openNextSkillTrigger(); await r.activate();
  assert.equal(r.state.prompt.kind, "dying"); assert.equal(resolved.length, 0);
  saveAndRestore(r); await r.choose({ instanceId: "rescue" });
  assert.equal(r.opponent.health, 1); assert.equal(resolved.length, 1);
});

test("罗莎真实暗置标记、减伤、隐私、角色休整后仍生效与下回合清空", async () => {
  const r = await roomRuntime([E.rosa]); r.owner.hand.push(hand("vine1", H.aid), hand("vine2", H.dodge));
  await r.activate(); await r.choose({ cardInstanceIds: ["vine1", "vine2"] });
  assert.equal(r.owner.markers[0].cards.length, 2); assert.equal(r.owner.characterSlots[0], null);
  const visible = JSON.stringify(r.room.snapshotFor("p2", false).players[0].markers);
  assert.ok(!visible.includes("vine1") && !visible.includes(H.aid));
  assert.equal(r.room.snapshotFor("p1", false).players[0].markers[0].cards[0].instanceId, "vine1");
  assert.ok(!JSON.stringify(r.room.snapshotFor("spectator", true).players[0].markers).includes("vine1"));
  r.room.applyDamage(r.owner, 2, "p2"); assert.equal(r.state.prompt.kind, "marker-effect"); saveAndRestore(r);
  await r.choose({ value: "vine" }); assert.equal(r.owner.health, 6); assert.equal(r.owner.markers[0].cards.length, 1);
  assert.ok(r.state.handDiscard.some((c) => c.instanceId === "vine1" && !c.faceDown));
  r.state.turnNumber = 3; r.room.onPhaseEntered("preparation", r.opponent);
  assert.equal(r.owner.markers.length, 0); assert.ok(r.state.handDiscard.some((c) => c.instanceId === "vine2"));
});

test("涅奥展示真实牌并回收同名牌，不允许伪造选择", async () => {
  const r = await roomRuntime([E.neo]); r.owner.hand.push(hand("show", H.aid)); r.state.handDiscard.push(hand("copy", H.aid), hand("wrong", H.dodge));
  await r.activate(); await r.choose({ cardInstanceIds: ["show"] }); saveAndRestore(r);
  await assert.rejects(() => r.choose({ cardInstanceIds: ["wrong"] }), /无效/);
  await r.choose({ cardInstanceIds: ["copy"] }); assert.ok(r.owner.hand.some((c) => c.instanceId === "copy"));
  assert.ok(r.state.logs.some((log) => log.text.includes("红桃7【急救】")));
});

test("殡葬者在对手退场后洗回己方退场角色", async () => {
  const r = await roomRuntime([E.undertaker], [filler]); r.owner.retired.push(role("dead", E.neo));
  r.room.retireCard(r.opponent, r.opponent.characterSlots[0], "p2"); r.room.openNextSkillTrigger();
  await r.activate(); await r.choose({ cardInstanceIds: ["dead"] });
  assert.ok(r.owner.characterDeck.some((c) => c.instanceId === "dead")); assert.equal(r.owner.retired.length, 0);
});

test("露娜封锁同名手牌与转化牌，回合结束解除", async () => {
  const r = await roomRuntime([E.luna]); r.opponent.hand.push(hand("dodge", H.dodge, "p2"), hand("joker", H.impersonate, "p2"));
  r.room.randomIndex = () => 0; await r.activate();
  assert.equal(handIsLocked(r.state, "p2", H.dodge), true);
  r.owner.hand.push(hand("attack", H.strike)); await r.command("p1", "hand:play", { instanceId: "attack" });
  assert.equal(r.room.snapshotFor("p2", false).game.legalHandCardIds.length, 0);
  await r.pass(); assert.equal(r.opponent.health, 6);
  r.state.phase = "end"; advancePhase(r.state, r.owner, (v) => v); assert.equal(handIsLocked(r.state, "p2", H.dodge), false);
});

test("侦探私有观看、弃行动牌后摸牌；非决策玩家不可代选", async () => {
  const r = await roomRuntime([E.detective]); r.opponent.hand.push(hand("secret", H.draw, "p2"));
  await r.activate();
  assert.ok(r.room.snapshotFor("p1", false).game.prompt.selectableCards.some((c) => c.instanceId === "secret"));
  assert.equal(r.room.snapshotFor("spectator", true).game.prompt.selectableCards, undefined);
  await assert.rejects(() => r.choose({ cardInstanceIds: ["secret"] }, "p2"), /当前没有/);
  const n = r.owner.hand.length; await r.choose({ cardInstanceIds: ["secret"] }); assert.equal(r.owner.hand.length, n + 1);
});

test("观者只调整对手牌堆顶两张，保留所有角色且不公开", async () => {
  const r = await roomRuntime([E.watcher]); r.opponent.characterDeck = [role("bottom", filler, "p2"), role("second", E.neo, "p2"), role("top", E.luna, "p2")];
  await r.activate(); assert.deepEqual(r.state.prompt.cardInstanceIds, ["top", "second"]);
  assert.equal(r.room.snapshotFor("p2", false).game.prompt.selectableCards, undefined);
  await r.choose({ cardInstanceIds: ["top"] }); assert.deepEqual(r.opponent.characterDeck.map((c) => c.instanceId), ["top", "bottom", "second"]);
});

test("威龙需要两次真实闪避；只打一张后放弃仍受伤", async () => {
  for (const dodgeTwice of [false, true]) {
    const r = await roomRuntime([E.weilong, filler]); r.opponent.hand.push(hand("d1", H.dodge, "p2"), hand("d2", H.dodge, "p2"));
    await r.activate(); assert.equal(r.state.stack.at(-1).requiredDodges, 2);
    await r.command("p2", "response:play", { instanceId: "d1" });
    assert.equal(r.state.stack.at(-1).dodgesPlayed, 1); assert.equal(r.opponent.health, 7); saveAndRestore(r);
    if (dodgeTwice) await r.command("p2", "response:play", { instanceId: "d2" }); else await r.pass();
    assert.equal(r.opponent.health, dodgeTwice ? 7 : 6); assert.equal(r.state.stack.length, 0);
  }
});

test("骇爪宣言命中可取任意手牌，未命中只能查看", async () => {
  for (const hit of [false, true]) {
    const r = await roomRuntime([E.hackclaw]); r.opponent.hand.push(hand("a", H.aid, "p2"), hand("b", H.draw, "p2"));
    await r.activate(); await r.choose({ value: hit ? H.draw : H.sabotage });
    if (hit) { await r.choose({ cardInstanceIds: ["a"] }); assert.ok(r.owner.hand.some((c) => c.instanceId === "a")); }
    else { await r.choose({ value: "done" }); assert.equal(r.opponent.hand.length, 2); }
  }
});

test("牧羊人退场费用并休整目标，不等于退场目标", async () => {
  const r = await roomRuntime([E.shepherd], [filler]); await r.activate(); await r.choose({ value: "0" });
  assert.equal(r.owner.retired.length, 1); assert.equal(r.opponent.retired.length, 0); assert.equal(r.opponent.characterDeck.length, 1);
});

test("深蓝由对手选择弃2或公开交1，多步恢复权限正确", async () => {
  for (const discard of [false, true]) {
    const r = await roomRuntime([E.deepBlue]); r.opponent.hand.push(hand("a", H.aid, "p2"), hand("b", H.draw, "p2"));
    await r.activate(); assert.equal(r.state.prompt.playerId, "p2"); saveAndRestore(r);
    await r.choose({ value: discard ? "discard" : "show" });
    assert.equal(r.state.prompt.playerId, discard ? "p2" : "p1");
    await r.choose({ cardInstanceIds: discard ? ["a", "b"] : ["a"] }); assert.equal(r.opponent.hand.length, discard ? 0 : 1);
  }
});

test("异画师小卡按基础牌需要转化：出刀、响应闪避、濒死急救", async () => {
  for (const needed of [H.strike, H.dodge, H.aid]) {
    const r = await roomRuntime([E.painter]); r.owner.hand.push(hand("paint", H.draw));
    if (needed === H.dodge) { r.state.currentPlayerId = "p2"; r.opponent.hand.push(hand("attack", H.strike, "p2")); await r.command("p2", "hand:play", { instanceId: "attack" }); }
    if (needed === H.aid) { r.owner.health = 1; r.room.applyDamage(r.owner, 1, "p2"); }
    await r.activate(); await r.choose({ value: needed }); await r.choose({ cardInstanceIds: ["paint"] });
    if (needed === H.strike) { await settle(r); assert.equal(r.opponent.health, 6); }
    if (needed === H.dodge) assert.equal(r.owner.health, 7);
    if (needed === H.aid) { assert.equal(r.owner.health, 1); assert.equal(r.state.winnerId, undefined); }
  }
});

test("异画师灰焕三分支，下一次伤害强化技能伤害而不只出刀", async () => {
  for (const value of ["damage", "draw", "take"]) {
    const r = await roomRuntime([E.colors, filler]); r.opponent.hand.push(hand("secret", H.aid, "p2"));
    await r.activate(); const count = r.owner.hand.length; await r.choose({ value });
    if (value === "draw") assert.equal(r.owner.hand.length, count + 2);
    if (value === "take") { await r.choose({ cardInstanceIds: ["secret"] }); assert.ok(r.owner.hand.some((c) => c.instanceId === "secret")); }
    if (value === "damage") { r.room.applyDamage(r.opponent, 1, "p1"); assert.equal(r.opponent.health, 5); r.room.applyDamage(r.opponent, 1, "p1"); assert.equal(r.opponent.health, 4); }
  }
});

test("隐形鸭在私有卡面发出之前阻止看破，并支持调包和重连", async () => {
  const r = await roomRuntime([], [E.invisible, E.neo]); r.opponent.characterSlots[1].faceDown = true;
  r.opponent.characterDeck.push(role("replacement", E.luna, "p2", true)); r.owner.hand.push(hand("inspect", H.inspect));
  await r.command("p1", "hand:play", { instanceId: "inspect", targetSlotIndex: 1 }); await settle(r);
  // settle declines optional triggers, so start a fresh scenario to accept the prevention.
  const s = await roomRuntime([], [E.invisible, E.neo]); s.opponent.characterSlots[1].faceDown = true;
  s.opponent.characterDeck.push(role("replacement", E.luna, "p2", true)); s.owner.hand.push(hand("inspect", H.inspect));
  await s.command("p1", "hand:play", { instanceId: "inspect", targetSlotIndex: 1 }); await s.pass();
  assert.equal(s.state.prompt.kind, "character-trigger"); assert.equal(s.state.prompt.playerId, "p2");
  assert.ok(!JSON.stringify(s.room.snapshotFor("p1", false).game.prompt).includes(E.neo)); saveAndRestore(s);
  await s.activate(0, "p2"); await s.choose({ value: "swap" });
  assert.equal(s.opponent.characterSlots[1].definitionId, E.luna);
  assert.equal(s.state.prompt.context.inspectionPrevented, true);
  await assert.rejects(() => s.choose({ value: "reveal" }), /防止/); await s.choose({ value: "keep" });
  assert.equal(s.state.stack.length, 0); assert.equal(s.state.pendingInspection, undefined);
});

test("爆炸王只针对布阵第二张，不能把出牌阶段的上阵计为第一张", async () => {
  const r = await roomRuntime([E.bomber]); r.state.currentPlayerId = "p2";
  r.opponent.characterDeck = [role("two", E.neo, "p2"), role("one", E.luna, "p2")];
  r.room.recordCharacterDeployment("p2", "p2", filler, "earlier");
  r.state.phase = "deployment";
  await r.command("p2", "character:deploy"); assert.equal(r.state.prompt, undefined);
  await r.command("p2", "character:deploy"); assert.equal(r.state.prompt.playerId, "p1");
  await r.activate(); assert.equal(r.opponent.characterSlots[1], null); assert.ok(r.opponent.characterDeck.some((c) => c.instanceId === "two"));
});

test("防止侦探观看不取消其独立摸牌；防止猎鹰观看不泄露定位也不休整目标", async () => {
  for (const detective of [true, false]) {
    const sourceId = detective ? "char_083_aichitun_detective" : "char_043_baizi_falcon";
    const r = await roomRuntime([sourceId], [E.invisible, E.warlock]);
    r.opponent.characterSlots[1].faceDown = true;
    if (detective) r.room.emitEvent("skill_resolved", { sourcePlayerId: "p2", metadata: { revealedFromFaceDown: true } });
    else r.room.emitEvent("strike_dodged", { sourcePlayerId: "p1", targetPlayerId: "p2" });
    r.room.openNextSkillTrigger(); await r.activate(); const count = r.owner.hand.length;
    await r.choose(detective ? { cardInstanceIds: ["p2-role-1"] } : { value: "1" });
    await r.activate(0, "p2"); await r.choose({ value: "keep" });
    const shown = r.room.snapshotFor("p1", false).game.prompt;
    assert.equal(shown.context, undefined); assert.equal(shown.selectableCards, undefined);
    assert.ok(!JSON.stringify(shown).includes(E.warlock));
    await r.choose({ value: "done" });
    assert.equal(r.owner.hand.length, count + (detective ? 1 : 0));
    assert.equal(r.opponent.characterSlots[1].definitionId, E.warlock);
    assert.equal(r.opponent.characterSlots[1].faceDown, true);
  }
});

test("呆呆鸟只收回此次被对手弃置的牌并令对手摸1", async () => {
  const r = await roomRuntime([E.dodo]); r.owner.hand.push(hand("lost", H.draw));
  r.room.discardSelectedHand(r.owner, ["lost"], "p2"); r.room.openNextSkillTrigger(); await r.activate(); await r.choose({ cardInstanceIds: ["lost"] });
  assert.ok(r.owner.hand.some((c) => c.instanceId === "lost")); assert.equal(r.opponent.hand.length, 1);
});

test("告密者按摸牌受益者触发，包括别人令对手摸牌", async () => {
  const r = await roomRuntime([E.snitch]); r.opponent.hand.push(hand("loot", H.aid, "p2"));
  r.room.emitEvent("cards_drawn", { sourcePlayerId: "p1", targetPlayerId: "p2", amount: 1, metadata: { outsideDrawPhase: true } }); r.room.openNextSkillTrigger();
  await r.activate(); await r.choose({ cardInstanceIds: ["loot"] }); assert.equal(r.state.handDeck[0].instanceId, "loot");
  assert.equal(r.opponent.hand.length, 0);
});

test("网红真实标记作为闪避，不能自动跳过；未使用者下回合收回", async () => {
  for (const use of [false, true]) {
    const r = await roomRuntime([E.celebrity]); r.owner.hand.push(hand("stored", H.draw)); await r.activate(); await r.choose({ cardInstanceIds: ["stored"] });
    r.owner.hand = []; r.state.currentPlayerId = "p2"; r.opponent.hand.push(hand("attack", H.strike, "p2"));
    await r.command("p2", "hand:play", { instanceId: "attack" });
    assert.ok(r.state.prompt.options.some((o) => o.value.startsWith("decoy:")));
    if (use) { await r.choose({ value: r.state.prompt.options.find((o) => o.value.startsWith("decoy:")).value }); assert.equal(r.owner.health, 7); assert.equal(r.owner.markers.length, 0); }
    else { await r.pass(); r.state.currentPlayerId = "p1"; r.state.turnNumber = 3; r.room.onPhaseEntered("preparation", r.opponent); assert.ok(r.owner.hand.some((c) => c.instanceId === "stored")); assert.equal(r.owner.markers.length, 0); }
  }
});

test("祖安怒兽与荒漠屠夫联动：额外出刀伤后由目标选择休整", async () => {
  const r = await roomRuntime(["char_052_fengyaojing_desert-butcher", E.beast], [E.neo]);
  r.owner.hand.push(hand("s1", H.strike), hand("s2", H.strike));
  await r.activate(0); await r.command("p1", "hand:play", { instanceId: "s1" }); await r.pass();
  assert.equal(r.opponent.health, 5); assert.equal(r.state.prompt.kind, "character-trigger");
  await r.activate(1); assert.equal(canUseInPlay(r.state, r.owner, H.strike), true);
  await r.command("p1", "hand:play", { instanceId: "s2" }); await r.pass();
  assert.equal(r.state.prompt.title, "鲜血追猎"); await r.choose({ value: "0" }); assert.equal(r.opponent.characterSlots[0], null);
});
