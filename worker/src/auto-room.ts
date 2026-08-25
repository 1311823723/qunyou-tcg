import { DurableObject } from "cloudflare:workers";
import bodies from "../../data/cards/bodies.json";
import characters from "../../data/cards/characters.json";
import handCards from "../../data/cards/hand_cards.json";
import characterAutomation from "../../data/cards/character_automation.json";
import characterImplementation from "../../data/cards/character_implementation.json";
import { allDecks } from "../../src/lib/decks";
import { getExtraFormProgressMax } from "../../src/lib/body-progress";
import {
  AUTO_STATE_VERSION,
  HAND_IDS,
  advancePhase,
  beginResponseWindow,
  canUseInPlay,
  createPrompt,
  damage,
  deployTopCharacter,
  drawCards,
  effectiveDefinition,
  handLimit,
  handName,
  heal,
  isHandResolutionItem,
  isActionCard,
  legalResponseCards,
  moveResolvedCardToDiscard,
  opponentOf,
  playerById,
  validPlayDefinition,
} from "./auto-engine.mts";
import {
  BODY_IDS,
  bodyId,
  bodyProgressDelta,
  bodyUsageKey,
  triggerKindForBody,
} from "./body-automation.mts";
import { bodySkillForId } from "./skills/body-registry.mts";
import type { BodySkillRuntimeContext } from "./skills/body-skill.mts";
import { characterSkillForId } from "./skills/character-registry.mts";
import type { CharacterSkillRuntimeContext } from "./skills/character-skill.mts";
import { AGGRO_CHARACTER_IDS } from "./skills/characters/aggro.mts";
import { COMBO_CHARACTER_IDS } from "./skills/characters/combo.mts";
import { MIZAI_CHARACTER_IDS } from "./skills/characters/mizai.mts";
import type {
  AutoBattleEvent,
  AutoLegalAction,
  AutoClientMessage,
  AutoPlayerState,
  AutoRoomState,
  AutoSocketAttachment,
  BodyRuntimeState,
  CharacterSkillResolutionItem,
  HandResolutionItem,
  PendingBodyTrigger,
  PendingJudgment,
  ResolutionItem,
  SkillContinuation,
} from "./auto-types";
import type { BattleLogTarget, CardInstance, CustomDeckConfig, LobbyRoomSummary } from "./types";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const WAITING_DISCONNECT_GRACE_MS = 60 * 1000;
const CUSTOM_DECK_ID = "custom";
const deckById = new Map(allDecks.map((deck) => [deck.id, deck]));
const bodyById = new Map(bodies.map((body) => [body.id, body]));
const characterById = new Map(characters.map((card) => [card.id, card]));
type CharacterAutomationEntry = {
  level: "assisted" | "full";
  trigger: { event: string; relation: string; timingText: string; targetMainRole?: string };
  usageLimit?: { scope: "event" | "turn" | "game"; count: number };
  assistedActions: string[];
};
const automationById = new Map(Object.entries(characterAutomation) as Array<[string, CharacterAutomationEntry]>);
const unlockedAutoDeckIds = new Set(allDecks
  .filter((deck) => deck.characterIds.every((id) => {
    const status = characterImplementation[id as keyof typeof characterImplementation];
    return status?.automation === "implemented" && status.review !== "needs_confirmation";
  }))
  .map((deck) => deck.id));

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function parseCustomDeck(value: unknown): CustomDeckConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  return {
    bodyId: cleanText(source.bodyId, 80),
    characterIds: Array.isArray(source.characterIds)
      ? source.characterIds.map((id) => cleanText(id, 80)).filter(Boolean)
      : [],
  };
}

function validCustomDeck(deck?: CustomDeckConfig): deck is CustomDeckConfig {
  return Boolean(deck
    && bodyById.has(deck.bodyId)
    && deck.characterIds.length === 16
    && new Set(deck.characterIds).size === 16
    && deck.characterIds.every((id) => characterById.has(id)));
}

export function validAutoLoadout(deckId: string, customDeck?: CustomDeckConfig) {
  void customDeck;
  return deckId !== CUSTOM_DECK_ID && unlockedAutoDeckIds.has(deckId);
}

