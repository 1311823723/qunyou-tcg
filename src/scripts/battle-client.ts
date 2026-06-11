import { getBattleApiUrl } from "../lib/battle-api";

type CatalogCard = {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  art?: string;
  extraArt?: string;
  extraName?: string;
  megaMax?: number;
};

type Catalog = {
  cards: Record<string, CatalogCard>;
  decks: Array<{ id: string; name: string; archetype: string; bodyId: string }>;
};

type CardView = {
  instanceId: string;
  definitionId?: string;
  ownerId?: string;
  faceDown?: boolean;
  revealed?: boolean;
  suit?: string;
  rank?: string;
};

type MarkerView = { id: string; label: string; ownerId: string };

type PlayerView = {
  id: string;
  nickname: string;
  deckId?: string;
  ready: boolean;
  connected: boolean;
  health?: number;
  megaProgress?: number;
  bodyFlipped?: boolean;
  body?: CardView;
  hand: CardView[];
  characterHand: CardView[];
  characterDeckCount: number;
  characterSlots: Array<CardView | MarkerView | null>;
  retired: CardView[];
  banished: CardView[];
};

type GameView = {
  started: boolean;
  currentPlayerId?: string;
  firstPlayerId?: string;
  turnNumber: number;
  handDeckCount: number;
  handDiscard: CardView[];
  resolving: CardView[];
  logs: Array<{ id: string; text: string; at: number }>;
};

type Snapshot = {
  roomCode: string;
  you: string;
  players: PlayerView[];
  game: GameView;
  inspection?: { title: string; cards: CardView[] };
};

