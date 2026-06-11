import { getBattleApiUrl } from "../lib/battle-api";

type CatalogCard = {
  id: string;
  name: string;
  kind: "body" | "character" | "hand";
  subtitle: string;
  text: string;
  imagePath?: string;
  extraImagePath?: string;
  extraName?: string;
  extraSubtitle?: string;
  extraText?: string;
  megaMax?: number;
};

type CatalogDeck = {
  id: string;
  name: string;
  archetype: string;
  bodyId: string;
  theme: string;
  blurb: string;
};

type Catalog = {
  cards: Record<string, CatalogCard>;
  decks: CatalogDeck[];
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

type PreservedUI = {
  scrollLeft: Record<string, number>;
  logOpen: boolean;
};

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Battle table element missing: ${selector}`);
  return element;
}

requiredElement<HTMLElement>("#battle-app");
const root = requiredElement<HTMLElement>("#battle-root");
const status = requiredElement<HTMLElement>("#battle-connection");
const statusText = status.querySelector<HTMLElement>(".battle-connection__text") ?? status;
const roomLabel = requiredElement<HTMLElement>("#battle-room-code");
const toastEl = document.querySelector<HTMLElement>("#battle-toast");
const coachEl = document.querySelector<HTMLElement>("#battle-coach");
const dialog = requiredElement<HTMLDialogElement>("#battle-dialog");
const dialogContent = requiredElement<HTMLElement>("#battle-dialog-content");
const catalogNode = requiredElement<HTMLScriptElement>("#battle-catalog");
const catalog = JSON.parse(catalogNode.textContent || "{}") as Catalog;

const API_URL = getBattleApiUrl();
const TOKEN_KEY = "qunyou-battle-token-v1";
const PENDING_KEY = "qunyou-battle-pending-v1";
const COACH_KEY = "qunyou-battle-coach-v1";
const roomCode = getRoomCode();
let snapshot: Snapshot | undefined;
let socket: WebSocket | undefined;
let reconnectTimer = 0;
let reconnectDelay = 800;
let hasConnected = false;
let connectionAttempt = 0;
let moveModeCardId: string | null = null;
let coachStep = 0;
let toastTimer = 0;
let coachShown = false;

const COACH_STEPS = [
  { title: "点击卡牌查看技能", text: "点任意卡牌可阅读完整效果，并从菜单移动到其他区域。" },
  { title: "拖拽或点击落点", text: "桌面端可拖拽卡牌；移动端请用菜单里的「点击落点移动」，再点目标区域。" },
  { title: "结束回合与日志", text: "中央栏可结束回合、查看操作日志。系统不自动判定规则，请双方诚信结算。" },
];

roomLabel.textContent = roomCode;

function setConnectionState(label: string, state: string) {
  statusText.textContent = label;
  status.dataset.state = state;
}

setConnectionState("连接中", "connecting");

function showToast(message: string) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function copyText(text: string, button?: HTMLButtonElement | null, doneLabel = "已复制", resetLabel?: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = doneLabel;
      window.setTimeout(() => { button.textContent = resetLabel ?? original; }, 1400);
    }
    showToast(doneLabel);
  } catch {
    showToast("复制失败，请手动复制");
  }
}

document.querySelector("#battle-copy-link")?.addEventListener("click", async (event) => {
  const inviteUrl = new URL("/play", location.origin);
  inviteUrl.searchParams.set("room", roomCode);
  await copyText(inviteUrl.toString(), event.currentTarget as HTMLButtonElement, "已复制", "邀请链接");
});

document.querySelector("#battle-copy-code")?.addEventListener("click", async (event) => {
  await copyText(roomCode, event.currentTarget as HTMLButtonElement, "已复制", "复制码");
});

// 点击弹窗外部（遮罩）关闭
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "Escape") {
    if (moveModeCardId) {
      moveModeCardId = null;
      render();
      return;
    }
    if (dialog.open) dialog.close();
  }
  if (event.key === "e" || event.key === "E") {
    if (dialog.open) return;
    const endBtn = root.querySelector<HTMLElement>('[data-command="turn:end"]');
    if (endBtn && !endBtn.hasAttribute("disabled")) endBtn.click();
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
  const created = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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

function deckFor(player?: PlayerView) {
  return catalog.decks.find((item) => item.id === player?.deckId);
}

function themeClasses(theme?: string) {
  const slug = theme ?? "neutral";
  return slug === "aggro" ? "deck-theme" : `deck-theme deck-theme--${slug}`;
}

function captureUIState(): PreservedUI {
  const scrollLeft: Record<string, number> = {};
  root.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
    if (element.dataset.scrollKey) scrollLeft[element.dataset.scrollKey] = element.scrollLeft;
  });
  const logDetails = root.querySelector<HTMLDetailsElement>(".battle-log");
  return { scrollLeft, logOpen: logDetails?.open ?? false };
}

function restoreUIState(state: PreservedUI) {
  Object.entries(state.scrollLeft).forEach(([key, value]) => {
    const element = root.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`);
    if (element) element.scrollLeft = value;
  });
  const logDetails = root.querySelector<HTMLDetailsElement>(".battle-log");
  if (logDetails && state.logOpen) logDetails.open = true;
  if (moveModeCardId) {
    root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((zone) => zone.classList.add("is-move-target"));
    showToast("点击高亮区域放置卡牌，按 Esc 取消");
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
  setConnectionState("连接中", "connecting");
  if (!snapshot) renderConnecting("正在确认房间与玩家座位。");
  const token = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, nickname: pending.nickname, deckId: pending.deckId }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(result.error || `加入房间失败（${response.status}）`);
  } catch (error) {
    window.clearTimeout(timeout);
    if (attempt !== connectionAttempt) return;
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "连接对战服务器超时。当前网络可能阻断了实时连接，请切换网络后重试。"
      : error instanceof TypeError
        ? "无法连接对战服务器。请检查网络后重试；若网页能打开但仍失败，请把此提示反馈给维护者。"
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
    setConnectionState("已连接", "open");
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
    setConnectionState("重连中", "closed");
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
    <p class="battle-loading__hint">同一浏览器会自动认回座位，房间保留 24 小时。</p>
  </section>`;
}

function renderConnectionError(message: string) {
  setConnectionState("连接失败", "failed");
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
  const preserved = captureUIState();
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = snapshot.players.find((player) => player.id !== snapshot?.you);
  if (!me) {
    renderFatal("未能认回你的座位。");
    return;
  }
  if (!snapshot.game.started) {
    renderLobby(me, opponent);
    restoreUIState(preserved);
    return;
  }

  const isMyTurn = snapshot.game.currentPlayerId === snapshot.you;
  root.innerHTML = `
    ${moveModeCardId ? `<div class="battle-move-banner">点击落点模式 · 选择目标区域（Esc 取消）</div>` : ""}
    <div class="battle-table">
      ${opponent ? renderPlayer(opponent, false, isMyTurn) : renderWaitingSeat()}
      ${renderCenter(snapshot.game, me, opponent, isMyTurn)}
      ${renderPlayer(me, true, isMyTurn)}
    </div>
  `;
  bindActions();
  restoreUIState(preserved);
  maybeShowCoach();
}

function renderLobby(me: PlayerView, opponent?: PlayerView) {
  const myDeck = deckFor(me);
  const bodyCard = myDeck ? catalog.cards[myDeck.bodyId] : undefined;
  root.innerHTML = `
    <section class="battle-lobby hud-panel ${themeClasses(myDeck?.theme)}">
      <div class="battle-lobby__heading">
        <div>
          <span class="battle-kicker">准备大厅</span>
          <h1 class="battle-room-display">${escapeHtml(snapshot?.roomCode || "")}</h1>
        </div>
        <p>双方选择预组并准备后，服务器自动洗牌、发牌并随机先手。</p>
      </div>
      <div class="battle-invite">
        <div>
          <span class="battle-invite__label">房间码</span>
          <strong class="battle-room-display">${escapeHtml(snapshot?.roomCode || roomCode)}</strong>
        </div>
        <div class="battle-invite__actions">
          <button type="button" class="battle-small-btn" id="lobby-copy-code">复制房间码</button>
          <button type="button" class="battle-small-btn" id="lobby-copy-link">复制邀请链接</button>
        </div>
      </div>
      <div class="battle-lobby__seats">
        ${renderLobbySeat(me, true)}
        ${opponent ? renderLobbySeat(opponent, false) : `<article class="battle-seat battle-seat--empty"><strong>等待对手</strong><p>发送房间链接或房间码给对方。</p></article>`}
      </div>
      <div class="battle-deck-preview" id="battle-deck-preview">
        ${renderDeckPreview(myDeck, bodyCard)}
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
      ${me.ready ? `<p class="battle-lobby__hint">已准备 · 预组已锁定，取消准备后可更换</p>` : ""}
    </section>
  `;
  document.querySelector("#battle-deck-select")?.addEventListener("change", (event) => {
    send("player:selectDeck", { deckId: (event.currentTarget as HTMLSelectElement).value });
  });
  document.querySelector("#lobby-copy-code")?.addEventListener("click", () => copyText(snapshot?.roomCode || roomCode));
  document.querySelector("#lobby-copy-link")?.addEventListener("click", () => {
    const inviteUrl = new URL("/play", location.origin);
    inviteUrl.searchParams.set("room", snapshot?.roomCode || roomCode);
    copyText(inviteUrl.toString());
  });
  bindActions();
}

function renderDeckPreview(deck?: CatalogDeck, body?: CatalogCard) {
  if (!deck) return `<p class="battle-deck-preview__empty">选择预组以预览本体与打法方向。</p>`;
  return `<article class="battle-deck-preview__card ${themeClasses(deck.theme)}">
    ${body?.imagePath ? `<img src="${body.imagePath}" alt="" class="battle-deck-preview__art" loading="lazy" />` : ""}
    <div>
      <span class="battle-deck-preview__tag">${escapeHtml(deck.archetype)}</span>
      <strong>${escapeHtml(deck.name)}</strong>
      <p>${escapeHtml(deck.blurb || body?.subtitle || "")}</p>
    </div>
  </article>`;
}

function renderLobbySeat(player: PlayerView, isMe: boolean) {
  const deck = deckFor(player);
  return `<article class="battle-seat ${themeClasses(deck?.theme)} ${player.ready ? "is-ready" : ""}">
    <span>${isMe ? "你的座位" : "对手座位"} · ${player.connected ? "在线" : "离线"}</span>
    <strong>${escapeHtml(player.nickname)}</strong>
    <p>${deck ? `${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}` : "尚未选择预组"}</p>
    <em>${player.ready ? "已准备" : "未准备"}</em>
  </article>`;
}

function renderPlayer(player: PlayerView, isMe: boolean, isMyTurn: boolean) {
  const body = cardDefinition(player.body);
  const deck = deckFor(player);
  const max = body?.megaMax;
  const megaText = max ? `${player.megaProgress || 0}/${max}` : String(player.megaProgress || 0);
  const turnClass = snapshot?.game.currentPlayerId === player.id ? " battle-player--active-turn" : "";
  return `
    <section class="battle-player ${themeClasses(deck?.theme)} ${isMe ? "battle-player--self" : "battle-player--opponent"}${turnClass}">
      <header class="battle-player__header">
        <div>
          <span>${isMe ? "你" : "对手"} · ${player.connected ? "在线" : "离线"}</span>
          <strong>${escapeHtml(player.nickname)}</strong>
          ${snapshot?.game.currentPlayerId === player.id ? `<span class="battle-turn-badge">${isMe && isMyTurn ? "你的回合" : "当前回合"}</span>` : ""}
        </div>
        <div class="battle-counters">
          ${renderCounter("体力", player.health || 0, "health:set", player.id, isMe)}
          ${renderCounter("Mega", megaText, "megaProgress:set", player.id, isMe, max)}
        </div>
      </header>
      <div class="battle-player__field">
        <div class="battle-body-zone">
          <span class="battle-zone-label">本体</span>
          ${renderCard(player.body, { owner: player, zone: "body", interactive: isMe, flipped: player.bodyFlipped, size: "field" })}
          ${isMe ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
        </div>
        <div class="battle-character-slots">
          <span class="battle-zone-label battle-zone-label--row">角色区</span>
          <div class="battle-character-slots__grid">
            ${player.characterSlots.map((item, index) => renderSlot(item, index, player, isMe)).join("")}
          </div>
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
        <div class="battle-card-row" data-scroll-key="${isMe ? "char-hand-self" : "char-hand-opp"}">${player.characterHand.map((card) => renderCard(card, { owner: player, zone: "characterHand", interactive: isMe, size: isMe ? "hand" : "compact" })).join("")}</div>
      </div>
      <div class="battle-private-rail battle-private-rail--hand">
        <div class="battle-private-rail__title">
          <strong>${isMe ? "我的手牌" : "对手手牌"}</strong>
          <span>${player.hand.length} 张</span>
          ${!isMe ? `<button class="battle-small-btn" data-command="card:inspect-zone" data-owner="${player.id}" data-zone="hand">查看手牌</button>` : ""}
        </div>
        <div class="battle-card-row" data-scroll-key="${isMe ? "hand-self" : "hand-opp"}">${player.hand.map((card) => renderCard(card, { owner: player, zone: "hand", interactive: isMe, size: isMe ? "hand" : "compact" })).join("")}</div>
      </div>
    </section>
  `;
}

function renderCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number) {
  const numeric = typeof value === "number" ? value : Number(String(value).split("/")[0]);
  const ready = label === "Mega" && max !== undefined && numeric >= max;
  return `<div class="battle-counter ${ready ? "is-ready" : ""}">
    <span>${label}</span><strong>${value}</strong>
    ${editable ? `<div class="battle-counter__actions">
      <button type="button" data-command="${command}" data-value="${numeric - 1}" aria-label="${label}减一">−</button>
      <button type="button" data-command="${command}" data-value="${numeric + 1}" aria-label="${label}加一">＋</button>
      <button type="button" data-counter-set="${command}" data-player="${playerId}" data-current="${numeric}" data-label="${label}">设置</button>
    </div>` : ""}
  </div>`;
}

function renderCenter(game: GameView, me: PlayerView, opponent: PlayerView | undefined, isMyTurn: boolean) {
  const current = snapshot?.players.find((player) => player.id === game.currentPlayerId);
  const recentLogs = game.logs.slice(-3).reverse();
  const endTurnDisabled = !isMyTurn ? " disabled" : "";
  const endTurnTitle = isMyTurn ? "" : ' title="当前不是你的回合"';
  return `<section class="battle-center">
    <div class="battle-turnbar">
      <span>第 ${game.turnNumber} 回合</span>
      <strong class="${isMyTurn ? "battle-turnbar__you" : ""}">${current ? `${escapeHtml(current.nickname)} 的回合` : "等待开始"}</strong>
      <button class="battle-small-btn battle-small-btn--accent" data-command="turn:end"${endTurnDisabled}${endTurnTitle}>结束回合</button>
    </div>
  <p class="battle-phase-hint">准备 → 摸牌 → 出牌 → 布阵 → 弃牌 → 结束</p>
    <div class="battle-common-zones">
      ${renderPile("共用牌堆", game.handDeckCount, "card:draw-hand", "摸 1 张")}
      ${renderZone("结算区", game.resolving, me, "resolving", true)}
      ${renderZone("手牌弃牌区", game.handDiscard, me, "handDiscard", true)}
    </div>
    <div class="battle-toolbar">
      <button type="button" data-command="deck:shuffle" data-deck="hand">洗混共用牌堆</button>
      <button type="button" data-command="hand:randomSelect" data-owner="${opponent?.id || ""}">随机展示对手手牌</button>
      <button type="button" data-command="marker:create">创建标记</button>
      ${moveModeCardId ? `<button type="button" data-command="move:cancel">取消落点</button>` : ""}
    </div>
    ${recentLogs.length ? `<ul class="battle-log-recent" aria-label="最近操作">${recentLogs.map((log) => `<li><time>${formatLogTime(log.at)}</time>${escapeHtml(log.text)}</li>`).join("")}</ul>` : ""}
    <details class="battle-log">
      <summary>全部日志 · ${game.logs.length}</summary>
      <ol>${game.logs.slice(-30).reverse().map((log) => `<li><time>${formatLogTime(log.at)}</time>${escapeHtml(log.text)}</li>`).join("")}</ol>
    </details>
  </section>`;
}

function formatLogTime(at: number) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function renderWaitingSeat() {
  return `<section class="battle-player battle-player--opponent battle-player--waiting"><strong>等待对手重新连接</strong></section>`;
}

function renderPile(title: string, count: number, command: string, action: string) {
  const dropTarget = title === "共用牌堆" ? ` data-drop-target="handDeckTop"` : "";
  return `<article class="battle-pile"${dropTarget}>
    <div class="battle-card-back"><span>群友杀</span></div>
    <strong>${title}</strong><span>${count} 张</span>
    ${command ? `<button type="button" class="battle-small-btn" data-command="${command}">${action}</button>` : ""}
  </article>`;
}

function renderZone(title: string, cards: CardView[], owner: PlayerView, zone: string, interactive: boolean) {
  return `<article class="battle-zone" data-drop-target="${zone}">
    <header><strong>${title}</strong><span>${cards.length}</span></header>
    <div class="battle-zone__cards">${cards.slice(-5).map((card) => renderCard(card, { owner, zone, interactive, size: "pile" })).join("")}</div>
  </article>`;
}

function renderSlot(item: CardView | MarkerView | null, index: number, owner: PlayerView, isMe: boolean) {
  if (!item) return `<article class="battle-slot" data-drop-target="characterSlot:${index}"><span>位 ${index + 1}</span></article>`;
  if ("label" in item) {
    const label = escapeHtml(item.label);
    return `<article class="battle-slot battle-slot--marker"><button type="button" data-marker="${item.id}" data-marker-label="${label}">${label}</button></article>`;
  }
  return `<article class="battle-slot">${renderCard(item, { owner, zone: `slot:${index}`, interactive: isMe || !item.faceDown, size: "field" })}</article>`;
}

function renderCard(
  card: CardView | undefined,
  options: { owner: PlayerView; zone: string; interactive: boolean; flipped?: boolean; size?: "hand" | "field" | "pile" | "compact" },
) {
  if (!card) return "";
  const definition = cardDefinition(card);
  const sizeClass = options.size ? ` battle-mini-card--${options.size}` : "";
  if (!definition) {
    return `<button type="button" class="battle-mini-card battle-mini-card--back${sizeClass}" data-card="${card.instanceId}" data-owner="${options.owner.id}" data-zone="${options.zone}" aria-label="暗置卡牌">
      <span>暗置</span><small>身份未知</small>
    </button>`;
  }
  const isFlipped = options.flipped && definition.kind === "body";
  const name = isFlipped ? definition.extraName || definition.name : definition.name;
  const poker = card.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank} · ` : "";
  let imagePath: string | undefined;
  if (definition.kind === "hand") {
    imagePath = handCardImagePath(definition.id, card.suit, card.rank);
  } else if (definition.kind === "body" && isFlipped) {
    imagePath = definition.extraImagePath;
  } else {
    imagePath = definition.imagePath;
  }
  const faceClass = card.faceDown ? " is-face-down" : (definition.kind === "character" && options.zone.startsWith("slot:") ? " is-face-up" : "");
  const cardClass = `battle-mini-card battle-mini-card--${definition.kind}${imagePath ? " battle-mini-card--art" : ""}${sizeClass}${faceClass}`;
  const inSlot = definition.kind === "character" && options.zone.startsWith("slot:");
  const faceBadge = inSlot
    ? (card.faceDown ? `<span class="battle-mini-card__face-badge battle-mini-card__face-badge--down">暗</span>` : `<span class="battle-mini-card__face-badge">明</span>`)
    : "";
  return `<button type="button" class="${cardClass}" draggable="${String(options.interactive)}"
    data-card="${card.instanceId}" data-owner="${options.owner.id}" data-zone="${options.zone}"
    aria-label="${escapeHtml(name)}" title="${escapeHtml(definition.text)}">
    ${imagePath ? `<img src="${imagePath}" alt="" loading="lazy" />` : `<span class="battle-mini-card__glyph">${definition.kind === "hand" ? "牌" : "角"}</span>`}
    ${faceBadge}
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
      const label = element.dataset.label || "数值";
      const current = Number(element.dataset.current || 0);
      showNumberDialog(label, current, (value) => send(element.dataset.counterSet || "", { value }));
    });
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (moveModeCardId) return;
      openCardMenu(element);
      event.stopPropagation();
    });
    element.addEventListener("dragstart", (event) => {
      if (!optionsDraggable(element)) return;
      event.dataTransfer?.setData("text/card-instance", element.dataset.card || "");
      element.classList.add("is-dragging");
    });
    element.addEventListener("dragend", () => element.classList.remove("is-dragging"));
  });
  root.querySelectorAll<HTMLElement>("[data-marker]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const markerId = element.dataset.marker;
      const label = element.dataset.markerLabel || "这个";
      if (!markerId) return;
      showConfirmDialog(`移除标记「${label}」？`, () => send("marker:remove", { markerId }));
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
      moveCardToTarget(instanceId, element.dataset.dropTarget || "");
    });
    element.addEventListener("click", () => {
      if (!moveModeCardId) return;
      moveCardToTarget(moveModeCardId, element.dataset.dropTarget || "");
      moveModeCardId = null;
      render();
    });
  });
}

function optionsDraggable(element: HTMLElement) {
  return element.getAttribute("draggable") === "true";
}

function moveCardToTarget(instanceId: string, dropTarget: string) {
  const [targetZone, rawIndex] = dropTarget.split(":");
  send("card:move", {
    instanceId,
    targetZone,
    targetIndex: rawIndex === undefined ? undefined : Number(rawIndex),
    faceDown: targetZone === "characterSlot",
  });
}

function handleCommand(element: HTMLElement) {
  const command = element.dataset.command || "";
  if (command === "move:cancel") {
    moveModeCardId = null;
    render();
    return;
  }
  if (command === "player:ready") {
    send(command, { ready: element.dataset.ready === "true" });
  } else if (command === "card:draw-hand") {
    send("card:draw", { deck: "hand", count: 1 });
  } else if (command === "card:draw-character") {
    send("card:draw", { deck: "character", count: 1 });
  } else if (command === "body:flip") {
    send(command);
  } else if (command === "turn:end") {
    if (element.hasAttribute("disabled")) {
      showError("当前不是你的回合。若双方同意换手，请直接切换回合标记。");
      return;
    }
    if (snapshot?.game.currentPlayerId !== snapshot?.you) {
      showConfirmDialog("当前不是你的回合，仍要结束并标记回合切换？", () => send(command));
      return;
    }
    send(command);
  } else if (command === "health:set" || command === "megaProgress:set") {
    send(command, { value: Number(element.dataset.value) });
  } else if (command === "deck:shuffle") {
    send(command, { deck: element.dataset.deck });
  } else if (command === "card:inspect-zone") {
    send("card:inspect", { ownerId: element.dataset.owner, zone: element.dataset.zone });
  } else if (command === "hand:randomSelect") {
    send(command, { ownerId: element.dataset.owner });
  } else if (command === "marker:create") {
    showMarkerDialog((label, slotIndex) => send(command, { label, slotIndex }));
  }
}

function showNumberDialog(label: string, current: number, onSubmit: (value: number) => void) {
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <h2>设置${escapeHtml(label)}</h2>
    <div class="battle-form-stepper">
      <button type="button" class="battle-stepper-btn" data-step="-1" aria-label="减少">−</button>
      <input type="number" id="battle-number-input" value="${current}" min="0" max="99" />
      <button type="button" class="battle-stepper-btn" data-step="1" aria-label="增加">＋</button>
    </div>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>确定</button>
    </div>
  </div>`;
  const input = dialogContent.querySelector<HTMLInputElement>("#battle-number-input");
  dialogContent.querySelectorAll<HTMLElement>("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!input) return;
      input.value = String(Math.max(0, Number(input.value) + Number(btn.dataset.step)));
    });
  });
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    if (!input) return;
    onSubmit(Number(input.value));
    dialog.close();
  });
  dialog.showModal();
  input?.focus();
  input?.select();
}

