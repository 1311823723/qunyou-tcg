import { DurableObject } from "cloudflare:workers";
import bodies from "../../data/cards/bodies.json";
import characters from "../../data/cards/characters.json";
import handCards from "../../data/cards/hand_cards.json";
import characterAutomation from "../../data/cards/character_automation.json";
import { allDecks } from "../../src/lib/decks";
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
  isActionCard,
  legalResponseCards,
  moveResolvedCardToDiscard,
  opponentOf,
  playerById,
  validPlayDefinition,
} from "./auto-engine.mts";
import type {
  AutoBattleEvent,
  AutoClientMessage,
  AutoPlayerState,
  AutoRoomState,
  AutoSocketAttachment,
  ResolutionItem,
} from "./auto-types";
import type { BattleLogTarget, CardInstance, CustomDeckConfig, LobbyRoomSummary } from "./types";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const WAITING_DISCONNECT_GRACE_MS = 60 * 1000;
const CUSTOM_DECK_ID = "custom";
const deckById = new Map(allDecks.map((deck) => [deck.id, deck]));
const bodyById = new Map(bodies.map((body) => [body.id, body]));
const characterById = new Map(characters.map((card) => [card.id, card]));
const automationById = new Map(Object.entries(characterAutomation));

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
  return deckId === CUSTOM_DECK_ID ? validCustomDeck(customDeck) : deckById.has(deckId);
}