type ServerMessage =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "error"; error: string }
  | { type: "inspection"; title: string; cards: CardView[] };

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Battle table element missing: ${selector}`);
  return element;
}

requiredElement<HTMLElement>("#battle-app");
const root = requiredElement<HTMLElement>("#battle-root");
const status = requiredElement<HTMLElement>("#battle-connection");
const roomLabel = requiredElement<HTMLElement>("#battle-room-code");
const dialog = requiredElement<HTMLDialogElement>("#battle-dialog");
const dialogContent = requiredElement<HTMLElement>("#battle-dialog-content");
const catalogNode = requiredElement<HTMLScriptElement>("#battle-catalog");
const catalog = JSON.parse(catalogNode.textContent || "{}") as Catalog;

const API_URL = getBattleApiUrl();
const TOKEN_KEY = "qunyou-battle-token-v1";
const PENDING_KEY = "qunyou-battle-pending-v1";
const roomCode = getRoomCode();
let snapshot: Snapshot | undefined;
let socket: WebSocket | undefined;
let reconnectTimer = 0;
let reconnectDelay = 800;
let hasConnected = false;
let connectionAttempt = 0;

roomLabel.textContent = `房间 ${roomCode}`;

document.querySelector("#battle-copy-link")?.addEventListener("click", async () => {
  const inviteUrl = new URL("/play", location.origin);
  inviteUrl.searchParams.set("room", roomCode);
  await navigator.clipboard.writeText(inviteUrl.toString());
  const button = document.querySelector<HTMLButtonElement>("#battle-copy-link");
  if (button) {
    button.textContent = "已复制";
    window.setTimeout(() => (button.textContent = "复制邀请链接"), 1400);
  }
});

function getRoomCode() {
  const parts = location.pathname.split("/").filter(Boolean);
  const last = parts.at(-1);
  const query = new URLSearchParams(location.search).get("code");
  return (last === "room" ? query : last)?.toUpperCase() || "";
}

function getToken() {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) return saved;
  const created = crypto.randomUUID();
  localStorage.setItem(TOKEN_KEY, created);
  return created;
}

function getPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") as { nickname?: string; deckId?: string };
  } catch {
    return {};
  }
}

async function connect() {
  const attempt = ++connectionAttempt;
  if (!roomCode || roomCode.length !== 6) {
    renderFatal("房间码无效，请返回对战首页重新进入。");
    return;
  }
  const pending = getPending();
  if (!pending.nickname) {
    const joinUrl = new URL("/play", location.origin);
    joinUrl.searchParams.set("room", roomCode);
    location.replace(joinUrl);
    return;
  }
  window.clearTimeout(reconnectTimer);
  status.textContent = "连接中";
  status.dataset.state = "connecting";
  if (!snapshot) renderConnecting("正在确认房间与玩家座位。");
  const token = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        nickname: pending.nickname,
        deckId: pending.deckId,
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || `加入房间失败（${response.status}）`);
  } catch (error) {
    window.clearTimeout(timeout);
    if (attempt !== connectionAttempt) return;
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "连接对战服务器超时。当前网络可能无法访问 workers.dev，或 WebSocket 被代理、防火墙拦截。"
      : error instanceof TypeError
        ? "无法连接对战服务器。请检查网络是否能访问 workers.dev，必要时切换网络或代理后重试。"
        : error instanceof Error ? error.message : "加入房间失败。";
    renderConnectionError(message);
    return;
  }
  window.clearTimeout(timeout);
  if (attempt !== connectionAttempt) return;

  const wsBase = API_URL.replace(/^http/, "ws");
  const url = new URL(`${wsBase}/rooms/${roomCode}/connect`);
  url.searchParams.set("token", token);
  socket = new WebSocket(url);
  let socketFailureHandled = false;
  const socketTimeout = window.setTimeout(() => {
    if (attempt === connectionAttempt && socket?.readyState === WebSocket.CONNECTING) {
      socketFailureHandled = true;
      socket.close();
      renderConnectionError("牌桌实时连接超时。网页可以访问，但当前网络可能拦截了 WebSocket；请切换网络或代理后重试。");
    }
  }, 10000);

  socket.addEventListener("open", () => {
    window.clearTimeout(socketTimeout);
    hasConnected = true;
    reconnectDelay = 800;
    status.textContent = "已连接";
    status.dataset.state = "open";
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "snapshot") {
      snapshot = message.snapshot;
      render();
    } else if (message.type === "inspection") {
      showInspection(message.title, message.cards);
    } else {
      showError(message.error);
    }
  });
  socket.addEventListener("close", () => {
    window.clearTimeout(socketTimeout);
    if (attempt !== connectionAttempt) return;
    if (socketFailureHandled) return;
    if (!hasConnected) {
      renderConnectionError("实时连接被拒绝或中断。请确认房间仍存在，并检查当前网络是否允许 WebSocket 连接。");
      return;
    }
    status.textContent = "重连中";
    status.dataset.state = "closed";
    reconnectTimer = window.setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
  });
  socket.addEventListener("error", () => socket?.close());
}

function renderConnecting(message: string) {
  root.innerHTML = `<section class="battle-loading hud-panel">
    <span class="battle-kicker">连接牌桌</span>
    <h1>房间 ${escapeHtml(roomCode)}</h1>
    <p>${escapeHtml(message)}</p>
  </section>`;
}

function renderConnectionError(message: string) {
  status.textContent = "连接失败";
  status.dataset.state = "failed";
  root.innerHTML = `<section class="battle-loading battle-loading--error hud-panel">
    <span class="battle-kicker">未能进入房间 ${escapeHtml(roomCode)}</span>
    <h1>连接失败</h1>
    <p>${escapeHtml(message)}</p>
    <div class="battle-loading__actions">
      <button type="button" class="btn btn--primary" id="battle-retry">重新连接</button>
      <a class="btn btn--secondary" href="/play?room=${encodeURIComponent(roomCode)}">返回加入页面</a>
    </div>
  </section>`;
  document.querySelector("#battle-retry")?.addEventListener("click", () => {
    hasConnected = false;
    connect();
  });
}

function send(type: string, payload: Record<string, unknown> = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    showError("连接尚未恢复，请稍后再试。");
    return;
  }
  socket.send(JSON.stringify({ type, actionId: crypto.randomUUID(), payload }));
}

function render() {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = snapshot.players.find((player) => player.id !== snapshot?.you);
  if (!me) {
    renderFatal("未能认回你的座位。");
    return;
  }
  if (!snapshot.game.started) {
    renderLobby(me, opponent);
    return;
  }

  root.innerHTML = `
    <div class="battle-table">
      ${opponent ? renderPlayer(opponent, false) : renderWaitingSeat()}
      ${renderCenter(snapshot.game, me, opponent)}
      ${renderPlayer(me, true)}
    </div>
  `;
  bindActions();
}

function renderLobby(me: PlayerView, opponent?: PlayerView) {
  root.innerHTML = `
    <section class="battle-lobby hud-panel">
      <div class="battle-lobby__heading">
        <div><span class="battle-kicker">准备大厅</span><h1>${escapeHtml(snapshot?.roomCode || "")}</h1></div>
        <p>双方选择预组并准备后，服务器自动洗牌、发牌并随机先手。</p>
      </div>
      <div class="battle-lobby__seats">
        ${renderLobbySeat(me, true)}
        ${opponent ? renderLobbySeat(opponent, false) : `<article class="battle-seat battle-seat--empty"><strong>等待对手</strong><p>发送房间链接或房间码。</p></article>`}
      </div>
      <div class="battle-lobby__controls">
        <label>我的预组
          <select id="battle-deck-select" ${me.ready ? "disabled" : ""}>
            ${catalog.decks.map((deck) => `<option value="${deck.id}" ${deck.id === me.deckId ? "selected" : ""}>${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}</option>`).join("")}
          </select>
        </label>
        <button class="btn ${me.ready ? "btn--secondary" : "btn--primary"}" data-command="player:ready" data-ready="${String(!me.ready)}">
          ${me.ready ? "取消准备" : "准备开局"}
        </button>
      </div>
    </section>
  `;
  document.querySelector("#battle-deck-select")?.addEventListener("change", (event) => {
    send("player:selectDeck", { deckId: (event.currentTarget as HTMLSelectElement).value });
  });
  bindActions();
}

function renderLobbySeat(player: PlayerView, isMe: boolean) {
  const deck = catalog.decks.find((item) => item.id === player.deckId);
  return `<article class="battle-seat ${player.ready ? "is-ready" : ""}">
    <span>${isMe ? "你的座位" : "对手座位"} · ${player.connected ? "在线" : "离线"}</span>
    <strong>${escapeHtml(player.nickname)}</strong>
    <p>${deck ? `${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}` : "尚未选择预组"}</p>
    <em>${player.ready ? "已准备" : "未准备"}</em>
  </article>`;
}

function renderPlayer(player: PlayerView, isMe: boolean) {
  const body = cardDefinition(player.body);
  const max = body?.megaMax;
  const megaText = max ? `${player.megaProgress || 0}/${max}` : String(player.megaProgress || 0);
  return `
    <section class="battle-player ${isMe ? "battle-player--self" : "battle-player--opponent"}">
      <header class="battle-player__header">
        <div><span>${isMe ? "你" : "对手"} · ${player.connected ? "在线" : "离线"}</span><strong>${escapeHtml(player.nickname)}</strong></div>
        <div class="battle-counters">
          ${renderCounter("体力", player.health || 0, "health:set", player.id, isMe)}
          ${renderCounter("Mega", megaText, "megaProgress:set", player.id, isMe, max)}
        </div>
      </header>
      <div class="battle-player__field">
        <div class="battle-body-zone">
          ${renderCard(player.body, { owner: player, zone: "body", interactive: isMe, flipped: player.bodyFlipped })}
          ${isMe ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
        </div>
        <div class="battle-character-slots">
          ${player.characterSlots.map((item, index) => renderSlot(item, index, player, isMe)).join("")}
        </div>
        <div class="battle-side-zones">
          ${renderPile("角色牌堆", player.characterDeckCount, isMe ? "card:draw-character" : "", "摸角色")}
          ${renderZone("退场区", player.retired, player, "retired", isMe)}
          ${renderZone("移出游戏", player.banished, player, "banished", isMe)}
        </div>
      </div>
      <div class="battle-private-rail">
        <div class="battle-private-rail__title">
          <strong>${isMe ? "角色手牌" : "对手角色手牌"}</strong><span>${player.characterHand.length} 张</span>
        </div>
        <div class="battle-card-row">${player.characterHand.map((card) => renderCard(card, { owner: player, zone: "characterHand", interactive: isMe })).join("")}</div>
      </div>
      <div class="battle-private-rail battle-private-rail--hand">
        <div class="battle-private-rail__title">
          <strong>${isMe ? "我的手牌" : "对手手牌"}</strong>
          <span>${player.hand.length} 张</span>
          ${!isMe ? `<button class="battle-small-btn" data-command="card:inspect-zone" data-owner="${player.id}" data-zone="hand">查看手牌</button>` : ""}
        </div>
        <div class="battle-card-row">${player.hand.map((card) => renderCard(card, { owner: player, zone: "hand", interactive: isMe })).join("")}</div>
      </div>
    </section>
  `;
}

function renderCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number) {
  const numeric = typeof value === "number" ? value : Number(String(value).split("/")[0]);
  const ready = label === "Mega" && max !== undefined && numeric >= max;
  return `<div class="battle-counter ${ready ? "is-ready" : ""}">
    <span>${label}</span><strong>${value}</strong>
    ${editable ? `<div>
      <button data-command="${command}" data-value="${numeric - 1}" aria-label="${label}减一">−</button>
      <button data-command="${command}" data-value="${numeric + 1}" aria-label="${label}加一">＋</button>
      <button data-counter-set="${command}" data-player="${playerId}" data-current="${numeric}">设置</button>
    </div>` : ""}
  </div>`;
}

function renderCenter(game: GameView, me: PlayerView, opponent?: PlayerView) {
  const current = snapshot?.players.find((player) => player.id === game.currentPlayerId);
  return `<section class="battle-center">
    <div class="battle-turnbar">
      <span>第 ${game.turnNumber} 回合</span>
      <strong>${current ? `${escapeHtml(current.nickname)} 的回合` : "等待开始"}</strong>
      <button class="battle-small-btn" data-command="turn:end">结束回合</button>
    </div>
    <div class="battle-common-zones">
      ${renderPile("共用牌堆", game.handDeckCount, "card:draw-hand", "摸 1 张")}
      ${renderZone("结算区", game.resolving, me, "resolving", true)}
      ${renderZone("手牌弃牌区", game.handDiscard, me, "handDiscard", true)}
    </div>
    <div class="battle-toolbar">
      <button data-command="deck:shuffle" data-deck="hand">洗混共用牌堆</button>
      <button data-command="card:inspect-deck" data-count="3">查看牌堆顶 3 张</button>
      <button data-command="hand:randomSelect" data-owner="${opponent?.id || ""}">随机展示对手手牌</button>
      <button data-command="card:inspect-zone" data-owner="${opponent?.id || ""}" data-zone="characterSlots">查看对手暗置角色</button>
      <button data-command="marker:create">创建标记</button>
    </div>
    <details class="battle-log">
      <summary>操作日志 · ${game.logs.length}</summary>
      <ol>${game.logs.slice(-30).reverse().map((log) => `<li><time>${new Date(log.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>${escapeHtml(log.text)}</li>`).join("")}</ol>
    </details>
  </section>`;
}

function renderWaitingSeat() {
  return `<section class="battle-player battle-player--opponent battle-player--waiting"><strong>等待对手重新连接</strong></section>`;
}

function renderPile(title: string, count: number, command: string, action: string) {
  const dropTarget = title === "共用牌堆" ? ` data-drop-target="handDeckTop"` : "";
  return `<article class="battle-pile"${dropTarget}>
    <div class="battle-card-back"><span>群友杀</span></div>
    <strong>${title}</strong><span>${count} 张</span>
    ${command ? `<button class="battle-small-btn" data-command="${command}">${action}</button>` : ""}
  </article>`;
}

function renderZone(title: string, cards: CardView[], owner: PlayerView, zone: string, interactive: boolean) {
  return `<article class="battle-zone" data-drop-target="${zone}">
    <header><strong>${title}</strong><span>${cards.length}</span></header>
    <div class="battle-zone__cards">${cards.slice(-5).map((card) => renderCard(card, { owner, zone, interactive })).join("")}</div>
  </article>`;
}

function renderSlot(item: CardView | MarkerView | null, index: number, owner: PlayerView, isMe: boolean) {
  if (!item) return `<article class="battle-slot" data-drop-target="characterSlot:${index}"><span>角色位 ${index + 1}</span></article>`;
  if ("label" in item) {
    return `<article class="battle-slot battle-slot--marker"><button data-marker="${item.id}">${escapeHtml(item.label)}</button></article>`;
  }
  return `<article class="battle-slot">${renderCard(item, { owner, zone: `slot:${index}`, interactive: isMe || !item.faceDown })}</article>`;
}

function renderCard(
  card: CardView | undefined,
  options: { owner: PlayerView; zone: string; interactive: boolean; flipped?: boolean },
) {
  if (!card) return "";
  const definition = cardDefinition(card);
  if (!definition) {
    return `<button class="battle-mini-card battle-mini-card--back" data-card="${card.instanceId}" data-owner="${options.owner.id}" data-zone="${options.zone}">
      <span>暗置</span><small>身份未知</small>
    </button>`;
  }
  const art = options.flipped ? definition.extraArt || definition.art : definition.art;
  const name = options.flipped ? definition.extraName || definition.name : definition.name;
  const poker = card.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank} · ` : "";
  return `<button class="battle-mini-card battle-mini-card--${definition.kind}" draggable="${String(options.interactive)}"
    data-card="${card.instanceId}" data-owner="${options.owner.id}" data-zone="${options.zone}" title="${escapeHtml(definition.text)}">
    ${art ? `<img src="${art}" alt="" />` : `<span class="battle-mini-card__glyph">${definition.kind === "hand" ? "牌" : "角"}</span>`}
    <strong>${escapeHtml(name)}</strong><small>${escapeHtml(poker + definition.subtitle)}</small>
  </button>`;
}