function showMarkerDialog(onSubmit: (label: string, slotIndex: number) => void) {
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <h2>创建标记</h2>
    <label class="battle-dialog-label">标记名称
      <input type="text" id="battle-marker-label" maxlength="12" placeholder="炸弹、毒雾、护盾" value="充能球" />
    </label>
    <p class="battle-dialog-hint">选择要放置的己方角色位（1–4）</p>
    <div class="battle-slot-picker">
      ${[0, 1, 2, 3].map((i) => `<button type="button" class="battle-slot-picker__btn" data-slot="${i}">位 ${i + 1}</button>`).join("")}
    </div>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelectorAll<HTMLElement>(".battle-slot-picker__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = dialogContent.querySelector<HTMLInputElement>("#battle-marker-label")?.value.trim();
      if (!label) return;
      onSubmit(label, Number(btn.dataset.slot));
      dialog.close();
    });
  });
  dialog.showModal();
}

function showHandMarkerDialog(instanceId: string) {
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <h2>暗置为标记</h2>
    <label class="battle-dialog-label">标记名称
      <input type="text" id="battle-marker-label" maxlength="12" value="充能球" />
    </label>
    <p class="battle-dialog-hint">选择角色位</p>
    <div class="battle-slot-picker">
      ${[0, 1, 2, 3].map((i) => `<button type="button" class="battle-slot-picker__btn" data-slot="${i}">位 ${i + 1}</button>`).join("")}
    </div>
    <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelectorAll<HTMLElement>(".battle-slot-picker__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = dialogContent.querySelector<HTMLInputElement>("#battle-marker-label")?.value.trim();
      if (!label) return;
      send("card:move", { instanceId, targetZone: "handMarker", targetIndex: Number(btn.dataset.slot), label });
      dialog.close();
    });
  });
  dialog.showModal();
}