export class AutoBattleRoom extends DurableObject<Env> {
  private state?: AutoRoomState;
  private readonly env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<AutoRoomState>("room");
      if (this.state) {
        this.state.mode = "auto";
        this.state.stack ??= [];
        this.state.usageCounters ??= {};
        this.state.turnModifiers ??= [];
        this.state.recentEvents ??= [];
        this.state.processedActionIds ??= [];
        await this.syncLobby();
      }
    });
  }

  async createRoom(code: string, token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig) {
    if (this.state) return { roomCode: this.state.roomCode, mode: "auto" as const };
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
        if (!validAutoLoadout(deckId, customDeck)) throw new Error("牌组无效。");
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
        this.state.recentEvents = [];
        card.faceDown = false;
        this.emitEvent("character_revealed", { sourcePlayerId: player.id, targetPlayerId: player.id, characterDefinitionId: card.definitionId });
        this.addLog(`${player.nickname} 明置了角色【${characterById.get(card.definitionId)?.name || card.definitionId}】`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex: slot });
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
      case "skill:activate":
        return this.activateAssistedSkill(player, payload);
      case "assisted:action":
        return this.applyAssistedAction(player, payload);
      case "assisted:finish": {
        if (this.state.prompt?.kind !== "assisted-skill" || this.state.prompt.playerId !== player.id) throw new Error("当前没有由你处理的辅助技能。");
        this.addLog(`${player.nickname} 完成了辅助技能结算`, player.id, { zone: "resolving" });
        const resumeResponse = Boolean(this.state.prompt.context?.resumeResponse);
        this.state.prompt = undefined;
        if (resumeResponse && this.state.stack.length) {
          const top = this.state.stack[this.state.stack.length - 1];
          if (top?.cancelled) this.continueStack();
          else this.restoreResponseAfterSkill(player.id);
        }
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
    if (target) target.wasRespondedTo = true;
    const item: ResolutionItem = {
      id: crypto.randomUUID(),
      sourcePlayerId: player.id,
      card,
      definitionId: card.definitionId,
      resolvedAs,
      targetPlayerId,
      targetSlotIndex,
      ...(target ? { countersItemId: target.id } : {}),
    };
    this.state.stack.push(item);
    this.emitEvent(response ? "card_responded" : "card_used", {
      sourcePlayerId: player.id,
      targetPlayerId,
      cardDefinitionId: effective,
      metadata: response && target ? { targetCardDefinitionId: effectiveDefinition(target) } : undefined,
    });
    if (effective === HAND_IDS.strike && !response) {
      const key = `turn:${this.state.turnNumber}:${player.id}:strike`;
      this.state.usageCounters[key] = (this.state.usageCounters[key] || 0) + 1;
    }
    this.addLog(`${player.nickname}${response ? "响应使用" : "使用"}了【${handName(effective)}】`, player.id, { zone: "resolving" });
    if (effective === HAND_IDS.strike || isActionCard(card.definitionId)) beginResponseWindow(this.state, item);
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

  private resolveTop() {
    if (!this.state || !this.state.stack.length || this.state.prompt) return;
    const item = this.state.stack.pop();
    if (!item) return;
    const effective = effectiveDefinition(item);

    if (item.countersItemId) {
      const target = this.state.stack.find((entry) => entry.id === item.countersItemId);
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
      if (isActionCard(item.definitionId)) this.emitEvent("card_resolved", { sourcePlayerId: item.sourcePlayerId, targetPlayerId: target?.sourcePlayerId, cardDefinitionId: item.definitionId });
      moveResolvedCardToDiscard(this.state, item.card);
      this.continueStack();
      return;
    }

    if (!item.cancelled) this.resolveHandEffect(item, effective);
    else if (effective === HAND_IDS.strike && item.cancelledByPlayerId && item.cancellationReason === "dodge") {
      this.emitEvent("strike_dodged", { sourcePlayerId: item.cancelledByPlayerId, targetPlayerId: item.sourcePlayerId, cardDefinitionId: effective });
    }
    moveResolvedCardToDiscard(this.state, item.card);
    if (this.state.prompt) return;
    if (isActionCard(item.definitionId)) this.emitEvent("card_resolved", { sourcePlayerId: item.sourcePlayerId, targetPlayerId: item.targetPlayerId, cardDefinitionId: item.definitionId });
    if (item.wasRespondedTo) {
      const source = playerById(this.state, item.sourcePlayerId);
      const recall = source?.hand.find((card) => card.definitionId === HAND_IDS.recall);
      if (source && recall) {
        this.state.prompt = createPrompt({
          kind: "recall",
          playerId: source.id,
          title: "撤回",
          message: `是否使用【撤回】取回【${handName(effective)}】？`,
          cardInstanceIds: [recall.instanceId],
          options: [{ value: "pass", label: "不撤回" }],
          context: { targetCardId: item.card.instanceId, targetDefinitionId: effective },
        });
        return;
      }
    }
    this.continueStack();
  }

  private continueStack() {
    if (!this.state || this.state.prompt) return;
    const top = this.state.stack[this.state.stack.length - 1];
    if (!top) return;
    if (top.cancelled) this.resolveTop();
    else beginResponseWindow(this.state, top);
  }

  private resolveHandEffect(item: ResolutionItem, effective: string) {
    if (!this.state) return;
    const source = playerById(this.state, item.sourcePlayerId);
    const target = item.targetPlayerId ? playerById(this.state, item.targetPlayerId) : undefined;
    if (!source) return;
    switch (effective) {
      case HAND_IDS.strike:
        if (target) this.applyDamage(target, 1, source.id, effective);
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
        if (target?.hand.length) this.discardRandom(target, source.id);
        break;
      case HAND_IDS.steal:
        if (target?.hand.length) {
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
          context: { sourcePlayerId: source.id, targetSlotIndex: item.targetSlotIndex, cardDefinitionId: HAND_IDS.crisis },
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
        this.state.prompt = undefined;
        this.continueStack();
      } else {
        prompt.cardInstanceIds = player.hand.filter((item) => item.definitionId === HAND_IDS.aid || item.definitionId === HAND_IDS.impersonate).map((item) => item.instanceId);
      }
      return;
    }
    if (prompt.kind === "crisis-choice") {
      if (!prompt.options?.some((option) => option.value === value)) throw new Error("危机破坏选择无效。");
      const slotIndex = Number(prompt.context?.targetSlotIndex);
      if (value === "rest") this.restCharacter(player, slotIndex, cleanText(prompt.context?.sourcePlayerId, 20));
      else this.applyDamage(player, 1, cleanText(prompt.context?.sourcePlayerId, 20), HAND_IDS.crisis);
      this.emitEvent("card_resolved", { sourcePlayerId: cleanText(prompt.context?.sourcePlayerId, 20), targetPlayerId: player.id, cardDefinitionId: HAND_IDS.crisis });
      if (this.state.prompt?.id === prompt.id) this.state.prompt = undefined;
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
      this.emitEvent("card_resolved", { sourcePlayerId: cleanText(prompt.context?.sourcePlayerId, 20), targetPlayerId: cleanText(prompt.context?.targetPlayerId, 20), cardDefinitionId: HAND_IDS.inspect });
      this.state.prompt = undefined;
      this.continueStack();
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
    throw new Error("选择类型无效。");
  }

  private activateAssistedSkill(player: AutoPlayerState, payload: Record<string, unknown>) {
    if (!this.state) throw new Error("房间状态不存在。");
    const responseActivation = this.state.prompt?.kind === "response" && this.state.responsePlayerId === player.id && this.state.stack.length > 0;
    if ((this.state.prompt || this.state.stack.length) && !responseActivation) throw new Error("请先完成当前结算。");
    const instanceId = cleanText(payload.instanceId, 80);
    const slotIndex = player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === instanceId);
    const role = player.characterSlots[slotIndex];
    if (!role || !("instanceId" in role)) throw new Error("角色不在你的角色区。");
    const definition = characterById.get(role.definitionId);
    if (!definition) throw new Error("角色数据不存在。");
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
      if (respondingTo) respondingTo.wasRespondedTo = true;
    }
    if (role.faceDown) role.faceDown = false;
    this.paySkillCost(player, role, definition.cost, payload, triggerContext);
    if (usageKey) this.state.usageCounters[usageKey] = (this.state.usageCounters[usageKey] || 0) + 1;
    const skillCountKey = `skill-actions:${this.state.turnNumber}:${player.id}`;
    this.state.usageCounters[skillCountKey] = (this.state.usageCounters[skillCountKey] || 0) + 1;
    const usedThisTurn = this.state.usageCounters[skillCountKey];
    this.emitEvent("skill_used", {
      sourcePlayerId: player.id,
      characterDefinitionId: role.definitionId,
      amount: usedThisTurn,
      metadata: { costType: definition.cost.type, costAmount: definition.cost.amount || 0 },
    });
    this.state.prompt = createPrompt({
      kind: "assisted-skill",
      playerId: player.id,
      title: `${definition.skillName} · 辅助结算`,
      message: definition.effectText,
      options: automation.assistedActions.map((action) => ({ value: action, label: this.assistedActionLabel(action) })),
      context: { characterId: definition.id, characterInstanceId: role.instanceId, allowedActions: automation.assistedActions, resumeResponse: responseActivation },
    });
    this.addLog(`${player.nickname} 发动了角色【${definition.name}】的技能【${definition.skillName}】（辅助结算）`, player.id, { zone: "characterSlot", ownerId: player.id, slotIndex });
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
    if (includesSelf) drawCards(this.state, player, 1, (items) => this.shuffle(items));
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
      if (top) {
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
    } else if (action === "inspect" || action === "manual") {
      // These effects still rely on table agreement; the public log preserves accountability.
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
    this.state.usageCounters = {};
    this.state.turnModifiers = [];
    for (const player of this.state.players) {
      const loadout = this.loadout(player);
      if (!loadout) throw new Error("牌组数据不存在。");
      const body = bodyById.get(loadout.bodyId);
      player.maxHealth = body?.hp || 7;
      player.health = player.maxHealth;
      player.body = { instanceId: crypto.randomUUID(), definitionId: loadout.bodyId, kind: "body", ownerId: player.id };
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

  private applyDamage(target: AutoPlayerState, amount: number, sourceId?: string, cardDefinitionId?: string) {
    if (!this.state) return;
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
    const applied = damage(this.state, target, finalAmount, sourceId);
    this.addLog(`${target.nickname} 受到 ${applied} 点伤害，当前体力 ${target.health}`, sourceId, { zone: "player", ownerId: target.id });
    this.emitEvent("damage_after", { sourcePlayerId: sourceId, targetPlayerId: target.id, cardDefinitionId, amount: applied });
  }

  private discardRandom(player: AutoPlayerState, actorId?: string) {
    if (!this.state || !player.hand.length) return;
    const [card] = player.hand.splice(this.randomIndex(player.hand.length), 1);
    card.ownerId = undefined;
    this.state.handDiscard.push(card);
    this.emitEvent("hand_discarded", { sourcePlayerId: actorId, targetPlayerId: player.id, amount: 1 });
    this.addLog(`${player.nickname} 随机弃置了1张手牌`, actorId, { zone: "handDiscard" });
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
    card.faceDown = undefined;
    player.characterDeck.unshift(card);
    this.emitEvent("character_rested", { sourcePlayerId, targetPlayerId: player.id, characterDefinitionId: card.definitionId, metadata: { skillCost } });
    if (drawForSelf) drawCards(this.state, player, 1, (items) => this.shuffle(items));
  }

  private retireCard(player: AutoPlayerState, card: CardInstance, sourcePlayerId = player.id) {
    const index = player.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === card.instanceId);
    if (index < 0) throw new Error("要退场的角色不在角色区。");
    player.characterSlots[index] = null;
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
    if (event === "play_phase" && this.state.currentPlayerId === player.id && this.state.phase === "play" && !responseActivation) return { id: `phase:${this.state.turnNumber}:play` };
    if (event === "preparation" && this.state.currentPlayerId === player.id && this.state.phase === "preparation" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:preparation` };
    if (event === "opponent_preparation" && this.state.currentPlayerId !== player.id && this.state.phase === "preparation" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:opponent-preparation` };
    if (event === "deployment" && this.state.currentPlayerId === player.id && this.state.phase === "deployment" && !this.state.prompt) return { id: `phase:${this.state.turnNumber}:deployment` };
    if (responseActivation) {
      const top = this.state.stack[this.state.stack.length - 1];
      const effective = top ? effectiveDefinition(top) : "";
      const promptId = this.state.prompt?.id || `response:${top?.id}`;
      if (effective === HAND_IDS.strike) {
        if (["strike_targeted", "damage_before", "body_targeted_by_hand", "basic_card_needed"].includes(event) && top.targetPlayerId === player.id) return { id: promptId };
        if (["strike_used", "damage_before_source"].includes(event) && top.sourcePlayerId === player.id) return { id: promptId };
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
    if (trigger === "damage_after" || trigger === "health_lost_after") return event.type === "damage_after";
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
    this.state.recentEvents.push({ id: crypto.randomUUID(), type, turnNumber: this.state.turnNumber, ...details });
    this.state.recentEvents = this.state.recentEvents.slice(-12);
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
    if ((this.state.prompt || this.state.stack.length) && !responseActivation) return [];
    return player.characterSlots.flatMap((slot) => {
      if (!slot || !("instanceId" in slot)) return [];
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
        stack: this.state.stack.map((item) => ({ ...item, card: { ...item.card } })),
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
