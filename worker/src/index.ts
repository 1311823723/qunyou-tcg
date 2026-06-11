import { DurableObject } from "cloudflare:workers";
import bodies from "../../data/cards/bodies.json";
import handCards from "../../data/cards/hand_cards.json";
import decks from "../../data/decks/aggro.deck.json";
import mizaiDeck from "../../data/decks/mizai.deck.json";
import comboDeck from "../../data/decks/combo.deck.json";
import transDeck from "../../data/decks/trans.deck.json";

interface Env {
  BATTLE_ROOMS: DurableObjectNamespace<BattleRoom>;
  ALLOWED_ORIGIN?: string;
}

type CardKind = "body" | "character" | "hand";
type ZoneName =
  | "hand"
  | "characterHand"
  | "characterDeck"
  | "retired"
  | "banished"
  | "body"
  | "handDeck"
  | "handDiscard"
  | "resolving"
  | "characterSlot";

interface CardInstance {
  instanceId: string;
  definitionId: string;
  kind: CardKind;
  ownerId?: string;
  faceDown?: boolean;
  suit?: string;
  rank?: string;
}

interface Marker {
  id: string;
  label: string;
  ownerId: string;
  card?: CardInstance;
}

interface PlayerState {
  id: string;
  token: string;
  nickname: string;
  deckId?: string;
  ready: boolean;
  health: number;
  megaProgress: number;
  bodyFlipped: boolean;
  body?: CardInstance;
  hand: CardInstance[];
  characterHand: CardInstance[];
  characterDeck: CardInstance[];
  characterSlots: Array<CardInstance | Marker | null>;
  retired: CardInstance[];
  banished: CardInstance[];
}

interface LogEntry {
  id: string;
  text: string;
  at: number;
}

interface RoomState {
  roomCode: string;
  createdAt: number;
  lastActivityAt: number;
  started: boolean;
  players: PlayerState[];
  handDeck: CardInstance[];
  handDiscard: CardInstance[];
  resolving: CardInstance[];
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  logs: LogEntry[];
  processedActionIds: string[];
}

interface SocketAttachment {
  playerId: string;
}

interface ClientMessage {
  type: string;
  actionId: string;
  payload?: Record<string, unknown>;
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const allDecks = [decks, mizaiDeck, comboDeck, transDeck];
const deckById = new Map(allDecks.map((deck) => [deck.id, deck]));
const bodyById = new Map(bodies.map((body) => [body.id, body]));

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin") || "";
  const allowed = env.ALLOWED_ORIGIN || origin || "*";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    if (request.method === "POST" && url.pathname === "/rooms") {
      const body = await request.json() as Record<string, unknown>;
      const nickname = cleanText(body.nickname, 20);
      const token = cleanText(body.token, 80);
      const deckId = cleanText(body.deckId, 80);
      if (!nickname || !token || !deckById.has(deckId)) {
        return json({ error: "昵称、身份令牌或预组无效。" }, { status: 400, headers });
      }
      const code = roomCode();
      const stub = env.BATTLE_ROOMS.getByName(code);
      const result = await stub.createRoom(code, token, nickname, deckId);
      return json(result, { headers });
    }