function cardDefinition(card?: CardView) {
  return card?.definitionId ? catalog.cards[card.definitionId] : undefined;
}

function bindActions() {
  root.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", () => handleCommand(element));
  });
  root.querySelectorAll<HTMLElement>("[data-counter-set]").forEach((element) => {
    element.addEventListener("click", () => {
      const next = prompt("输入新的数值", element.dataset.current);
      if (next !== null) send(element.dataset.counterSet || "", { value: Number(next) });
    });
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((element) => {
    element.addEventListener("click", () => openCardMenu(element));
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/card-instance", element.dataset.card || "");
    });
  });
  root.querySelectorAll<HTMLElement>("[data-marker]").forEach((element) => {
    element.addEventListener("click", () => {
      if (confirm("移除这个标记？")) send("marker:remove", { markerId: element.dataset.marker });
    });
  });
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      element.classList.add("is-drag-over");
    });
    element.addEventListener("dragleave", () => element.classList.remove("is-drag-over"));
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("is-drag-over");
      const instanceId = event.dataTransfer?.getData("text/card-instance");
      if (!instanceId) return;
      const [targetZone, rawIndex] = (element.dataset.dropTarget || "").split(":");
      send("card:move", {
        instanceId,
        targetZone,
        targetIndex: rawIndex === undefined ? undefined : Number(rawIndex),
        faceDown: targetZone === "characterSlot",
      });
    });
  });
}

