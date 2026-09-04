import assert from "node:assert/strict";
import test from "node:test";
import { roomRuntime, role } from "./fixtures/auto-room-runtime.mjs";

const LINK = "body_link_001";
const RESOURCE = "char_019_dong_defect-robot";
const SUPPORT = "char_042_xiaoapan_neo";
const FIELD_ROLE = "char_006_weixiaokele_ninja";

function useSkill(r, mainRole, definitionId = FIELD_ROLE, activationId) {
  const used = r.room.emitEvent("skill_used", {
    sourcePlayerId: "p1",
    characterDefinitionId: definitionId,
    metadata: { mainRole },
  });
  r.room.emitEvent("skill_resolved", {
    sourcePlayerId: "p1",
    characterDefinitionId: definitionId,
    metadata: { activationId: activationId || used.id },
  });
  r.room.openNextSkillTrigger();
  return used.id;
}

async function linkRoom() {
  const r = await roomRuntime([]);
  r.owner.body = { instanceId: "body-link", definitionId: LINK, ownerId: "p1", kind: "body", faceDown: false };
  r.owner.bodyState = r.room.newBodyState(LINK);
  return r;
}

test("魅影换手按本回合历史定位判定，放弃不计次数与进度", async () => {
  const r = await linkRoom();
  useSkill(r, "资源", RESOURCE);
  assert.equal(r.state.prompt, undefined);
  useSkill(r, "资源", RESOURCE);
  assert.equal(r.state.prompt, undefined);
  useSkill(r, "支援", SUPPORT);
  assert.equal(r.state.prompt?.kind, "body-skill");
  await r.choose({ value: "pass" });
  assert.equal(r.owner.bodyState.progress, 0);
  assert.equal(Object.keys(r.state.usageCounters).some((key) => key.endsWith(":link-used")), false);

  useSkill(r, "支援", SUPPORT);
  assert.equal(r.state.prompt?.kind, "body-skill", "资源→支援→支援的后两次都满足‘此前有其他定位’");
  const before = r.owner.hand.length;
  await r.choose({ value: "draw" });
  assert.equal(r.owner.hand.length, before + 1);
  assert.equal(r.owner.bodyState.progress, 1);

  useSkill(r, "防御");
  assert.equal(r.state.prompt, undefined, "正面每个己方回合只能实际发动一次");
});

test("被无效的已支付技能仍计入定位，同一发动编号不重复触发", async () => {
  const r = await linkRoom();
  useSkill(r, "资源", RESOURCE);
  const activationId = useSkill(r, "支援", SUPPORT);
  assert.equal(r.state.prompt?.kind, "body-skill");
  await r.choose({ value: "draw" });
  r.room.emitEvent("skill_resolved", {
    sourcePlayerId: "p1",
    characterDefinitionId: SUPPORT,
    metadata: { activationId, cancelledBySilencer: true },
  });
  r.room.openNextSkillTrigger();
  assert.equal(r.state.prompt, undefined);
});

test("正面换手保持原角色位，不触发休整摸牌", async () => {
  const r = await linkRoom();
  r.owner.characterSlots[1] = role("field", FIELD_ROLE);
  r.owner.characterDeck = [role("next", RESOURCE)];
  useSkill(r, "资源", RESOURCE);
  useSkill(r, "支援", SUPPORT);
  await r.choose({ value: "swap" });
  const handBefore = r.owner.hand.length;
  await r.choose({ cardInstanceIds: ["field"] });
  assert.equal(r.owner.characterSlots[1]?.instanceId, "next");
  assert.equal(r.owner.characterSlots[1]?.faceDown, true);
  assert.equal(r.owner.characterDeck[0]?.instanceId, "field");
  assert.equal(r.owner.hand.length, handBefore);
  assert.equal(r.state.recentEvents.at(-1)?.type, "character_deployed");
});

test("极巨化可延后进入，双方回合可耗能，空场只摸牌", async () => {
  const r = await linkRoom();
  r.owner.bodyState.progress = 3;
  r.state.phase = "preparation";
  r.room.onPhaseEntered("preparation", r.opponent);
  assert.equal(r.state.prompt?.context?.action, "dynamax-enter");
  await r.choose({ value: "pass" });
  assert.equal(r.owner.bodyState.flipped, false);
  assert.equal(r.owner.bodyState.extraFormUsed, false);

  r.state.turnNumber = 2;
  r.room.onPhaseEntered("preparation", r.opponent);
  await r.choose({ value: "activate" });
  assert.equal(r.owner.bodyState.flipped, true);
  assert.equal(r.owner.bodyState.dynamaxEnergy, 3);
  assert.equal(r.owner.bodyState.dynamaxHealth, 2);

  r.state.currentPlayerId = "p2";
  r.state.phase = "play";
  useSkill(r, "资源", RESOURCE);
  useSkill(r, "支援", SUPPORT);
  const before = r.owner.hand.length;
  await r.choose({ value: "activate" });
  assert.equal(r.owner.hand.length, before + 1);
  assert.equal(r.owner.bodyState.dynamaxEnergy, 2);
  assert.equal(r.owner.bodyState.flipped, true);
});

test("极巨体力先承伤，不计为普通体力减少", async () => {
  const r = await linkRoom();
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxHealth = 2;
  r.owner.bodyState.dynamaxEnergy = 3;
  r.room.applyDamage(r.owner, 1, "p2");
  assert.equal(r.owner.health, 7);
  assert.equal(r.owner.bodyState.dynamaxHealth, 1);
  assert.equal(r.state.recentEvents.at(-1)?.metadata?.healthLost, 0);
  r.room.applyDamage(r.owner, 3, "p2");
  assert.equal(r.owner.health, 5);
  assert.equal(r.owner.bodyState.dynamaxHealth, 0);
  assert.equal(r.state.recentEvents.at(-1)?.metadata?.healthLost, 2);
});

test("最后1点极巨能量的精准换手完整结算后才翻回", async () => {
  const r = await linkRoom();
  r.owner.bodyState.flipped = true;
  r.owner.bodyState.extraFormUsed = true;
  r.owner.bodyState.dynamaxHealth = 2;
  r.owner.bodyState.dynamaxEnergy = 1;
  r.owner.characterSlots[0] = role("field", FIELD_ROLE);
  r.owner.characterDeck = [role("c1", RESOURCE), role("c2", SUPPORT), role("c3", FIELD_ROLE)];
  r.state.currentPlayerId = "p2";
  useSkill(r, "资源", RESOURCE);
  useSkill(r, "支援", SUPPORT);
  await r.choose({ value: "activate" });
  assert.equal(r.owner.bodyState.dynamaxEnergy, 0);
  assert.equal(r.owner.bodyState.flipped, true);
  await r.choose({ cardInstanceIds: ["field"] });
  assert.equal(r.owner.bodyState.flipped, true);
  assert.equal(r.room.snapshotFor("p2", false).game.prompt.selectableCards, undefined);
  await r.choose({ cardInstanceIds: ["c3"] });
  assert.equal(r.owner.bodyState.flipped, true);
  await r.choose({ cardInstanceIds: ["c2", "c1"] });
  assert.equal(r.owner.characterSlots[0]?.instanceId, "c3");
  assert.deepEqual(r.owner.characterDeck.map((card) => card.instanceId), ["c1", "c2", "field"]);
  assert.equal(r.owner.bodyState.flipped, false);
  assert.equal(r.owner.bodyState.dynamaxHealth, 0);
});