    const joinMatch = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/join$/);
    if (request.method === "POST" && joinMatch) {
      const body = await request.json() as Record<string, unknown>;
      const nickname = cleanText(body.nickname, 20);
      const token = cleanText(body.token, 80);
      const deckId = cleanText(body.deckId, 80);
      if (!nickname || !token || !deckById.has(deckId)) {
        return json({ error: "昵称、身份令牌或预组无效。" }, { status: 400, headers });
      }
      const stub = env.BATTLE_ROOMS.getByName(joinMatch[1]);
      const result = await stub.joinRoom(token, nickname, deckId);
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
    });
  }

  async createRoom(code: string, token: string, nickname: string, deckId: string) {
    if (this.state) return { roomCode: this.state.roomCode };
    const now = Date.now();
    this.state = {
      roomCode: code,
      createdAt: now,
      lastActivityAt: now,
      started: false,
      players: [this.newPlayer("p1", token, nickname, deckId)],
      handDeck: [],
      handDiscard: [],
      resolving: [],
      turnNumber: 0,
      logs: [{ id: crypto.randomUUID(), text: `${nickname} 创建了房间`, at: now }],
      processedActionIds: [],
    };
    await this.persist();
    return { roomCode: code };
  }

  async joinRoom(token: string, nickname: string, deckId: string) {
    if (!this.state) {
      return { status: 404, body: { error: "房间不存在或已经过期。" } };
    }
    let player = this.state.players.find((item) => item.token === token);
    if (!player) {
      if (this.state.players.length >= 2) {
        return { status: 409, body: { error: "房间已满，无法加入。" } };
      }
      player = this.newPlayer("p2", token, nickname, deckId);
      this.state.players.push(player);
      this.addLog(`${nickname} 加入了房间`);
      await this.persist();
    }
    return { status: 200, body: { ok: true, playerId: player.id } };
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return json({ error: "房间不存在或已经过期。" }, { status: 404 });
    const url = new URL(request.url);
    const token = cleanText(url.searchParams.get("token"), 80);
    const player = this.state.players.find((item) => item.token === token);
    if (!player) return json({ error: "请先通过加入页面进入房间。" }, { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: player.id } satisfies SocketAttachment);
    this.state.lastActivityAt = Date.now();
    await this.persist();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.state || typeof raw !== "string") return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    const player = this.state.players.find((item) => item.id === attachment?.playerId);
    if (!player) return this.sendError(ws, "座位身份无效。");

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.sendError(ws, "消息格式无效。");
    }
    console.log("[worker] received", { type: message.type, actionId: message.actionId, payload: message.payload });
    if (!message.actionId || this.state.processedActionIds.includes(message.actionId)) {
      console.log("[worker] skipped", { hasActionId: !!message.actionId, isDuplicate: this.state.processedActionIds.includes(message.actionId) });
      return;
    }

    try {
      const inspection = this.applyAction(player, message);
      // room:end 已在 applyAction 中完成所有清理与通知，无需后续处理
      if (message.type === "room:end") return;
      this.state.processedActionIds.push(message.actionId);
      this.state.processedActionIds = this.state.processedActionIds.slice(-100);
      this.state.lastActivityAt = Date.now();
      await this.persist();
      if (inspection) ws.send(JSON.stringify({ type: "inspection", ...inspection }));
      this.broadcast();
    } catch (error) {
      this.sendError(ws, error instanceof Error ? error.message : "操作失败。");
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
    this.broadcast();
  }

  async alarm() {
    if (!this.state) return;
    if (Date.now() - this.state.lastActivityAt >= ROOM_TTL_MS && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      this.state = undefined;
      return;
    }
    await this.ctx.storage.setAlarm(this.state.lastActivityAt + ROOM_TTL_MS);
  }

  private newPlayer(id: string, token: string, nickname: string, deckId: string): PlayerState {
    return {
      id,
      token,
      nickname,
      deckId,
      ready: false,
      health: 7,
      megaProgress: 0,
      bodyFlipped: false,
      hand: [],
      characterHand: [],
      characterDeck: [],
      characterSlots: [null, null, null, null],
      retired: [],
      banished: [],
    };
  }

  private applyAction(player: PlayerState, message: ClientMessage) {
    if (!this.state) throw new Error("房间状态不存在。");
    const payload = message.payload || {};

    switch (message.type) {
      case "player:selectDeck": {
        if (this.state.started || player.ready) throw new Error("当前不能更换预组。");
        const deckId = cleanText(payload.deckId, 80);
        if (!deckById.has(deckId)) throw new Error("预组不存在。");
        player.deckId = deckId;
        this.addLog(`${player.nickname} 选择了预组`);
        return;
      }
      case "player:ready": {
        if (this.state.started) throw new Error("牌局已经开始。");
        player.ready = Boolean(payload.ready);
        this.addLog(`${player.nickname}${player.ready ? "已准备" : "取消准备"}`);
        if (this.state.players.length === 2 && this.state.players.every((item) => item.ready && item.deckId)) {
          this.startGame();
        }
        return;
      }
      case "card:draw":
        this.requireStarted();
        this.draw(player, cleanText(payload.deck, 20), this.clamp(payload.count, 1, 10));
        return;
      case "card:move":
        this.requireStarted();
        this.moveCard(player, payload);
        return;
      case "card:flip": {
        const card = this.findCard(cleanText(payload.instanceId, 80));
        if (!card || card.kind !== "character" || card.ownerId !== player.id) throw new Error("只能翻转自己的角色。");
        card.faceDown = !card.faceDown;
        this.addLog(`${player.nickname} ${card.faceDown ? "暗置" : "明置"}了一张角色`);
        return;
      }
      case "card:inspect":
        return this.inspect(player, payload);
      case "hand:randomSelect":
        return this.randomSelect(player, payload);
      case "deck:shuffle":
        this.shuffleDeck(player, cleanText(payload.deck, 30));
        return;
      case "body:flip":
        player.bodyFlipped = !player.bodyFlipped;
        this.addLog(`${player.nickname} 将本体翻至${player.bodyFlipped ? "额外形态" : "正面"}`);
        return;
      case "health:set": {
        player.health = this.clamp(payload.value, 0, 99);
        this.addLog(`${player.nickname} 将体力调整为 ${player.health}`);
        return;
      }
      case "megaProgress:set": {
        const max = this.megaMax(player);
        player.megaProgress = this.clamp(payload.value, 0, max ?? 99);
        this.addLog(`${player.nickname} 将 Mega 能量调整为 ${player.megaProgress}${max ? `/${max}` : ""}`);
        return;
      }
      case "marker:create": {
        const index = this.clamp(payload.slotIndex, 0, 3);
        if (player.characterSlots[index]) throw new Error("该角色位已经被占用。");
        const label = cleanText(payload.label, 20);
        if (!label) throw new Error("标记名称不能为空。");
        player.characterSlots[index] = { id: crypto.randomUUID(), label, ownerId: player.id };
        this.addLog(`${player.nickname} 创建了「${label}」标记`);
        return;
      }
      case "marker:remove": {
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
            this.addLog(`${player.nickname} 移除了「${marker.label}」标记`);
            return;
          }
        }
        throw new Error("标记不存在。");
      }
      case "turn:end": {
        const opponent = this.state.players.find((item) => item.id !== this.state?.currentPlayerId);
        if (!opponent) throw new Error("对手尚未加入。");
        this.state.currentPlayerId = opponent.id;
        this.state.turnNumber += 1;
        this.addLog(`${player.nickname} 结束了回合`);
        return;
      }
      case "room:end": {
        this.addLog(`${player.nickname} 结束了游戏，房间即将销毁`);
        // 通知所有客户端
        for (const socket of this.ctx.getWebSockets()) {
          try { socket.send(JSON.stringify({ type: "roomEnded" })); } catch { /* closing */ }
        }
        // 关闭所有连接
        for (const socket of this.ctx.getWebSockets()) {
          try { socket.close(1000, "Room ended"); } catch { /* closing */ }
        }
        // 清空房间数据（后台执行，无需等待）
        this.ctx.storage.deleteAll().catch(() => {});
        this.state = undefined;
        return;
      }
      default:
        throw new Error("暂不支持这个操作。");
    }
  }

  private startGame() {
    if (!this.state) return;
    this.state.handDeck = this.shuffle(handCards.flatMap((definition) =>
      definition.cards.map((entry) => ({
        instanceId: crypto.randomUUID(),
        definitionId: definition.id,
        kind: "hand" as const,
        suit: entry.suit,
        rank: entry.rank,
      })),
    ));
    for (const player of this.state.players) {
      const deck = deckById.get(player.deckId || "");
      if (!deck) throw new Error("预组数据不存在。");
      const body = bodyById.get(deck.bodyId);
      player.health = body?.hp || 7;
      player.megaProgress = 0;
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
      player.characterHand = [];
      player.characterSlots = [null, null, null, null];
      player.retired = [];
      player.banished = [];
      this.draw(player, "hand", 5, false);
      this.draw(player, "character", 4, false);
    }
    const first = this.state.players[crypto.getRandomValues(new Uint8Array(1))[0] % 2];
    this.state.started = true;
    this.state.firstPlayerId = first.id;
    this.state.currentPlayerId = first.id;
    this.state.turnNumber = 1;
    this.addLog(`牌局开始，${first.nickname} 为先手`);
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
      if (log) this.addLog(`${player.nickname} 摸了 ${count} 张手牌`);
    } else if (deck === "character") {
      for (let index = 0; index < count; index += 1) {
        const card = player.characterDeck.pop();
        if (!card) break;
        player.characterHand.push(card);
      }
      if (log) this.addLog(`${player.nickname} 摸了 ${count} 张角色牌`);
    } else {
      throw new Error("牌堆无效。");
    }
  }

  private moveCard(actor: PlayerState, payload: Record<string, unknown>) {
    if (!this.state) return;
    const instanceId = cleanText(payload.instanceId, 80);
    const located = this.removeCard(instanceId);
    if (!located) throw new Error("找不到这张牌。");
    const { card, owner } = located;
    const target = cleanText(payload.targetZone, 40);
    const publicSource = ["handDiscard", "resolving", "retired", "banished"].includes(located.zone);
    const publicTarget = ["handDeckTop", "handDeckBottom", "handDiscard", "resolving", "hand"].includes(target);
    if (card.ownerId && card.ownerId !== actor.id && !publicSource && !publicTarget) {
      this.restoreCard(located);
      throw new Error("不能移动对手的私密卡牌。");
    }
    const targetIndex = Number(payload.targetIndex);

    try {
      if (target === "resolving") this.state.resolving.push(card);
      else if (target === "handDiscard") this.state.handDiscard.push(card);
      else if (target === "handDeckTop") {
        card.ownerId = undefined;
        this.state.handDeck.push(card);
      } else if (target === "handDeckBottom") {
        card.ownerId = undefined;
        this.state.handDeck.unshift(card);
      } else if (target === "opponentHand") {
        const opponent = this.state.players.find((item) => item.id !== actor.id);
        if (!opponent || card.kind !== "hand") throw new Error("不能交给对手。");
        card.ownerId = opponent.id;
        opponent.hand.push(card);
      } else if (target === "hand") {
        if (card.kind !== "hand") throw new Error("只有手牌能加入手牌区。");
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
      } else if (target === "characterHand") {
        card.faceDown = false;
        owner.characterHand.push(card);
      } else if (target === "characterDeckBottom") {
        card.faceDown = false;
        owner.characterDeck.unshift(card);
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
      } else {
        throw new Error("目标区域无效。");
      }
    } catch (error) {
      this.restoreCard(located);
      throw error;
    }
    this.addLog(`${actor.nickname} 移动了一张${card.kind === "character" ? "角色牌" : "手牌"}`);
  }

  private removeCard(instanceId: string) {
    if (!this.state) return undefined;
    for (const player of this.state.players) {
      const playerZones: Array<[ZoneName, CardInstance[]]> = [
        ["hand", player.hand],
        ["characterHand", player.characterHand],
        ["characterDeck", player.characterDeck],
        ["retired", player.retired],
        ["banished", player.banished],
      ];
      for (const [zone, cards] of playerZones) {
        const index = cards.findIndex((card) => card.instanceId === instanceId);
        if (index >= 0) return { card: cards.splice(index, 1)[0], owner: player, zone, index };
      }
      const slot = player.characterSlots.findIndex((item) => item && "instanceId" in item && item.instanceId === instanceId);
      if (slot >= 0) {
        const card = player.characterSlots[slot] as CardInstance;
        player.characterSlots[slot] = null;
        return { card, owner: player, zone: "characterSlot" as ZoneName, index: slot };
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
        return { card: cards.splice(index, 1)[0], owner, zone, index };
      }
    }
    return undefined;
  }

  private restoreCard(located: { card: CardInstance; owner: PlayerState; zone: ZoneName; index: number }) {
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
      const card = this.findCard(instanceId);
      if (!card) throw new Error("找不到这张牌。");
      // 暗置角色位查看：记录具体位置
      let slotLabel = "";
      for (const owner of this.state.players) {
        const slotIndex = owner.characterSlots.findIndex(
          (item) => item && "instanceId" in item && item.instanceId === instanceId
        );
        if (slotIndex >= 0) {
          slotLabel = `${owner.nickname} 的第${slotIndex + 1}个暗置角色`;
          break;
        }
      }
      this.addLog(`${player.nickname} 查看了${slotLabel || "一张卡牌"}`);
      return { title: slotLabel || "查看卡牌", cards: [this.cardView(card, true)] };
    }
    const zone = cleanText(payload.zone, 30);
    const ownerId = cleanText(payload.ownerId, 20);
    const owner = this.state.players.find((item) => item.id === ownerId);
    if (!owner) throw new Error("目标玩家不存在。");
    if (zone === "hand") {
      const cards = owner.hand;
      this.addLog(`${player.nickname} 查看了 ${owner.nickname} 的手牌`);
      return { title: `${owner.nickname} 的手牌`, cards: cards.map((card) => this.cardView(card, true)) };
    }
    throw new Error("不能查看该区域。");
  }

  private randomSelect(player: PlayerState, payload: Record<string, unknown>) {
    if (!this.state) throw new Error("房间不存在。");
    const owner = this.state.players.find((item) => item.id === cleanText(payload.ownerId, 20));
    if (!owner || owner.hand.length === 0) throw new Error("目标没有手牌。");
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const card = owner.hand[random % owner.hand.length];
    this.addLog(`${player.nickname} 随机展示了 ${owner.nickname} 的一张手牌`);
    return { title: "随机展示手牌", cards: [this.cardView(card, true)] };
  }

  private shuffleDeck(player: PlayerState, deck: string) {
    if (!this.state) return;
    if (deck === "hand") this.state.handDeck = this.shuffle(this.state.handDeck);
    else if (deck === "character") player.characterDeck = this.shuffle(player.characterDeck);
    else throw new Error("牌堆无效。");
    this.addLog(`${player.nickname} 洗混了${deck === "hand" ? "共用手牌牌堆" : "角色牌堆"}`);
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
        ...player.characterHand,
        ...player.characterDeck,
        ...player.characterSlots.filter((item): item is CardInstance => !!item && "instanceId" in item),
        ...player.retired,
        ...player.banished,
      ]),
    ];
    return cards.find((card) => card.instanceId === instanceId);
  }

  private snapshotFor(playerId: string) {
    if (!this.state) throw new Error("房间不存在。");
    const connected = new Set(
      this.ctx.getWebSockets()
        .map((socket) => socket.deserializeAttachment() as SocketAttachment | null)
        .map((attachment) => attachment?.playerId)
        .filter(Boolean),
    );
    return {
      roomCode: this.state.roomCode,
      you: playerId,
      players: this.state.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        deckId: player.deckId,
        ready: player.ready,
        connected: connected.has(player.id),
        health: player.health,
        megaProgress: player.megaProgress,
        bodyFlipped: player.bodyFlipped,
        body: player.body ? this.cardView(player.body, true) : undefined,
        hand: player.hand.map((card) => this.cardView(card, card.ownerId === playerId)),
        characterHand: player.characterHand.map((card) => this.cardView(card, card.ownerId === playerId)),
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
          return this.cardView(item, item.ownerId === playerId || !item.faceDown);
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

  private broadcast() {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment?.playerId) continue;
      try {
        socket.send(JSON.stringify({ type: "snapshot", snapshot: this.snapshotFor(attachment.playerId) }));
      } catch {
        // A closing socket will disappear from getWebSockets on the next event.
      }
    }
  }

  private sendError(ws: WebSocket, error: string) {
    ws.send(JSON.stringify({ type: "error", error }));
  }

  private addLog(text: string) {
    if (!this.state) return;
    this.state.logs.push({ id: crypto.randomUUID(), text, at: Date.now() });
    this.state.logs = this.state.logs.slice(-100);
  }

  private megaMax(player: PlayerState) {
    const deck = deckById.get(player.deckId || "");
    const body = bodyById.get(deck?.bodyId || "");
    const match = body?.extraForm?.condition.match(/累计[^\d]{0,24}(\d+)\s*(?:点|次|张)/);
    return match ? Number(match[1]) : undefined;
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
    await this.ctx.storage.setAlarm(this.state.lastActivityAt + ROOM_TTL_MS);
  }
}