function handleCommand(element: HTMLElement) {
  const command = element.dataset.command || "";
  if (command === "player:ready") {
    send(command, { ready: element.dataset.ready === "true" });
  } else if (command === "card:draw-hand") {
    send("card:draw", { deck: "hand", count: 1 });
  } else if (command === "card:draw-character") {
    send("card:draw", { deck: "character", count: 1 });
  } else if (command === "body:flip" || command === "turn:end") {
    send(command);
  } else if (command === "health:set" || command === "megaProgress:set") {
    send(command, { value: Number(element.dataset.value) });
  } else if (command === "deck:shuffle") {
    send(command, { deck: element.dataset.deck });
  } else if (command === "card:inspect-zone") {
    send("card:inspect", { ownerId: element.dataset.owner, zone: element.dataset.zone });
  } else if (command === "card:inspect-deck") {
    send("card:inspect", { zone: "handDeck", count: Number(element.dataset.count) });
  } else if (command === "hand:randomSelect") {
    send(command, { ownerId: element.dataset.owner });
  } else if (command === "marker:create") {
    const label = prompt("标记名称，例如：炸弹、毒雾、护盾");
    const slot = prompt("放到哪个己方角色位？请输入 1-4", "1");
    if (label && slot) send(command, { label, slotIndex: Number(slot) - 1 });
  }
}

