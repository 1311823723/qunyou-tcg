import { DurableObject } from "cloudflare:workers";
import bodies from "../../data/cards/bodies.json";
import characters from "../../data/cards/characters.json";
import handCards from "../../data/cards/hand_cards.json";
import { getExtraFormProgressMax } from "../../src/lib/body-progress";
import { allDecks } from "../../src/lib/decks";
import { formatCharacterCost } from "../../src/lib/ui";
import {
  consumeInspectionGrant,
  createInspectionGrant,
  pruneInspections,
  requireInspectionGrant,
} from "./inspection";
import {
  clearExpiredRestart,
  createRestartRequest,
  isRevisionIndependentRestartCommand,
} from "./restart";
import {
  assertCardCanEnter,
  isPrivateLocation,
  isPublicLocation,
  zoneLabel,
} from "./movement";
import { migrateRoomState, ROOM_STATE_VERSION } from "./state-migration.mts";
import type { LocatedCard } from "./movement";
import type {
  BattleLogKind,
  BattleLogTarget,
  CardInstance,
  ClientMessage,
  CustomDeckConfig,
  InspectionResult,
  Marker,
  PlayerState,
  RoomState,
  SocketAttachment,
  VisualEffectSpec,
  ZoneName,
} from "./types";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CUSTOM_DECK_ID = "custom";
const deckById = new Map(allDecks.map((deck) => [deck.id, deck]));
const bodyById = new Map(bodies.map((body) => [body.id, body]));
const characterById = new Map(characters.map((card) => [card.id, card]));
const handCardById = new Map(handCards.map((card) => [card.id, card]));

function isOriginAllowed(origin: string, env: Env) {
  if (!origin) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.qunyou-tcg\.pages\.dev$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(origin);
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    ...(origin ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function parseCustomDeck(value: unknown): CustomDeckConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const bodyId = cleanText(raw.bodyId, 80);
  const characterIds = Array.isArray(raw.characterIds)
    ? raw.characterIds.map((id) => cleanText(id, 80)).filter(Boolean)
    : [];
  return { bodyId, characterIds };
}

function isValidCustomDeck(deck: CustomDeckConfig | undefined): deck is CustomDeckConfig {
  if (!deck) return false;
  if (!bodyById.has(deck.bodyId)) return false;
  if (deck.characterIds.length !== 16) return false;
  const unique = new Set(deck.characterIds);
  if (unique.size !== 16) return false;
  return deck.characterIds.every((id) => characterById.has(id));
}

function isLoadoutRequestValid(deckId: string, customDeck: CustomDeckConfig | undefined) {
  return deckId === CUSTOM_DECK_ID
    ? isValidCustomDeck(customDeck)
    : deckById.has(deckId);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";
    if (!isOriginAllowed(origin, env)) {
      return json({ error: "当前来源不允许访问对战服务。" }, { status: 403 });
    }
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (request.method === "POST" && url.pathname === "/rooms") {
      const rate = await env.CREATE_RATE_LIMITER.limit({ key: clientAddress(request) });
      if (!rate.success) {
        return json({ error: "创建房间过于频繁，请稍后再试。" }, { status: 429, headers });
      }
      const body = await request.json() as Record<string, unknown>;
      const nickname = cleanText(body.nickname, 20);
      const token = cleanText(body.token, 80);
      const deckId = cleanText(body.deckId, 80);
      const customDeck = parseCustomDeck(body.customDeck);
      if (!nickname || !token || !isLoadoutRequestValid(deckId, customDeck)) {
        return json({ error: "昵称、身份令牌或牌组无效。自组牌组需要 1 张本体和 16 张不重复角色。" }, { status: 400, headers });
      }
      const code = roomCode();
      const stub = env.BATTLE_ROOMS.getByName(code);
      const result = await stub.createRoom(code, token, nickname, deckId, customDeck);
      return json(result, { headers });
    }

    const joinMatch = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/join$/);
    if (request.method === "POST" && joinMatch) {
      const rate = await env.JOIN_RATE_LIMITER.limit({ key: clientAddress(request) });
      if (!rate.success) {
        return json({ error: "加入房间请求过于频繁，请稍后再试。" }, { status: 429, headers });
      }
      const body = await request.json() as Record<string, unknown>;
      const nickname = cleanText(body.nickname, 20);
      const token = cleanText(body.token, 80);
      const deckId = cleanText(body.deckId, 80);
      const customDeck = parseCustomDeck(body.customDeck);
      if (!nickname || !token || !isLoadoutRequestValid(deckId, customDeck)) {
        return json({ error: "昵称、身份令牌或牌组无效。自组牌组需要 1 张本体和 16 张不重复角色。" }, { status: 400, headers });
      }
      const stub = env.BATTLE_ROOMS.getByName(joinMatch[1]);
      const result = await stub.joinRoom(token, nickname, deckId, customDeck);
      return json(result.body, { status: result.status, headers });
    }

    const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/connect$/);
    if (request.method === "GET" && match) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "需要 WebSocket 连接。" }, { status: 426, headers });
      }
      const stub = env.BATTLE_ROOMS.getByName(match[1]);
      return stub.fetch(request);
    }

    return json({ error: "Not found" }, { status: 404, headers });
  },
};