function showConfirmDialog(message: string, onConfirm: () => void) {
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <h2>请确认</h2>
    <p>${escapeHtml(message)}</p>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>确定</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    onConfirm();
    dialog.close();
  });
  dialog.showModal();
}

function openCardMenu(element: HTMLElement) {
  const instanceId = element.dataset.card || "";
  const ownerId = element.dataset.owner || "";
  const zone = element.dataset.zone || "";
  const card = findVisibleCard(instanceId);
  const definition = cardDefinition(card);
  let displayName = definition?.name || "";
  let displaySubtitle = definition?.subtitle || "";
  let displayText = definition?.text || "";
  let imagePath = definition?.imagePath;
  if (definition?.kind === "body") {
    const owner = snapshot?.players.find((p) => p.id === ownerId);
    if (owner?.bodyFlipped && definition.extraName) {
      displayName = definition.extraName;
      displaySubtitle = definition.extraSubtitle || definition.subtitle;
      displayText = definition.extraText || definition.text;
      imagePath = definition.extraImagePath || imagePath;
    }
  }
  if (definition?.kind === "hand" && card) {
    imagePath = handCardImagePath(definition.id, card.suit, card.rank) || imagePath;
  }
  const parts = displayName.includes("-") ? displayName.split("-") : ["", displayName];
  const roleTag = definition?.kind === "character" ? definition.subtitle.split(" · ")[0] : "";
  const isFaceDown = card?.faceDown ?? false;
  const faceStatus = definition?.kind === "character"
    ? (isFaceDown ? `<span class="battle-tag" style="background:rgba(255,179,71,0.15);border-color:rgba(255,179,71,0.4);color:#ffb347">暗置</span>` : `<span class="battle-tag" style="background:rgba(98,217,139,0.12);border-color:rgba(98,217,139,0.35);color:#62d98b">已明置</span>`)
    : "";
  dialogContent.innerHTML = `
    <div class="battle-card-menu battle-card-menu--rich">
      <div class="battle-card-detail">
        ${imagePath ? `<img class="battle-card-detail__art" src="${imagePath}" alt="" />` : `<div class="battle-card-detail__placeholder">${definition?.kind === "hand" ? "牌" : "角"}</div>`}
        <div class="battle-card-detail__body">
          <h2>${definition ? (parts[0] ? `<span class="battle-card-detail__role">${escapeHtml(parts[0])}</span>` : "") + escapeHtml(parts[1] || displayName) : "暗置卡牌"}</h2>
          ${roleTag ? `<span class="battle-tag">${escapeHtml(roleTag)}</span>` : ""} ${faceStatus}
          ${definition ? `<p class="battle-card-detail__subtitle">${escapeHtml(displaySubtitle)}</p><p class="battle-card-detail__text">${escapeHtml(displayText)}</p>` : `<p>这张卡牌为暗置状态，可以通过卡牌效果查看。</p>`}
        </div>
      </div>
      <div class="battle-card-menu__sections">
        ${moveButtonSections(instanceId, ownerId, zone, definition?.kind)}
      </div>
    </div>
  `;
  dialog.showModal();
  bindCardMenuActions(instanceId, ownerId, zone, definition?.kind);
}