function openCardMenu(element: HTMLElement) {
  const instanceId = element.dataset.card || "";
  const ownerId = element.dataset.owner || "";
  const zone = element.dataset.zone || "";
  const card = findVisibleCard(instanceId);
  const definition = cardDefinition(card);
  dialogContent.innerHTML = `
    <div class="battle-card-menu">
      <h2>${definition ? escapeHtml(definition.name) : "暗置卡牌"}</h2>
      ${definition ? `<p><strong>${escapeHtml(definition.subtitle)}</strong></p><p>${escapeHtml(definition.text)}</p>` : `<p>你当前无权查看这张牌。</p>`}
      <div class="battle-card-menu__actions">
        ${moveButtons(instanceId, ownerId, zone, definition?.kind)}
      </div>
    </div>
  `;
  dialog.showModal();
  dialogContent.querySelectorAll<HTMLElement>("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.move || "";
      const [targetZone, rawIndex] = target.split(":");
      send("card:move", {
        instanceId,
        targetZone,
        targetIndex: rawIndex === undefined ? undefined : Number(rawIndex),
        faceDown: button.dataset.faceDown === "true",
      });
      dialog.close();
    });
  });
  dialogContent.querySelector<HTMLElement>("[data-flip-card]")?.addEventListener("click", () => {
    send("card:flip", { instanceId });
    dialog.close();
  });
  dialogContent.querySelector<HTMLElement>("[data-inspect-card]")?.addEventListener("click", () => {
    send("card:inspect", { instanceId });
    dialog.close();
  });
  dialogContent.querySelector<HTMLElement>("[data-hand-marker]")?.addEventListener("click", () => {
    const label = prompt("标记名称，例如：充能球、毒雾", "充能球");
    const slot = prompt("放到哪个己方角色位？请输入 1-4", "1");
    if (label && slot) {
      send("card:move", {
        instanceId,
        targetZone: "handMarker",
        targetIndex: Number(slot) - 1,
        label,
      });
    }
    dialog.close();
  });
}