export class AutoBattleRoom extends DurableObject<Env> {
  private state?: AutoRoomState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<AutoRoomState>("room");
      if (this.state) {
        this.state.mode = "auto";
        this.state.stack ??= [];
        for (const item of this.state.stack) item.kind ??= "hand";
        this.state.usageCounters ??= {};
        this.state.turnModifiers ??= [];
        this.state.recentEvents ??= [];
        this.state.pendingBodyTriggers ??= [];
        this.state.pendingJudgments ??= [];
        this.state.processedActionIds ??= [];
        for (const player of this.state.players) player.bodyState ??= this.newBodyState(player.body?.definitionId);
        this.state.stateVersion = AUTO_STATE_VERSION;
        await this.syncLobby();
      }
    });
  }

  async createRoom(code: string, token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig) {
    if (this.state) return { roomCode: this.state.roomCode, mode: "auto" as const };
    if (!validAutoLoadout(deckId, customDeck)) throw new Error("自动对战只能使用已完成角色技能自动化的预组。");
    const now = Date.now();
    this.state = {
      stateVersion: AUTO_STATE_VERSION,
      mode: "auto",
      roomCode: code,
      createdAt: now,
      lastActivityAt: now,
      started: false,
      players: [this.newPlayer("p1", token, nickname, deckId, customDeck)],
      spectators: [],
      handDeck: [],
      handDiscard: [],
      resolving: [],
      turnNumber: 0,
      phase: "preparation",
      stack: [],
      consecutivePasses: 0,
      usageCounters: {},
      turnModifiers: [],
      deployedThisPhase: 0,
      recentEvents: [],
      pendingBodyTriggers: [],
      pendingJudgments: [],
      revision: 0,
      logs: [],
      processedActionIds: [],
    };
    this.addLog(`${nickname} 创建了自动对战房间`, "p1", { zone: "lobby", ownerId: "p1" });
    await this.persist();
    await this.syncLobby();
    return { roomCode: code, mode: "auto" as const };
  }

  async joinRoom(token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig) {
    if (!this.state) return { status: 404, body: { error: "房间不存在或已经过期。" } };
    let player = this.state.players.find((item) => item.token === token);
    if (!player) {
      if (this.state.started) return { status: 409, body: { error: "牌局已经开始，请使用观战模式进入。" } };
      if (this.state.players[0]?.disconnectedAt) return { status: 409, body: { error: "房主暂时离线，请等待其重连。" } };
      if (this.state.players.length >= 2) return { status: 409, body: { error: "房间已满，无法加入。" } };
      if (!validAutoLoadout(deckId, customDeck)) return { status: 400, body: { error: "自动对战只能使用已解锁预组。" } };
      player = this.newPlayer("p2", token, nickname, deckId, customDeck);
      this.state.players.push(player);
      this.addLog(`${nickname} 加入了自动对战房间`, player.id, { zone: "lobby", ownerId: player.id });
      this.state.revision += 1;
    }
    this.state.lastActivityAt = Date.now();
    await this.persist();
    await this.syncLobby();
    return { status: 200, body: { ok: true, playerId: player.id, mode: "auto" } };
  }

  async fetch(request: Request) {
    if (!this.state) return json({ error: "房间不存在或已经过期。" }, { status: 404 });
    const url = new URL(request.url);
    const token = cleanText(url.searchParams.get("token"), 80);
    const spectator = url.searchParams.get("spectator") === "true";
    const spectatorNickname = cleanText(url.searchParams.get("nickname"), 20);
    let playerId = "";
    let isSpectator = false;

    if (spectator) {
      if (!this.state.started) return json({ error: "牌局开始后才能观战。" }, { status: 409 });
      if (!token || !spectatorNickname) return json({ error: "观战身份无效。" }, { status: 400 });
      playerId = `spectator-${crypto.randomUUID()}`;
      isSpectator = true;
      this.state.spectators.push(playerId);
      this.addLog(`${spectatorNickname} 加入观战`, playerId, { zone: "spectator" });
    } else {
      const player = this.state.players.find((item) => item.token === token);
      if (!player) return json({ error: "请先通过大厅进入房间。" }, { status: 401 });
      player.disconnectedAt = undefined;
      playerId = player.id;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      playerId,
      isSpectator,
      ...(isSpectator ? { spectatorNickname } : {}),
    } satisfies AutoSocketAttachment);
    this.state.lastActivityAt = Date.now();
    await this.persist();
    await this.syncLobby();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.state || typeof raw !== "string") return;
    const attachment = ws.deserializeAttachment() as AutoSocketAttachment | null;
    if (attachment?.isSpectator) return this.sendError(ws, "观战者不能进行操作。");
    const player = this.state.players.find((item) => item.id === attachment?.playerId);
    if (!player) return this.sendError(ws, "座位身份无效。");

    let message: AutoClientMessage;
    try {
      message = JSON.parse(raw) as AutoClientMessage;
    } catch {
      return this.sendError(ws, "消息格式无效。");
    }
    if (!message.actionId) return this.sendError(ws, "操作标识无效。");
    if (this.state.processedActionIds.includes(message.actionId)) return this.sendAck(ws, message.actionId, true);

    try {
      if (message.type === "room:end") return await this.destroyRoom("这场自动对战已经结束。");
      if (message.type === "room:leave") return await this.leaveWaitingRoom(player);
      if (!Number.isInteger(message.baseRevision) || message.baseRevision !== this.state.revision) {
        throw new Error("牌桌状态已更新，请等待同步后重试。");
      }
      const stateBeforeAction = structuredClone(this.state);
      try {
        await this.applyAction(player, message);
        this.openNextSkillTrigger();
      } catch (error) {
        this.state = stateBeforeAction;
        throw error;
      }
      this.state.processedActionIds.push(message.actionId);
      this.state.processedActionIds = this.state.processedActionIds.slice(-100);
      this.state.revision += 1;
      this.state.lastActivityAt = Date.now();
      await this.persist();
      await this.syncLobby();
      this.broadcast();
      this.sendAck(ws, message.actionId);
    } catch (error) {
      this.sendError(ws, error instanceof Error ? error.message : "操作失败。", message.actionId);
    }
  }

  async webSocketClose(ws: WebSocket) {
    if (!this.state) return;
    const attachment = ws.deserializeAttachment() as AutoSocketAttachment | null;
    if (attachment?.isSpectator) {
      this.state.spectators = this.state.spectators.filter((id) => id !== attachment.playerId);
      this.addLog(`${attachment.spectatorNickname || "观战者"} 离开观战`, attachment.playerId, { zone: "spectator" });
    } else if (attachment?.playerId) {
      const hasOther = this.ctx.getWebSockets().some((socket) => {
        if (socket === ws) return false;
        return (socket.deserializeAttachment() as AutoSocketAttachment | null)?.playerId === attachment.playerId;
      });
      if (!hasOther) {
        const player = this.state.players.find((item) => item.id === attachment.playerId);
        if (player) player.disconnectedAt = Date.now();
      }
    }
    this.state.lastActivityAt = Date.now();
    await this.persist();
    await this.syncLobby();
    this.broadcast(attachment?.playerId);
  }

  async alarm() {
    if (!this.state) return;
    const now = Date.now();
    if (!this.state.started) {
      const host = this.state.players[0];
      if (host?.disconnectedAt && now - host.disconnectedAt >= WAITING_DISCONNECT_GRACE_MS) {
        await this.destroyRoom("房主离线超时，等待房间已关闭。");
        return;
      }
      const guest = this.state.players[1];
      if (guest?.disconnectedAt && now - guest.disconnectedAt >= WAITING_DISCONNECT_GRACE_MS) {
        this.state.players.splice(1, 1);
        if (host) host.ready = false;
        this.addLog(`${guest.nickname} 离线超时，座位已释放`, guest.id, { zone: "lobby" });
        this.state.revision += 1;
      }
    }
    if (now - this.state.lastActivityAt >= ROOM_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.destroyRoom("房间已过期。");
      return;
    }
    await this.persist();
    await this.syncLobby();
    this.broadcast();
  }

  private async applyAction(player: AutoPlayerState, message: AutoClientMessage) {
    if (!this.state) throw new Error("房间状态不存在。");
    const payload = message.payload || {};
    switch (message.type) {
      case "player:selectDeck": {
        if (this.state.started || player.ready) throw new Error("当前不能更换预组。");
        const deckId = cleanText(payload.deckId, 80);
        const customDeck = parseCustomDeck(payload.customDeck);
        if (!validAutoLoadout(deckId, customDeck)) throw new Error("该预组的角色技能尚未全部实现。");
        player.deckId = deckId;
        player.customDeck = deckId === CUSTOM_DECK_ID ? customDeck : undefined;
        return;
      }
      case "player:ready": {
        if (this.state.started) throw new Error("牌局已经开始。");
        player.ready = Boolean(payload.ready);
        this.addLog(`${player.nickname}${player.ready ? "已准备" : "取消准备"}`, player.id, { zone: "player", ownerId: player.id });
        if (this.state.players.length === 2 && this.state.players.every((item) => item.ready && this.loadout(item))) this.startGame();
        return;
      }
      case "phase:advance": {
        this.requireStarted();
        const previous = this.state.phase;
        const next = advancePhase(this.state, player, (items) => this.shuffle(items));
        this.state.recentEvents = [];
        this.addLog(`${player.nickname} 将阶段从${this.phaseLabel(previous)}推进至${this.phaseLabel(next)}`, player.id, { zone: "turn" });
        this.onPhaseEntered(next, player);
        this.openNextSkillTrigger();
        return;
      }
      case "character:deploy": {
        this.requireTurn(player, "deployment");
        if (this.state.prompt || this.state.stack.length) throw new Error("请先完成当前结算。");
        if (this.state.deployedThisPhase >= 2) throw new Error("本布阵阶段已经上阵2张角色。");
        const deployed = deployTopCharacter(player);
        if (!deployed) throw new Error("角色区已满或角色牌堆为空。");
        this.state.recentEvents = [];
        this.state.deployedThisPhase += 1;
        this.recordCharacterDeployment(player.id, player.id, deployed.card.definitionId);
        this.addLog(`${player.nickname} 暗置上阵了1张角色`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex: deployed.slotIndex });
        return;
      }
      case "character:reveal": {
        this.requireTurn(player, "deployment");
        const slot = Number(payload.slotIndex);
        const card = player.characterSlots[slot];
        if (!card || !("instanceId" in card) || !card.faceDown) throw new Error("只能明置自己的暗置角色。");
        if (this.isCharacterRevealLocked(player, card.instanceId)) throw new Error("该角色本回合不能明置。");
        this.state.recentEvents = [];
        card.faceDown = false;
        this.emitEvent("character_revealed", { sourcePlayerId: player.id, targetPlayerId: player.id, characterDefinitionId: card.definitionId });
        this.addLog(`${player.nickname} 明置了角色【${characterById.get(card.definitionId)?.name || card.definitionId}】`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex: slot });
        this.openNextSkillTrigger();
        return;
      }
      case "bomb:remove": {
        this.requireTurn(player, "play");
        if (this.state.prompt || this.state.stack.length) throw new Error("请先完成当前结算。");
        const markerId = cleanText(payload.markerId, 80);
        const modifierIndex = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "aggro-bomb"
          && modifier.targetPlayerId === player.id && modifier.markerId === markerId);
        const modifier = this.state.turnModifiers[modifierIndex];
        const marker = modifier ? player.characterSlots[Number(modifier.targetSlotIndex)] : undefined;
        if (!modifier || !marker || "instanceId" in marker || marker.id !== markerId) throw new Error("炸弹标记已经不在角色区。");
        const ids = Array.isArray(payload.costCharacterIds) ? payload.costCharacterIds.map((id) => cleanText(id, 80)) : [];
        if (ids.length !== 1) throw new Error("请选择1张角色支付休整费用。");
        const cost = player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === ids[0]);
        if (!cost || !("instanceId" in cost)) throw new Error("休整费用中的角色无效。");
        this.restCard(player, cost, false, player.id, true);
        const slotIndex = Number(modifier.targetSlotIndex);
        player.characterSlots[slotIndex] = null;
        this.state.turnModifiers.splice(modifierIndex, 1);
        this.addLog(`${player.nickname}休整1张角色，拆除了「炸弹」`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex });
        return;
      }
      case "hand:play":
        return this.playHand(player, payload, false);
      case "response:play":
        return this.playHand(player, payload, true);
      case "response:pass":
        return this.passResponse(player);
      case "choice:submit":
        return this.submitChoice(player, payload);
      case "body:activate":
        return this.activateBodyExtra(player, payload);
      case "skill:activate":
        return this.activateAssistedSkill(player, payload);
      case "assisted:action":
        return this.applyAssistedAction(player, payload);
      case "assisted:finish": {
        if (this.state.prompt?.kind !== "assisted-skill" || this.state.prompt.playerId !== player.id) throw new Error("当前没有由你处理的辅助技能。");
        this.addLog(`${player.nickname} 完成了辅助技能结算`, player.id, { zone: "resolving" });
        const resumeResponse = Boolean(this.state.prompt.context?.resumeResponse);
        const retiredAmbushInstanceId = cleanText(this.state.prompt.context?.retiredAmbushInstanceId, 80);
        this.state.prompt = undefined;
        if (retiredAmbushInstanceId) this.finishRetiredAmbushSkill(player, retiredAmbushInstanceId);
        if (resumeResponse && this.state.stack.length) {
          const top = this.state.stack[this.state.stack.length - 1];
          if (isHandResolutionItem(top) && top.cancelled) this.continueStack();
          else this.restoreResponseAfterSkill(player.id);
        }
        this.openNextSkillTrigger();
        return;
      }
      default:
        throw new Error("自动对战暂不支持这个操作。");
    }
  }

  private playHand(player: AutoPlayerState, payload: Record<string, unknown>, response: boolean) {
    if (!this.state) return;
    const instanceId = cleanText(payload.instanceId, 80);
    const index = player.hand.findIndex((card) => card.instanceId === instanceId);
    if (index < 0) throw new Error("这张牌不在你的手牌中。");
    const card = player.hand[index];
    const resolvedAs = cleanText(payload.resolvedAs, 80) || undefined;
    if (!validPlayDefinition(card.definitionId, resolvedAs)) throw new Error("基础牌转化选择无效。");

    if (response) {
      if (this.state.prompt?.context?.skillOnly === true) throw new Error("当前窗口只能发动对应角色技能或放弃。");
      if (!legalResponseCards(this.state, player).some((item) => item.instanceId === card.instanceId)) throw new Error("这张牌不能在当前窗口响应。");
      if (card.definitionId === HAND_IDS.impersonate && resolvedAs !== HAND_IDS.dodge) throw new Error("【冒名顶替】响应【出刀】时必须视为【闪避】。");
    } else if (!canUseInPlay(this.state, player, card.definitionId, resolvedAs)) {
      throw new Error("这张牌当前不能使用。");
    }
    const effective = card.definitionId === HAND_IDS.impersonate ? resolvedAs || "" : card.definitionId;
    const opponent = opponentOf(this.state, player.id);
    const targetsOpponent = [HAND_IDS.strike, HAND_IDS.sabotage, HAND_IDS.steal, HAND_IDS.crisis, HAND_IDS.inspect].includes(effective as never);
    const targetPlayerId = effective === HAND_IDS.aid ? player.id : targetsOpponent ? opponent?.id : undefined;
    const targetSlotIndex = Number.isInteger(payload.targetSlotIndex) ? Number(payload.targetSlotIndex) : undefined;
    if ([HAND_IDS.crisis, HAND_IDS.inspect].includes(effective as never)) {
      const target = opponent?.characterSlots[targetSlotIndex ?? -1];
      if (!target || !("instanceId" in target)) throw new Error("请选择合法的对手角色。");
      if (effective === HAND_IDS.crisis && target.faceDown) throw new Error("危机破坏只能选择明置角色。");
      if (effective === HAND_IDS.inspect && !target.faceDown) throw new Error("看破只能选择暗置角色。");
    }
    if (!response) this.state.recentEvents = [];

    player.hand.splice(index, 1);
    this.state.resolving.push(card);
    const target = response ? this.state.stack[this.state.stack.length - 1] : undefined;
    if (isHandResolutionItem(target)) target.wasRespondedTo = true;
    const item: ResolutionItem = {
      kind: "hand",
      id: crypto.randomUUID(),
      sourcePlayerId: player.id,
      card,
      definitionId: card.definitionId,
      resolvedAs,
      targetPlayerId,
      targetSlotIndex,
      ...(target ? { countersItemId: target.id } : {}),
    };
    if (isHandResolutionItem(item) && effective === HAND_IDS.strike) this.attachStrikeModifiers(player, item);
    this.state.stack.push(item);
    this.emitEvent(response ? "card_responded" : "card_used", {
      sourcePlayerId: player.id,
      targetPlayerId,
      cardDefinitionId: effective,
      metadata: {
        actionCard: isActionCard(card.definitionId),
        ...(response && isHandResolutionItem(target) ? { targetCardDefinitionId: effectiveDefinition(target) } : {}),
      },
    });
    if (effective === HAND_IDS.strike && !response) {
      const key = `turn:${this.state.turnNumber}:${player.id}:strike`;
      this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
    }
    this.addLog(`${player.nickname}${response ? "响应使用" : "使用"}了【${handName(effective)}】`, player.id, { zone: "resolving" });
    if (effective === HAND_IDS.strike || isActionCard(card.definitionId)) {
      if (!response && this.openSourceSkillBeforeResponse(item)) return;
      beginResponseWindow(this.state, item);
    }
    else {
      this.state.prompt = undefined;
      this.state.responsePlayerId = undefined;
      this.resolveTop();
    }
  }

  private passResponse(player: AutoPlayerState) {
    if (!this.state || this.state.prompt?.kind !== "response" || this.state.responsePlayerId !== player.id) throw new Error("现在不由你响应。");
    this.state.consecutivePasses += 1;
    this.addLog(`${player.nickname} 放弃响应`, player.id, { zone: "resolving" });
    if (this.state.consecutivePasses < 2) {
      const next = opponentOf(this.state, player.id);
      if (!next) return;
      this.state.responsePlayerId = next.id;
      this.state.prompt = createPrompt({
        kind: "response",
        playerId: next.id,
        title: "响应窗口",
        message: "是否继续响应？",
        cardInstanceIds: [],
        options: [{ value: "pass", label: "放弃响应" }],
      });
      this.state.prompt.cardInstanceIds = legalResponseCards(this.state, next).map((card) => card.instanceId);
      return;
    }
    this.state.prompt = undefined;
    this.state.responsePlayerId = undefined;
    this.state.consecutivePasses = 0;
    this.resolveTop();
  }

  private openSourceSkillBeforeResponse(item: HandResolutionItem) {
    if (!this.state || ![HAND_IDS.strike, HAND_IDS.crisis].includes(effectiveDefinition(item) as never)) return false;
    const source = playerById(this.state, item.sourcePlayerId);
    if (!source) return false;
    const candidate = source.characterSlots.find((slot) => {
      if (!slot || !("instanceId" in slot) || (slot.faceDown && this.isCharacterRevealLocked(source, slot.instanceId))) return false;
      const registered = this.registeredCharacterSkill(source, slot);
      if (!registered || registered.module.trigger.event !== "prediction_targeted") return false;
      const key = this.characterEventUsageKey(item.id, source.id, `${slot.instanceId}:${registered.handlerId}`);
      return (this.state?.usageCounters[key] || 0) === 0;
    });
    if (!candidate || !("instanceId" in candidate)) return false;
    this.state.responsePlayerId = source.id;
    this.state.consecutivePasses = 0;
    this.state.prompt = createPrompt({
      kind: "response",
      playerId: source.id,
      title: "指定目标后的技能窗口",
      message: "你可以发动符合时机的角色技能，或放弃并让对手开始响应。",
      cardInstanceIds: [],
      options: [{ value: "pass", label: "放弃发动" }],
      context: { itemId: item.id, skillOnly: true },
    });
    return true;
  }

  private resolveTop(): void {
    if (!this.state || !this.state.stack.length || this.state.prompt) return;
    const item = this.state.stack.pop();
    if (!item) return;
    if (!isHandResolutionItem(item)) return this.resolveCharacterSkillItem(item);
    const effective = effectiveDefinition(item);

    if (item.countersItemId) {
      const target = this.state.stack.find((entry): entry is HandResolutionItem => entry.id === item.countersItemId && isHandResolutionItem(entry));
      if (target && !item.cancelled) {
        target.cancelled = true;
        target.cancelledByPlayerId = item.sourcePlayerId;
        target.cancellationReason = effective === HAND_IDS.dodge
          ? "dodge"
          : effective === HAND_IDS.meeting
            ? "meeting"
            : "counter";
      }
      if (effective === HAND_IDS.meeting && !item.cancelled) {
        this.state.phase = "deployment";
        this.state.deployedThisPhase = 2;
        for (const player of this.state.players) {
          let deployed;
          while ((deployed = deployTopCharacter(player))) {
            this.recordCharacterDeployment(item.sourcePlayerId, player.id, deployed.card.definitionId);
          }
        }
        this.addLog("【紧急会议】抵消了牌并结束出牌阶段，双方角色区已补满", item.sourcePlayerId, { zone: "resolving" });
      }
      if (isActionCard(item.definitionId)) this.emitEvent("card_resolved", {
        sourcePlayerId: item.sourcePlayerId,
        targetPlayerId: target?.sourcePlayerId,
        cardDefinitionId: item.definitionId,
        metadata: {
          actionCard: true,
          causedDamage: Number(item.damageDealt || 0) > 0,
          cardInstanceId: item.card.instanceId,
          targetSlotIndex: item.targetSlotIndex,
          cancelled: Boolean(item.cancelled),
        },
      });
      moveResolvedCardToDiscard(this.state, item.card);
      this.continueStack();
      return;
    }

    if (!item.cancelled) this.resolveHandEffect(item, effective);
    else if (effective === HAND_IDS.strike && item.cancelledByPlayerId && item.cancellationReason === "dodge") {
      this.emitEvent("strike_dodged", { sourcePlayerId: item.cancelledByPlayerId, targetPlayerId: item.sourcePlayerId, cardDefinitionId: effective });
      if (item.drawSourceOnDodge) {
        const source = playerById(this.state, item.sourcePlayerId);
        if (source) {
          const amount = drawCards(this.state, source, 1, (items) => this.shuffle(items));
          if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: source.id, targetPlayerId: source.id, amount, metadata: { outsideDrawPhase: true } });
        }
      }
    }
    if (effective === HAND_IDS.strike && !item.damagePending && !item.bloodAfterResolved) {
      this.resolveBloodStrikeAfterDamage(item.sourcePlayerId, Number(item.damageDealt || 0), item);
      item.bloodAfterResolved = true;
    }
    if (!item.damagePending && item.returnCharacterOnDamageInstanceId && Number(item.damageDealt || 0) > 0) {
      const source = playerById(this.state, item.sourcePlayerId);
      if (source) this.shuffleRetiredCharacter(source, item.returnCharacterOnDamageInstanceId);
    }
    if (!item.damagePending && item.bodyEffect === "aggro-mega-strike" && Number(item.damageDealt || 0) === 0) {
      const source = playerById(this.state, item.sourcePlayerId);
      if (source) this.loseHealth(source, 1, "【爱至癫狂】未造成伤害");
    }
    moveResolvedCardToDiscard(this.state, item.card);
    if (this.state.prompt) return;
    if (isActionCard(item.definitionId)) this.emitEvent("card_resolved", {
      sourcePlayerId: item.sourcePlayerId,
      targetPlayerId: item.targetPlayerId,
      cardDefinitionId: item.definitionId,
      metadata: {
        actionCard: true,
        causedDamage: Number(item.damageDealt || 0) > 0,
        cardInstanceId: item.card.instanceId,
        targetSlotIndex: item.targetSlotIndex,
        cancelled: Boolean(item.cancelled),
      },
    });
    if ([HAND_IDS.strike, HAND_IDS.crisis].includes(effective as never)) {
      this.resolveMizaiPrediction(
        item.sourcePlayerId,
        item.card.instanceId,
        Number(item.damageDealt || 0) > 0,
        effective,
        Boolean(item.wasRespondedTo),
      );
      if (this.state.prompt) return;
    }
    if (item.wasRespondedTo && this.openRecallForResolved(item.sourcePlayerId, item.card.instanceId, effective)) return;
    this.continueStack();
  }

  private continueStack(): void {
    if (!this.state || this.state.prompt) return;
    const top = this.state.stack[this.state.stack.length - 1];
    if (!top) return;
    if (!isHandResolutionItem(top)) return this.resolveTop();
    if (top.cancelled) this.resolveTop();
    else beginResponseWindow(this.state, top);
  }

  private resolveHandEffect(item: HandResolutionItem, effective: string) {
    if (!this.state) return;
    const source = playerById(this.state, item.sourcePlayerId);
    const target = item.targetPlayerId ? playerById(this.state, item.targetPlayerId) : undefined;
    if (!source) return;
    switch (effective) {
      case HAND_IDS.strike:
        if (target) {
          const applied = this.applyDamage(target, 1 + Number(item.damageBonus || 0), source.id, effective, {
            continuation: {
              kind: "hand-strike",
              sourcePlayerId: source.id,
              cardInstanceId: item.card.instanceId,
              wasRespondedTo: Boolean(item.wasRespondedTo),
              bodyEffect: item.bodyEffect,
              returnCharacterOnDamageInstanceId: item.returnCharacterOnDamageInstanceId,
              healSourceOnDamageAtLeast: item.healSourceOnDamageAtLeast,
              healSourceIfHealthNotHigher: item.healSourceIfHealthNotHigher,
              healSourceOnAnyDamage: item.healSourceOnAnyDamage,
            },
          });
          if (applied === undefined) item.damagePending = true;
          else item.damageDealt = (item.damageDealt || 0) + applied;
        }
        break;
      case HAND_IDS.aid:
        {
          const recovered = heal(source, 1);
          this.addLog(`${source.nickname} 回复了 ${recovered} 点体力`, source.id, { zone: "player", ownerId: source.id });
          if (recovered > 0) this.emitEvent("health_recovered", { sourcePlayerId: source.id, targetPlayerId: source.id, amount: recovered });
        }
        break;
      case HAND_IDS.draw:
        {
          const drawn = drawCards(this.state, source, 2, (items) => this.shuffle(items));
          this.addLog(`${source.nickname} 摸了 ${drawn} 张手牌`, source.id, { zone: "hand", ownerId: source.id });
          if (drawn > 0) this.emitEvent("cards_drawn", { sourcePlayerId: source.id, targetPlayerId: source.id, amount: drawn, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
        }
        break;
      case HAND_IDS.sabotage:
        if (target?.hand.length && !this.openDirectDisruptPrompt(source, target, item, "sabotage")) this.discardRandom(target, source.id);
        break;
      case HAND_IDS.steal:
        if (target?.hand.length && !this.openDirectDisruptPrompt(source, target, item, "steal")) {
          const index = this.randomIndex(target.hand.length);
          const [card] = target.hand.splice(index, 1);
          card.ownerId = source.id;
          source.hand.push(card);
          this.emitEvent("hand_lost", { sourcePlayerId: source.id, targetPlayerId: target.id, amount: 1 });
          this.addLog(`${source.nickname} 随机获得了${target.nickname}的1张手牌`, source.id, { zone: "hand", ownerId: target.id });
        }
        break;
      case HAND_IDS.crisis:
        if (target) this.state.prompt = createPrompt({
          kind: "crisis-choice",
          playerId: target.id,
          title: "危机破坏",
          message: "选择休整该角色，或令本体受到1点伤害。",
          options: [{ value: "rest", label: "休整角色" }, { value: "damage", label: "受到1点伤害" }],
          context: {
            sourcePlayerId: source.id,
            targetSlotIndex: item.targetSlotIndex,
            cardDefinitionId: HAND_IDS.crisis,
            cardInstanceId: item.card.instanceId,
            wasRespondedTo: Boolean(item.wasRespondedTo),
          },
        });
        break;
      case HAND_IDS.inspire:
        this.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: source.id, kind: "next-skill-cost-rest-one", count: 1 });
        break;
      case HAND_IDS.deploy:
        {
          const deployed = deployTopCharacter(source);
          if (deployed) this.recordCharacterDeployment(source.id, source.id, deployed.card.definitionId);
        }
        break;
      case HAND_IDS.inspect:
        {
          const inspectedCard = target?.characterSlots[item.targetSlotIndex ?? -1];
        this.state.prompt = createPrompt({
          kind: "reveal-choice",
          playerId: source.id,
          title: "看破",
          message: "你已查看该暗置角色，是否令其明置？",
          options: [{ value: "reveal", label: "令其明置" }, { value: "keep", label: "保持暗置" }],
          context: {
            targetPlayerId: target?.id,
            targetSlotIndex: item.targetSlotIndex,
            sourcePlayerId: source.id,
            cardDefinitionId: HAND_IDS.inspect,
            cardInstanceId: item.card.instanceId,
            inspectedCard: inspectedCard && "instanceId" in inspectedCard ? inspectedCard : undefined,
          },
        });
        this.emitEvent("inspection", { sourcePlayerId: source.id, targetPlayerId: target?.id, characterDefinitionId: inspectedCard && "instanceId" in inspectedCard ? inspectedCard.definitionId : undefined });
        }
        break;
      default:
        break;
    }
  }

  private submitChoice(player: AutoPlayerState, payload: Record<string, unknown>) {
    if (!this.state?.prompt || this.state.prompt.playerId !== player.id) throw new Error("当前没有需要你完成的选择。");
    const prompt = this.state.prompt;
    const value = cleanText(payload.value, 40);
    if (prompt.kind === "response") {
      if (value !== "pass") throw new Error("响应选择无效。");
      return this.passResponse(player);
    }
    if (prompt.kind === "discard") {
      const ids = Array.isArray(payload.cardInstanceIds) ? payload.cardInstanceIds.map((id) => cleanText(id, 80)) : [];
      if (ids.length !== prompt.min || new Set(ids).size !== ids.length) throw new Error("弃牌数量不正确。");
      for (const id of ids) {
        const index = player.hand.findIndex((card) => card.instanceId === id);
        if (index < 0) throw new Error("弃牌选择中包含无效手牌。");
        const [card] = player.hand.splice(index, 1);
        card.ownerId = undefined;
        this.state.handDiscard.push(card);
      }
      if (ids.length) this.emitEvent("hand_discarded", { sourcePlayerId: player.id, targetPlayerId: player.id, amount: ids.length, metadata: { phaseDiscard: true } });
      this.state.prompt = undefined;
      this.addLog(`${player.nickname} 在弃牌阶段弃置了 ${ids.length} 张手牌`, player.id, { zone: "handDiscard" });
      return;
    }
    if (prompt.kind === "damage-before") {
      const pending = prompt.context?.pendingDamage as {
        targetPlayerId?: string;
        sourcePlayerId?: string;
        amount?: number;
        cardDefinitionId?: string;
        continuation?: Record<string, unknown>;
      } | undefined;
      const source = pending?.sourcePlayerId ? playerById(this.state, pending.sourcePlayerId) : undefined;
      const target = pending?.targetPlayerId ? playerById(this.state, pending.targetPlayerId) : undefined;
      if (!pending || !source || !target || source.id !== player.id) throw new Error("待处理伤害已经失效。");
      this.state.prompt = undefined;
      let applied = 0;
      if (value === "pass") {
        applied = this.applyDamage(target, Number(pending.amount || 0), source.id, pending.cardDefinitionId, {
          skipReplacement: true,
          deferred: true,
          continuation: pending.continuation,
        }) || 0;
        if ((this.state.prompt as AutoRoomState["prompt"])?.kind === "dying") return;
      } else {
        const match = value.match(/^replace:([^:]+):(\d+)$/);
        const hitman = match ? this.findCharacterInstance(source, match[1]) : undefined;
        const slotIndex = match ? Number(match[2]) : -1;
        const targetRole = target.characterSlots[slotIndex];
        if (!hitman || (hitman.definitionId !== AGGRO_CHARACTER_IDS.weixiaokeleHitman
          && this.copiedCharacterDefinitionId(source, hitman) !== AGGRO_CHARACTER_IDS.weixiaokeleHitman)
          || !source.characterSlots.some((slot) => slot && "instanceId" in slot && slot.instanceId === hitman.instanceId)
          || !targetRole || !("instanceId" in targetRole)) throw new Error("伤害替换目标已经失效。");
        const definition = characterById.get(AGGRO_CHARACTER_IDS.weixiaokeleHitman);
        if (!definition) throw new Error("专业杀手数据不存在。");
        if (hitman.faceDown) hitman.faceDown = false;
        this.paySkillCost(source, hitman, definition.cost, { costCharacterIds: [hitman.instanceId] });
        this.emitEvent("skill_used", {
          sourcePlayerId: source.id,
          characterDefinitionId: hitman.definitionId,
          metadata: { costType: definition.cost.type, costAmount: definition.cost.amount || 0, mainRole: definition.mainRole },
        });
        this.restCharacter(target, slotIndex, source.id);
        this.emitEvent("skill_resolved", { sourcePlayerId: source.id, characterDefinitionId: hitman.definitionId });
        this.addLog(`${source.nickname}发动【专业处理】，将伤害改为休整对手1张角色`, source.id, { zone: "resolving" });
      }
      this.resumeDamageContinuation(pending.continuation, applied);
      return;
    }
    if (prompt.kind === "dying") {
      if (value === "pass") {
        const winner = opponentOf(this.state, player.id);
        this.state.winnerId = winner?.id;
        this.state.prompt = undefined;
        this.state.stack = [];
        this.state.resolving = [];
        this.addLog(`${player.nickname} 未能脱离濒死，${winner?.nickname || "对手"} 获胜`, winner?.id, { zone: "room" });
        return;
      }
      const cardId = cleanText(payload.instanceId, 80);
      const index = player.hand.findIndex((card) => card.instanceId === cardId && (card.definitionId === HAND_IDS.aid || card.definitionId === HAND_IDS.impersonate));
      if (index < 0) throw new Error("请选择可作为【急救】使用的牌。");
      const [card] = player.hand.splice(index, 1);
      card.ownerId = undefined;
      this.state.handDiscard.push(card);
      heal(player, 1);
      this.emitEvent("health_recovered", { sourcePlayerId: player.id, targetPlayerId: player.id, amount: 1 });
      if (player.health >= 1) {
        const continuation = prompt.context?.damageContinuation as Record<string, unknown> | undefined;
        const applied = Number(prompt.context?.appliedDamage || 0);
        this.state.prompt = undefined;
        if (continuation) this.resumeDamageContinuation(continuation, applied);
        else this.continueStack();
      } else {
        prompt.cardInstanceIds = player.hand.filter((item) => item.definitionId === HAND_IDS.aid || item.definitionId === HAND_IDS.impersonate).map((item) => item.instanceId);
      }
      return;
    }
    if (prompt.kind === "crisis-choice") {
      if (!prompt.options?.some((option) => option.value === value)) throw new Error("危机破坏选择无效。");
      const slotIndex = Number(prompt.context?.targetSlotIndex);
      let causedDamage = false;
      if (value === "rest") this.restCharacter(player, slotIndex, cleanText(prompt.context?.sourcePlayerId, 20));
      else {
        const applied = this.applyDamage(player, 1, cleanText(prompt.context?.sourcePlayerId, 20), HAND_IDS.crisis, {
          continuation: {
            kind: "crisis",
            sourcePlayerId: cleanText(prompt.context?.sourcePlayerId, 20),
            targetPlayerId: player.id,
            cardInstanceId: cleanText(prompt.context?.cardInstanceId, 80),
            targetSlotIndex: Number(prompt.context?.targetSlotIndex),
          },
        });
        if (applied === undefined) return;
        causedDamage = applied > 0;
      }
      this.emitEvent("card_resolved", {
        sourcePlayerId: cleanText(prompt.context?.sourcePlayerId, 20),
        targetPlayerId: player.id,
        cardDefinitionId: HAND_IDS.crisis,
        metadata: {
          actionCard: true,
          causedDamage,
          cardInstanceId: cleanText(prompt.context?.cardInstanceId, 80),
          targetSlotIndex: Number(prompt.context?.targetSlotIndex),
        },
      });
      if (this.state.prompt?.id === prompt.id) this.state.prompt = undefined;
      this.resolveMizaiPrediction(
        cleanText(prompt.context?.sourcePlayerId, 20),
        cleanText(prompt.context?.cardInstanceId, 80),
        causedDamage,
        HAND_IDS.crisis,
        prompt.context?.wasRespondedTo === true,
      );
      if (!this.state.prompt && prompt.context?.wasRespondedTo === true) {
        this.openRecallForResolved(
          cleanText(prompt.context?.sourcePlayerId, 20),
          cleanText(prompt.context?.cardInstanceId, 80),
          HAND_IDS.crisis,
        );
      }
      this.continueStack();
      return;
    }
    if (prompt.kind === "reveal-choice") {
      if (!["reveal", "keep"].includes(value)) throw new Error("看破选择无效。");
      if (value === "reveal") {
        const owner = playerById(this.state, cleanText(prompt.context?.targetPlayerId, 20));
        const card = owner?.characterSlots[Number(prompt.context?.targetSlotIndex)];
        if (card && "instanceId" in card) card.faceDown = false;
      }
      this.emitEvent("card_resolved", {
        sourcePlayerId: cleanText(prompt.context?.sourcePlayerId, 20),
        targetPlayerId: cleanText(prompt.context?.targetPlayerId, 20),
        cardDefinitionId: HAND_IDS.inspect,
        metadata: {
          actionCard: true,
          causedDamage: false,
          cardInstanceId: cleanText(prompt.context?.cardInstanceId, 80),
          targetSlotIndex: Number(prompt.context?.targetSlotIndex),
        },
      });
      this.state.prompt = undefined;
      this.continueStack();
      return;
    }
    if (prompt.kind === "character-skill") return this.submitCharacterChoice(player, prompt, payload);
    if (prompt.kind === "character-trigger") {
      if (value.startsWith("body:")) {
        const triggerId = value.slice(5);
        const allowed = Array.isArray(prompt.context?.bodyTriggerIds) ? prompt.context.bodyTriggerIds.map(String) : [];
        const index = this.state.pendingBodyTriggers.findIndex((trigger) => trigger.id === triggerId && trigger.playerId === player.id);
        if (!allowed.includes(triggerId) || index < 0) throw new Error("本体技能触发选择无效。");
        const [trigger] = this.state.pendingBodyTriggers.splice(index, 1);
        this.state.prompt = undefined;
        if (!this.openBodyPrompt(player, trigger)) this.openNextSkillTrigger();
        return;
      }
      if (value !== "pass") throw new Error("同时触发选择无效。");
      const eventId = cleanText(prompt.context?.eventId, 80);
      const eligibleIds = Array.isArray(prompt.context?.eligibleInstanceIds)
        ? prompt.context.eligibleInstanceIds.map((id) => cleanText(id, 80))
        : [];
      for (const instanceId of eligibleIds) {
        const role = this.findCharacterInstance(player, instanceId);
        const registered = role ? this.registeredCharacterSkill(player, role) : undefined;
        if (role && registered) this.state.usageCounters[this.characterEventUsageKey(eventId, player.id, `${role.instanceId}:${registered.handlerId}`)] = 1;
      }
      const bodyTriggerIds = Array.isArray(prompt.context?.bodyTriggerIds) ? prompt.context.bodyTriggerIds.map(String) : [];
      this.state.pendingBodyTriggers = this.state.pendingBodyTriggers.filter((trigger) => !bodyTriggerIds.includes(trigger.id));
      this.state.prompt = undefined;
      this.openNextSkillTrigger();
      return;
    }
    if ((prompt.kind as string) === "recall") {
      if (value !== "pass") {
        const recallId = cleanText(payload.instanceId, 80);
        const recallIndex = player.hand.findIndex((card) => card.instanceId === recallId && card.definitionId === HAND_IDS.recall);
        const targetIndex = this.state.handDiscard.findIndex((card) => card.instanceId === prompt.context?.targetCardId);
        if (recallIndex < 0 || targetIndex < 0) throw new Error("撤回目标无效。");
        const [recall] = player.hand.splice(recallIndex, 1);
        recall.ownerId = undefined;
        this.state.handDiscard.push(recall);
        const [target] = this.state.handDiscard.splice(targetIndex, 1);
        target.ownerId = player.id;
        player.hand.push(target);
        if (cleanText(prompt.context?.targetDefinitionId, 80) === HAND_IDS.strike) {
          const usageKey = `turn:${this.state.turnNumber}:${player.id}:strike`;
          this.state.usageCounters[usageKey] = Math.max(0, (this.state.usageCounters[usageKey] || 0) - 1);
        }
      }
      this.state.prompt = undefined;
      this.continueStack();
      return;
    }
    if (prompt.kind === "body-skill") return this.submitBodyChoice(player, prompt, payload);
    throw new Error("选择类型无效。");
  }

  private resumeDamageContinuation(continuation: Record<string, unknown> | undefined, applied: number) {
    if (!this.state || !continuation) {
      this.openNextSkillTrigger();
      return;
    }
    const kind = cleanText(continuation.kind, 40);
    if (kind === "character-skill") {
      const item = continuation.item as CharacterSkillResolutionItem | undefined;
      if (!item) return this.openNextSkillTrigger();
      const source = playerById(this.state, item.sourcePlayerId);
      if (applied > 0 && continuation.after === "return-self-if-target-health-at-most-3") {
        const target = opponentOf(this.state, item.sourcePlayerId);
        if (target && target.health <= 3 && source) this.shuffleRetiredCharacter(source, item.sourceInstanceId);
      }
      if (source) this.finishCharacterSkill(item, source);
      return;
    }
    if (kind === "hand-strike") {
      const sourceId = cleanText(continuation.sourcePlayerId, 20);
      const source = playerById(this.state, sourceId);
      const returnId = cleanText(continuation.returnCharacterOnDamageInstanceId, 80);
      if (applied > 0 && source && returnId) this.shuffleRetiredCharacter(source, returnId);
      if (applied === 0 && continuation.bodyEffect === "aggro-mega-strike" && source) this.loseHealth(source, 1, "【爱至癫狂】未造成伤害");
      this.resolveBloodStrikeAfterDamage(sourceId, applied, {
        healSourceOnDamageAtLeast: Number(continuation.healSourceOnDamageAtLeast || 0) || undefined,
        healSourceIfHealthNotHigher: continuation.healSourceIfHealthNotHigher === true,
        healSourceOnAnyDamage: continuation.healSourceOnAnyDamage === true,
      });
      this.resolveMizaiPrediction(
        sourceId,
        cleanText(continuation.cardInstanceId, 80),
        applied > 0,
        HAND_IDS.strike,
        continuation.wasRespondedTo === true,
      );
      if (!this.state.prompt && continuation.wasRespondedTo === true) {
        this.openRecallForResolved(sourceId, cleanText(continuation.cardInstanceId, 80), HAND_IDS.strike);
      }
      this.continueStack();
      this.openNextSkillTrigger();
      return;
    }
    if (kind === "crisis") {
      this.emitEvent("card_resolved", {
        sourcePlayerId: cleanText(continuation.sourcePlayerId, 20),
        targetPlayerId: cleanText(continuation.targetPlayerId, 20),
        cardDefinitionId: HAND_IDS.crisis,
        metadata: {
          actionCard: true,
          causedDamage: applied > 0,
          cardInstanceId: cleanText(continuation.cardInstanceId, 80),
          targetSlotIndex: Number(continuation.targetSlotIndex),
        },
      });
      this.resolveMizaiPrediction(
        cleanText(continuation.sourcePlayerId, 20),
        cleanText(continuation.cardInstanceId, 80),
        applied > 0,
        HAND_IDS.crisis,
        continuation.wasRespondedTo === true,
      );
      if (!this.state.prompt && continuation.wasRespondedTo === true) {
        this.openRecallForResolved(
          cleanText(continuation.sourcePlayerId, 20),
          cleanText(continuation.cardInstanceId, 80),
          HAND_IDS.crisis,
        );
      }
      this.continueStack();
      this.openNextSkillTrigger();
      return;
    }
    if (kind === "bomb") {
      const target = playerById(this.state, cleanText(continuation.targetPlayerId, 20));
      if (target) this.discardRandom(target, cleanText(continuation.sourcePlayerId, 20));
      this.openNextSkillTrigger();
      return;
    }
    this.openNextSkillTrigger();
  }

  private newBodyState(definitionId?: string): BodyRuntimeState {
    const definition = bodyById.get(definitionId || "");
    return {
      progress: 0,
      progressMax: definition ? getExtraFormProgressMax(definition) || 0 : 0,
      flipped: false,
      extraFormUsed: false,
      trackedCharacterInstanceIds: [],
    };
  }

  private bodySkillContext(player: AutoPlayerState): BodySkillRuntimeContext {
    if (!this.state) throw new Error("房间状态不存在。");
    const state = this.state;
    const usageKey = (scope: "turn" | "game", suffix: string) => bodyUsageKey(scope, state.turnNumber, player.id, suffix);
    return {
      state,
      player,
      opponent: () => opponentOf(state, player.id),
      skillName: (extraForm = false) => {
        const definition = bodyById.get(bodyId(player));
        return extraForm ? definition?.extraForm?.skillName || definition?.skillName || "本体技能" : definition?.skillName || "本体技能";
      },
      usage: (scope, suffix) => state.usageCounters[usageKey(scope, suffix)] || 0,
      incrementUsage: (scope, suffix, amount = 1) => {
        const key = usageKey(scope, suffix);
        state.usageCounters[key] = (state.usageCounters[key] || 0) + amount;
        return state.usageCounters[key];
      },
      enqueueTrigger: (kind, eventId, context) => {
        if (state.pendingBodyTriggers.some((trigger) => trigger.playerId === player.id && trigger.kind === kind && trigger.eventId === eventId)) return;
        state.pendingBodyTriggers.push({ id: crypto.randomUUID(), kind, playerId: player.id, eventId, context });
      },
      setPrompt: (prompt) => { state.prompt = createPrompt(prompt); },
      clearPrompt: (promptId) => { if (state.prompt?.id === promptId) state.prompt = undefined; },
      draw: (count) => {
        const amount = drawCards(state, player, count, (items) => this.shuffle(items));
        this.addLog(`${player.nickname}摸了 ${amount} 张手牌`, player.id, { zone: "hand", ownerId: player.id });
        if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: state.phase !== "draw" } });
        return amount;
      },
      takeTopHandCards: (count) => this.takeTopHandCards(count),
      discardHandCard: (owner, instanceId) => {
        const index = owner.hand.findIndex((card) => card.instanceId === instanceId);
        if (index < 0) return undefined;
        const [card] = owner.hand.splice(index, 1);
        card.ownerId = undefined;
        state.handDiscard.push(card);
        return card;
      },
      gainHandCard: (card) => {
        card.ownerId = player.id;
        player.hand.push(card);
      },
      discardLooseCard: (card) => {
        card.ownerId = undefined;
        state.handDiscard.push(card);
      },
      handName,
      addLog: (message, actorId, target) => this.addLog(message, actorId, target),
      emitEvent: (type, details = {}) => this.emitEvent(type, details),
      legalStrikeCards: () => player.hand.filter((card) => card.definitionId === HAND_IDS.strike || card.definitionId === HAND_IDS.impersonate),
      startBodyStrike: (targetPlayerId, cardInstanceId) => {
        const target = playerById(state, targetPlayerId);
        const index = player.hand.findIndex((card) => card.instanceId === cardInstanceId);
        if (!target || index < 0) throw new Error("额外【出刀】目标或手牌无效。");
        const [card] = player.hand.splice(index, 1);
        if (![HAND_IDS.strike, HAND_IDS.impersonate].includes(card.definitionId as never)) throw new Error("该牌不能当【出刀】使用。");
        state.resolving.push(card);
        const item: ResolutionItem = {
          kind: "hand",
          id: crypto.randomUUID(), sourcePlayerId: player.id, targetPlayerId: target.id, card,
          definitionId: card.definitionId,
          resolvedAs: card.definitionId === HAND_IDS.impersonate ? HAND_IDS.strike : undefined,
          bodyEffect: "aggro-mega-strike",
        };
        if (isHandResolutionItem(item)) this.attachStrikeModifiers(player, item);
        state.stack.push(item);
        this.emitEvent("card_used", { sourcePlayerId: player.id, targetPlayerId: target.id, cardDefinitionId: HAND_IDS.strike, metadata: { actionCard: false, bodySkill: true } });
        state.responsePlayerId = target.id;
        state.consecutivePasses = 0;
        state.prompt = createPrompt({
          kind: "response", playerId: target.id, title: "响应窗口", message: "是否响应本体技能使用的【出刀】？",
          cardInstanceIds: [], options: [{ value: "pass", label: "放弃响应" }], context: { itemId: item.id },
        });
        state.prompt.cardInstanceIds = legalResponseCards(state, target).map((candidate) => candidate.instanceId);
      },
    };
  }

  private handleBodyEvent(event: AutoBattleEvent) {
    if (!this.state?.started) return;
    const playersInResolutionOrder = [...this.state.players].sort((left, right) => {
      const leftIsCurrent = left.id === this.state?.currentPlayerId;
      const rightIsCurrent = right.id === this.state?.currentPlayerId;
      return Number(leftIsCurrent) - Number(rightIsCurrent);
    });
    for (const player of playersInResolutionOrder) {
      const skill = bodySkillForId(bodyId(player));
      const context = skill ? this.bodySkillContext(player) : undefined;
      const delta = skill ? skill.progressDelta(player, event) : bodyProgressDelta(player, event);
      if (delta > 0 && !player.bodyState.flipped) {
        const previous = player.bodyState.progress;
        player.bodyState.progress = Math.min(player.bodyState.progressMax, previous + delta);
        if (player.bodyState.progress !== previous) {
          this.addLog(`${player.nickname}的额外形态进度 ${player.bodyState.progress}/${player.bodyState.progressMax}`, player.id, { zone: "body", ownerId: player.id });
        }
        if (player.bodyState.progressMax > 0 && player.bodyState.progress >= player.bodyState.progressMax) {
          player.bodyState.flipped = true;
          const form = bodyById.get(bodyId(player))?.extraForm?.type === "mega" ? "Mega" : "Z招式就绪";
          this.addLog(`${player.nickname}已达成${form}条件`, player.id, { zone: "body", ownerId: player.id });
        }
      }

      const triggerSpec = skill && context ? skill.collectTrigger(context, event) : undefined;
      const kind = skill ? triggerSpec?.kind : triggerKindForBody(player, event);
      if (!kind) continue;
      const trigger: PendingBodyTrigger = {
        id: crypto.randomUUID(),
        kind,
        playerId: player.id,
        eventId: event.id,
        context: {
          sourcePlayerId: event.sourcePlayerId,
          targetPlayerId: event.targetPlayerId,
          characterDefinitionId: event.characterDefinitionId,
          causedDamage: event.metadata?.causedDamage === true,
          ...triggerSpec?.context,
        },
      };
      if (!this.state.pendingBodyTriggers.some((queued) => queued.playerId === player.id && queued.kind === kind && queued.eventId === event.id)) {
        this.state.pendingBodyTriggers.push(trigger);
      }
    }
  }

  private openNextBodyTrigger() {
    if (!this.state?.started || this.state.prompt || this.state.stack.length || this.state.winnerId) return;
    while (this.state.pendingBodyTriggers.length) {
      const trigger = this.state.pendingBodyTriggers.shift();
      if (!trigger) return;
      const player = playerById(this.state, trigger.playerId);
      if (!player) continue;
      if (this.openBodyPrompt(player, trigger)) return;
    }
  }

  private openNextSkillTrigger(): void {
    if (!this.state?.started || this.state.prompt || this.state.stack.length || this.state.winnerId) return;
    const playersInResolutionOrder = [...this.state.players].sort((left, right) => {
      const leftIsCurrent = left.id === this.state?.currentPlayerId;
      const rightIsCurrent = right.id === this.state?.currentPlayerId;
      return Number(leftIsCurrent) - Number(rightIsCurrent);
    });
    for (const player of playersInResolutionOrder) {
      const pendingBody = this.state.pendingBodyTriggers.filter((trigger) => trigger.playerId === player.id);
      const candidates = player.characterSlots.flatMap((slot) => {
        if (!slot || !("instanceId" in slot)) return [];
        if (slot.faceDown && this.isCharacterRevealLocked(player, slot.instanceId)) return [];
        const registered = this.registeredCharacterSkill(player, slot);
        const module = registered?.module;
        if (!module || ["play_phase", "basic_card_needed", "prediction_targeted"].includes(module.trigger.event)) return [];
        const trigger = this.skillTriggerContext(module.trigger.event, module.trigger.relation, undefined, player, false);
        if (!trigger) return [];
        const event = "type" in trigger ? trigger as AutoBattleEvent : undefined;
        const eventId = event?.id || trigger.id;
        if ((this.state!.usageCounters[this.characterEventUsageKey(eventId, player.id, `${slot.instanceId}:${registered.handlerId}`)] || 0) > 0) return [];
        const context = this.characterSkillContext(player, slot, event);
        if (module.canActivate && !module.canActivate(context)) return [];
        return [{ slot, eventId }];
      });
      if (!candidates.length && !pendingBody.length) continue;
      const eventId = pendingBody[0]?.eventId || candidates[0]?.eventId;
      const sameEvent = candidates.filter((candidate) => candidate.eventId === eventId);
      const sameEventBody = pendingBody.filter((trigger) => trigger.eventId === eventId);
      if (!sameEvent.length && sameEventBody.length === 1) {
        const triggerIndex = this.state.pendingBodyTriggers.findIndex((trigger) => trigger.id === sameEventBody[0].id);
        const [trigger] = this.state.pendingBodyTriggers.splice(triggerIndex, 1);
        if (this.openBodyPrompt(player, trigger)) return;
        return this.openNextSkillTrigger();
      }
      const bodyName = bodyById.get(bodyId(player))?.skillName || "本体技能";
      this.state.prompt = createPrompt({
        kind: "character-trigger",
        playerId: player.id,
        title: "同时触发结算",
        message: "选择先发动的技能，或放弃该玩家在本次事件的其余可选触发。",
        options: [
          ...sameEventBody.map((trigger) => ({ value: `body:${trigger.id}`, label: `发动本体技能【${bodyName}】` })),
          { value: "pass", label: "放弃本次其余触发" },
        ],
        context: {
          eventId,
          eligibleInstanceIds: sameEvent.map((candidate) => candidate.slot.instanceId),
          bodyTriggerIds: sameEventBody.map((trigger) => trigger.id),
        },
      });
      return;
    }
    this.advancePendingJudgment();
  }

  private openBodyPrompt(player: AutoPlayerState, trigger: PendingBodyTrigger) {
    if (!this.state) return false;
    const registeredSkill = bodySkillForId(bodyId(player));
    if (registeredSkill) return registeredSkill.openPrompt(this.bodySkillContext(player), trigger);
    const make = (message: string, options: Array<{ value: string; label: string }>, action: string) => {
      this.state!.prompt = createPrompt({
        kind: "body-skill",
        playerId: player.id,
        title: bodyById.get(bodyId(player))?.skillName || "本体技能",
        message,
        options,
        context: { action, triggerId: trigger.id, ...trigger.context },
      });
      return true;
    };
    const turnKey = (suffix: string) => bodyUsageKey("turn", this.state!.turnNumber, player.id, suffix);
    switch (trigger.kind) {
      case "trans-deploy":
        if ((this.state.usageCounters[turnKey("trans")] || 0) >= (player.bodyState.flipped ? 2 : 1)) return false;
        if (!player.characterSlots.includes(null) || !player.characterDeck.length) return false;
        return make("你完成了拟态或虚拟牌操作，是否从角色牌堆顶暗置上阵1张角色？", [{ value: "deploy", label: "暗置上阵" }, { value: "pass", label: "不发动" }], "trans-deploy");
      case "dispatch-reveal":
        if ((this.state.usageCounters[turnKey("dispatch")] || 0) >= 1 || !player.characterDeck.length) return false;
        return this.openDispatchSortPrompt(player, trigger);
      case "blood-judgment":
        if ((this.state.usageCounters[turnKey("blood")] || 0) >= 2) return false;
        return make("你受到了伤害，是否发动【红黑谜案大推理】进行判定？", [{ value: "judge", label: "进行判定" }, { value: "pass", label: "不发动" }], "blood-judge");
      case "ambush-refill":
        if ((this.state.usageCounters[turnKey("ambush-refill")] || 0) >= 1 || !player.characterSlots.includes(null) || !player.characterDeck.length) return false;
        return make("己方伏击角色因支付费用离场，是否暗置补位1张角色？", [{ value: "deploy", label: "暗置补位" }, { value: "pass", label: "不发动" }], "ambush-refill");
      case "defense-reward":
        if ((this.state.usageCounters[turnKey("defense")] || 0) >= 3) return false;
        return make("你成功抵消、防止或减少了伤害，是否摸1张手牌并观看对手1张暗置角色？", [{ value: "reward", label: "摸牌并观看" }, { value: "pass", label: "不发动" }], "defense-reward");
      default:
        return false;
    }
  }

  private takeTopHandCards(count: number) {
    if (!this.state) return [];
    const cards: CardInstance[] = [];
    while (cards.length < count) {
      if (!this.state.handDeck.length) {
        if (!this.state.handDiscard.length) break;
        this.state.handDeck = this.shuffle(this.state.handDiscard.splice(0).map((card) => ({ ...card, ownerId: undefined })));
      }
      const card = this.state.handDeck.pop();
      if (!card) break;
      cards.push(card);
    }
    return cards;
  }

  private openDispatchSortPrompt(player: AutoPlayerState, trigger: PendingBodyTrigger) {
    if (!this.state) return false;
    const cards: CardInstance[] = [];
    while (cards.length < 3 && player.characterDeck.length) {
      const card = player.characterDeck.pop();
      if (card) cards.push(card);
    }
    if (!cards.length) return false;
    const permutations = <T,>(items: T[]): T[][] => items.length <= 1
      ? [items]
      : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
    const options: Array<{ value: string; label: string }> = [{ value: "pass", label: "不发动（原顺序放回）" }];
    const indexes = cards.map((_, index) => index);
    for (const order of permutations(indexes)) {
      options.push({ value: `b:-1|o:${order.join(",")}`, label: `牌堆顶顺序：${order.map((index) => characterById.get(cards[index].definitionId)?.name || cards[index].definitionId).join(" → ")}` });
    }
    if (cards.length > 1) for (const bottom of indexes) {
      const rest = indexes.filter((index) => index !== bottom);
      for (const order of permutations(rest)) {
        options.push({ value: `b:${bottom}|o:${order.join(",")}`, label: `${characterById.get(cards[bottom].definitionId)?.name || cards[bottom].definitionId}置底；顶部：${order.map((index) => characterById.get(cards[index].definitionId)?.name || cards[index].definitionId).join(" → ")}` });
      }
    }
    this.state.prompt = createPrompt({
      kind: "body-skill", playerId: player.id, title: "洞察全局",
      message: "观看角色牌堆顶3张，可将至多1张置底，并选择其余牌的顶部顺序。",
      selectableCards: cards, options,
      context: { action: "dispatch-sort", cardIds: cards.map((card) => card.instanceId), revealedByOpponent: trigger.context?.sourcePlayerId !== player.id },
    });
    return true;
  }

  private submitBodyChoice(player: AutoPlayerState, prompt: NonNullable<AutoRoomState["prompt"]>, payload: Record<string, unknown>) {
    if (!this.state) return;
    const registeredSkill = bodySkillForId(bodyId(player));
    if (registeredSkill?.resolveChoice(this.bodySkillContext(player), prompt, payload)) return;
    const action = cleanText(prompt.context?.action, 80);
    const value = cleanText(payload.value, 400);
    const selectedIds = Array.isArray(payload.cardInstanceIds) ? payload.cardInstanceIds.map((id) => cleanText(id, 80)) : [];
    const turnKey = (suffix: string) => bodyUsageKey("turn", this.state!.turnNumber, player.id, suffix);
    const clear = () => { if (this.state?.prompt?.id === prompt.id) this.state.prompt = undefined; };
    const draw = (count: number) => {
      const amount = drawCards(this.state!, player, count, (items) => this.shuffle(items));
      this.addLog(`${player.nickname}摸了 ${amount} 张手牌`, player.id, { zone: "hand", ownerId: player.id });
      if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: this.state!.phase !== "draw" } });
    };

    if (action === "trans-deploy" || action === "ambush-refill") {
      clear();
      if (value === "pass") return;
      if (value !== "deploy") throw new Error("上阵选择无效。");
      const suffix = action === "trans-deploy" ? "trans" : "ambush-refill";
      this.state.usageCounters[turnKey(suffix)] = (this.state.usageCounters[turnKey(suffix)] || 0) + 1;
      const deployed = deployTopCharacter(player);
      if (!deployed) throw new Error("角色区已满或角色牌堆为空。");
      this.recordCharacterDeployment(player.id, player.id, deployed.card.definitionId);
      if (action === "trans-deploy") {
        player.bodyState.trackedCharacterInstanceIds.push(deployed.card.instanceId);
        if (player.bodyState.flipped) this.state.turnModifiers.push({
          id: crypto.randomUUID(), ownerId: player.id, kind: "body-next-skill-cost-rest-one", count: 1,
          characterInstanceId: deployed.card.instanceId, expiresAtTurnNumber: this.state.turnNumber + 1,
        });
      }
      this.addLog(`${player.nickname}因本体技能暗置上阵1张角色`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex: deployed.slotIndex });
      return;
    }
    if (action === "dispatch-sort") {
      const cards = prompt.selectableCards || [];
      let bottom = -1;
      let order = cards.map((_, index) => index);
      if (value !== "pass") {
        const match = value.match(/^b:(-?\d+)\|o:([\d,]*)$/);
        if (!match) throw new Error("牌堆顺序选择无效。");
        bottom = Number(match[1]);
        order = match[2] ? match[2].split(",").map(Number) : [];
        const expected = cards.map((_, index) => index).filter((index) => index !== bottom).sort();
        if (JSON.stringify([...order].sort()) !== JSON.stringify(expected)) throw new Error("牌堆顺序不完整。");
      }
      if (bottom >= 0) player.characterDeck.unshift(cards[bottom]);
      for (const index of [...order].reverse()) player.characterDeck.push(cards[index]);
      if (value !== "pass") this.state.usageCounters[turnKey("dispatch")] = (this.state.usageCounters[turnKey("dispatch")] || 0) + 1;
      clear();
      if (value !== "pass" && prompt.context?.revealedByOpponent === true) {
        draw(1);
        this.state.prompt = createPrompt({
          kind: "body-skill", playerId: player.id, title: "洞察全局", message: "对手角色明置：请弃置1张手牌。",
          min: 1, max: 1, cardInstanceIds: player.hand.map((card) => card.instanceId), selectableCards: player.hand,
          context: { action: "dispatch-discard" },
        });
      }
      return;
    }
    if (action === "dispatch-discard" || action === "blood-self-discard") {
      if (selectedIds.length !== 1 || !prompt.cardInstanceIds?.includes(selectedIds[0])) throw new Error("请选择1张手牌弃置。");
      const index = player.hand.findIndex((card) => card.instanceId === selectedIds[0]);
      if (index < 0) throw new Error("手牌已变化。");
      const [card] = player.hand.splice(index, 1); card.ownerId = undefined; this.state.handDiscard.push(card);
      clear();
      if (action === "blood-self-discard") {
        draw(1);
        this.openNextSkillTrigger();
      }
      return;
    }
    if (action === "blood-judge") {
      if (value === "pass") {
        clear();
        this.openNextSkillTrigger();
        return;
      }
      if (value !== "judge") throw new Error("判定选择无效。");
      this.state.usageCounters[turnKey("blood")] = (this.state.usageCounters[turnKey("blood")] || 0) + 1;
      clear(); this.startJudgment(player, "blood-body"); return;
    }
    if (action === "defense-reward") {
      if (value === "pass") return clear();
      if (value !== "reward") throw new Error("守势循环选择无效。");
      this.state.usageCounters[turnKey("defense")] = (this.state.usageCounters[turnKey("defense")] || 0) + 1;
      clear(); draw(1);
      const opponent = opponentOf(this.state, player.id);
      const hidden = opponent?.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot && slot.faceDown ? [{ slot, index }] : []) || [];
      if (hidden.length) this.state.prompt = createPrompt({
        kind: "body-skill", playerId: player.id, title: "守势循环", message: "选择观看对手1张暗置角色。",
        options: hidden.map(({ index }) => ({ value: String(index), label: `观看角色位 ${index + 1}` })), context: { action: "defense-inspect", opponentId: opponent?.id },
      });
      return;
    }
    if (action === "defense-inspect") {
      const opponent = playerById(this.state, cleanText(prompt.context?.opponentId, 20));
      const slot = opponent?.characterSlots[Number(value)];
      if (!slot || !("instanceId" in slot) || !slot.faceDown) throw new Error("该角色已不是暗置状态。");
      this.state.prompt = createPrompt({ kind: "body-skill", playerId: player.id, title: "守势循环·观看", message: "你观看了这张暗置角色。", selectableCards: [slot], options: [{ value: "done", label: "完成" }], context: { action: "defense-inspect-done" } });
      return;
    }
    if (action === "defense-inspect-done") { if (value !== "done") throw new Error("请完成观看。"); return clear(); }
    if (action === "dispatch-z-select") return this.resolveDispatchZSelection(player, prompt, selectedIds);
    if (action === "dispatch-z-reveal") return this.resolveDispatchZReveal(player, prompt, selectedIds);
    if (action === "blood-z-pick") return this.resolveBloodZSelection(player, prompt, selectedIds);
    throw new Error("本体技能选择无效。");
  }

  private judgmentColor(card: CardInstance) {
    return card.joker === "big" || ["红桃", "方块"].includes(card.suit || "") ? "红色" : "黑色";
  }

  private startJudgment(player: AutoPlayerState, purpose: PendingJudgment["purpose"] = "generic") {
    if (!this.state) return;
    const [card] = this.takeTopHandCards(1);
    if (!card) return;
    card.ownerId = undefined;
    this.state.handDiscard.push(card);
    const judgment: PendingJudgment = {
      id: crypto.randomUUID(), playerId: player.id, purpose, stage: "revealed", cardInstanceId: card.instanceId,
    };
    this.state.pendingJudgments.push(judgment);
    const color = this.judgmentColor(card);
    this.addLog(`${player.nickname}的判定牌为${color}【${handName(card.definitionId)}】`, player.id, { zone: "handDiscard" });
    this.emitEvent("judgment_revealed", {
      sourcePlayerId: player.id, targetPlayerId: player.id, cardDefinitionId: card.definitionId,
      metadata: { color, bodySkill: purpose === "blood-body", judgmentId: judgment.id, cardInstanceId: card.instanceId },
    });
    this.openNextSkillTrigger();
  }

  private pendingJudgment(id?: string) {
    if (!this.state) return undefined;
    return id
      ? this.state.pendingJudgments.find((judgment) => judgment.id === id)
      : this.state.pendingJudgments.at(-1);
  }

  private pendingJudgmentCard(judgment?: PendingJudgment) {
    return judgment ? this.state?.handDiscard.find((card) => card.instanceId === judgment.cardInstanceId) : undefined;
  }

  private advancePendingJudgment() {
    if (!this.state || this.state.prompt || this.state.stack.length) return;
    const judgment = this.pendingJudgment();
    if (!judgment) return this.openNextBodyTrigger();
    const player = playerById(this.state, judgment.playerId);
    const card = this.pendingJudgmentCard(judgment);
    if (!player || !card) {
      this.state.pendingJudgments = this.state.pendingJudgments.filter((candidate) => candidate.id !== judgment.id);
      return this.openNextSkillTrigger();
    }
    if (judgment.stage === "revealed") {
      judgment.stage = "resolved";
      const color = this.judgmentColor(card);
      this.emitEvent("judgment_resolved", {
        sourcePlayerId: player.id, targetPlayerId: player.id, cardDefinitionId: card.definitionId,
        metadata: { color, bodySkill: judgment.purpose === "blood-body", judgmentId: judgment.id, cardInstanceId: card.instanceId },
      });
      return this.openNextSkillTrigger();
    }
    this.state.pendingJudgments = this.state.pendingJudgments.filter((candidate) => candidate.id !== judgment.id);
    const red = this.judgmentColor(card) === "红色";
    if (judgment.purpose === "blood-prophet") {
      if (red) {
        const recovered = heal(player, 1);
        if (recovered) this.emitEvent("health_recovered", { sourcePlayerId: player.id, targetPlayerId: player.id, amount: recovered });
      } else {
        this.loseHealth(player, 1, "【命运预视】黑色判定");
        const amount = drawCards(this.state, player, 2, (items) => this.shuffle(items));
        if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: true } });
      }
      return this.openNextSkillTrigger();
    }
    if (judgment.purpose !== "blood-body") return this.openNextSkillTrigger();
    if (red) {
      const amount = drawCards(this.state, player, 2, (items) => this.shuffle(items));
      this.addLog(`${player.nickname}因红色判定摸了 ${amount} 张手牌`, player.id, { zone: "hand", ownerId: player.id });
      if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
      return this.openNextSkillTrigger();
    }
    const opponent = opponentOf(this.state, player.id);
    if (opponent?.hand.length) this.discardRandom(opponent, player.id);
    if (player.hand.length) {
      this.state.prompt = createPrompt({
        kind: "body-skill", playerId: player.id, title: "红黑谜案大推理", message: "黑色判定：请弃置1张手牌，然后摸1张。",
        min: 1, max: 1, cardInstanceIds: player.hand.map((item) => item.instanceId), selectableCards: player.hand,
        context: { action: "blood-self-discard" },
      });
    } else {
      const amount = drawCards(this.state, player, 1, (items) => this.shuffle(items));
      if (amount) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
    }
  }

  private activateBodyExtra(player: AutoPlayerState, _payload: Record<string, unknown>) {
    if (!this.state) return;
    this.requireTurn(player, "play");
    if (this.state.prompt || this.state.stack.length) throw new Error("请先完成当前结算。");
    const definition = bodyById.get(bodyId(player));
    if (!definition?.extraForm || definition.extraForm.type !== "z-move") throw new Error("该本体没有可主动发动的Z招式。");
    if (!player.bodyState.flipped) throw new Error("Z招式尚未就绪。");
    if (player.bodyState.extraFormUsed) throw new Error("Z招式本局已使用。");
    const id = bodyId(player);
    if (id === BODY_IDS.defense) throw new Error("该Z招式会在致命伤害前自动触发。");
    player.bodyState.extraFormUsed = true;
    this.addLog(`${player.nickname}发动了Z招式【${definition.extraForm.skillName}】`, player.id, { zone: "body", ownerId: player.id });

    if (id === BODY_IDS.dispatch) {
      const roles = player.characterSlots.flatMap((slot) => slot && "instanceId" in slot ? [slot] : []);
      const min = player.characterSlots.includes(null) ? 0 : 1;
      this.state.prompt = createPrompt({
        kind: "body-skill", playerId: player.id, title: definition.extraForm.skillName,
        message: `选择要洗回角色牌堆的角色（${min ? "至少1张" : "可不选"}）。`,
        min, max: roles.length, cardInstanceIds: roles.map((card) => card.instanceId), selectableCards: roles,
        context: { action: "dispatch-z-select" },
      });
      return;
    }
    if (id === BODY_IDS.blood) {
      const max = Math.min(3, player.maxHealth - player.health);
      const cards = [...this.state.handDiscard];
      if (!max || !cards.length) {
        const recovered = heal(player, 1);
        this.addLog(`${player.nickname}回复了 ${recovered} 点体力`, player.id, { zone: "player", ownerId: player.id });
        return;
      }
      this.state.prompt = createPrompt({
        kind: "body-skill", playerId: player.id, title: definition.extraForm.skillName,
        message: `从弃牌区选择至多 ${max} 张不同名称的牌加入手牌，然后回复1点体力。`,
        min: 0, max, cardInstanceIds: cards.map((card) => card.instanceId), selectableCards: cards,
        options: [{ value: "none", label: "不获得牌，直接回复" }], context: { action: "blood-z-pick" },
      });
      return;
    }
    if (id === BODY_IDS.ambush) {
      player.bodyState.ambushWindow = { remaining: 2, expiresAtTurnNumber: this.state.turnNumber + 2 };
      this.addLog(`${player.nickname}的退场伏击角色在下个回合开始前可至多免费发动2次`, player.id, { zone: "retired", ownerId: player.id });
      return;
    }
    throw new Error("该Z招式尚未接入自动结算。");
  }

  private resolveDispatchZSelection(player: AutoPlayerState, prompt: NonNullable<AutoRoomState["prompt"]>, selectedIds: string[]) {
    if (!this.state) return;
    if (selectedIds.length < Number(prompt.min || 0) || selectedIds.length > Number(prompt.max || 0) || new Set(selectedIds).size !== selectedIds.length
      || selectedIds.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("换阵角色选择无效。");
    const returning: CardInstance[] = [];
    for (let index = 0; index < player.characterSlots.length; index += 1) {
      const slot = player.characterSlots[index];
      if (slot && "instanceId" in slot && selectedIds.includes(slot.instanceId)) {
        player.characterSlots[index] = null; slot.faceDown = undefined; returning.push(slot);
      }
    }
    player.characterDeck = this.shuffle([...player.characterDeck, ...returning]);
    const deployed: CardInstance[] = [];
    const desired = selectedIds.length + 1;
    for (let count = 0; count < desired; count += 1) {
      const result = deployTopCharacter(player);
      if (!result) break;
      deployed.push(result.card); this.recordCharacterDeployment(player.id, player.id, result.card.definitionId);
    }
    this.state.prompt = createPrompt({
      kind: "body-skill", playerId: player.id, title: "终局换阵", message: "可立即明置以此法上阵的1张角色，使其下一次【休整X】费用-1。",
      min: 0, max: 1, cardInstanceIds: deployed.map((card) => card.instanceId), selectableCards: deployed,
      options: [{ value: "none", label: "不立即明置" }], context: { action: "dispatch-z-reveal" },
    });
  }

  private resolveDispatchZReveal(player: AutoPlayerState, prompt: NonNullable<AutoRoomState["prompt"]>, selectedIds: string[]) {
    if (!this.state) return;
    if (selectedIds.length > 1 || (selectedIds[0] && !prompt.cardInstanceIds?.includes(selectedIds[0]))) throw new Error("至多选择1张换阵角色。");
    if (selectedIds[0]) {
      const role = player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === selectedIds[0]);
      if (!role || !("instanceId" in role)) throw new Error("换阵角色已不在场。");
      role.faceDown = false;
      this.emitEvent("character_revealed", { sourcePlayerId: player.id, targetPlayerId: player.id, characterDefinitionId: role.definitionId });
      this.addLog(`${player.nickname}因Z招式立即明置了【${characterById.get(role.definitionId)?.name || role.definitionId}】`, player.id, { zone: "characterSlot", ownerId: player.id });
      this.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: player.id, kind: "body-next-skill-cost-rest-one", count: 1, characterInstanceId: role.instanceId });
    }
    this.state.prompt = undefined;
  }

  private resolveBloodZSelection(player: AutoPlayerState, prompt: NonNullable<AutoRoomState["prompt"]>, selectedIds: string[]) {
    if (!this.state) return;
    if (selectedIds.length > Number(prompt.max || 0) || new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !prompt.cardInstanceIds?.includes(id))) throw new Error("Z招式选牌无效。");
    const names = new Set<string>();
    for (const id of selectedIds) {
      const index = this.state.handDiscard.findIndex((card) => card.instanceId === id);
      if (index < 0) throw new Error("弃牌区状态已变化。");
      const definitionId = this.state.handDiscard[index].definitionId;
      if (names.has(definitionId)) throw new Error("选择的牌名称必须不同。");
      names.add(definitionId);
      const [card] = this.state.handDiscard.splice(index, 1); card.ownerId = player.id; player.hand.push(card);
    }
    const recovered = heal(player, 1);
    this.state.prompt = undefined;
    this.addLog(`${player.nickname}从弃牌区获得 ${selectedIds.length} 张牌并回复 ${recovered} 点体力`, player.id, { zone: "handDiscard" });
  }

  private onPhaseEntered(phase: AutoRoomState["phase"], _previousPlayer: AutoPlayerState) {
    if (!this.state) return;
    const current = this.state.currentPlayerId ? playerById(this.state, this.state.currentPlayerId) : undefined;
    if (phase === "preparation" && current) {
      const returning = this.state.turnModifiers.filter((modifier) => modifier.kind === "aggro-return-character"
        && modifier.ownerId === current.id && Number(modifier.expiresAtTurnNumber || 0) <= this.state!.turnNumber);
      for (const modifier of returning) {
        const target = modifier.targetPlayerId ? playerById(this.state, modifier.targetPlayerId) : undefined;
        const banishedIndex = target?.banished.findIndex((card) => card.instanceId === modifier.targetCharacterInstanceId) ?? -1;
        const slotIndex = Number(modifier.targetSlotIndex);
        const marker = target?.characterSlots[slotIndex];
        if (target && banishedIndex >= 0 && marker && !("instanceId" in marker) && marker.id === modifier.markerId) {
          const [card] = target.banished.splice(banishedIndex, 1);
          card.faceDown = modifier.storedFaceDown;
          target.characterSlots[slotIndex] = card;
          this.addLog(`【${characterById.get(card.definitionId)?.name || card.definitionId}】从移出游戏区返回角色位`, current.id, { zone: "characterSlot", ownerId: target.id, slotIndex });
        }
        this.state.turnModifiers.splice(this.state.turnModifiers.findIndex((candidate) => candidate.id === modifier.id), 1);
      }
    }
    if (phase === "play" && current) {
      const bombs = this.state.turnModifiers.filter((modifier) => modifier.kind === "aggro-bomb"
        && modifier.ownerId === current.id && Number(modifier.expiresAtTurnNumber || 0) <= this.state!.turnNumber);
      for (const modifier of bombs) {
        const target = modifier.targetPlayerId ? playerById(this.state, modifier.targetPlayerId) : undefined;
        const slotIndex = Number(modifier.targetSlotIndex);
        const marker = target?.characterSlots[slotIndex];
        this.state.turnModifiers.splice(this.state.turnModifiers.findIndex((candidate) => candidate.id === modifier.id), 1);
        if (!target || !marker || "instanceId" in marker || marker.id !== modifier.markerId) continue;
        target.characterSlots[slotIndex] = null;
        this.addLog(`${current.nickname}的「炸弹」爆炸`, current.id, { zone: "characterSlot", ownerId: target.id, slotIndex });
        const applied = this.applyDamage(target, 1, current.id, undefined, {
          deferred: true,
          continuation: { kind: "bomb", sourcePlayerId: current.id, targetPlayerId: target.id },
        });
        if (applied === undefined || this.state.prompt?.kind === "dying") return;
        this.discardRandom(target, current.id);
      }
    }
    if (phase === "preparation" && current?.bodyState.ambushWindow && this.state.turnNumber >= current.bodyState.ambushWindow.expiresAtTurnNumber) {
      current.bodyState.ambushWindow = undefined;
      this.addLog(`${current.nickname}的【万劫暗夜】持续时间结束`, current.id, { zone: "body", ownerId: current.id });
    }
    for (const player of this.state.players) {
      bodySkillForId(bodyId(player))?.onPhaseEntered?.(this.bodySkillContext(player), phase, _previousPlayer);
    }
    if (phase !== "end" || !current) return;
    const storedCards = this.state.turnModifiers.filter((modifier) => modifier.kind === "blood-stored-card"
      && Number(modifier.expiresAtTurnNumber || 0) <= this.state!.turnNumber);
    for (const modifier of storedCards) {
      const target = modifier.targetPlayerId ? playerById(this.state, modifier.targetPlayerId) : undefined;
      const marker = target?.markers.find((entry) => entry.kind === "cards" && entry.cards.some((card) => card.instanceId === modifier.targetCardInstanceId));
      if (target && marker?.kind === "cards") {
        const cardIndex = marker.cards.findIndex((card) => card.instanceId === modifier.targetCardInstanceId);
        const [card] = marker.cards.splice(cardIndex, 1);
        card.ownerId = target.id;
        target.hand.push(card);
        if (!marker.cards.length) target.markers.splice(target.markers.indexOf(marker), 1);
        this.addLog(`${target.nickname}收回了本回合被封存的1张手牌`, target.id, { zone: "hand", ownerId: target.id });
      }
      this.state.turnModifiers.splice(this.state.turnModifiers.findIndex((candidate) => candidate.id === modifier.id), 1);
    }
    const recoil = this.state.turnModifiers.filter((modifier) => modifier.kind === "aggro-sheriff-recoil" && modifier.targetPlayerId === current.id);
    for (const modifier of recoil) {
      const owner = playerById(this.state, modifier.ownerId);
      if (owner && (this.state.usageCounters[`damage-dealt:${this.state.turnNumber}:${current.id}`] || 0) === 0) {
        this.loseHealth(owner, 1, "【执法追责】反噬");
      }
      this.state.turnModifiers.splice(this.state.turnModifiers.findIndex((candidate) => candidate.id === modifier.id), 1);
    }
    for (const player of this.state.players) {
      if (bodyId(player) === BODY_IDS.trans && player.bodyState.trackedCharacterInstanceIds.length) {
        for (const instanceId of [...player.bodyState.trackedCharacterInstanceIds]) {
          const role = player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === instanceId);
          if (role && "instanceId" in role) this.restCard(player, role, false, player.id);
        }
        player.bodyState.trackedCharacterInstanceIds = [];
      }
    }
  }

  private finishRetiredAmbushSkill(player: AutoPlayerState, instanceId: string) {
    if (!this.state) return;
    const index = player.retired.findIndex((card) => card.instanceId === instanceId);
    if (index < 0) return;
    const [card] = player.retired.splice(index, 1); card.faceDown = undefined;
    player.characterDeck = this.shuffle([...player.characterDeck, card]);
    if (player.bodyState.ambushWindow) {
      player.bodyState.ambushWindow.remaining -= 1;
      if (player.bodyState.ambushWindow.remaining <= 0) player.bodyState.ambushWindow = undefined;
    }
    this.addLog(`${player.nickname}将已免费发动的伏击角色洗回角色牌堆`, player.id, { zone: "retired", ownerId: player.id });
  }

  private loseHealth(player: AutoPlayerState, amount: number, reason: string) {
    if (!this.state) return 0;
    const lost = damage(this.state, player, amount);
    if (lost > 0) {
      const key = `health-reduction-events:${this.state.turnNumber}:${player.id}`;
      this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
      this.emitEvent("health_lost_after", { sourcePlayerId: player.id, targetPlayerId: player.id, amount: lost });
    }
    this.addLog(`${player.nickname}因${reason}失去 ${lost} 点体力，当前体力 ${player.health}`, player.id, { zone: "player", ownerId: player.id });
    return lost;
  }

  private findCharacterInstance(player: AutoPlayerState, instanceId: string) {
    return player.characterSlots.find((slot): slot is CardInstance => Boolean(slot && "instanceId" in slot && slot.instanceId === instanceId))
      || player.retired.find((card) => card.instanceId === instanceId)
      || player.characterDeck.find((card) => card.instanceId === instanceId)
      || player.banished.find((card) => card.instanceId === instanceId);
  }

  private characterEventUsageKey(eventId: string, playerId: string, definitionId: string) {
    return `skill:event:${eventId}:${playerId}:${definitionId}`;
  }

  private characterUsageKey(player: AutoPlayerState, definitionId: string, eventId: string, scope: "turn" | "game" | "event") {
    if (!this.state) return "";
    if (scope === "game") return `skill:game:${player.id}:${definitionId}`;
    if (scope === "event") return this.characterEventUsageKey(eventId, player.id, definitionId);
    return `skill:turn:${this.state.turnNumber}:${player.id}:${definitionId}`;
  }

  private copiedCharacterDefinitionId(player: AutoPlayerState, role: CardInstance) {
    return this.state?.turnModifiers.find((modifier) => modifier.kind === "aggro-copy-character-skill"
      && modifier.ownerId === player.id && modifier.characterInstanceId === role.instanceId)?.copiedDefinitionId;
  }

  private registeredCharacterSkill(player: AutoPlayerState, role: CardInstance) {
    const handlerId = this.copiedCharacterDefinitionId(player, role) || role.definitionId;
    const module = characterSkillForId(handlerId);
    const definition = characterById.get(handlerId);
    return module && definition ? { handlerId, module, definition } : undefined;
  }

  private isCharacterRevealLocked(player: AutoPlayerState, instanceId: string) {
    return Boolean(this.state?.turnModifiers.some((modifier) => modifier.kind === "aggro-reveal-lock"
      && modifier.targetPlayerId === player.id && modifier.targetCharacterInstanceId === instanceId));
  }

  private characterSkillContext(
    player: AutoPlayerState,
    role: CardInstance,
    event?: AutoBattleEvent,
    continuation?: SkillContinuation,
    resolutionItem?: CharacterSkillResolutionItem,
  ): CharacterSkillRuntimeContext {
    if (!this.state) throw new Error("房间状态不存在。");
    const state = this.state;
    const setContinuationPrompt: CharacterSkillRuntimeContext["setPrompt"] = (step, prompt, data = {}, decisionPlayerId = player.id) => {
      const handlerId = resolutionItem?.handlerId || continuation?.handlerId || role.definitionId;
      state.prompt = createPrompt({
        ...prompt,
        kind: "character-skill",
        playerId: decisionPlayerId,
        context: {
          continuation: {
            handlerId,
            sourceDefinitionId: role.definitionId,
            sourceInstanceId: role.instanceId,
            step,
            eventId: event?.id,
            data: {
              ...data,
              ...(resolutionItem ? { resumeResponse: Boolean(resolutionItem.resumeResponse) } : {}),
              ...(resolutionItem?.dyingPromptContext ? { dyingPromptContext: resolutionItem.dyingPromptContext } : {}),
            },
          } satisfies SkillContinuation,
        },
      });
    };
    return {
      state,
      player,
      role,
      event,
      continuation,
      opponent: () => opponentOf(state, player.id),
      setPrompt: setContinuationPrompt,
      clearPrompt: (promptId) => { if (state.prompt?.id === promptId) state.prompt = undefined; },
      draw: (count) => {
        const amount = drawCards(state, player, count, (items) => this.shuffle(items));
        if (amount) {
          this.addLog(`${player.nickname}摸了 ${amount} 张手牌`, player.id, { zone: "hand", ownerId: player.id });
          this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: state.phase !== "draw" } });
        }
        return amount;
      },
      drawOpponent: (count) => {
        const target = opponentOf(state, player.id);
        if (!target) return 0;
        const amount = drawCards(state, target, count, (items) => this.shuffle(items));
        if (amount) {
          this.addLog(`${target.nickname}摸了 ${amount} 张手牌`, player.id, { zone: "hand", ownerId: target.id });
          this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: target.id, amount, metadata: { outsideDrawPhase: state.phase !== "draw" } });
        }
        return amount;
      },
      discardOwnHand: (instanceIds) => this.discardSelectedHand(player, instanceIds, player.id),
      discardOpponentHand: (instanceIds) => {
        const target = opponentOf(state, player.id);
        return target ? this.discardSelectedHand(target, instanceIds, player.id) : [];
      },
      discardRandomOpponent: (count) => {
        const target = opponentOf(state, player.id);
        if (!target) return [];
        const discarded: CardInstance[] = [];
        while (discarded.length < count && target.hand.length) {
          const card = this.discardRandom(target, player.id);
          if (card) discarded.push(card);
        }
        return discarded;
      },
      gainRandomOpponentHand: () => {
        const target = opponentOf(state, player.id);
        if (!target?.hand.length) return undefined;
        const index = this.randomIndex(target.hand.length);
        const [card] = target.hand.splice(index, 1);
        card.ownerId = player.id;
        player.hand.push(card);
        this.emitEvent("hand_lost", { sourcePlayerId: player.id, targetPlayerId: target.id, amount: 1 });
        this.addLog(`${player.nickname}随机获得了${target.nickname}的1张手牌`, player.id, { zone: "hand", ownerId: target.id });
        return card;
      },
      canUseBasic: (definitionId) => {
        if (definitionId === HAND_IDS.aid) return player.health < player.maxHealth;
        return canUseInPlay({ ...state, prompt: undefined } as AutoRoomState, player, definitionId);
      },
      randomOpponentHand: () => {
        const target = opponentOf(state, player.id);
        return target?.hand.length ? target.hand[this.randomIndex(target.hand.length)] : undefined;
      },
      takeTopHandCards: (count) => this.takeTopHandCards(count),
      putHandDeckTop: (cards) => {
        for (const card of [...cards].reverse()) { card.ownerId = undefined; state.handDeck.push(card); }
      },
      putHandDeckBottom: (cards) => {
        for (const card of [...cards].reverse()) { card.ownerId = undefined; state.handDeck.unshift(card); }
      },
      gainFromHandDiscard: (instanceIds) => {
        const gained: CardInstance[] = [];
        for (const id of instanceIds) {
          const index = state.handDiscard.findIndex((card) => card.instanceId === id);
          if (index < 0) throw new Error("弃牌区中已找不到选中的牌。");
          const [card] = state.handDiscard.splice(index, 1);
          card.ownerId = player.id;
          player.hand.push(card);
          gained.push(card);
        }
        return gained;
      },
      shuffleFromHandDiscard: (instanceIds) => {
        const returned: CardInstance[] = [];
        for (const id of instanceIds) {
          const index = state.handDiscard.findIndex((card) => card.instanceId === id);
          if (index < 0) throw new Error("弃牌区中已找不到选中的牌。");
          const [card] = state.handDiscard.splice(index, 1);
          card.ownerId = undefined;
          returned.push(card);
        }
        state.handDeck = this.shuffle([...state.handDeck, ...returned]);
        return returned;
      },
      addModifier: (modifier) => { state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: player.id, ...modifier }); },
      counterCurrentHand: () => {
        const target = [...state.stack].reverse().find(isHandResolutionItem);
        if (!target || target.cancelled) return false;
        target.cancelled = true;
        target.cancelledByPlayerId = player.id;
        target.cancellationReason = "skill";
        return true;
      },
      damageOpponent: (amount, options) => {
        const target = opponentOf(state, player.id);
        if (!target) return 0;
        const applied = this.applyDamage(target, amount, player.id, undefined, {
          continuation: {
            kind: "character-skill",
            item: resolutionItem || {
              kind: "character-skill",
              id: crypto.randomUUID(),
              sourcePlayerId: player.id,
              sourceInstanceId: role.instanceId,
              definitionId: role.definitionId,
              handlerId: continuation?.handlerId || role.definitionId,
              eventId: continuation?.eventId,
              resumeResponse: continuation?.data?.resumeResponse === true,
            },
            after: options?.after,
          },
        });
        if (applied !== undefined && applied > 0 && options?.after === "return-self-if-target-health-at-most-3" && target.health <= 3) {
          this.shuffleRetiredCharacter(player, role.instanceId);
        }
        return applied;
      },
      loseHealth: (amount, reason = "角色技能") => this.loseHealth(player, amount, reason),
      loseOpponentHealth: (amount, reason = "角色技能") => {
        const target = opponentOf(state, player.id);
        return target ? this.loseHealth(target, amount, reason) : 0;
      },
      heal: (amount) => {
        const recovered = heal(player, amount);
        if (recovered) this.emitEvent("health_recovered", { sourcePlayerId: player.id, targetPlayerId: player.id, amount: recovered });
        return recovered;
      },
      startJudgment: (purpose = "generic") => this.startJudgment(player, purpose),
      currentJudgmentCard: () => this.pendingJudgmentCard(this.pendingJudgment(String(event?.metadata?.judgmentId || ""))),
      replaceCurrentJudgment: (instanceId) => {
        const judgment = this.pendingJudgment(String(event?.metadata?.judgmentId || ""));
        const previous = this.pendingJudgmentCard(judgment);
        const index = player.hand.findIndex((card) => card.instanceId === instanceId);
        if (!judgment || judgment.stage !== "revealed" || !previous || index < 0) throw new Error("当前判定已无法替换。");
        const [replacement] = player.hand.splice(index, 1);
        replacement.ownerId = undefined;
        state.handDiscard.push(replacement);
        const previousIndex = state.handDiscard.findIndex((card) => card.instanceId === previous.instanceId);
        state.handDiscard.splice(previousIndex, 1);
        previous.ownerId = player.id;
        player.hand.push(previous);
        judgment.cardInstanceId = replacement.instanceId;
        this.addLog(`${player.nickname}用【${handName(replacement.definitionId)}】替换了判定牌`, player.id, { zone: "handDiscard" });
        return previous;
      },
      drawJudgmentCandidate: () => {
        const [candidate] = this.takeTopHandCards(1);
        if (!candidate) return undefined;
        candidate.ownerId = undefined;
        state.handDiscard.push(candidate);
        this.addLog(`${player.nickname}进行了第二次判定：${this.judgmentColor(candidate)}【${handName(candidate.definitionId)}】`, player.id, { zone: "handDiscard" });
        return candidate;
      },
      chooseJudgmentCandidate: (instanceId) => {
        const judgment = this.pendingJudgment(String(event?.metadata?.judgmentId || ""));
        const card = state.handDiscard.find((candidate) => candidate.instanceId === instanceId);
        if (!judgment || judgment.stage !== "resolved" || !card) throw new Error("选择的判定牌已无效。");
        judgment.cardInstanceId = card.instanceId;
        const resolvedEvent = state.recentEvents.find((candidate) => candidate.id === event?.id);
        if (resolvedEvent) {
          resolvedEvent.cardDefinitionId = card.definitionId;
          resolvedEvent.metadata = { ...resolvedEvent.metadata, color: this.judgmentColor(card), cardInstanceId: card.instanceId };
        }
      },
      useVirtualStrike: (instanceId, options = {}) => this.useVirtualStrike(player, instanceId, options.damage),
      storeOpponentHandCard: (instanceId, label) => {
        const target = opponentOf(state, player.id);
        const index = target?.hand.findIndex((card) => card.instanceId === instanceId) ?? -1;
        if (!target || index < 0) throw new Error("要封存的手牌已不存在。");
        const [card] = target.hand.splice(index, 1);
        card.ownerId = target.id;
        const marker = target.markers.find((entry) => entry.kind === "cards" && entry.label === label);
        if (marker?.kind === "cards") marker.cards.push(card);
        else target.markers.push({ id: crypto.randomUUID(), kind: "cards", label, ownerId: target.id, cards: [card] });
        state.turnModifiers.push({
          id: crypto.randomUUID(), ownerId: player.id, kind: "blood-stored-card", count: 1,
          targetPlayerId: target.id, targetCardInstanceId: card.instanceId, expiresAtTurnNumber: state.turnNumber,
        });
        this.emitEvent("hand_lost", { sourcePlayerId: player.id, targetPlayerId: target.id, amount: 1 });
      },
      markerCount: (label) => {
        const marker = player.markers.find((entry) => entry.kind === "counter" && entry.label === label);
        return marker?.kind === "counter" ? marker.count : 0;
      },
      addCounterMarker: (label, amount = 1) => {
        const marker = player.markers.find((entry) => entry.kind === "counter" && entry.label === label);
        if (marker?.kind === "counter") marker.count = Math.min(99, marker.count + amount);
        else player.markers.push({ id: crypto.randomUUID(), kind: "counter", label, ownerId: player.id, count: Math.min(99, amount) });
        return marker?.kind === "counter" ? marker.count : Math.min(99, amount);
      },
      removeCounterMarker: (label, amount = 1) => {
        const index = player.markers.findIndex((entry) => entry.kind === "counter" && entry.label === label);
        const marker = player.markers[index];
        if (!marker || marker.kind !== "counter" || marker.count < amount) return 0;
        marker.count -= amount;
        const remaining = marker.count;
        if (marker.count <= 0) player.markers.splice(index, 1);
        return remaining + amount;
      },
      copyActionEffect: (definitionId, targetSlotIndex) => this.copyActionEffect(player, role, definitionId, targetSlotIndex, event),
      restOpponentCharacter: (slotIndex) => {
        const target = opponentOf(state, player.id);
        if (!target) throw new Error("对手不存在。");
        this.restCharacter(target, slotIndex, player.id);
      },
      revealOpponentCharacter: (slotIndex) => {
        const target = opponentOf(state, player.id);
        const card = target?.characterSlots[slotIndex];
        if (!target || !card || !("instanceId" in card) || !card.faceDown) throw new Error("目标已不是暗置角色。");
        card.faceDown = false;
        this.emitEvent("character_revealed", { sourcePlayerId: player.id, targetPlayerId: target.id, characterDefinitionId: card.definitionId });
        this.addLog(`${player.nickname}明置了对手角色【${characterById.get(card.definitionId)?.name || card.definitionId}】`, player.id, { zone: "characterSlot", ownerId: target.id, slotIndex });
        return card;
      },
      banishOpponentCharacterUntilNextPreparation: (slotIndex) => this.banishOpponentCharacterUntilNextPreparation(player, slotIndex),
      lockOpponentCharacterReveal: (slotIndex) => this.lockOpponentCharacterReveal(player, slotIndex),
      placeOpponentBomb: (slotIndex) => this.placeOpponentBomb(player, slotIndex),
      shuffleSelfFromRetired: () => this.shuffleRetiredCharacter(player, role.instanceId),
      shuffleOwnRetired: (instanceId) => this.shuffleRetiredCharacter(player, instanceId),
      banishOpponentRetired: (instanceId) => {
        const target = opponentOf(state, player.id);
        if (!target) return false;
        const index = target.retired.findIndex((card) => card.instanceId === instanceId);
        if (index < 0) return false;
        const [card] = target.retired.splice(index, 1);
        card.faceDown = false;
        target.banished.push(card);
        this.addLog(`${player.nickname}将对手退场区的【${characterById.get(card.definitionId)?.name || card.definitionId}】移出游戏`, player.id, { zone: "banished", ownerId: target.id });
        return true;
      },
      makeCurrentStrikeUndodgeable: (returnSelfOnDamage = false) => {
        const target = [...state.stack].reverse().find((item) => isHandResolutionItem(item)
          && effectiveDefinition(item) === HAND_IDS.strike && item.sourcePlayerId === player.id);
        if (!target || !isHandResolutionItem(target)) return false;
        target.cannotDodge = true;
        if (returnSelfOnDamage) target.returnCharacterOnDamageInstanceId = role.instanceId;
        if (state.prompt?.kind === "response") state.prompt.cardInstanceIds = legalResponseCards(state, playerById(state, state.prompt.playerId)!).map((card) => card.instanceId);
        return true;
      },
      boostNextStrikeDamage: (amount = 1) => {
        state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: player.id, kind: "aggro-next-strike-damage", count: Math.max(1, amount), sourceDefinitionId: role.definitionId });
      },
      useOpponentBasic: (instanceId, definitionId) => this.useOpponentBasic(player, instanceId, definitionId),
      copyOpponentCharacterSkill: (slotIndex) => this.copyOpponentCharacterSkill(player, role, slotIndex),
      dodgeCurrentStrike: () => {
        const target = [...state.stack].reverse().find((item) => isHandResolutionItem(item)
          && effectiveDefinition(item) === HAND_IDS.strike && item.targetPlayerId === player.id);
        if (!target || !isHandResolutionItem(target) || target.cancelled || target.cannotDodge) return false;
        target.cancelled = true;
        target.cancelledByPlayerId = player.id;
        target.cancellationReason = "dodge";
        return true;
      },
      isActionCard,
      handName,
      addLog: (message, actorId, target) => this.addLog(message, actorId, target),
      emitEvent: (type, details = {}) => this.emitEvent(type, details),
    };
  }

  private activateFullCharacterSkill(player: AutoPlayerState, role: CardInstance, payload: Record<string, unknown>) {
    if (!this.state) return;
    const registered = this.registeredCharacterSkill(player, role);
    if (!registered) throw new Error("该角色技能尚未实现。");
    const { module, definition, handlerId } = registered;
    const responseActivation = this.state.prompt?.kind === "response" && this.state.responsePlayerId === player.id && this.state.stack.length > 0;
    const dyingActivation = this.state.prompt?.kind === "dying" && this.state.prompt.playerId === player.id;
    const dyingPromptContext = dyingActivation ? { ...(this.state.prompt?.context || {}) } : undefined;
    const trigger = this.skillTriggerContext(module.trigger.event, module.trigger.relation, undefined, player, responseActivation);
    const promptedEventId = this.state.prompt?.kind === "character-trigger" ? cleanText(this.state.prompt.context?.eventId, 80) : "";
    const event = promptedEventId
      ? this.state.recentEvents.find((candidate) => candidate.id === promptedEventId)
      : trigger && "type" in trigger ? trigger as AutoBattleEvent : undefined;
    const eventId = event?.id || trigger?.id || `phase:${this.state.turnNumber}:${module.trigger.event}`;
    if (!trigger && !promptedEventId) throw new Error(`当前不满足技能时机：${definition.timing}`);
    const context = this.characterSkillContext(player, role, event);
    if (module.canActivate && !module.canActivate(context)) throw new Error("当前没有可结算的技能对象。");
    const limit = module.usageLimit;
    if (limit) {
      const key = this.characterUsageKey(player, `${role.instanceId}:${handlerId}`, eventId, limit.scope);
      if ((this.state.usageCounters[key] || 0) >= limit.count) throw new Error("该技能已达到当前次数上限。");
      this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
    }
    if (!["play_phase", "basic_card_needed"].includes(module.trigger.event)) {
      const key = this.characterEventUsageKey(eventId, player.id, `${role.instanceId}:${handlerId}`);
      if ((this.state.usageCounters[key] || 0) > 0) throw new Error("该角色已处理过本次触发。");
      this.state.usageCounters[key] = 1;
    }
    if (responseActivation) {
      const respondingTo = this.state.stack[this.state.stack.length - 1];
      if (isHandResolutionItem(respondingTo)) respondingTo.wasRespondedTo = true;
    }
    if (role.faceDown) role.faceDown = false;
    this.paySkillCost(player, role, definition.cost, payload, { id: eventId, metadata: event?.metadata });
    const skillCountKey = `skill-actions:${this.state.turnNumber}:${player.id}`;
    this.state.usageCounters[skillCountKey] = (this.state.usageCounters[skillCountKey] || 0) + 1;
    this.emitEvent("skill_used", {
      sourcePlayerId: player.id,
      characterDefinitionId: role.definitionId,
      amount: this.state.usageCounters[skillCountKey],
      metadata: { costType: definition.cost.type, costAmount: definition.cost.amount || 0, mainRole: definition.mainRole },
    });
    this.state.prompt = undefined;
    const item: CharacterSkillResolutionItem = {
      kind: "character-skill",
      id: crypto.randomUUID(),
      sourcePlayerId: player.id,
      sourceInstanceId: role.instanceId,
      definitionId: role.definitionId,
      handlerId,
      eventId: event?.id,
      resumeResponse: responseActivation,
      dyingPromptContext,
    };
    this.state.stack.push(item);
    const sourceName = characterById.get(role.definitionId)?.name || role.definitionId;
    const copied = handlerId !== role.definitionId ? `（复制自【${definition.name}】）` : "";
    this.addLog(`${player.nickname}发动了角色【${sourceName}】的技能【${definition.skillName}】${copied}`, player.id, { zone: "resolving" });
    this.resolveTop();
  }

  private resolveCharacterSkillItem(item: CharacterSkillResolutionItem): void {
    if (!this.state) return;
    const player = playerById(this.state, item.sourcePlayerId);
    const role = player ? this.findCharacterInstance(player, item.sourceInstanceId) : undefined;
    const module = characterSkillForId(item.handlerId);
    if (!player || !role || !module) return this.continueStack();
    const event = item.eventId ? this.state.recentEvents.find((candidate) => candidate.id === item.eventId) : undefined;
    module.activate(this.characterSkillContext(player, role, event, undefined, item));
    if (!this.state.prompt || this.state.prompt.kind === "dying") this.finishCharacterSkill(item, player);
  }

  private submitCharacterChoice(player: AutoPlayerState, prompt: NonNullable<AutoRoomState["prompt"]>, payload: Record<string, unknown>) {
    if (!this.state) return;
    const continuation = prompt.context?.continuation as SkillContinuation | undefined;
    if (!continuation) throw new Error("技能选择缺少可恢复状态。");
    const owner = this.state.players.find((candidate) => this.findCharacterInstance(candidate, continuation.sourceInstanceId));
    const role = owner && this.findCharacterInstance(owner, continuation.sourceInstanceId);
    const module = characterSkillForId(continuation.handlerId);
    if (!owner || !role || !module?.resolveChoice) throw new Error("技能结算器已不可用。");
    const event = continuation.eventId ? this.state.recentEvents.find((candidate) => candidate.id === continuation.eventId) : undefined;
    const continuationItem: CharacterSkillResolutionItem = {
      kind: "character-skill",
      id: crypto.randomUUID(),
      sourcePlayerId: owner.id,
      sourceInstanceId: role.instanceId,
      definitionId: continuation.sourceDefinitionId,
      handlerId: continuation.handlerId,
      eventId: continuation.eventId,
      resumeResponse: continuation.data?.resumeResponse === true,
      dyingPromptContext: continuation.data?.dyingPromptContext && typeof continuation.data.dyingPromptContext === "object"
        ? continuation.data.dyingPromptContext as Record<string, unknown>
        : undefined,
    };
    const completed = module.resolveChoice(this.characterSkillContext(owner, role, event, continuation, continuationItem), prompt, payload);
    if (!completed) throw new Error("技能选择与当前结算步骤不匹配。");
    if (this.state.prompt) return;
    if (continuation.data?.finishMode === "action") {
      this.emitEvent("card_resolved", {
        sourcePlayerId: cleanText(continuation.data.sourcePlayerId, 20),
        targetPlayerId: cleanText(continuation.data.targetPlayerId, 20),
        cardDefinitionId: cleanText(continuation.data.cardDefinitionId, 80),
        metadata: {
          actionCard: true,
          causedDamage: false,
          cardInstanceId: cleanText(continuation.data.cardInstanceId, 80),
        },
      });
      this.continueStack();
      return;
    }
    if (continuationItem.dyingPromptContext) {
      this.emitEvent("skill_resolved", { sourcePlayerId: owner.id, characterDefinitionId: role.definitionId });
      this.resumeDyingAfterCharacterSkill(owner, continuationItem.dyingPromptContext);
      return;
    }
    const postPredictionRecall = continuation.data?.postPredictionRecall;
    if (postPredictionRecall && typeof postPredictionRecall === "object") {
      const recall = postPredictionRecall as Record<string, unknown>;
      this.emitEvent("skill_resolved", { sourcePlayerId: owner.id, characterDefinitionId: role.definitionId });
      if (!this.openRecallForResolved(
        cleanText(recall.sourcePlayerId, 20),
        cleanText(recall.cardInstanceId, 80),
        cleanText(recall.effectiveDefinitionId, 80),
      )) {
        this.continueStack();
        this.openNextSkillTrigger();
      }
      return;
    }
    this.finishCharacterSkill(continuationItem, owner);
  }

  private finishCharacterSkill(item: CharacterSkillResolutionItem, player: AutoPlayerState) {
    if (!this.state) return;
    this.emitEvent("skill_resolved", { sourcePlayerId: player.id, characterDefinitionId: item.definitionId });
    if (this.state.prompt?.kind === "dying") return;
    if (item.dyingPromptContext) {
      this.resumeDyingAfterCharacterSkill(player, item.dyingPromptContext);
      return;
    }
    if (item.resumeResponse && this.state.stack.length) {
      const top = this.state.stack[this.state.stack.length - 1];
      if (isHandResolutionItem(top) && top.cancelled) this.continueStack();
      else this.restoreResponseAfterSkill(player.id);
      return;
    }
    this.continueStack();
    this.openNextSkillTrigger();
  }

  private resumeDyingAfterCharacterSkill(player: AutoPlayerState, context: Record<string, unknown>) {
    if (!this.state) return;
    this.state.prompt = undefined;
    if (player.health >= 1) {
      const continuation = context.damageContinuation as Record<string, unknown> | undefined;
      const applied = Number(context.appliedDamage || 0);
      if (continuation) this.resumeDamageContinuation(continuation, applied);
      else this.continueStack();
      return;
    }
    const aidCards = player.hand.filter((card) => card.definitionId === HAND_IDS.aid || card.definitionId === HAND_IDS.impersonate);
    this.state.prompt = createPrompt({
      kind: "dying",
      playerId: player.id,
      title: "濒死",
      message: "使用【急救】将体力回复至1点或以上，或放弃并结束对局。",
      cardInstanceIds: aidCards.map((card) => card.instanceId),
      options: [{ value: "pass", label: "放弃急救" }],
      context,
    });
  }

  private openDirectDisruptPrompt(source: AutoPlayerState, target: AutoPlayerState, item: HandResolutionItem, operation: "sabotage" | "steal") {
    if (!this.state) return false;
    const modifierIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === source.id && modifier.kind === "combo-direct-disrupt");
    if (modifierIndex < 0) return false;
    const [modifier] = this.state.turnModifiers.splice(modifierIndex, 1);
    const role = modifier.characterInstanceId ? this.findCharacterInstance(source, modifier.characterInstanceId) : undefined;
    if (!role) return false;
    this.state.prompt = createPrompt({
      kind: "character-skill",
      playerId: source.id,
      title: "定点处理",
      message: operation === "steal" ? "观看对手手牌，选择1张获得。" : "观看对手手牌，选择1张弃置。",
      min: 1,
      max: 1,
      cardInstanceIds: target.hand.map((card) => card.instanceId),
      selectableCards: target.hand,
      context: {
        continuation: {
          handlerId: role.definitionId,
          sourceDefinitionId: role.definitionId,
          sourceInstanceId: role.instanceId,
          step: "direct-disrupt",
          data: {
            operation,
            finishMode: "action",
            sourcePlayerId: source.id,
            targetPlayerId: target.id,
            cardDefinitionId: item.definitionId,
            cardInstanceId: item.card.instanceId,
          },
        } satisfies SkillContinuation,
      },
    });
    return true;
  }

  private copyActionEffect(player: AutoPlayerState, role: CardInstance, definitionId: string, targetSlotIndex?: number, event?: AutoBattleEvent) {
    if (!this.state || !isActionCard(definitionId)) return false;
    const target = opponentOf(this.state, player.id);
    if (!target) return false;
    if (definitionId === HAND_IDS.draw) return this.characterSkillContext(player, role, event).draw(2) >= 0;
    if (definitionId === HAND_IDS.sabotage) { if (!target.hand.length) return false; this.discardRandom(target, player.id); return true; }
    if (definitionId === HAND_IDS.steal) {
      if (!target.hand.length) return false;
      const [card] = target.hand.splice(this.randomIndex(target.hand.length), 1);
      card.ownerId = player.id;
      player.hand.push(card);
      this.emitEvent("hand_lost", { sourcePlayerId: player.id, targetPlayerId: target.id, amount: 1 });
      return true;
    }
    if (definitionId === HAND_IDS.inspire) {
      this.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: player.id, kind: "next-skill-cost-rest-one", count: 1 });
      return true;
    }
    if (definitionId === HAND_IDS.deploy) {
      const deployed = deployTopCharacter(player);
      if (!deployed) return false;
      this.recordCharacterDeployment(player.id, player.id, deployed.card.definitionId);
      return true;
    }
    if ([HAND_IDS.crisis, HAND_IDS.inspect].includes(definitionId as never)) {
      const legal = target.characterSlots.flatMap((slot, index) => slot && "instanceId" in slot
        && (definitionId === HAND_IDS.crisis ? !slot.faceDown : Boolean(slot.faceDown)) ? [index] : []);
      if (!legal.length) return false;
      if (targetSlotIndex === undefined) {
        this.characterSkillContext(player, role, event).setPrompt("copy-target", {
          title: "拟态复制目标",
          message: `为复制的【${handName(definitionId)}】重新选择合法目标。`,
          options: legal.map((index) => ({ value: String(index), label: `对手角色位 ${index + 1}` })),
        }, { copiedDefinitionId: definitionId });
        return true;
      }
      if (!legal.includes(targetSlotIndex)) return false;
      if (definitionId === HAND_IDS.crisis) {
        this.characterSkillContext(player, role, event).setPrompt("copy-crisis-choice", {
          title: "复制·危机破坏",
          message: "选择休整该角色，或令本体受到1点伤害。",
          options: [{ value: "rest", label: "休整角色" }, { value: "damage", label: "受到1点伤害" }],
        }, { copiedDefinitionId: definitionId, targetSlotIndex }, target.id);
      } else {
        const targetRole = target.characterSlots[targetSlotIndex];
        this.characterSkillContext(player, role, event).setPrompt("copy-inspect-choice", {
          title: "复制·看破",
          message: "你已查看该暗置角色，是否令其明置？",
          selectableCards: targetRole && "instanceId" in targetRole ? [targetRole] : undefined,
          options: [{ value: "reveal", label: "令其明置" }, { value: "keep", label: "保持暗置" }],
        }, { copiedDefinitionId: definitionId, targetSlotIndex });
      }
      return true;
    }
    return false;
  }

  private activateAssistedSkill(player: AutoPlayerState, payload: Record<string, unknown>) {
    if (!this.state) throw new Error("房间状态不存在。");
    const responseActivation = this.state.prompt?.kind === "response" && this.state.responsePlayerId === player.id && this.state.stack.length > 0;
    const triggerActivation = this.state.prompt?.kind === "character-trigger" && this.state.prompt.playerId === player.id;
    const dyingActivation = this.state.prompt?.kind === "dying" && this.state.prompt.playerId === player.id;
    if ((this.state.prompt || this.state.stack.length) && !responseActivation && !triggerActivation && !dyingActivation) throw new Error("请先完成当前结算。");
    const instanceId = cleanText(payload.instanceId, 80);
    const slotIndex = player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === instanceId);
    const retiredIndex = player.retired.findIndex((card) => card.instanceId === instanceId);
    const fromRetired = slotIndex < 0 && retiredIndex >= 0;
    const role = fromRetired ? player.retired[retiredIndex] : player.characterSlots[slotIndex];
    if (!role || !("instanceId" in role)) throw new Error("角色不在你的角色区或可发动的退场区。");
    if (triggerActivation) {
      const eligible = Array.isArray(this.state.prompt?.context?.eligibleInstanceIds)
        ? this.state.prompt.context.eligibleInstanceIds.map(String)
        : [];
      if (!eligible.includes(role.instanceId)) throw new Error("该角色不在当前可发动的触发队列中。");
    }
    if (!fromRetired && characterSkillForId(role.definitionId)) return this.activateFullCharacterSkill(player, role, payload);
    const definition = characterById.get(role.definitionId);
    if (!definition) throw new Error("角色数据不存在。");
    if (fromRetired) {
      const window = player.bodyState.ambushWindow;
      const usedKey = bodyUsageKey("game", this.state.turnNumber, player.id, `ambush-z:${role.instanceId}`);
      if (!window || window.remaining <= 0 || definition.mainRole !== "伏击" || (this.state.usageCounters[usedKey] || 0) > 0) throw new Error("该退场伏击角色当前不能免费发动。");
      this.state.usageCounters[usedKey] = 1;
    }
    const automation = automationById.get(role.definitionId);
    if (!automation) throw new Error("该角色缺少自动化元数据。");
    const triggerContext = this.skillTriggerContext(automation.trigger.event, automation.trigger.relation, automation.trigger.targetMainRole, player, responseActivation);
    if (!triggerContext) throw new Error(`当前不满足技能时机：${definition.timing}`);
    const usageKey = automation.usageLimit
      ? automation.usageLimit.scope === "game"
        ? `skill:game:${player.id}:${role.definitionId}`
        : automation.usageLimit.scope === "event"
          ? `skill:event:${triggerContext.id}:${player.id}:${role.definitionId}`
          : `skill:turn:${this.state.turnNumber}:${player.id}:${role.definitionId}`
      : undefined;
    if (usageKey && (this.state.usageCounters[usageKey] || 0) >= automation.usageLimit!.count) throw new Error("该技能已达到当前次数上限。");
    if (responseActivation) {
      const respondingTo = this.state.stack[this.state.stack.length - 1];
      if (isHandResolutionItem(respondingTo)) respondingTo.wasRespondedTo = true;
    }
    if (role.faceDown) role.faceDown = false;
    if (!fromRetired) this.paySkillCost(player, role, definition.cost, payload, triggerContext);
    const leftFieldForCost = !fromRetired && !player.characterSlots.some((slot) => slot && "instanceId" in slot && slot.instanceId === role.instanceId);
    if (usageKey) this.state.usageCounters[usageKey] = (this.state.usageCounters[usageKey] || 0) + 1;
    const skillCountKey = `skill-actions:${this.state.turnNumber}:${player.id}`;
    this.state.usageCounters[skillCountKey] = (this.state.usageCounters[skillCountKey] || 0) + 1;
    const usedThisTurn = this.state.usageCounters[skillCountKey];
    this.emitEvent("skill_used", {
      sourcePlayerId: player.id,
      characterDefinitionId: role.definitionId,
      amount: usedThisTurn,
      metadata: {
        costType: definition.cost.type,
        costAmount: definition.cost.amount || 0,
        mainRole: definition.mainRole,
        leftFieldForCost,
        virtualCard: /当作|视为|虚拟牌/.test(definition.effectText),
        freeFromRetired: fromRetired,
      },
    });
    this.state.prompt = createPrompt({
      kind: "assisted-skill",
      playerId: player.id,
      title: `${definition.skillName} · 辅助结算`,
      message: definition.effectText,
      options: automation.assistedActions.map((action) => ({ value: action, label: this.assistedActionLabel(action) })),
      context: { characterId: definition.id, characterInstanceId: role.instanceId, allowedActions: automation.assistedActions, resumeResponse: responseActivation, ...(fromRetired ? { retiredAmbushInstanceId: role.instanceId } : {}) },
    });
    this.addLog(`${player.nickname} ${fromRetired ? "从退场区免费" : ""}发动了角色【${definition.name}】的技能【${definition.skillName}】（辅助结算）`, player.id, fromRetired ? { zone: "retired", ownerId: player.id } : { zone: "characterSlot", ownerId: player.id, slotIndex });
  }

  private paySkillCost(
    player: AutoPlayerState,
    role: CardInstance,
    cost: { type?: string; amount?: number; text?: string },
    payload: Record<string, unknown>,
    triggerContext?: { id: string; metadata?: Record<string, string | number | boolean | undefined> },
  ) {
    if (!this.state) return;
    let type = cost.type || "无";
    let amount = Number(cost.amount || 0);
    const bodyModifierIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === player.id && modifier.kind === "body-next-skill-cost-rest-one" && modifier.characterInstanceId === role.instanceId);
    if (bodyModifierIndex >= 0) {
      this.state.turnModifiers.splice(bodyModifierIndex, 1);
      if (type === "休整") amount = Math.max(0, amount - 1);
    }
    const modifierIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === player.id && modifier.kind === "next-skill-cost-rest-one");
    if (modifierIndex >= 0 && type !== "退场") {
      type = "休整";
      amount = 1;
      this.state.turnModifiers.splice(modifierIndex, 1);
    }
    if (type === "复合" && cost.text?.includes("休整自身/退场自身")) {
      const mode = cleanText(payload.costMode, 20);
      if (mode === "retire") return this.retireCard(player, role, player.id);
      if (mode === "rest") return this.restCard(player, role, true, player.id, true);
      throw new Error("请选择休整自身或退场自身支付费用。");
    }
    if (type === "复合" && cost.text === "同等费用") {
      const matchedType = cleanText(triggerContext?.metadata?.costType, 20);
      const matchedAmount = Math.max(0, Number(triggerContext?.metadata?.costAmount || 0));
      if (matchedType === "退场") return this.retireCard(player, role, player.id);
      if (matchedType === "休整自身") return this.restCard(player, role, true, player.id, true);
      if (matchedType === "休整" && matchedAmount > 0) {
        type = "休整";
        amount = matchedAmount;
      } else throw new Error("当前事件中没有可对应的技能费用。");
    }
    if (type === "休整自身") return this.restCard(player, role, true, player.id, true);
    if (type === "退场") return this.retireCard(player, role, player.id);
    if (type !== "休整" || amount <= 0) return;
    const ids = Array.isArray(payload.costCharacterIds) ? payload.costCharacterIds.map((id) => cleanText(id, 80)) : [];
    if (ids.length !== amount || new Set(ids).size !== ids.length) throw new Error(`请选择 ${amount} 张角色支付休整费用。`);
    const cards = ids.map((id) => {
      const card = player.characterSlots.find((slot) => slot && "instanceId" in slot && slot.instanceId === id);
      if (!card || !("instanceId" in card)) throw new Error("休整费用中包含无效角色。");
      return card;
    });
    const includesSelf = cards.some((card) => card.instanceId === role.instanceId);
    for (const card of cards) this.restCard(player, card, false, player.id, true);
    if (includesSelf) this.drawForRestingSkillSource(player);
  }

  private applyAssistedAction(player: AutoPlayerState, payload: Record<string, unknown>) {
    if (!this.state || this.state.prompt?.kind !== "assisted-skill" || this.state.prompt.playerId !== player.id) throw new Error("当前没有由你处理的辅助技能。");
    const action = cleanText(payload.action, 30);
    const allowed = Array.isArray(this.state.prompt.context?.allowedActions) ? this.state.prompt.context.allowedActions : [];
    if (!allowed.includes(action)) throw new Error("该技能不允许这项辅助操作。");
    const target = playerById(this.state, cleanText(payload.playerId, 20)) || player;
    const amount = Math.min(3, Math.max(1, Math.trunc(Number(payload.amount) || 1)));
    if (action === "draw") {
      const drawn = drawCards(this.state, target, amount, (items) => this.shuffle(items));
      if (drawn > 0) this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: target.id, amount: drawn, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
    }
    else if (action === "damage") this.applyDamage(target, amount, player.id);
    else if (action === "prevent_damage") {
      const top = this.state.stack[this.state.stack.length - 1];
      if (isHandResolutionItem(top)) {
        top.cancelled = true;
        top.cancelledByPlayerId = player.id;
        top.cancellationReason = "skill";
        this.emitEvent("damage_prevented", { sourcePlayerId: player.id, targetPlayerId: target.id, amount });
      } else {
        const existing = this.state.turnModifiers.find((modifier) => modifier.ownerId === target.id && modifier.kind === "damage-shield");
        if (existing) {
          existing.count += amount;
          existing.expiresAtTurnNumber = Math.max(existing.expiresAtTurnNumber || 0, this.state.turnNumber + 2);
        } else {
          this.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: target.id, kind: "damage-shield", count: amount, expiresAtTurnNumber: this.state.turnNumber + 2 });
        }
      }
    }
    else if (action === "heal") {
      const recovered = heal(target, amount);
      if (recovered > 0) this.emitEvent("health_recovered", { sourcePlayerId: player.id, targetPlayerId: target.id, amount: recovered });
    }
    else if (action === "deploy") {
      const deployed = deployTopCharacter(target);
      if (deployed) this.recordCharacterDeployment(player.id, target.id, deployed.card.definitionId);
    }
    else if (action === "judge") {
      if (!this.state.handDeck.length && this.state.handDiscard.length) {
        this.state.handDeck = this.shuffle(this.state.handDiscard.splice(0).map((card) => ({ ...card, ownerId: undefined })));
      }
      const card = this.state.handDeck.pop();
      if (card) {
        card.ownerId = undefined;
        this.state.handDiscard.push(card);
        this.addLog(`${player.nickname} 的判定牌为【${handName(card.definitionId)}】`, player.id, { zone: "handDiscard" });
        this.emitEvent("judgment_revealed", { sourcePlayerId: player.id, targetPlayerId: player.id, cardDefinitionId: card.definitionId });
        this.emitEvent("judgment_resolved", { sourcePlayerId: player.id, targetPlayerId: player.id, cardDefinitionId: card.definitionId });
      }
    } else if (action === "marker") {
      const label = cleanText(payload.label, 20) || "技能标记";
      const existing = target.markers.find((marker) => marker.kind === "counter" && marker.label === label);
      if (existing && existing.kind === "counter") existing.count = Math.min(99, existing.count + amount);
      else target.markers.push({ id: crypto.randomUUID(), kind: "counter", label, ownerId: target.id, count: amount });
    } else if (action === "move") {
      const slotIndex = Number(payload.slotIndex);
      const operation = cleanText(payload.operation, 20);
      const card = target.characterSlots[slotIndex];
      if (!card || !("instanceId" in card)) throw new Error("请选择有效角色位。");
      if (operation === "retire") this.retireCard(target, card, player.id);
      else this.restCard(target, card, false, player.id);
    } else if (action === "extra_strike") {
      const existing = this.state.turnModifiers.find((modifier) => modifier.ownerId === target.id && modifier.kind === "extra-strike");
      if (existing) existing.count += 1;
      else this.state.turnModifiers.push({ id: crypto.randomUUID(), ownerId: target.id, kind: "extra-strike", count: 1 });
    } else if (action === "inspect") {
      const inspectionKind = cleanText(payload.inspectionKind, 30) || "characterRole";
      if (!["handDeckTop", "opponentHand", "characterRole"].includes(inspectionKind)) throw new Error("观看类型无效。");
      let inspected: CardInstance[] = [];
      if (inspectionKind === "handDeckTop") {
        const card = this.state.handDeck.at(-1);
        if (card) inspected = [card];
      } else if (inspectionKind === "opponentHand") {
        if (target.id === player.id) throw new Error("请选择对手的手牌。");
        inspected = [...target.hand];
      } else {
        const slotIndex = Number(payload.slotIndex);
        const role = target.characterSlots[slotIndex];
        if (role && "instanceId" in role) inspected = [role];
      }
      if (!inspected.length) throw new Error("当前没有可观看的牌。");
      this.state.prompt.selectableCards = inspected;
      this.emitEvent("inspection", { sourcePlayerId: player.id, targetPlayerId: target.id, metadata: { inspectionKind } });
    } else if (action === "manual") {
      // The public log preserves accountability for effects that still need table agreement.
    } else throw new Error("辅助结算操作无效。");
    this.addLog(`${player.nickname} 执行了辅助结算：${action} ${amount}`, player.id, { zone: "resolving" });
  }

  private startGame() {
    if (!this.state) return;
    this.state.handDeck = this.shuffle(handCards.flatMap((definition) => definition.cards.map((entry) => ({
      instanceId: crypto.randomUUID(),
      definitionId: definition.id,
      kind: "hand" as const,
      suit: "suit" in entry ? entry.suit : undefined,
      rank: "rank" in entry ? entry.rank : undefined,
      joker: "joker" in entry ? entry.joker as "small" | "big" : undefined,
    }))));
    this.state.handDiscard = [];
    this.state.resolving = [];
    this.state.stack = [];
    this.state.prompt = undefined;
    this.state.recentEvents = [];
    this.state.pendingBodyTriggers = [];
    this.state.pendingJudgments = [];
    this.state.usageCounters = {};
    this.state.turnModifiers = [];
    for (const player of this.state.players) {
      const loadout = this.loadout(player);
      if (!loadout) throw new Error("牌组数据不存在。");
      const body = bodyById.get(loadout.bodyId);
      player.maxHealth = body?.hp || 7;
      player.health = player.maxHealth;
      player.body = { instanceId: crypto.randomUUID(), definitionId: loadout.bodyId, kind: "body", ownerId: player.id };
      player.bodyState = this.newBodyState(loadout.bodyId);
      player.hand = [];
      player.characterDeck = this.shuffle(loadout.characterIds.map((definitionId) => ({ instanceId: crypto.randomUUID(), definitionId, kind: "character" as const, ownerId: player.id })));
      player.characterSlots = [null, null, null, null];
      player.markers = [];
      player.retired = [];
      player.banished = [];
      drawCards(this.state, player, 5, (items) => this.shuffle(items));
      deployTopCharacter(player);
      deployTopCharacter(player);
    }
    const first = this.state.players[this.randomIndex(2)];
    this.state.started = true;
    this.state.startedAt = Date.now();
    this.state.firstPlayerId = first.id;
    this.state.currentPlayerId = first.id;
    this.state.turnNumber = 1;
    this.state.phase = "preparation";
    this.addLog(`自动对战开始，${first.nickname} 为先手`, undefined, { zone: "turn" });
  }

  private discardSelectedHand(target: AutoPlayerState, instanceIds: string[], actorId?: string) {
    if (!this.state || new Set(instanceIds).size !== instanceIds.length) throw new Error("弃牌选择无效。");
    const cards = instanceIds.map((instanceId) => {
      const card = target.hand.find((candidate) => candidate.instanceId === instanceId);
      if (!card) throw new Error("弃牌选择中包含无效手牌。");
      return card;
    });
    for (const card of cards) {
      target.hand.splice(target.hand.findIndex((candidate) => candidate.instanceId === card.instanceId), 1);
      card.ownerId = undefined;
      this.state.handDiscard.push(card);
    }
    if (cards.length) {
      this.emitEvent("hand_discarded", {
        sourcePlayerId: actorId, targetPlayerId: target.id, amount: cards.length,
        metadata: { cardInstanceIds: cards.map((card) => card.instanceId).join(",") },
      });
      this.addLog(`${target.nickname}弃置了 ${cards.length} 张手牌`, actorId, { zone: "handDiscard" });
    }
    return cards;
  }

  private shuffleRetiredCharacter(player: AutoPlayerState, instanceId: string) {
    const index = player.retired.findIndex((card) => card.instanceId === instanceId);
    if (index < 0) return false;
    const [card] = player.retired.splice(index, 1);
    card.faceDown = undefined;
    player.characterDeck = this.shuffle([...player.characterDeck, card]);
    this.addLog(`${player.nickname}将【${characterById.get(card.definitionId)?.name || card.definitionId}】洗回角色牌堆`, player.id, { zone: "retired", ownerId: player.id });
    return true;
  }

  private banishOpponentCharacterUntilNextPreparation(source: AutoPlayerState, slotIndex: number) {
    if (!this.state) throw new Error("房间状态不存在。");
    const target = opponentOf(this.state, source.id);
    const card = target?.characterSlots[slotIndex];
    if (!target || !card || !("instanceId" in card)) throw new Error("目标角色已不在角色区。");
    const markerId = crypto.randomUUID();
    target.characterSlots[slotIndex] = { id: markerId, label: "暂离", ownerId: target.id };
    target.banished.push(card);
    this.state.turnModifiers.push({
      id: crypto.randomUUID(),
      ownerId: source.id,
      kind: "aggro-return-character",
      count: 1,
      targetPlayerId: target.id,
      targetCharacterInstanceId: card.instanceId,
      targetSlotIndex: slotIndex,
      markerId,
      storedFaceDown: card.faceDown,
      expiresAtTurnNumber: this.state.turnNumber + 2,
      sourceDefinitionId: AGGRO_CHARACTER_IDS.pelican,
    });
    this.emitEvent("character_banished", { sourcePlayerId: source.id, targetPlayerId: target.id, characterDefinitionId: card.definitionId });
    this.addLog(`${source.nickname}将对手角色【${characterById.get(card.definitionId)?.name || card.definitionId}】暂时移出游戏`, source.id, { zone: "banished", ownerId: target.id });
    return card;
  }

  private lockOpponentCharacterReveal(source: AutoPlayerState, slotIndex: number) {
    if (!this.state) return;
    const target = opponentOf(this.state, source.id);
    const card = target?.characterSlots[slotIndex];
    if (!target || !card || !("instanceId" in card) || !card.faceDown) throw new Error("只能封锁暗置角色。");
    this.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: source.id, kind: "aggro-reveal-lock", count: 1,
      targetPlayerId: target.id, targetCharacterInstanceId: card.instanceId,
      expiresAtTurnNumber: this.state.turnNumber + 1, sourceDefinitionId: AGGRO_CHARACTER_IDS.baiziNinja,
    });
    this.addLog(`${source.nickname}令对手角色位 ${slotIndex + 1} 本回合不能明置`, source.id, { zone: "characterSlot", ownerId: target.id, slotIndex });
  }

  private placeOpponentBomb(source: AutoPlayerState, slotIndex: number) {
    if (!this.state) return;
    const target = opponentOf(this.state, source.id);
    if (!target || target.characterSlots[slotIndex] !== null) throw new Error("只能在空角色位放置炸弹。");
    const markerId = crypto.randomUUID();
    target.characterSlots[slotIndex] = { id: markerId, label: "炸弹", ownerId: target.id };
    this.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: source.id, kind: "aggro-bomb", count: 1,
      targetPlayerId: target.id, targetSlotIndex: slotIndex, markerId,
      expiresAtTurnNumber: this.state.turnNumber + 2, sourceDefinitionId: AGGRO_CHARACTER_IDS.weixiaokeleBomber,
    });
    this.addLog(`${source.nickname}在对手角色位 ${slotIndex + 1} 放置了「炸弹」`, source.id, { zone: "characterSlot", ownerId: target.id, slotIndex });
  }

  private copyOpponentCharacterSkill(source: AutoPlayerState, morphling: CardInstance, slotIndex: number) {
    if (!this.state) return;
    const target = opponentOf(this.state, source.id);
    const card = target?.characterSlots[slotIndex];
    if (!target || !card || !("instanceId" in card) || card.faceDown !== false) throw new Error("只能复制对手已明置角色的技能。");
    if (!characterSkillForId(card.definitionId)) throw new Error("该角色技能尚未实现，不能复制。");
    this.state.turnModifiers = this.state.turnModifiers.filter((modifier) => modifier.kind !== "aggro-copy-character-skill" || modifier.characterInstanceId !== morphling.instanceId);
    this.state.turnModifiers.push({
      id: crypto.randomUUID(), ownerId: source.id, kind: "aggro-copy-character-skill", count: 1,
      characterInstanceId: morphling.instanceId, copiedDefinitionId: card.definitionId,
      expiresAtTurnNumber: this.state.turnNumber + 1, sourceDefinitionId: morphling.definitionId,
    });
    this.addLog(`${source.nickname}令【变形鸭-微笑尅乐】获得【${characterById.get(card.definitionId)?.name || card.definitionId}】的技能`, source.id, { zone: "characterSlot", ownerId: source.id });
  }

  private attachStrikeModifiers(source: AutoPlayerState, item: HandResolutionItem) {
    if (!this.state) return;
    const damageModifiers = this.state.turnModifiers.filter((modifier) => modifier.ownerId === source.id && modifier.kind === "aggro-next-strike-damage");
    if (damageModifiers.length) {
      const modifierIds = new Set(damageModifiers.map((modifier) => modifier.id));
      const amount = damageModifiers.reduce((total, modifier) => total + modifier.count, 0);
      this.state.turnModifiers = this.state.turnModifiers.filter((modifier) => !modifierIds.has(modifier.id));
      item.damageBonus = Number(item.damageBonus || 0) + amount;
      this.addLog(`${source.nickname}强化了本次【出刀】，伤害+${amount}`, source.id, { zone: "resolving" });
    }
    const undodgeableIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === source.id && modifier.kind === "mizai-next-strike-undodgeable");
    if (undodgeableIndex >= 0) {
      this.state.turnModifiers.splice(undodgeableIndex, 1);
      item.cannotDodge = true;
      this.addLog(`${source.nickname}的本次【出刀】不可被【闪避】响应`, source.id, { zone: "resolving" });
    }
    const dodgeDrawIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === source.id && modifier.kind === "blood-next-strike-dodge-draw");
    if (dodgeDrawIndex >= 0) {
      this.state.turnModifiers.splice(dodgeDrawIndex, 1);
      item.drawSourceOnDodge = true;
    }
    if (this.state.turnModifiers.some((modifier) => modifier.ownerId === source.id && modifier.kind === "blood-strike-heal-strong")) {
      item.healSourceOnDamageAtLeast = 2;
    }
    const conditionalIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === source.id && modifier.kind === "blood-next-strike-heal-conditional");
    if (conditionalIndex >= 0) {
      const [modifier] = this.state.turnModifiers.splice(conditionalIndex, 1);
      item.healSourceIfHealthNotHigher = modifier.count === 1;
      item.healSourceOnAnyDamage = modifier.count === 2;
    }
  }

  private resolveBloodStrikeAfterDamage(sourcePlayerId: string, applied: number, flags: Partial<HandResolutionItem>) {
    if (!this.state || applied <= 0) return;
    const source = playerById(this.state, sourcePlayerId);
    const target = source ? opponentOf(this.state, source.id) : undefined;
    if (!source) return;
    const shouldHeal = (Number(flags.healSourceOnDamageAtLeast || 0) > 0 && applied >= Number(flags.healSourceOnDamageAtLeast))
      || flags.healSourceOnAnyDamage === true
      || (flags.healSourceIfHealthNotHigher === true && Boolean(target && source.health <= target.health));
    if (!shouldHeal) return;
    const recovered = heal(source, 1);
    if (recovered) {
      this.emitEvent("health_recovered", { sourcePlayerId: source.id, targetPlayerId: source.id, amount: recovered });
      this.addLog(`${source.nickname}因角色技能回复1点体力`, source.id, { zone: "player", ownerId: source.id });
    }
  }

  private resolveMizaiPrediction(
    sourcePlayerId: string,
    cardInstanceId: string,
    causedDamage: boolean,
    effectiveDefinitionId: string,
    wasRespondedTo: boolean,
  ) {
    if (!this.state || !cardInstanceId) return false;
    const index = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "mizai-prediction"
      && modifier.ownerId === sourcePlayerId
      && modifier.targetCardInstanceId === cardInstanceId);
    if (index < 0) return false;
    const [modifier] = this.state.turnModifiers.splice(index, 1);
    const owner = playerById(this.state, sourcePlayerId);
    if (!owner) return false;
    if (modifier.predictedDamage !== causedDamage) {
      this.addLog(`${owner.nickname}的【预言成真】未命中`, owner.id, { zone: "player", ownerId: owner.id });
      return false;
    }
    const role = modifier.characterInstanceId ? this.findCharacterInstance(owner, modifier.characterInstanceId) : undefined;
    const opponent = opponentOf(this.state, owner.id);
    if (!role || !opponent) return false;
    this.addLog(`${owner.nickname}的【预言成真】命中`, owner.id, { zone: "player", ownerId: owner.id });
    this.state.prompt = createPrompt({
      kind: "character-skill",
      playerId: owner.id,
      title: "预言成真",
      message: "预言命中。观看对手所有手牌，然后摸1张牌。",
      selectableCards: opponent.hand,
      options: [{ value: "done", label: "完成观看并摸1张" }],
      context: {
        continuation: {
          handlerId: MIZAI_CHARACTER_IDS.seer,
          sourceDefinitionId: role.definitionId,
          sourceInstanceId: role.instanceId,
          step: "seer-inspect",
          data: {
            ...(wasRespondedTo ? {
              postPredictionRecall: {
                sourcePlayerId,
                cardInstanceId,
                effectiveDefinitionId,
              },
            } : {}),
          },
        } satisfies SkillContinuation,
      },
    });
    return true;
  }

  private openRecallForResolved(sourcePlayerId: string, targetCardId: string, effectiveDefinitionId: string) {
    if (!this.state) return false;
    const source = playerById(this.state, sourcePlayerId);
    const recall = source?.hand.find((card) => card.definitionId === HAND_IDS.recall);
    if (!source || !recall) return false;
    this.state.prompt = createPrompt({
      kind: "recall",
      playerId: source.id,
      title: "撤回",
      message: `是否使用【撤回】取回【${handName(effectiveDefinitionId)}】？`,
      cardInstanceIds: [recall.instanceId],
      options: [{ value: "pass", label: "不撤回" }],
      context: { targetCardId, targetDefinitionId: effectiveDefinitionId },
    });
    return true;
  }

  private useOpponentBasic(source: AutoPlayerState, instanceId: string, definitionId: string) {
    if (!this.state || ![HAND_IDS.strike, HAND_IDS.dodge, HAND_IDS.aid].includes(definitionId as never)) {
      throw new Error("审判声明的基础牌无效。");
    }
    const opponent = opponentOf(this.state, source.id);
    const cardIndex = opponent?.hand.findIndex((card) => card.instanceId === instanceId && card.definitionId === definitionId) ?? -1;
    if (!opponent || cardIndex < 0) throw new Error("对手已无法交出声明的基础牌。");

    if (definitionId === HAND_IDS.strike && !canUseInPlay({ ...this.state, prompt: undefined } as AutoRoomState, source, definitionId)) {
      throw new Error("当前不能再使用【出刀】。");
    }
    if (definitionId === HAND_IDS.dodge) {
      const target = [...this.state.stack].reverse().find((item) => isHandResolutionItem(item)
        && effectiveDefinition(item) === HAND_IDS.strike
        && item.targetPlayerId === source.id);
      if (!target || !isHandResolutionItem(target) || target.cancelled || target.cannotDodge) throw new Error("当前没有可用【闪避】响应的【出刀】。");
      const [card] = opponent.hand.splice(cardIndex, 1);
      this.emitEvent("hand_lost", { sourcePlayerId: source.id, targetPlayerId: opponent.id, amount: 1 });
      card.ownerId = undefined;
      this.state.handDiscard.push(card);
      target.cancelled = true;
      target.cancelledByPlayerId = source.id;
      target.cancellationReason = "dodge";
      target.wasRespondedTo = true;
      this.emitEvent("card_responded", {
        sourcePlayerId: source.id,
        targetPlayerId: target.sourcePlayerId,
        cardDefinitionId: HAND_IDS.dodge,
        metadata: { targetCardDefinitionId: HAND_IDS.strike },
      });
      this.addLog(`${opponent.nickname}交出【闪避】，视为由${source.nickname}打出`, source.id, { zone: "handDiscard" });
      return;
    }

    const [card] = opponent.hand.splice(cardIndex, 1);
    this.emitEvent("hand_lost", { sourcePlayerId: source.id, targetPlayerId: opponent.id, amount: 1 });
    if (definitionId === HAND_IDS.aid) {
      card.ownerId = undefined;
      this.state.handDiscard.push(card);
      const recovered = heal(source, 1);
      if (recovered) this.emitEvent("health_recovered", { sourcePlayerId: source.id, targetPlayerId: source.id, amount: recovered });
      this.addLog(`${opponent.nickname}交出【急救】，视为由${source.nickname}使用并回复 ${recovered} 点体力`, source.id, { zone: "handDiscard" });
      return;
    }

    card.ownerId = source.id;
    this.state.resolving.push(card);
    const target = opponentOf(this.state, source.id);
    const item: HandResolutionItem = {
      kind: "hand",
      id: crypto.randomUUID(),
      sourcePlayerId: source.id,
      card,
      definitionId: HAND_IDS.strike,
      targetPlayerId: target?.id,
    };
    this.attachStrikeModifiers(source, item);
    this.state.stack.push(item);
    const key = `turn:${this.state.turnNumber}:${source.id}:strike`;
    this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
    this.emitEvent("card_used", {
      sourcePlayerId: source.id,
      targetPlayerId: target?.id,
      cardDefinitionId: HAND_IDS.strike,
      metadata: { actionCard: false },
    });
    this.addLog(`${opponent.nickname}交出【出刀】，视为由${source.nickname}使用`, source.id, { zone: "resolving" });
  }

  private useVirtualStrike(source: AutoPlayerState, instanceId: string, damageAmount?: number) {
    if (!this.state) return;
    const index = source.hand.findIndex((card) => card.instanceId === instanceId);
    const target = opponentOf(this.state, source.id);
    if (index < 0 || !target) throw new Error("用于视为【出刀】的手牌已无效。");
    const [card] = source.hand.splice(index, 1);
    this.state.resolving.push(card);
    const item: HandResolutionItem = {
      kind: "hand", id: crypto.randomUUID(), sourcePlayerId: source.id, card,
      definitionId: HAND_IDS.strike, targetPlayerId: target.id,
      ...(damageAmount && damageAmount > 1 ? { damageBonus: damageAmount - 1 } : {}),
    };
    this.attachStrikeModifiers(source, item);
    this.state.stack.push(item);
    this.emitEvent("card_used", {
      sourcePlayerId: source.id, targetPlayerId: target.id, cardDefinitionId: HAND_IDS.strike,
      metadata: { actionCard: false, virtual: true, cardInstanceId: card.instanceId },
    });
    this.addLog(`${source.nickname}视为使用了1张【出刀】`, source.id, { zone: "resolving" });
    beginResponseWindow(this.state, item);
  }

  private applyDamage(
    target: AutoPlayerState,
    amount: number,
    sourceId?: string,
    cardDefinitionId?: string,
    options: { skipReplacement?: boolean; deferred?: boolean; continuation?: Record<string, unknown> } = {},
  ): number | undefined {
    if (!this.state) return 0;
    const source = sourceId ? playerById(this.state, sourceId) : undefined;
    if (!options.skipReplacement && source && source.id !== target.id) {
      const hitmen = source.characterSlots.flatMap((slot) => slot && "instanceId" in slot
        && (slot.definitionId === AGGRO_CHARACTER_IDS.weixiaokeleHitman
          || this.copiedCharacterDefinitionId(source, slot) === AGGRO_CHARACTER_IDS.weixiaokeleHitman) ? [slot] : []);
      const targets = target.characterSlots.flatMap((slot, slotIndex) => slot && "instanceId" in slot ? [{ slot, slotIndex }] : []);
      if (hitmen.length && targets.length) {
        this.state.prompt = createPrompt({
          kind: "damage-before",
          playerId: source.id,
          title: "伤害替换",
          message: "是否发动【专业处理】，将此次伤害改为休整对手1张角色？",
          options: [
            ...hitmen.flatMap((hitman) => targets.map(({ slot, slotIndex }) => ({
              value: `replace:${hitman.instanceId}:${slotIndex}`,
              label: slot.faceDown
                ? `发动专业杀手，休整对手角色位 ${slotIndex + 1}`
                : `发动专业杀手，休整【${characterById.get(slot.definitionId)?.name || `角色位 ${slotIndex + 1}`}】`,
            }))),
            { value: "pass", label: "不发动，正常造成伤害" },
          ],
          context: {
            pendingDamage: {
              targetPlayerId: target.id,
              sourcePlayerId: source.id,
              amount,
              cardDefinitionId,
              continuation: options.continuation,
            },
          },
        });
        return undefined;
      }
    }
    let finalAmount = amount;
    const shieldIndex = this.state.turnModifiers.findIndex((modifier) => modifier.ownerId === target.id && modifier.kind === "damage-shield" && modifier.count > 0);
    if (shieldIndex >= 0 && finalAmount > 0) {
      const shield = this.state.turnModifiers[shieldIndex];
      finalAmount = Math.max(0, finalAmount - 1);
      shield.count -= 1;
      if (shield.count <= 0) this.state.turnModifiers.splice(shieldIndex, 1);
      this.emitEvent("damage_prevented", { sourcePlayerId: target.id, targetPlayerId: target.id, amount: 1 });
      this.addLog(`${target.nickname} 的防护令伤害-1`, target.id, { zone: "player", ownerId: target.id });
    }
    if (finalAmount > 0 && bodyId(target) === BODY_IDS.defense && target.bodyState.flipped && !target.bodyState.extraFormUsed && target.health - finalAmount <= 0) {
      target.bodyState.extraFormUsed = true;
      this.emitEvent("damage_prevented", { sourcePlayerId: target.id, targetPlayerId: target.id, amount: finalAmount, metadata: { bodyZMove: true } });
      const recovered = heal(target, 2);
      this.addLog(`${target.nickname}发动【绝境神铠·不灭灵魂究极再临】，防止致命伤害并回复 ${recovered} 点体力`, target.id, { zone: "body", ownerId: target.id });
      if (recovered > 0) this.emitEvent("health_recovered", { sourcePlayerId: target.id, targetPlayerId: target.id, amount: recovered });
      return 0;
    }
    const applied = damage(this.state, target, finalAmount, sourceId);
    if (sourceId && applied > 0) {
      const key = `damage-dealt:${this.state.turnNumber}:${sourceId}`;
      this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + applied;
      const eventKey = `damage-events-dealt:${this.state.turnNumber}:${sourceId}`;
      this.state.usageCounters[eventKey] = (this.state.usageCounters[eventKey] || 0) + 1;
    }
    if (applied > 0) {
      const healthKey = `health-reduction-events:${this.state.turnNumber}:${target.id}`;
      this.state.usageCounters[healthKey] = (this.state.usageCounters[healthKey] || 0) + 1;
    }
    this.addLog(`${target.nickname} 受到 ${applied} 点伤害，当前体力 ${target.health}`, sourceId, { zone: "player", ownerId: target.id });
    this.emitEvent("damage_after", { sourcePlayerId: sourceId, targetPlayerId: target.id, cardDefinitionId, amount: applied });
    if (this.state.prompt?.kind === "dying" && options.deferred && options.continuation) {
      this.state.prompt.context = { ...this.state.prompt.context, damageContinuation: options.continuation, appliedDamage: applied };
    }
    return applied;
  }

  private discardRandom(player: AutoPlayerState, actorId?: string) {
    if (!this.state || !player.hand.length) return undefined;
    const [card] = player.hand.splice(this.randomIndex(player.hand.length), 1);
    card.ownerId = undefined;
    this.state.handDiscard.push(card);
    this.emitEvent("hand_discarded", {
      sourcePlayerId: actorId, targetPlayerId: player.id, amount: 1,
      metadata: { cardInstanceIds: card.instanceId },
    });
    this.addLog(`${player.nickname} 随机弃置了1张手牌`, actorId, { zone: "handDiscard" });
    return card;
  }

  private restCharacter(player: AutoPlayerState, slotIndex: number, sourcePlayerId?: string) {
    const card = player.characterSlots[slotIndex];
    if (!card || !("instanceId" in card)) throw new Error("目标角色已不在角色区。");
    this.restCard(player, card, false, sourcePlayerId);
  }

  private restCard(player: AutoPlayerState, card: CardInstance, drawForSelf = true, sourcePlayerId = player.id, skillCost = false) {
    if (!this.state) return;
    const index = player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === card.instanceId);
    if (index < 0) throw new Error("要休整的角色不在角色区。");
    player.characterSlots[index] = null;
    this.state.turnModifiers = this.state.turnModifiers.filter((modifier) => modifier.characterInstanceId !== card.instanceId);
    card.faceDown = undefined;
    player.characterDeck.unshift(card);
    this.emitEvent("character_rested", { sourcePlayerId, targetPlayerId: player.id, characterDefinitionId: card.definitionId, metadata: { skillCost } });
    if (drawForSelf) this.drawForRestingSkillSource(player);
  }

  private drawForRestingSkillSource(player: AutoPlayerState) {
    if (!this.state) return 0;
    const amount = drawCards(this.state, player, 1, (items) => this.shuffle(items));
    if (amount > 0) {
      this.addLog(`${player.nickname}因休整发动技能的角色摸1张牌`, player.id, { zone: "hand", ownerId: player.id });
      this.emitEvent("cards_drawn", { sourcePlayerId: player.id, targetPlayerId: player.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
    }
    return amount;
  }

  private retireCard(player: AutoPlayerState, card: CardInstance, sourcePlayerId = player.id) {
    if (!this.state) return;
    const index = player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === card.instanceId);
    if (index < 0) throw new Error("要退场的角色不在角色区。");
    player.characterSlots[index] = null;
    this.state.turnModifiers = this.state.turnModifiers.filter((modifier) => modifier.characterInstanceId !== card.instanceId);
    card.faceDown = false;
    player.retired.push(card);
    this.emitEvent("character_retired", { sourcePlayerId, targetPlayerId: player.id, characterDefinitionId: card.definitionId });
  }

  private newPlayer(id: string, token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig): AutoPlayerState {
    return {
      id, token, nickname, deckId,
      ...(deckId === CUSTOM_DECK_ID && customDeck ? { customDeck } : {}),
      ready: false,
      health: 7,
      maxHealth: 7,
      bodyState: this.newBodyState(),
      hand: [], characterDeck: [], characterSlots: [null, null, null, null], markers: [], retired: [], banished: [],
    };
  }

  private loadout(player: AutoPlayerState): CustomDeckConfig | undefined {
    if (player.deckId === CUSTOM_DECK_ID) return validCustomDeck(player.customDeck) ? player.customDeck : undefined;
    const deck = deckById.get(player.deckId || "");
    return deck ? { bodyId: deck.bodyId, characterIds: deck.characterIds } : undefined;
  }

  private requireStarted() {
    if (!this.state?.started) throw new Error("牌局尚未开始。");
  }

  private requireTurn(player: AutoPlayerState, phase: AutoRoomState["phase"]) {
    this.requireStarted();
    if (this.state?.currentPlayerId !== player.id || this.state.phase !== phase) throw new Error(`当前不是你的${this.phaseLabel(phase)}。`);
  }

  private phaseLabel(phase: AutoRoomState["phase"]) {
    return ({ preparation: "准备阶段", draw: "摸牌阶段", play: "出牌阶段", deployment: "布阵阶段", discard: "弃牌阶段", end: "结束阶段" })[phase];
  }

  private skillTriggerContext(event: string, relation: string, targetMainRole: string | undefined, player: AutoPlayerState, responseActivation: boolean) {
    if (!this.state) return undefined;
    if (event === "basic_card_needed" && this.state.prompt?.kind === "dying" && this.state.prompt.playerId === player.id) {
      return {
        id: this.state.prompt.id,
        type: "basic_card_needed",
        turnNumber: this.state.turnNumber,
        sourcePlayerId: player.id,
        targetPlayerId: player.id,
        metadata: { neededDefinitionId: HAND_IDS.aid },
      } satisfies AutoBattleEvent;
    }
    if (event === "basic_card_needed" && this.state.currentPlayerId === player.id && this.state.phase === "play" && !this.state.prompt && !this.state.stack.length) {
      return { id: `phase:${this.state.turnNumber}:basic-card`, type: "basic_card_needed", turnNumber: this.state.turnNumber, sourcePlayerId: player.id } satisfies AutoBattleEvent;
    }
    if (event === "play_phase" && this.state.currentPlayerId === player.id && this.state.phase === "play" && !responseActivation) return { id: `phase:${this.state.turnNumber}:play` };
    if (event === "preparation" && this.state.currentPlayerId === player.id && this.state.phase === "preparation" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:preparation` };
    if (event === "opponent_preparation" && this.state.currentPlayerId !== player.id && this.state.phase === "preparation" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:opponent-preparation` };
    if (event === "deployment" && this.state.currentPlayerId === player.id && this.state.phase === "deployment" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:deployment` };
    if (responseActivation) {
      const top = this.state.stack[this.state.stack.length - 1];
      if (!isHandResolutionItem(top)) return undefined;
      const effective = effectiveDefinition(top);
      const promptId = top.id;
      if (event === "prediction_targeted" && top.sourcePlayerId === player.id
        && [HAND_IDS.strike, HAND_IDS.crisis].includes(effective as never)) {
        return {
          id: promptId,
          type: "prediction_targeted",
          turnNumber: this.state.turnNumber,
          sourcePlayerId: player.id,
          targetPlayerId: top.targetPlayerId,
          cardDefinitionId: effective,
          metadata: { cardInstanceId: top.card.instanceId },
        } satisfies AutoBattleEvent;
      }
      if (effective === HAND_IDS.strike) {
        if (event === "basic_card_needed" && top.targetPlayerId === player.id) return {
          id: promptId,
          type: "basic_card_needed",
          turnNumber: this.state.turnNumber,
          sourcePlayerId: player.id,
          targetPlayerId: player.id,
          metadata: { neededDefinitionId: HAND_IDS.dodge },
        } satisfies AutoBattleEvent;
        if (["strike_targeted", "damage_before", "body_targeted_by_hand"].includes(event) && top.targetPlayerId === player.id) return { id: promptId };
        if (event === "strike_used" && this.relationMatches(relation, top.sourcePlayerId, top.targetPlayerId, player.id)) {
          return {
            id: promptId,
            type: "card_used",
            turnNumber: this.state.turnNumber,
            sourcePlayerId: top.sourcePlayerId,
            targetPlayerId: top.targetPlayerId,
            cardDefinitionId: HAND_IDS.strike,
            metadata: { cardInstanceId: top.card.instanceId },
          } satisfies AutoBattleEvent;
        }
        if (event === "damage_before_source" && top.sourcePlayerId === player.id) return { id: promptId };
      }
      if (isActionCard(top?.definitionId || "")) {
        if (event === "action_used" && this.relationMatches(relation, top?.sourcePlayerId, top?.targetPlayerId, player.id)) return { id: promptId };
        if (event === "hand_lost_before" && top?.targetPlayerId === player.id && [HAND_IDS.sabotage, HAND_IDS.steal].includes(effective as never)) return { id: promptId };
        if (event === "body_targeted_by_hand" && top?.targetPlayerId === player.id) return { id: promptId };
      }
    }
    return [...this.state.recentEvents].reverse().find((candidate) => this.eventMatches(event, candidate)
      && this.relationMatches(relation, candidate.sourcePlayerId, candidate.targetPlayerId, player.id)
      && (!targetMainRole || characterById.get(candidate.characterDefinitionId || "")?.mainRole === targetMainRole));
  }

  private eventMatches(trigger: string, event: AutoBattleEvent) {
    if (trigger === "action_used") return event.type === "card_used" && isActionCard(event.cardDefinitionId || "");
    if (trigger === "action_resolved") return event.type === "card_resolved" && isActionCard(event.cardDefinitionId || "");
    if (trigger === "strike_used") return event.type === "card_used" && event.cardDefinitionId === HAND_IDS.strike;
    if (trigger === "strike_dodged") return event.type === "strike_dodged";
    if (trigger === "strike_damage_after") return event.type === "damage_after" && event.cardDefinitionId === HAND_IDS.strike;
    if (trigger === "damage_after") return event.type === "damage_after";
    if (trigger === "health_lost_after") return event.type === "health_lost_after" || event.type === "damage_after";
    if (trigger === "health_recovered") return event.type === "health_recovered";
    if (trigger === "card_responded") return event.type === "card_responded";
    if (trigger === "character_deployed" || trigger === "opponent_deployment") return event.type === "character_deployed" && (trigger !== "opponent_deployment" || (event.amount || 0) >= 2);
    if (trigger === "character_revealed") return event.type === "character_revealed";
    if (trigger === "character_retired") return event.type === "character_retired";
    if (trigger === "hand_discarded") return event.type === "hand_discarded";
    if (trigger === "health_recovered") return event.type === "health_recovered";
    if (trigger === "inspection") return event.type === "inspection";
    if (trigger === "judgment_revealed" || trigger === "judgment_resolved") return event.type === trigger;
    if (trigger === "opponent_extra_draw") return event.type === "cards_drawn" && event.metadata?.outsideDrawPhase === true;
    if (trigger === "second_skill_used") return event.type === "skill_used" && (event.amount || 0) >= 2;
    if (trigger === "high_cost_skill_used") return event.type === "skill_used" && event.metadata?.costType === "休整" && Number(event.metadata?.costAmount || 0) >= 2;
    if (trigger === "skill_cost_rest_after") return event.type === "character_rested" && event.metadata?.skillCost === true;
    if (trigger === "body_targeted_by_hand") return event.type === "card_used" && Boolean(event.targetPlayerId);
    return event.type === trigger;
  }

  private relationMatches(relation: string, sourcePlayerId: string | undefined, targetPlayerId: string | undefined, playerId: string) {
    if (relation === "source_self") return sourcePlayerId === playerId;
    if (relation === "source_opponent") return Boolean(sourcePlayerId && sourcePlayerId !== playerId);
    if (relation === "target_self") return targetPlayerId === playerId;
    if (relation === "target_opponent") return Boolean(targetPlayerId && targetPlayerId !== playerId);
    return true;
  }

  private emitEvent(type: string, details: Omit<AutoBattleEvent, "id" | "type" | "turnNumber"> = {}) {
    if (!this.state) return;
    const event = { id: crypto.randomUUID(), type, turnNumber: this.state.turnNumber, ...details } satisfies AutoBattleEvent;
    this.state.recentEvents.push(event);
    this.state.recentEvents = this.state.recentEvents.slice(-12);
    this.handleCharacterModifiers(event);
    this.handleBodyEvent(event);
  }

  private handleCharacterModifiers(event: AutoBattleEvent) {
    if (!this.state) return;
    if (event.type === "card_resolved" && isActionCard(event.cardDefinitionId || "")) {
      const index = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "combo-next-action-draw" && modifier.ownerId === event.sourcePlayerId);
      if (index >= 0) {
        const [modifier] = this.state.turnModifiers.splice(index, 1);
        const owner = playerById(this.state, modifier.ownerId);
        if (owner) {
          const amount = drawCards(this.state, owner, 1, (items) => this.shuffle(items));
          if (amount) {
            this.addLog(`${owner.nickname}因政治家的效果摸1张牌`, owner.id, { zone: "hand", ownerId: owner.id });
            this.emitEvent("cards_drawn", { sourcePlayerId: owner.id, targetPlayerId: owner.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
          }
        }
      }
      const counterIndex = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "combo-counter-action-draw"
        && modifier.targetCardInstanceId === event.metadata?.cardInstanceId);
      if (counterIndex >= 0) {
        const [modifier] = this.state.turnModifiers.splice(counterIndex, 1);
        const owner = playerById(this.state, modifier.ownerId);
        if (owner) {
          const amount = drawCards(this.state, owner, 1, (items) => this.shuffle(items));
          if (amount) {
            this.addLog(`${owner.nickname}因鹈鹕的效果摸1张牌`, owner.id, { zone: "hand", ownerId: owner.id });
            this.emitEvent("cards_drawn", { sourcePlayerId: owner.id, targetPlayerId: owner.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
          }
        }
      }
    }
    if (event.type === "skill_resolved" && event.sourcePlayerId) {
      const index = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "combo-next-other-skill-damage"
        && modifier.ownerId === event.sourcePlayerId && modifier.sourceDefinitionId !== event.characterDefinitionId);
      if (index >= 0) {
        const [modifier] = this.state.turnModifiers.splice(index, 1);
        const owner = playerById(this.state, modifier.ownerId);
        const target = owner ? opponentOf(this.state, owner.id) : undefined;
        if (owner && target) this.applyDamage(target, 1, owner.id);
      }
    }
    if (event.type === "card_used" && event.sourcePlayerId) {
      const handType = isActionCard(event.cardDefinitionId || "") ? "action" : "basic";
      const index = this.state.turnModifiers.findIndex((modifier) => modifier.kind === "combo-declare-hand-type"
        && modifier.targetPlayerId === event.sourcePlayerId && modifier.declaredHandType === handType);
      if (index >= 0) {
        const [modifier] = this.state.turnModifiers.splice(index, 1);
        const owner = playerById(this.state, modifier.ownerId);
        if (owner) {
          const amount = drawCards(this.state, owner, 1, (items) => this.shuffle(items));
          if (amount) {
            this.addLog(`${owner.nickname}因宣言命中摸1张牌`, owner.id, { zone: "hand", ownerId: owner.id });
            this.emitEvent("cards_drawn", { sourcePlayerId: owner.id, targetPlayerId: owner.id, amount, metadata: { outsideDrawPhase: this.state.phase !== "draw" } });
          }
        }
      }
    }
  }

  private recordCharacterDeployment(sourcePlayerId: string, targetPlayerId: string, characterDefinitionId: string) {
    if (!this.state) return;
    const key = `deploy-actions:${this.state.turnNumber}:${targetPlayerId}`;
    this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
    this.emitEvent("character_deployed", { sourcePlayerId, targetPlayerId, characterDefinitionId, amount: this.state.usageCounters[key] });
  }

  private legalSkillInstanceIds(player: AutoPlayerState) {
    if (!this.state || this.state.winnerId) return [];
    const responseActivation = this.state.prompt?.kind === "response" && this.state.responsePlayerId === player.id && this.state.stack.length > 0;
    const triggerPrompt = this.state.prompt?.kind === "character-trigger" && this.state.prompt.playerId === player.id;
    const dyingActivation = this.state.prompt?.kind === "dying" && this.state.prompt.playerId === player.id;
    if ((this.state.prompt || this.state.stack.length) && !responseActivation && !triggerPrompt && !dyingActivation) return [];
    const promptedIds = triggerPrompt && Array.isArray(this.state.prompt?.context?.eligibleInstanceIds)
      ? new Set(this.state.prompt.context.eligibleInstanceIds.map(String))
      : undefined;
    const field = player.characterSlots.flatMap((slot) => {
      if (!slot || !("instanceId" in slot)) return [];
      if (slot.faceDown && this.isCharacterRevealLocked(player, slot.instanceId)) return [];
      const skill = this.registeredCharacterSkill(player, slot);
      const registered = skill?.module;
      if (registered && skill) {
        if (promptedIds) return promptedIds.has(slot.instanceId) ? [slot.instanceId] : [];
        const trigger = this.skillTriggerContext(registered.trigger.event, registered.trigger.relation, undefined, player, responseActivation);
        if (!trigger) return [];
        const event = "type" in trigger ? trigger as AutoBattleEvent : undefined;
        const eventId = event?.id || trigger.id;
        if (!["play_phase", "basic_card_needed"].includes(registered.trigger.event)
          && (this.state!.usageCounters[this.characterEventUsageKey(eventId, player.id, `${slot.instanceId}:${skill.handlerId}`)] || 0) > 0) return [];
        if (registered.usageLimit) {
          const key = this.characterUsageKey(player, `${slot.instanceId}:${skill.handlerId}`, eventId, registered.usageLimit.scope);
          if ((this.state!.usageCounters[key] || 0) >= registered.usageLimit.count) return [];
        }
        return !registered.canActivate || registered.canActivate(this.characterSkillContext(player, slot, event)) ? [slot.instanceId] : [];
      }
      const automation = automationById.get(slot.definitionId);
      if (!automation) return [];
      const trigger = this.skillTriggerContext(automation.trigger.event, automation.trigger.relation, automation.trigger.targetMainRole, player, responseActivation);
      if (!trigger) return [];
      if (automation.usageLimit) {
        const key = automation.usageLimit.scope === "game"
          ? `skill:game:${player.id}:${slot.definitionId}`
          : automation.usageLimit.scope === "event"
            ? `skill:event:${trigger.id}:${player.id}:${slot.definitionId}`
            : `skill:turn:${this.state!.turnNumber}:${player.id}:${slot.definitionId}`;
        if ((this.state!.usageCounters[key] || 0) >= automation.usageLimit.count) return [];
      }
      return [slot.instanceId];
    });
    const window = player.bodyState.ambushWindow;
    if (!window || window.remaining <= 0) return field;
    const retired = player.retired.flatMap((role) => {
      const definition = characterById.get(role.definitionId);
      const automation = automationById.get(role.definitionId);
      if (!definition || definition.mainRole !== "伏击" || !automation) return [];
      if ((this.state!.usageCounters[bodyUsageKey("game", this.state!.turnNumber, player.id, `ambush-z:${role.instanceId}`)] || 0) > 0) return [];
      return this.skillTriggerContext(automation.trigger.event, automation.trigger.relation, automation.trigger.targetMainRole, player, responseActivation) ? [role.instanceId] : [];
    });
    return [...field, ...retired];
  }

  private canActivateBodyExtra(player: AutoPlayerState) {
    if (!this.state || this.state.winnerId || this.state.prompt || this.state.stack.length) return false;
    if (this.state.currentPlayerId !== player.id || this.state.phase !== "play" || !player.bodyState.flipped || player.bodyState.extraFormUsed) return false;
    const id = bodyId(player);
    return [BODY_IDS.dispatch, BODY_IDS.blood, BODY_IDS.ambush].includes(id as never);
  }

  private legalActionsFor(player: AutoPlayerState, legalHandCardIds: string[], legalSkillInstanceIds: string[]): AutoLegalAction[] {
    if (!this.state || this.state.winnerId) return [];
    const actions: AutoLegalAction[] = [];
    const prompt = this.state.prompt;
    if (prompt) {
      if (prompt.playerId !== player.id) return [];
      if (prompt.kind === "response") {
        actions.push({ type: "response:pass" });
        for (const instanceId of prompt.cardInstanceIds || []) {
          const card = player.hand.find((candidate) => candidate.instanceId === instanceId);
          if (card) actions.push({ type: "response:play", payload: { instanceId, ...(card.definitionId === HAND_IDS.impersonate ? { resolvedAs: HAND_IDS.dodge } : {}) } });
        }
        for (const instanceId of legalSkillInstanceIds) actions.push({ type: "skill:activate", payload: { instanceId }, selection: this.skillCostSelection(player, instanceId) });
      } else if (prompt.kind === "dying") {
        actions.push({ type: "choice:submit", payload: { value: "pass" } });
        for (const instanceId of prompt.cardInstanceIds || []) actions.push({ type: "choice:submit", payload: { value: "aid", instanceId } });
        for (const instanceId of legalSkillInstanceIds) actions.push({ type: "skill:activate", payload: { instanceId }, selection: this.skillCostSelection(player, instanceId) });
      } else if ((prompt.kind as string) === "recall") {
        actions.push({ type: "choice:submit", payload: { value: "pass" } });
        for (const instanceId of prompt.cardInstanceIds || []) actions.push({ type: "choice:submit", payload: { value: "recall", instanceId } });
      } else if (prompt.kind === "discard") {
        actions.push({
          type: "choice:submit",
          selection: { kind: "cards", cardInstanceIds: prompt.cardInstanceIds || [], min: Number(prompt.min || 0), max: Number(prompt.max || 0) },
        });
      } else {
        for (const option of prompt.options || []) actions.push({ type: prompt.kind === "assisted-skill" ? "assisted:action" : "choice:submit", payload: prompt.kind === "assisted-skill" ? { action: option.value } : { value: option.value } });
        if (prompt.cardInstanceIds?.length && prompt.max !== undefined) actions.push({
          type: "choice:submit",
          selection: { kind: "cards", cardInstanceIds: prompt.cardInstanceIds, min: Number(prompt.min || 0), max: Number(prompt.max || 0) },
        });
        const continuation = prompt.context?.continuation as SkillContinuation | undefined;
        if (continuation?.step === "prophet-order") actions.push({
          type: "choice:submit",
          selection: { kind: "order", cardInstanceIds: prompt.cardInstanceIds || [], min: prompt.cardInstanceIds?.length || 0, max: prompt.cardInstanceIds?.length || 0 },
        });
        if (prompt.kind === "character-trigger") {
          for (const instanceId of legalSkillInstanceIds) actions.push({ type: "skill:activate", payload: { instanceId }, selection: this.skillCostSelection(player, instanceId) });
        }
        if (prompt.kind === "assisted-skill") actions.push({ type: "assisted:finish" });
      }
      return actions;
    }
    if (this.state.stack.length || this.state.currentPlayerId !== player.id) return [];
    actions.push({ type: "phase:advance" });
    if (this.state.phase === "deployment") {
      if (this.state.deployedThisPhase < 2 && player.characterSlots.includes(null) && player.characterDeck.length) actions.push({ type: "character:deploy" });
      player.characterSlots.forEach((slot, slotIndex) => {
        if (slot && "instanceId" in slot && slot.faceDown && !this.isCharacterRevealLocked(player, slot.instanceId)) actions.push({ type: "character:reveal", payload: { slotIndex } });
      });
    }
    for (const instanceId of legalSkillInstanceIds) actions.push({ type: "skill:activate", payload: { instanceId }, selection: this.skillCostSelection(player, instanceId) });
    if (this.canActivateBodyExtra(player)) actions.push({ type: "body:activate" });
    if (this.state.phase === "play") {
      const costIds = player.characterSlots.flatMap((slot) => slot && "instanceId" in slot ? [slot.instanceId] : []);
      for (const modifier of this.state.turnModifiers.filter((candidate) => candidate.kind === "aggro-bomb" && candidate.targetPlayerId === player.id)) {
        const marker = player.characterSlots[Number(modifier.targetSlotIndex)];
        if (marker && !("instanceId" in marker) && marker.id === modifier.markerId && costIds.length) {
          actions.push({
            type: "bomb:remove",
            payload: { markerId: modifier.markerId || "" },
            selection: { kind: "skill-cost", cardInstanceIds: costIds, min: 1, max: 1 },
          });
        }
      }
    }
    for (const instanceId of legalHandCardIds) {
      const card = player.hand.find((candidate) => candidate.instanceId === instanceId);
      if (!card) continue;
      if (card.definitionId === HAND_IDS.impersonate) {
        if (canUseInPlay(this.state, player, card.definitionId, HAND_IDS.strike)) actions.push({ type: "hand:play", payload: { instanceId, resolvedAs: HAND_IDS.strike } });
        if (canUseInPlay(this.state, player, card.definitionId, HAND_IDS.aid)) actions.push({ type: "hand:play", payload: { instanceId, resolvedAs: HAND_IDS.aid } });
        continue;
      }
      if ([HAND_IDS.crisis, HAND_IDS.inspect].includes(card.definitionId as never)) {
        const opponent = opponentOf(this.state, player.id);
        opponent?.characterSlots.forEach((slot, targetSlotIndex) => {
          if (!slot || !("instanceId" in slot)) return;
          if (card.definitionId === HAND_IDS.crisis ? !slot.faceDown : Boolean(slot.faceDown)) actions.push({ type: "hand:play", payload: { instanceId, targetSlotIndex } });
        });
      } else actions.push({ type: "hand:play", payload: { instanceId } });
    }
    return actions;
  }

  private skillCostSelection(player: AutoPlayerState, instanceId: string): AutoLegalAction["selection"] | undefined {
    const role = this.findCharacterInstance(player, instanceId);
    const definition = role ? this.registeredCharacterSkill(player, role)?.definition || characterById.get(role.definitionId) : undefined;
    if (!role || !definition) return undefined;
    if (definition.cost.type === "退场" || definition.cost.type === "无") return undefined;
    if (definition.cost.type === "休整自身") return { kind: "skill-cost", cardInstanceIds: [instanceId], min: 1, max: 1 };
    const available = player.characterSlots.flatMap((slot) => slot && "instanceId" in slot ? [slot.instanceId] : []);
    const nextCostOne = this.state?.turnModifiers.some((modifier) => modifier.ownerId === player.id && modifier.kind === "next-skill-cost-rest-one");
    const bodyReduction = this.state?.turnModifiers.some((modifier) => modifier.ownerId === player.id && modifier.kind === "body-next-skill-cost-rest-one" && modifier.characterInstanceId === instanceId);
    const amount = nextCostOne ? 1 : definition.cost.type === "休整" ? Math.max(0, Number(definition.cost.amount || 0) - (bodyReduction ? 1 : 0)) : 0;
    return amount > 0 ? { kind: "skill-cost", cardInstanceIds: available, min: amount, max: amount } : undefined;
  }

  private restoreResponseAfterSkill(skillOwnerId: string) {
    if (!this.state) return;
    const next = opponentOf(this.state, skillOwnerId);
    const top = this.state.stack[this.state.stack.length - 1];
    if (!next || !top) return;
    this.state.responsePlayerId = next.id;
    this.state.consecutivePasses = 0;
    this.state.prompt = createPrompt({
      kind: "response",
      playerId: next.id,
      title: "响应窗口",
      message: "辅助技能已结算，是否继续响应？",
      cardInstanceIds: [],
      options: [{ value: "pass", label: "放弃响应" }],
      context: { itemId: top.id },
    });
    this.state.prompt.cardInstanceIds = legalResponseCards(this.state, next).map((card) => card.instanceId);
  }

  private assistedActionLabel(action: string) {
    return ({ draw: "摸牌", damage: "造成伤害", prevent_damage: "防止本次伤害", heal: "回复体力", deploy: "上阵角色", judge: "进行判定", inspect: "观看/查看", move: "移动角色", marker: "调整标记", extra_strike: "增加【出刀】次数", manual: "记录手动效果" } as Record<string, string>)[action] || action;
  }

  private snapshotFor(viewerId: string, spectator = false, disconnectedPlayerId?: string) {
    if (!this.state) throw new Error("房间不存在。");
    const connected = new Set(this.ctx.getWebSockets().map((socket) => (socket.deserializeAttachment() as AutoSocketAttachment | null)?.playerId));
    if (disconnectedPlayerId) connected.delete(disconnectedPlayerId);
    const visiblePrompt = this.state.prompt
      ? this.state.prompt.playerId === viewerId
        ? this.state.prompt
        : { id: this.state.prompt.id, kind: this.state.prompt.kind, playerId: this.state.prompt.playerId, title: this.state.prompt.title, message: "等待该玩家完成选择。" }
      : undefined;
    const viewer = this.state.players.find((player) => player.id === viewerId);
    const legalHandCardIds = spectator || !viewer
      ? []
      : this.state.prompt?.playerId === viewerId
        ? this.state.prompt.cardInstanceIds || []
        : !this.state.prompt && !this.state.stack.length && this.state.phase === "play" && this.state.currentPlayerId === viewerId
          ? viewer.hand.filter((card) => card.definitionId === HAND_IDS.impersonate
            ? canUseInPlay(this.state!, viewer, card.definitionId, HAND_IDS.aid) || canUseInPlay(this.state!, viewer, card.definitionId, HAND_IDS.strike)
            : canUseInPlay(this.state!, viewer, card.definitionId)).map((card) => card.instanceId)
          : [];
    const legalSkillInstanceIds = spectator || !viewer ? [] : this.legalSkillInstanceIds(viewer);
    const legalActions = spectator || !viewer ? [] : this.legalActionsFor(viewer, legalHandCardIds, legalSkillInstanceIds);
    return {
      mode: "auto",
      roomCode: this.state.roomCode,
      you: spectator ? "spectator" : viewerId,
      revision: this.state.revision,
      players: this.state.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        deckId: player.deckId,
        customDeck: player.id === viewerId ? player.customDeck : undefined,
        ready: player.ready,
        connected: connected.has(player.id),
        health: player.health,
        maxHealth: player.maxHealth,
        body: player.body,
        bodyState: {
          progress: player.bodyState.progress,
          progressMax: player.bodyState.progressMax,
          flipped: player.bodyState.flipped,
          extraFormUsed: player.bodyState.extraFormUsed,
          trackedCharacterInstanceIds: player.id === viewerId && !spectator ? player.bodyState.trackedCharacterInstanceIds : [],
          ...(player.bodyState.ambushWindow ? { ambushWindow: player.bodyState.ambushWindow } : {}),
        },
        hand: player.id === viewerId && !spectator ? player.hand : player.hand.map(() => ({ ownerId: player.id, faceDown: true })),
        handCount: player.hand.length,
        characterDeckCount: player.characterDeck.length,
        characterSlots: player.characterSlots.map((slot, slotIndex) => {
          if (!slot) return null;
          if ("label" in slot) return slot;
          if (slot.faceDown && player.id !== viewerId) return { ownerId: player.id, faceDown: true, slotIndex };
          return slot;
        }),
        markers: player.markers.map((marker) => marker.kind === "counter" ? marker : { ...marker, cards: marker.cards.map(() => ({ ownerId: player.id, faceDown: true })), count: marker.cards.length }),
        retired: player.retired,
        banished: player.banished.map((card) => card.faceDown ? { ownerId: player.id, faceDown: true } : card),
      })),
      game: {
        started: this.state.started,
        currentPlayerId: this.state.currentPlayerId,
        firstPlayerId: this.state.firstPlayerId,
        turnNumber: this.state.turnNumber,
        phase: this.state.phase,
        handDeckCount: this.state.handDeck.length,
        handDiscard: this.state.handDiscard,
        resolving: this.state.resolving,
        stack: this.state.stack.map((item) => isHandResolutionItem(item) ? { ...item, card: { ...item.card } } : { ...item }),
        prompt: visiblePrompt,
        responsePlayerId: this.state.responsePlayerId,
        winnerId: this.state.winnerId,
        deployedThisPhase: this.state.deployedThisPhase,
        recentEvents: this.state.recentEvents.slice(-4).map((event) => ({
          id: event.id,
          type: event.type,
          sourcePlayerId: event.sourcePlayerId,
          targetPlayerId: event.targetPlayerId,
        })),
        legalHandCardIds,
        legalSkillInstanceIds,
        legalActions,
        legalBodyActionPlayerIds: !spectator && viewer && this.canActivateBodyExtra(viewer) ? [viewer.id] : [],
        skillCostRestReductionByCharacterId: spectator || !viewer ? {} : Object.fromEntries(this.state.turnModifiers
          .filter((modifier) => modifier.ownerId === viewer.id && modifier.kind === "body-next-skill-cost-rest-one" && modifier.characterInstanceId)
          .map((modifier) => [modifier.characterInstanceId!, 1])),
        logs: this.state.logs,
      },
      isSpectator: spectator,
    };
  }

  private broadcast(disconnectedPlayerId?: string) {
    if (!this.state) return;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as AutoSocketAttachment | null;
      if (!attachment?.playerId) continue;
      try {
        socket.send(JSON.stringify({ type: "snapshot", snapshot: this.snapshotFor(attachment.playerId, Boolean(attachment.isSpectator), disconnectedPlayerId) }));
      } catch { /* closing socket */ }
    }
  }

  private lobbySummary(): LobbyRoomSummary {
    if (!this.state) throw new Error("房间不存在。");
    return {
      mode: "auto",
      roomCode: this.state.roomCode,
      status: this.state.started ? "playing" : "waiting",
      players: this.state.players.map((player) => ({ nickname: player.nickname, connected: !player.disconnectedAt })),
      playerCount: this.state.players.length,
      capacity: 2,
      joinable: !this.state.started && this.state.players.length < 2 && !this.state.players[0]?.disconnectedAt,
      spectatorCount: this.state.spectators.length,
      createdAt: this.state.createdAt,
      ...(this.state.startedAt ? { startedAt: this.state.startedAt } : {}),
      updatedAt: Date.now(),
    };
  }

  private async syncLobby() {
    if (this.state) await this.env.BATTLE_LOBBY.getByName("global").upsertRoom(this.lobbySummary());
  }

  private async leaveWaitingRoom(player: AutoPlayerState) {
    if (!this.state || this.state.started) throw new Error("牌局开始后不能退出等待房间。");
    if (player.id === "p1") return await this.destroyRoom("房主已退出，等待房间已关闭。");
    this.state.players = this.state.players.filter((item) => item.id !== player.id);
    if (this.state.players[0]) this.state.players[0].ready = false;
    this.state.revision += 1;
    await this.persist();
    await this.syncLobby();
    this.broadcast();
  }

  private async destroyRoom(reason: string) {
    if (!this.state) return;
    const code = this.state.roomCode;
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify({ type: "roomEnded", reason })); } catch { /* noop */ }
      try { socket.close(1000, "Room ended"); } catch { /* noop */ }
    }
    await this.ctx.storage.deleteAll();
    await this.env.BATTLE_LOBBY.getByName("global").removeRoom(code);
    this.state = undefined;
  }

  private addLog(text: string, actorId?: string, target?: BattleLogTarget) {
    if (!this.state) return;
    this.state.logs.push({ id: crypto.randomUUID(), text, at: Date.now(), ...(actorId ? { actorId } : {}), kind: actorId ? "action" : "system", ...(target ? { target } : {}) });
    this.state.logs = this.state.logs.slice(-120);
  }

  private sendAck(ws: WebSocket, actionId: string, duplicate = false) {
    ws.send(JSON.stringify({ type: "actionAck", actionId, revision: this.state?.revision || 0, ...(duplicate ? { duplicate: true } : {}) }));
  }

  private sendError(ws: WebSocket, error: string, actionId?: string) {
    ws.send(JSON.stringify({ type: "error", error, actionId, revision: this.state?.revision || 0 }));
  }

  private randomIndex(length: number) {
    return crypto.getRandomValues(new Uint32Array(1))[0] % Math.max(1, length);
  }

  private shuffle<T>(items: T[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.randomIndex(index + 1);
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  private async persist() {
    if (!this.state) return;
    await this.ctx.storage.put("room", this.state);
    const alarms = [this.state.lastActivityAt + ROOM_TTL_MS];
    if (!this.state.started) for (const player of this.state.players) if (player.disconnectedAt) alarms.push(player.disconnectedAt + WAITING_DISCONNECT_GRACE_MS);
    await this.ctx.storage.setAlarm(Math.min(...alarms));
  }
}