function bindCardMenuActions(instanceId: string, ownerId: string, zone: string, kind?: string) {
  dialogContent.querySelector<HTMLElement>("[data-move-mode]")?.addEventListener("click", () => {
    moveModeCardId = instanceId;
    dialog.close();
    render();
  });
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
    dialog.close();
    showHandMarkerDialog(instanceId);
  });
}

function moveButtonSections(instanceId: string, ownerId: string, zone: string, kind?: string) {
  const isMine = ownerId === snapshot?.you;
  const move: string[] = [];
  const state: string[] = [];
  const view: string[] = [];
  const add = (label: string, target: string, faceDown = false) => move.push(
    `<button type="button" data-move="${target}" data-face-down="${String(faceDown)}">${label}</button>`,
  );
  if (!kind) {
    view.push(`<button type="button" data-inspect-card="${instanceId}">查看暗置卡牌</button>`);
    return renderActionSections(move, state, view);
  }
  if (isMine) move.push(`<button type="button" data-move-mode="${instanceId}">点击落点移动</button>`);
  if (kind === "hand") {
    add("打到结算区", "resolving");
    add("置入弃牌区", "handDiscard");
    add("放回牌堆顶", "handDeckTop");
    add("放回牌堆底", "handDeckBottom");
    if (isMine) add("交给对手", "opponentHand");
    if (isMine) state.push(`<button type="button" data-hand-marker="${instanceId}">暗置为标记</button>`);
    // 公开区域（弃牌/结算区）的卡牌可以加入手牌
    if (zone === "handDiscard" || zone === "resolving") add("加入我的手牌", "hand");
  } else if (kind === "character") {
    if (isMine) {
      for (let index = 0; index < 4; index += 1) add(`暗置到位 ${index + 1}`, `characterSlot:${index}`, true);
      add("返回角色手牌", "characterHand");
      add("休整至牌堆底", "characterDeckBottom");
      add("退场", "retired");
      add("移出游戏", "banished");
    }
    if (zone.startsWith("slot:")) state.push(`<button type="button" data-flip-card="${instanceId}">明置 / 暗置</button>`);
  }
  view.push(`<button type="button" data-inspect-card="${instanceId}">查看卡牌</button>`);
  return renderActionSections(move, state, view);
}