function moveButtons(instanceId: string, ownerId: string, zone: string, kind?: string) {
  const isMine = ownerId === snapshot?.you;
  const buttons: string[] = [];
  const add = (label: string, target: string, faceDown = false) => buttons.push(
    `<button type="button" data-move="${target}" data-face-down="${String(faceDown)}">${label}</button>`,
  );
  if (!kind) {
    buttons.push(`<button type="button" data-inspect-card="${instanceId}">按效果查看</button>`);
    return buttons.join("");
  }
  if (kind === "hand") {
    add("打到结算区", "resolving");
    add("置入弃牌区", "handDiscard");
    add("放回牌堆顶", "handDeckTop");
    add("放回牌堆底", "handDeckBottom");
    if (isMine) add("交给对手", "opponentHand");
    if (isMine) buttons.push(`<button type="button" data-hand-marker="${instanceId}">暗置为标记</button>`);
  } else if (kind === "character") {
    if (isMine) {
      for (let index = 0; index < 4; index += 1) add(`暗置到角色位 ${index + 1}`, `characterSlot:${index}`, true);
      add("返回角色手牌", "characterHand");
      add("休整至牌堆底", "characterDeckBottom");
      add("退场", "retired");
      add("移出游戏", "banished");
    }
    if (zone.startsWith("slot:")) buttons.push(`<button type="button" data-flip-card="${instanceId}">明置 / 暗置</button>`);
  }
  buttons.push(`<button type="button" data-inspect-card="${instanceId}">查看卡牌</button>`);
  return buttons.join("");
}

function findVisibleCard(instanceId: string) {
  if (!snapshot) return undefined;
  const pools = snapshot.players.flatMap((player) => [
    player.body,
    ...player.hand,
    ...player.characterHand,
    ...player.characterSlots.filter((item): item is CardView => !!item && "instanceId" in item),
    ...player.retired,
    ...player.banished,
  ]);
  return [...pools, ...snapshot.game.handDiscard, ...snapshot.game.resolving].find((card) => card?.instanceId === instanceId);
}

function showInspection(title: string, cards: CardView[]) {
  dialogContent.innerHTML = `<div class="battle-card-menu"><h2>${escapeHtml(title)}</h2>
    <div class="battle-inspection">${cards.map((card) => {
      const definition = cardDefinition(card);
      const poker = card.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank} · ` : "";
      return `<article>
        <strong>${escapeHtml(poker + (definition?.name || "未知"))}</strong>
        <p>${escapeHtml(definition?.text || "")}</p>
        <div class="battle-card-menu__actions">
          <button type="button" data-inspection-move="${card.instanceId}" data-target="handDeckTop">置于牌堆顶</button>
          <button type="button" data-inspection-move="${card.instanceId}" data-target="handDeckBottom">置于牌堆底</button>
          <button type="button" data-inspection-move="${card.instanceId}" data-target="handDiscard">置入弃牌区</button>
          <button type="button" data-inspection-move="${card.instanceId}" data-target="hand">加入我的手牌</button>
        </div>
      </article>`;
    }).join("")}</div></div>`;
  dialog.showModal();
  dialogContent.querySelectorAll<HTMLElement>("[data-inspection-move]").forEach((button) => {
    button.addEventListener("click", () => {
      send("card:move", {
        instanceId: button.dataset.inspectionMove,
        targetZone: button.dataset.target,
      });
      dialog.close();
    });
  });
}

function showError(message: string) {
  dialogContent.innerHTML = `<div class="battle-card-menu"><h2>操作未完成</h2><p>${escapeHtml(message)}</p></div>`;
  dialog.showModal();
}

function renderFatal(message: string) {
  root.innerHTML = `<section class="battle-loading hud-panel"><h1>无法进入牌桌</h1><p>${escapeHtml(message)}</p><a class="btn btn--primary" href="/play">返回在线对战</a></section>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function suitSymbol(suit: string) {
  return ({ "黑桃": "♠", "红桃": "♥", "梅花": "♣", "方块": "♦" } as Record<string, string>)[suit] || suit;
}

connect();