export class BattleRoom extends DurableObject<Env> {
  private state?: RoomState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<RoomState>("room");
      if (this.state) {
        this.state.revision ??= 0;
        this.state.inspections ??= [];
        this.state.processedActionIds ??= [];
        const migrated = this.migrateState();
        if (migrated) await ctx.storage.put("room", this.state);
      }
    });
  }

  async createRoom(code: string, token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig) {
    if (this.state) return { roomCode: this.state.roomCode };
    const now = Date.now();
    this.state = {
      stateVersion: ROOM_STATE_VERSION,
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
      revision: 0,
      logs: [{
        id: crypto.randomUUID(),
        text: `${nickname} 创建了房间`,
        at: now,
        actorId: "p1",
        kind: "system",
        target: { zone: "lobby", ownerId: "p1" },
      }],
      processedActionIds: [],
      inspections: [],
    };
    await this.persist();
    return { roomCode: code };
  }

  async joinRoom(token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig) {
    if (!this.state) {
      return { status: 404, body: { error: "房间不存在或已经过期。" } };
    }
    let player = this.state.players.find((item) => item.token === token);
    if (!player) {
      if (this.state.players.length >= 2) {
        return { status: 409, body: { error: "房间已满，无法加入。" } };
      }
      player = this.newPlayer("p2", token, nickname, deckId, customDeck);
      this.state.players.push(player);
      this.addLog(`${nickname} 加入了房间`, player.id, "system", { zone: "lobby", ownerId: player.id });
      this.state.revision += 1;
      await this.persist();
    }
    return { status: 200, body: { ok: true, playerId: player.id } };
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return json({ error: "房间不存在或已经过期。" }, { status: 404 });
    const url = new URL(request.url);
    const token = cleanText(url.searchParams.get("token"), 80);
    const spectator = url.searchParams.get("spectator") === "true";

    let playerId: string;
    let isSpectator = false;

    if (spectator) {
      // 观战者连接
      playerId = `spectator-${crypto.randomUUID()}`;
      isSpectator = true;
      if (!this.state.spectators) this.state.spectators = [];
      this.state.spectators.push(playerId);
      this.addLog(`观战者加入`, playerId, "system", { zone: "spectator" });
    } else {
      // 玩家连接
      const player = this.state.players.find((item) => item.token === token);
      if (!player) return json({ error: "请先通过加入页面进入房间。" }, { status: 401 });
      playerId = player.id;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId, isSpectator } satisfies SocketAttachment);
    this.state.lastActivityAt = Date.now();
    await this.persist();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.state || typeof raw !== "string") return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;

    // 观战者不能发送游戏操作
    if (attachment?.isSpectator) {
      return this.sendError(ws, "观战者不能进行操作。");
    }

    const player = this.state.players.find((item) => item.id === attachment?.playerId);
    if (!player) return this.sendError(ws, "座位身份无效。");

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.sendError(ws, "消息格式无效。");
    }
    if (!message.actionId) {
      return this.sendError(ws, "操作标识无效。", {
        revision: this.state.revision,
        category: "invalid_action",
      });
    }
    if (this.state.processedActionIds.includes(message.actionId)) {
      if ((message.protocolVersion ?? 1) >= 2) this.sendActionAck(ws, message.actionId, true);
      return;
    }

    try {
      if (message.type === "room:end") {
        await this.endRoom(player);
        return;
      }
      const now = Date.now();
      pruneInspections(this.state, now);
      if (clearExpiredRestart(this.state, now)) {
        this.addLog("重新开始请求已超时");
        this.state.revision += 1;
        await this.persist();
        this.broadcast();
      }
      if (
        !isRevisionIndependentRestartCommand(message.type)
        && (!Number.isInteger(message.baseRevision) || message.baseRevision !== this.state.revision)
      ) {
        throw new Error("牌桌状态已更新，请等待同步后重试。");
      }
      const visualEffects: VisualEffectSpec[] = [];
      const inspection = this.applyAction(player, message, visualEffects);
      this.state.processedActionIds.push(message.actionId);
      this.state.processedActionIds = this.state.processedActionIds.slice(-100);
      this.state.lastActivityAt = Date.now();
      this.state.revision += 1;
      await this.persist();
      this.broadcast();
      this.broadcastVisualEffects(visualEffects);
      if ((message.protocolVersion ?? 1) >= 2) this.sendActionAck(ws, message.actionId);
      if (inspection) {
        if (inspection.audience === "all") {
          for (const socket of this.ctx.getWebSockets()) {
            try {
              const attachment = socket.deserializeAttachment() as SocketAttachment | null;
              const isViewer = attachment?.playerId === inspection.viewerId;
              socket.send(JSON.stringify({
                type: "inspection",
                ...inspection,
                cards: inspection.cards.map((card) => isViewer ? card : this.redactInspectionCard(card)),
                allowedActions: isViewer ? inspection.allowedActions : [],
              }));
            } catch {
              // A closing socket will disappear from the next socket list.
            }
          }
        } else {
          ws.send(JSON.stringify({ type: "inspection", ...inspection }));
        }
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "操作失败。";
      console.error(JSON.stringify({
        event: "battle_command_failed",
        roomCode: this.state?.roomCode,
        command: message.type,
        category: this.errorCategory(messageText),
      }));
      this.sendError(ws, messageText, {
        actionId: message.actionId,
        revision: this.state.revision,
        category: this.errorCategory(messageText),
      });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;

    // 观战者断开连接
    if (attachment?.isSpectator && this.state?.spectators) {
      const index = this.state.spectators.indexOf(attachment.playerId);
      if (index >= 0) {
        this.state.spectators.splice(index, 1);
        this.addLog(`观战者离开`, attachment.playerId, "system", { zone: "spectator" });
        this.broadcast();
      }
      return;
    }

    // 玩家断开连接
    const hasAnotherConnection = attachment?.playerId
      ? this.ctx.getWebSockets().some((socket) => {
          if (socket === ws) return false;
          const other = socket.deserializeAttachment() as SocketAttachment | null;
          return other?.playerId === attachment.playerId;
        })
      : false;
    this.broadcast(hasAnotherConnection ? undefined : attachment?.playerId);
  }

  async alarm() {
    if (!this.state) return;
    if (clearExpiredRestart(this.state)) {
      this.addLog("重新开始请求已超时");
      this.state.revision += 1;
      await this.persist();
      this.broadcast();
      return;
    }
    if (Date.now() - this.state.lastActivityAt >= ROOM_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.state = undefined;
      return;
    }
    await this.ctx.storage.setAlarm(this.state.lastActivityAt + ROOM_TTL_MS);
  }

  private newPlayer(id: string, token: string, nickname: string, deckId: string, customDeck?: CustomDeckConfig): PlayerState {
    return {
      id,
      token,
      nickname,
      deckId,
      ...(deckId === CUSTOM_DECK_ID && customDeck ? { customDeck } : {}),
      ready: false,
      health: 7,
      megaProgress: 0,
      bodyFlipped: false,
      hand: [],
      characterDeck: [],
      characterSlots: [null, null, null, null],
      retired: [],
      banished: [],
    };
  }

  private migrateState() {
    if (!this.state) return false;
    const result = migrateRoomState(this.state, (items) => this.shuffle(items));
    if (result.recycledCount) {
      this.addLog(`规则更新：${result.recycledCount} 张角色手牌已洗回各自角色牌堆`);
    }
    return result.migrated;
  }

  private playerLoadout(player: PlayerState): CustomDeckConfig | undefined {
    if (player.deckId === CUSTOM_DECK_ID) {
      return isValidCustomDeck(player.customDeck) ? player.customDeck : undefined;
    }
    const deck = deckById.get(player.deckId || "");
    return deck ? { bodyId: deck.bodyId, characterIds: deck.characterIds } : undefined;
  }

  private applyAction(
    player: PlayerState,
    message: ClientMessage,
    visualEffects: VisualEffectSpec[],
  ): InspectionResult | void {
    if (!this.state) throw new Error("房间状态不存在。");
    const payload = message.payload || {};

    switch (message.type) {
      case "player:selectDeck": {
        if (this.state.started || player.ready) throw new Error("当前不能更换预组。");
        const deckId = cleanText(payload.deckId, 80);
        const customDeck = parseCustomDeck(payload.customDeck);
        if (!isLoadoutRequestValid(deckId, customDeck)) throw new Error("牌组无效。自组牌组需要 1 张本体和 16 张不重复角色。");
        player.deckId = deckId;
        player.customDeck = deckId === CUSTOM_DECK_ID ? customDeck : undefined;
        this.addLog(`${player.nickname} 选择了${deckId === CUSTOM_DECK_ID ? "自组牌组" : "预组"}`, player.id, "action", { zone: "player", ownerId: player.id });
        return;
      }
      case "player:ready": {
        if (this.state.started) throw new Error("牌局已经开始。");
        player.ready = Boolean(payload.ready);
        this.addLog(`${player.nickname}${player.ready ? "已准备" : "取消准备"}`, player.id, "action", {
          zone: "player",
          ownerId: player.id,
        });
        if (this.state.players.length === 2 && this.state.players.every((item) => item.ready && this.playerLoadout(item))) {
          const first = this.startGame();
          visualEffects.push(this.turnStartEffect(first));
        }
        return;
      }
      case "card:draw":
        this.requireStarted();
        this.draw(player, cleanText(payload.deck, 20), this.clamp(payload.count, 1, 10));
        return;
      case "character:deploy":
        this.requireStarted();
        this.deployCharacter(player);
        return;
      case "card:move":
        this.requireStarted();
        this.moveCard(player, payload);
        return;
      case "card:flip": {
        this.requireStarted();
        const card = this.findCard(cleanText(payload.instanceId, 80));
        if (!card || card.kind !== "character" || card.ownerId !== player.id) throw new Error("只能翻转自己的角色。");
        card.faceDown = !card.faceDown;
        const located = this.locateCard(card.instanceId);
        const definition = characterById.get(card.definitionId);
        const flipLabel = card.faceDown
          ? "暗置了一张角色"
          : `明置了角色【${definition?.name || "未知角色"}】`;
        this.addLog(`${player.nickname} ${flipLabel}`, player.id, "action", {
          zone: "characterSlot",
          ownerId: player.id,
          slotIndex: located?.zone === "characterSlot" ? located.index : undefined,
        });
        if (!card.faceDown) {
          visualEffects.push({
            effect: "characterFlip",
            actorId: player.id,
            ownerId: player.id,
            definitionId: card.definitionId,
            ...(located?.zone === "characterSlot" ? { slotIndex: located.index } : {}),
            faceDown: false,
          });
        }
        return;
      }
      case "character:declareSkill": {
        this.requireStarted();
        const located = this.declareCharacterSkill(player, cleanText(payload.instanceId, 80));
        if (!located.card.faceDown && located.zone === "characterSlot") {
          visualEffects.push({
            effect: "characterSkill",
            actorId: player.id,
            ownerId: player.id,
            definitionId: located.card.definitionId,
            slotIndex: located.index,
          });
        }
        return;
      }
      case "card:inspect":
        this.requireStarted();
        return this.inspect(player, payload);
      case "hand:randomSelect":
        this.requireStarted();
        return this.randomSelect(player, payload);
      case "deck:shuffle":
        this.requireStarted();
        this.shuffleDeck(player, cleanText(payload.deck, 30));
        return;
      case "deck:recycleDiscard":
        this.requireStarted();
        this.recycleHandDiscard(player);
        return;
      case "resolving:discardAll":
        this.requireStarted();
        this.discardResolving(player);
        return;
      case "body:flip":
        this.requireStarted();
        player.bodyFlipped = !player.bodyFlipped;
        this.addLog(`${player.nickname} 将本体翻至${player.bodyFlipped ? "额外形态" : "正面"}`, player.id, "action", {
          zone: "body",
          ownerId: player.id,
        });
        if (player.bodyFlipped && player.body) {
          visualEffects.push({
            effect: "bodyMega",
            actorId: player.id,
            ownerId: player.id,
            definitionId: player.body.definitionId,
          });
        }
        return;
      case "health:set": {
        this.requireStarted();
        const targetId = cleanText(payload.playerId, 20);
        const target = targetId
          ? this.state.players.find((item) => item.id === targetId)
          : player;
        if (!target) throw new Error("目标玩家不存在。");
        target.health = this.clamp(payload.value, 0, 99);
        this.addLog(`${player.nickname} 将${target.id === player.id ? "自己的" : `${target.nickname} 的`}体力调整为 ${target.health}`, player.id, "action", {
          zone: "health",
          ownerId: target.id,
        });
        return;
      }
      case "megaProgress:set": {
        this.requireStarted();
        const max = this.megaMax(player);
        player.megaProgress = this.clamp(payload.value, 0, max ?? 99);
        const bodyId = player.body?.definitionId || this.playerLoadout(player)?.bodyId;
        const body = bodyById.get(bodyId || "");
        const formLabel = body?.extraForm?.type === "z-move" ? "Z招式" : "Mega";
        this.addLog(`${player.nickname} 将${formLabel}进度调整为 ${player.megaProgress}${max ? `/${max}` : ""}`, player.id, "action", {
          zone: "mega",
          ownerId: player.id,
        });
        return;
      }
      case "mega:activate": {
        this.requireStarted();
        const megaMax = this.megaMax(player);
        if (!megaMax || player.megaProgress < megaMax) {
          throw new Error("Mega 进度未满，无法激活。");
        }
        if (player.megaUsed) {
          throw new Error("Mega 已使用。");
        }
        player.megaUsed = true;
        player.bodyFlipped = true;
        this.addLog(`${player.nickname} 激活了 Mega！`, player.id, "action", {
          zone: "body",
          ownerId: player.id,
        });
        return;
      }
      case "zmove:activate": {
        this.requireStarted();
        const zMax = this.megaMax(player);
        if (!zMax || player.megaProgress < zMax) {
          throw new Error("Z 招式进度未满，无法激活。");
        }
        if (player.zMoveUsed) {
          throw new Error("Z 招式已使用。");
        }
        player.zMoveUsed = true;
        player.bodyFlipped = true;
        this.addLog(`${player.nickname} 激活了 Z 招式！`, player.id, "action", {
          zone: "body",
          ownerId: player.id,
        });
        return;
      }
      case "marker:create": {
        this.requireStarted();
        const index = this.clamp(payload.slotIndex, 0, 3);
        if (player.characterSlots[index]) throw new Error("该角色位已经被占用。");
        const label = cleanText(payload.label, 20);
        if (!label) throw new Error("标记名称不能为空。");
        player.characterSlots[index] = { id: crypto.randomUUID(), label, ownerId: player.id };
        this.addLog(`${player.nickname} 创建了「${label}」标记`, player.id, "action", {
          zone: "characterSlot",
          ownerId: player.id,
          slotIndex: index,
        });
        return;
      }
      case "marker:remove": {
        this.requireStarted();
        const markerId = cleanText(payload.markerId, 80);
        for (const owner of this.state.players) {
          const index = owner.characterSlots.findIndex((item) => item && "label" in item && item.id === markerId);
          if (index >= 0) {
            const marker = owner.characterSlots[index] as Marker;
            owner.characterSlots[index] = null;
            if (marker.card) {
              marker.card.faceDown = false;
              this.state.handDiscard.push(marker.card);
            }
            this.addLog(`${player.nickname} 移除了「${marker.label}」标记`, player.id, "action", {
              zone: "characterSlot",
              ownerId: owner.id,
              slotIndex: index,
            });
            return;
          }
        }
        throw new Error("标记不存在。");
      }
      case "turn:end": {
        this.requireStarted();
        if (this.state.currentPlayerId !== player.id) throw new Error("当前不是你的回合。");
        const opponent = this.state.players.find((item) => item.id !== this.state?.currentPlayerId);
        if (!opponent) throw new Error("对手尚未加入。");
        this.state.currentPlayerId = opponent.id;
        this.state.turnNumber += 1;
        this.addLog(`${player.nickname} 结束了回合`, player.id, "action", { zone: "turn" });
        visualEffects.push(this.turnStartEffect(opponent, player.id));
        return;
      }
      case "room:restartRequest": {
        this.requireStarted();
        const opponent = this.state.players.find((item) => item.id !== player.id);
        if (!opponent || !this.connectedPlayerIds().has(opponent.id)) {
          throw new Error("对手当前离线，不能发起重新开始。");
        }
        createRestartRequest(this.state, player.id);
        this.addLog(`${player.nickname} 请求重新开始牌局`, player.id, "action", { zone: "restart" });
        return;
      }
      case "room:restartRespond": {
        this.requireStarted();
        const pending = this.state.pendingRestart;
        const requestId = cleanText(payload.requestId, 80);
        if (!pending || pending.id !== requestId) throw new Error("重新开始请求不存在或已经失效。");
        if (pending.requestedBy === player.id) throw new Error("发起者不能代替对手确认。");
        if (!this.connectedPlayerIds().has(pending.requestedBy)) {
          throw new Error("发起者当前离线，不能完成重新开始。");
        }
        if (payload.accept !== true) {
          this.state.pendingRestart = undefined;
          this.addLog(`${player.nickname} 拒绝了重新开始请求`, player.id, "action", { zone: "restart" });
          return;
        }
        this.state.pendingRestart = undefined;
        const first = this.initializeGame("restart");
        visualEffects.push(this.turnStartEffect(first, player.id));
        return;
      }
      case "room:restartCancel": {
        this.requireStarted();
        const pending = this.state.pendingRestart;
        const requestId = cleanText(payload.requestId, 80);
        if (!pending || pending.id !== requestId) throw new Error("重新开始请求不存在或已经失效。");
        if (pending.requestedBy !== player.id) throw new Error("只有发起者可以取消请求。");
        this.state.pendingRestart = undefined;
        this.addLog(`${player.nickname} 取消了重新开始请求`, player.id, "action", { zone: "restart" });
        return;
      }
      default:
        throw new Error("暂不支持这个操作。");
    }
  }

  private startGame() {
    return this.initializeGame("start");
  }

  private initializeGame(reason: "start" | "restart") {
    if (!this.state) throw new Error("房间状态不存在。");
    this.state.inspections = [];
    this.state.pendingRestart = undefined;
    this.state.handDeck = this.shuffle(handCards.flatMap((definition) =>
      definition.cards.map((entry) => ({
        instanceId: crypto.randomUUID(),
        definitionId: definition.id,
        kind: "hand" as const,
        suit: entry.suit,
        rank: entry.rank,
      })),
    ));
    this.state.handDiscard = [];
    this.state.resolving = [];
    if (reason === "restart") {
      this.state.logs = [];
    }
    for (const player of this.state.players) {
      const deck = this.playerLoadout(player);
      if (!deck) throw new Error("牌组数据不存在。");
      const body = bodyById.get(deck.bodyId);
      player.health = body?.hp || 7;
      player.megaProgress = 0;
      player.megaUsed = false;
      player.zMoveUsed = false;
      player.bodyFlipped = false;
      player.body = {
        instanceId: crypto.randomUUID(),
        definitionId: deck.bodyId,
        kind: "body",
        ownerId: player.id,
      };
      player.characterDeck = this.shuffle(deck.characterIds.map((definitionId) => ({
        instanceId: crypto.randomUUID(),
        definitionId,
        kind: "character" as const,
        ownerId: player.id,
      })));
      player.hand = [];
      player.characterSlots = [null, null, null, null];
      player.retired = [];
      player.banished = [];
      this.draw(player, "hand", 5, false);
      this.deployCharacter(player, false);
      this.deployCharacter(player, false);
    }
    const first = this.state.players[crypto.getRandomValues(new Uint8Array(1))[0] % 2];
    this.state.started = true;
    this.state.firstPlayerId = first.id;
    this.state.currentPlayerId = first.id;
    this.state.turnNumber = 1;
    this.addLog(reason === "restart"
      ? `牌局已重新开始，${first.nickname} 为先手`
      : `牌局开始，${first.nickname} 为先手`, undefined, "system", { zone: "turn" });
    return first;
  }

  private draw(player: PlayerState, deck: string, count: number, log = true) {
    if (!this.state) return;
    if (deck === "hand") {
      for (let index = 0; index < count; index += 1) {
        const card = this.state.handDeck.pop();
        if (!card) break;
        card.ownerId = player.id;
        player.hand.push(card);
      }
      if (log) this.addLog(`${player.nickname} 摸了 ${count} 张手牌`, player.id, "action", {
        zone: "hand",
        ownerId: player.id,
      });
    } else {
      throw new Error("牌堆无效。");
    }
  }

  private deployCharacter(player: PlayerState, log = true) {
    const slotIndex = player.characterSlots.findIndex((item) => item === null);
    if (slotIndex < 0) throw new Error("角色区已满，不能继续上阵。");
    const card = player.characterDeck.pop();
    if (!card) throw new Error("角色牌堆为空，不能上阵角色。");
    card.faceDown = true;
    card.ownerId = player.id;
    player.characterSlots[slotIndex] = card;
    if (log) this.addLog(`${player.nickname} 从角色牌堆暗置上阵了 1 张角色至位置 ${slotIndex + 1}`, player.id, "action", {
      zone: "characterSlot",
      ownerId: player.id,
      slotIndex,
    });
  }

  private moveCard(actor: PlayerState, payload: Record<string, unknown>) {
    if (!this.state) return;
    const instanceId = cleanText(payload.instanceId, 80);
    const located = this.locateCard(instanceId);
    if (!located) throw new Error("找不到这张牌。");
    const { card, owner } = located;
    const target = cleanText(payload.targetZone, 40);
    assertCardCanEnter(card, target);
    const inspectionId = cleanText(payload.inspectionId, 80);
    const privateSource = isPrivateLocation(located);
    const requiresInspection = owner.id !== actor.id && privateSource;
    if (requiresInspection) {
      requireInspectionGrant(this.state, inspectionId, actor.id, instanceId, target);
    }
    const targetIndex = Number(payload.targetIndex);
    const sourceLabel = zoneLabel(located.zone);
    const targetLabel = zoneLabel(target);
    const revealInLog = requiresInspection
      || isPublicLocation(located)
      || ["resolving", "handDiscard", "retired"].includes(target);
    this.removeCard(instanceId);

    try {
      if (target === "resolving") {
        this.state.resolving.push(card);
      } else if (target === "handDiscard") {
        card.faceDown = false;
        this.state.handDiscard.push(card);
      }
      else if (target === "handDeckTop") {
        card.ownerId = undefined;
        card.faceDown = false;
        this.state.handDeck.push(card);
      } else if (target === "handDeckBottom") {
        card.ownerId = undefined;
        card.faceDown = false;
        this.state.handDeck.unshift(card);
      } else if (target === "opponentHand") {
        const opponent = this.state.players.find((item) => item.id !== actor.id);
        if (!opponent || card.kind !== "hand" || (owner.id !== actor.id && !isPublicLocation(located))) {
          throw new Error("不能交给对手。");
        }
        card.ownerId = opponent.id;
        opponent.hand.push(card);
      } else if (target === "hand") {
        card.ownerId = actor.id;
        actor.hand.push(card);
      } else if (target === "handMarker") {
        if (card.kind !== "hand" || card.ownerId !== actor.id) throw new Error("只能将自己的手牌暗置为标记。");
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 3 || actor.characterSlots[targetIndex]) {
          throw new Error("标记位置无效或已被占用。");
        }
        const label = cleanText(payload.label, 20);
        if (!label) throw new Error("标记名称不能为空。");
        card.faceDown = true;
        actor.characterSlots[targetIndex] = { id: crypto.randomUUID(), label, ownerId: actor.id, card };
      } else if (target === "characterDeckBottom") {
        card.faceDown = false;
        owner.characterDeck.unshift(card);
      } else if (target === "characterDeckShuffle") {
        if (located.zone !== "retired") throw new Error("只有退场区角色可以洗回角色牌堆。");
        card.faceDown = false;
        owner.characterDeck = this.shuffle([...owner.characterDeck, card]);
      } else if (target === "retired") {
        card.faceDown = false;
        owner.retired.push(card);
      } else if (target === "banished") {
        owner.banished.push(card);
      } else if (target === "characterSlot") {
        if (card.kind !== "character" || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 3) {
          throw new Error("角色位无效。");
        }
        if (owner.characterSlots[targetIndex]) throw new Error("角色位已被占用。");
        card.faceDown = Boolean(payload.faceDown);
        owner.characterSlots[targetIndex] = card;
      }
    } catch (error) {
      this.restoreCard(located);
      throw error;
    }
    if (requiresInspection) consumeInspectionGrant(this.state, inspectionId);
    const cardLabel = revealInLog ? this.cardLabel(card) : `一张${card.kind === "character" ? "角色牌" : "手牌"}`;
    const targetOwnerId = target === "opponentHand"
      ? this.state.players.find((item) => item.id !== actor.id)?.id
      : target === "hand"
        ? actor.id
        : ["retired", "banished", "characterSlot", "characterDeckBottom", "characterDeckShuffle"].includes(target)
          ? owner.id
          : undefined;
    const logTarget = {
      zone: target,
      ...(targetOwnerId ? { ownerId: targetOwnerId } : {}),
      ...(target === "characterSlot" && Number.isInteger(targetIndex) ? { slotIndex: targetIndex } : {}),
    };
    if (target === "handDiscard" && card.kind === "hand") {
      const ownerLabel = owner.id === actor.id ? "" : `${owner.nickname} 的`;
      this.addLog(`${actor.nickname} 弃置了${ownerLabel}${this.handCardLabel(card)}`, actor.id, "action", logTarget);
    } else if (target === "characterDeckBottom" && card.kind === "character") {
      this.addLog(`${actor.nickname} 休整了${this.cardLabel(card)}，置于角色牌堆底`, actor.id, "action", logTarget);
    } else if (target === "characterDeckShuffle" && card.kind === "character") {
      this.addLog(`${actor.nickname} 将${this.cardLabel(card)}从退场区洗回${owner.nickname}的角色牌堆`, actor.id, "action", logTarget);
    } else {
      this.addLog(`${actor.nickname} 将${cardLabel}从${sourceLabel}移动到${targetLabel}`, actor.id, "action", logTarget);
    }
  }

  private declareCharacterSkill(player: PlayerState, instanceId: string) {
    const located = this.locateCard(instanceId);
    if (!located || located.card.kind !== "character") throw new Error("找不到这张角色牌。");
    if (located.owner.id !== player.id) throw new Error("只能声明自己的角色技能。");
    const definition = characterById.get(located.card.definitionId);
    if (!definition) throw new Error("角色数据不存在。");
    this.addLog(
      `${player.nickname} 声明发动角色【${definition.name}】的技能【${definition.skillName}】`
      + `｜类型：角色 / ${definition.mainRole}`
      + `｜发动时机：${definition.timing}`
      + `｜消耗：${formatCharacterCost(definition.cost)}`
      + `｜效果：${definition.effectText}`,
      player.id,
      "action",
      { zone: "characterSlot", ownerId: player.id, slotIndex: located.index },
    );
    return located;
  }

  private locateCard(instanceId: string): LocatedCard | undefined {
    if (!this.state) return undefined;
    for (const player of this.state.players) {
      const playerZones: Array<[ZoneName, CardInstance[]]> = [
        ["hand", player.hand],
        ["characterDeck", player.characterDeck],
        ["retired", player.retired],
        ["banished", player.banished],
      ];
      for (const [zone, cards] of playerZones) {
        const index = cards.findIndex((card) => card.instanceId === instanceId);
        if (index >= 0) return { card: cards[index], owner: player, zone, index };
      }
      const slot = player.characterSlots.findIndex((item) => item && "instanceId" in item && item.instanceId === instanceId);
      if (slot >= 0) {
        return {
          card: player.characterSlots[slot] as CardInstance,
          owner: player,
          zone: "characterSlot",
          index: slot,
        };
      }
    }
    const commonZones: Array<[ZoneName, CardInstance[]]> = [
      ["handDeck", this.state.handDeck],
      ["handDiscard", this.state.handDiscard],
      ["resolving", this.state.resolving],
    ];
    for (const [zone, cards] of commonZones) {
      const index = cards.findIndex((card) => card.instanceId === instanceId);
      if (index >= 0) {
        const owner = this.state.players.find((player) => player.id === cards[index].ownerId) || this.state.players[0];
        return { card: cards[index], owner, zone, index };
      }
    }
    return undefined;
  }

  private removeCard(instanceId: string): LocatedCard | undefined {
    const located = this.locateCard(instanceId);
    if (!located || !this.state) return undefined;
    const { owner, zone, index } = located;
    if (zone === "characterSlot") owner.characterSlots[index] = null;
    else if (zone === "handDeck") this.state.handDeck.splice(index, 1);
    else if (zone === "handDiscard") this.state.handDiscard.splice(index, 1);
    else if (zone === "resolving") this.state.resolving.splice(index, 1);
    else (owner[zone] as CardInstance[]).splice(index, 1);
    return located;
  }

  private restoreCard(located: LocatedCard) {
    if (!this.state) return;
    const { card, owner, zone, index } = located;
    if (zone === "characterSlot") owner.characterSlots[index] = card;
    else if (zone === "handDeck") this.state.handDeck.splice(index, 0, card);
    else if (zone === "handDiscard") this.state.handDiscard.splice(index, 0, card);
    else if (zone === "resolving") this.state.resolving.splice(index, 0, card);
    else (owner[zone] as CardInstance[]).splice(index, 0, card);
  }

  private inspect(player: PlayerState, payload: Record<string, unknown>) {
    if (!this.state) throw new Error("房间不存在。");
    const instanceId = cleanText(payload.instanceId, 80);
    if (instanceId) {
      const located = this.locateCard(instanceId);
      if (!located) throw new Error("找不到这张牌。");
      if (located.owner.id !== player.id && !isPublicLocation(located)) {
        throw new Error("不能通过卡牌标识查看对手的私密卡牌。");
      }
      const grant = createInspectionGrant(this.state, player.id, [located.card], []);
      this.addLog(`${player.nickname} 查看了一张卡牌`, player.id, "inspection", {
        zone: located.zone,
        ownerId: located.owner.id,
        ...(located.zone === "characterSlot" ? { slotIndex: located.index } : {}),
      });
      return {
        inspectionId: grant.id,
        viewerId: player.id,
        title: "查看卡牌",
        cards: [this.cardView(located.card, true)],
        allowedActions: grant.allowedActions,
      };
    }
    const zone = cleanText(payload.zone, 30);
    const ownerId = cleanText(payload.ownerId, 20);
    const owner = this.state.players.find((item) => item.id === ownerId);
    if (!owner) throw new Error("目标玩家不存在。");
    if (zone === "hand") {
      const cards = owner.hand;
      const allowedActions = ["handDeckTop", "handDeckBottom", "handDiscard", "hand"] as const;
      const grant = createInspectionGrant(this.state, player.id, cards, [...allowedActions]);
      this.addLog(`${player.nickname} 查看了 ${owner.nickname} 的手牌`, player.id, "inspection", {
        zone: "hand",
        ownerId: owner.id,
      });
      return {
        inspectionId: grant.id,
        viewerId: player.id,
        title: `${owner.nickname} 的手牌`,
        cards: cards.map((card) => this.cardView(card, true)),
        allowedActions: grant.allowedActions,
      };
    }
    if (zone === "characterSlot") {
      const slotIndex = Number(payload.slotIndex);
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 3) throw new Error("角色位置无效。");
      const item = owner.characterSlots[slotIndex];
      if (!item || "label" in item) throw new Error("该位置没有可查看的角色牌。");
      const grant = createInspectionGrant(this.state, player.id, [item], []);
      this.addLog(`${player.nickname} 查看了 ${owner.nickname} 的第 ${slotIndex + 1} 个暗置角色`, player.id, "inspection", {
        zone: "characterSlot",
        ownerId: owner.id,
        slotIndex,
      });
      return {
        inspectionId: grant.id,
        viewerId: player.id,
        title: `${owner.nickname} 的第 ${slotIndex + 1} 个暗置角色`,
        cards: [this.cardView(item, true)],
        allowedActions: grant.allowedActions,
      };
    }
    throw new Error("不能查看该区域。");
  }

  private randomSelect(player: PlayerState, payload: Record<string, unknown>) {
    if (!this.state) throw new Error("房间不存在。");
    const owner = this.state.players.find((item) => item.id === cleanText(payload.ownerId, 20));
    if (!owner || owner.hand.length === 0) throw new Error("目标没有手牌。");
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const card = owner.hand[random % owner.hand.length];
    const label = this.handCardLabel(card);
    const allowedActions = ["handDeckTop", "handDeckBottom", "handDiscard", "hand"] as const;
    const grant = createInspectionGrant(this.state, player.id, [card], [...allowedActions]);
    this.addLog(`${player.nickname} 随机展示了 ${owner.nickname} 的 ${label}`, player.id, "inspection", {
      zone: "hand",
      ownerId: owner.id,
    });
    return {
      inspectionId: grant.id,
      viewerId: player.id,
      title: `${owner.nickname} 随机展示：${label}`,
      cards: [this.cardView(card, true)],
      allowedActions: grant.allowedActions,
      audience: "all" as const,
    };
  }

  private shuffleDeck(player: PlayerState, deck: string) {
    if (!this.state) return;
    if (deck === "hand") this.state.handDeck = this.shuffle(this.state.handDeck);
    else if (deck === "character") player.characterDeck = this.shuffle(player.characterDeck);
    else throw new Error("牌堆无效。");
    this.addLog(`${player.nickname} 洗混了${deck === "hand" ? "共用手牌牌堆" : "角色牌堆"}`, player.id, "action", {
      zone: deck === "hand" ? "handDeck" : "characterDeck",
      ...(deck === "character" ? { ownerId: player.id } : {}),
    });
  }

  private recycleHandDiscard(player: PlayerState) {
    if (!this.state) return;
    if (this.state.handDiscard.length === 0) throw new Error("手牌弃牌区为空。");
    const recycled = this.shuffle(this.state.handDiscard).map((card) => ({
      ...card,
      ownerId: undefined,
      faceDown: false,
    }));
    this.state.handDiscard = [];
    this.state.handDeck = [...recycled, ...this.state.handDeck];
    this.addLog(`${player.nickname} 将手牌弃牌区的 ${recycled.length} 张牌洗混并放到共用牌堆底`, player.id, "action", {
      zone: "handDeckBottom",
    });
  }

  private discardResolving(player: PlayerState) {
    if (!this.state) return;
    if (this.state.resolving.length === 0) throw new Error("结算区为空。");
    const discarded = this.state.resolving.map((card) => {
      card.faceDown = false;
      return card;
    });
    this.state.resolving = [];
    this.state.handDiscard.push(...discarded);
    this.addLog(`${player.nickname} 将结算区的 ${discarded.length} 张牌全部弃置：${discarded.map((card) => this.handCardLabel(card)).join("、")}`, player.id, "action", {
      zone: "handDiscard",
    });
  }

  private findCard(instanceId: string) {
    if (!this.state) return undefined;
    const cards = [
      ...this.state.handDeck,
      ...this.state.handDiscard,
      ...this.state.resolving,
      ...this.state.players.flatMap((player) => [
        ...(player.body ? [player.body] : []),
        ...player.hand,
        ...player.characterDeck,
        ...player.characterSlots.filter((item): item is CardInstance => !!item && "instanceId" in item),
        ...player.retired,
        ...player.banished,
      ]),
    ];
    return cards.find((card) => card.instanceId === instanceId);
  }

  private snapshotFor(playerId: string, disconnectedPlayerId?: string) {
    if (!this.state) throw new Error("房间不存在。");
    const connected = this.connectedPlayerIds();
    if (disconnectedPlayerId) connected.delete(disconnectedPlayerId);
    return {
      roomCode: this.state.roomCode,
      you: playerId,
      revision: this.state.revision,
      pendingRestart: this.state.pendingRestart,
      players: this.state.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        deckId: player.deckId,
        ...(player.id === playerId && player.deckId === CUSTOM_DECK_ID && player.customDeck ? { customDeck: player.customDeck } : {}),
        ready: player.ready,
        connected: connected.has(player.id),
        health: player.health,
        megaProgress: player.megaProgress,
        megaUsed: player.megaUsed || false,
        zMoveUsed: player.zMoveUsed || false,
        bodyFlipped: player.bodyFlipped,
        body: player.body ? this.cardView(player.body, true) : undefined,
        hand: player.id === playerId
          ? player.hand.map((card) => this.cardView(card, true))
          : player.hand.map(() => ({ ownerId: player.id, faceDown: true })),
        handCount: player.hand.length,
        characterDeckCount: player.characterDeck.length,
        characterSlots: player.characterSlots.map((item) => {
          if (!item) return item;
          if ("label" in item) {
            return {
              id: item.id,
              label: item.label,
              ownerId: item.ownerId,
              ...(item.ownerId === playerId && item.card ? { card: this.cardView(item.card, true) } : {}),
            };
          }
          if (item.ownerId !== playerId && item.faceDown) {
            return {
              ownerId: item.ownerId,
              faceDown: true,
              slotIndex: player.characterSlots.indexOf(item),
            };
          }
          return this.cardView(item, true);
        }),
        retired: player.retired.map((card) => this.cardView(card, true)),
        banished: player.banished.map((card) => this.cardView(card, card.ownerId === playerId || !card.faceDown)),
      })),
      game: {
        started: this.state.started,
        currentPlayerId: this.state.currentPlayerId,
        firstPlayerId: this.state.firstPlayerId,
        turnNumber: this.state.turnNumber,
        handDeckCount: this.state.handDeck.length,
        handDiscard: this.state.handDiscard.map((card) => this.cardView(card, true)),
        resolving: this.state.resolving.map((card) => this.cardView(card, true)),
        logs: this.state.logs,
      },
    };
  }

  private snapshotForSpectator(disconnectedPlayerId?: string) {
    if (!this.state) throw new Error("房间不存在。");
    const connected = this.connectedPlayerIds();
    if (disconnectedPlayerId) connected.delete(disconnectedPlayerId);
    return {
      roomCode: this.state.roomCode,
      you: "spectator",
      revision: this.state.revision,
      pendingRestart: this.state.pendingRestart,
      players: this.state.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        deckId: player.deckId,
        ready: player.ready,
        connected: connected.has(player.id),
        health: player.health,
        megaProgress: player.megaProgress,
        megaUsed: player.megaUsed || false,
        zMoveUsed: player.zMoveUsed || false,
        bodyFlipped: player.bodyFlipped,
        body: player.body ? this.cardView(player.body, true) : undefined,
        hand: player.hand.map(() => ({ ownerId: player.id, faceDown: true })),
        handCount: player.hand.length,
        characterDeckCount: player.characterDeck.length,
        characterSlots: player.characterSlots.map((item) => {
          if (!item) return item;
          if ("label" in item) {
            return {
              id: item.id,
              label: item.label,
              ownerId: item.ownerId,
            };
          }
          if (item.faceDown) {
            return {
              ownerId: item.ownerId,
              faceDown: true,
              slotIndex: player.characterSlots.indexOf(item),
            };
          }
          return this.cardView(item, true);
        }),
        retired: player.retired.map((card) => this.cardView(card, true)),
        banished: player.banished.map((card) => this.cardView(card, !card.faceDown)),
      })),
      game: {
        started: this.state.started,
        currentPlayerId: this.state.currentPlayerId,
        firstPlayerId: this.state.firstPlayerId,
        turnNumber: this.state.turnNumber,
        handDeckCount: this.state.handDeck.length,
        handDiscard: this.state.handDiscard.map((card) => this.cardView(card, true)),
        resolving: this.state.resolving.map((card) => this.cardView(card, true)),
        logs: this.state.logs,
      },
      isSpectator: true,
    };
  }

  private cardView(card: CardInstance, reveal: boolean) {
    return {
      instanceId: card.instanceId,
      ownerId: card.ownerId,
      faceDown: card.faceDown,
      ...(reveal ? {
        definitionId: card.definitionId,
        suit: card.suit,
        rank: card.rank,
      } : {}),
    };
  }

  private broadcast(disconnectedPlayerId?: string) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.playerId) continue;
      try {
        if (attachment.isSpectator) {
          socket.send(JSON.stringify({
            type: "snapshot",
            snapshot: this.snapshotForSpectator(disconnectedPlayerId),
          }));
        } else {
          socket.send(JSON.stringify({
            type: "snapshot",
            snapshot: this.snapshotFor(attachment.playerId, disconnectedPlayerId),
          }));
        }
      } catch {
        // A closing socket will disappear from getWebSockets on the next event.
      }
    }
  }

  private broadcastVisualEffects(effects: VisualEffectSpec[]) {
    if (!this.state || effects.length === 0) return;
    const revision = this.state.revision;
    for (const effect of effects) {
      const message = {
        type: "visualEffect",
        eventId: crypto.randomUUID(),
        revision,
        ...effect,
      };
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          // A closing socket will disappear from the next socket list.
        }
      }
    }
  }

  private turnStartEffect(player: PlayerState, actorId?: string): VisualEffectSpec {
    return {
      effect: "turnStart",
      ...(actorId ? { actorId } : {}),
      ownerId: player.id,
      ...(player.body ? { definitionId: player.body.definitionId } : {}),
    };
  }

  private sendActionAck(ws: WebSocket, actionId: string, duplicate = false) {
    ws.send(JSON.stringify({
      type: "actionAck",
      actionId,
      revision: this.state?.revision ?? 0,
      ...(duplicate ? { duplicate: true } : {}),
    }));
  }

  private sendError(
    ws: WebSocket,
    error: string,
    metadata: { actionId?: string; revision?: number; category?: string } = {},
  ) {
    ws.send(JSON.stringify({ type: "error", error, ...metadata }));
  }

  private async endRoom(player: PlayerState) {
    if (!this.state) throw new Error("房间状态不存在。");
    this.addLog(`${player.nickname} 结束了游戏`, player.id, "action", { zone: "room" });
    const sockets = this.ctx.getWebSockets();
    for (const socket of sockets) {
      try {
        socket.send(JSON.stringify({ type: "roomEnded" }));
      } catch {
        // The socket will be closed below.
      }
    }
    await this.ctx.storage.deleteAll();
    this.state = undefined;
    for (const socket of sockets) {
      try {
        socket.close(1000, "Room ended");
      } catch {
        // The peer may already have disconnected.
      }
    }
  }

  private addLog(
    text: string,
    actorId?: string,
    kind: BattleLogKind = actorId ? "action" : "system",
    target?: BattleLogTarget,
  ) {
    if (!this.state) return;
    this.state.logs.push({
      id: crypto.randomUUID(),
      text,
      at: Date.now(),
      ...(actorId ? { actorId } : {}),
      kind,
      ...(target ? { target } : {}),
    });
    this.state.logs = this.state.logs.slice(-100);
  }

  private handCardLabel(card: CardInstance) {
    const definition = handCardById.get(card.definitionId);
    const poker = card.suit && card.rank ? `${card.suit}${card.rank}` : "无点数";
    return `${poker}【${definition?.name || card.definitionId}】`;
  }

  private cardLabel(card: CardInstance) {
    if (card.kind === "hand") return this.handCardLabel(card);
    if (card.kind === "character") {
      const definition = characterById.get(card.definitionId);
      return `角色牌【${definition?.name || card.definitionId}】`;
    }
    const definition = bodyById.get(card.definitionId);
    return `本体【${definition?.name || card.definitionId}】`;
  }

  private connectedPlayerIds() {
    return new Set<string>(
      this.ctx.getWebSockets()
        .map((socket) => socket.deserializeAttachment() as SocketAttachment | null)
        .map((attachment) => attachment?.playerId)
        .filter((playerId): playerId is string => Boolean(playerId)),
    );
  }

  private errorCategory(message: string) {
    if (message.includes("状态已更新")) return "stale_revision";
    if (message.includes("授权") || message.includes("私密") || message.includes("只能")) return "permission";
    if (message.includes("不存在") || message.includes("无效")) return "invalid_state";
    return "validation";
  }

  private redactInspectionCard(card: Record<string, unknown>) {
    const { instanceId: _instanceId, ...visibleCard } = card;
    return visibleCard;
  }

  private megaMax(player: PlayerState) {
    const bodyId = player.body?.definitionId || this.playerLoadout(player)?.bodyId;
    const body = bodyById.get(bodyId || "");
    return body ? getExtraFormProgressMax(body) : undefined;
  }

  private clamp(value: unknown, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  private shuffle<T>(items: T[]) {
    const copy = [...items];
    const random = crypto.getRandomValues(new Uint32Array(copy.length));
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = random[index] % (index + 1);
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  }

  private requireStarted() {
    if (!this.state?.started) throw new Error("牌局尚未开始。");
  }

  private async persist() {
    if (!this.state) return;
    await this.ctx.storage.put("room", this.state);
    const roomExpiry = this.state.lastActivityAt + ROOM_TTL_MS;
    const nextAlarm = this.state.pendingRestart
      ? Math.min(roomExpiry, this.state.pendingRestart.expiresAt)
      : roomExpiry;
    await this.ctx.storage.setAlarm(nextAlarm);
  }
}