function renderActionSections(move: string[], state: string[], view: string[]) {
  const sections: string[] = [];
  if (move.length) sections.push(`<div class="battle-action-group"><h3>移动</h3><div class="battle-card-menu__actions">${move.join("")}</div></div>`);
  if (state.length) sections.push(`<div class="battle-action-group"><h3>状态</h3><div class="battle-card-menu__actions">${state.join("")}</div></div>`);
  if (view.length) sections.push(`<div class="battle-action-group"><h3>查看</h3><div class="battle-card-menu__actions">${view.join("")}</div></div>`);
  return sections.join("");
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
      const img = definition?.kind === "hand"
        ? handCardImagePath(definition.id, card.suit, card.rank)
        : definition?.imagePath;
      return `<article class="battle-inspection__card">
        ${img ? `<img src="${img}" alt="" class="battle-inspection__art" />` : ""}
        <div>
          <strong>${escapeHtml(poker + (definition?.name || "未知"))}</strong>
          <p>${escapeHtml(definition?.text || "")}</p>
          <div class="battle-card-menu__actions">
            <button type="button" data-inspection-move="${card.instanceId}" data-target="handDeckTop">置于牌堆顶</button>
            <button type="button" data-inspection-move="${card.instanceId}" data-target="handDeckBottom">置于牌堆底</button>
            <button type="button" data-inspection-move="${card.instanceId}" data-target="handDiscard">置入弃牌区</button>
            <button type="button" data-inspection-move="${card.instanceId}" data-target="hand">加入我的手牌</button>
          </div>
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
  dialogContent.innerHTML = `<div class="battle-card-menu"><h2>操作未完成</h2><p>${escapeHtml(message)}</p>
    <button type="button" class="btn btn--primary" data-dialog-cancel>知道了</button></div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.showModal();
}

function renderFatal(message: string) {
  root.innerHTML = `<section class="battle-loading hud-panel"><h1>无法进入牌桌</h1><p>${escapeHtml(message)}</p><a class="btn btn--primary" href="/play">返回在线对战</a></section>`;
}

function maybeShowCoach() {
  if (coachShown || !coachEl || localStorage.getItem(COACH_KEY)) return;
  if (!snapshot?.game.started) return;
  coachShown = true;
  coachEl.hidden = false;
  const title = coachEl.querySelector("#battle-coach-title");
  const text = coachEl.querySelector("#battle-coach-text");
  const showStep = () => {
    const step = COACH_STEPS[coachStep];
    if (!step || !title || !text) return;
    title.textContent = step.title;
    text.textContent = step.text;
  };
  showStep();
  document.querySelector("#battle-coach-skip")?.addEventListener("click", () => finishCoach(), { once: true });
  document.querySelector("#battle-coach-next")?.addEventListener("click", () => {
    coachStep += 1;
    if (coachStep >= COACH_STEPS.length) finishCoach();
    else showStep();
  });
}

function finishCoach() {
  localStorage.setItem(COACH_KEY, "1");
  if (coachEl) coachEl.hidden = true;
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

function handCardImagePath(definitionId: string, suit?: string, rank?: string) {
  if (!suit || !rank) return undefined;
  const suitSlug = ({ "黑桃": "spade", "红桃": "heart", "梅花": "club", "方块": "diamond" } as Record<string, string>)[suit];
  if (!suitSlug) return undefined;
  return `/cards/hand_cards/${definitionId}_${suitSlug}_${rank.toLowerCase()}.webp`;
}

connect();
