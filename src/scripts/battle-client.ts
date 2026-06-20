import { getBattleApiUrl } from "../lib/battle-api";
import { escapeHtml, handCardImagePath, suitSymbol } from "./battle-format";
import {
  bindHighResImage,
  renderCardArtDialog,
  renderCardArtPreview,
  renderCardDetailBody,
  resolveCardDetail,
  type BodyDetailForm,
  type CardDetailMode,
} from "./battle-card-detail";
import {
  autoFillCharacters,
  customCardSearchText,
  customRoleFilters,
  customTagFilters,
  matchesCustomFilters,
  renderSelectedCharacterTray,
  type CustomDeckFilters,
} from "./battle-custom-deck";
import { normalizeBattleSnapshot } from "./battle-state.mjs";
import {
  battleLogRegionId,
  battleLogTargetKey,
  filterBattleLogs,
  formatBattleLog,
} from "./battle-log.mjs";
import type {
  CardView,
  AnimationMode,
  BattleLog,
  Catalog,
  CatalogCard,
  CatalogDeck,
  CustomDeckConfig,
  GameView,
  InspectionAction,
  MarkerView,
  PlayerView,
  PreservedUI,
  ServerMessage,
  Snapshot,
  VisualEffectEvent,
} from "./battle-types";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Battle table element missing: ${selector}`);
  return element;
}

const app = requiredElement<HTMLElement>("#battle-app");
const root = requiredElement<HTMLElement>("#battle-root");
const status = requiredElement<HTMLElement>("#battle-connection");
const statusText = status.querySelector<HTMLElement>(".battle-connection__text") ?? status;
const roomLabel = requiredElement<HTMLElement>("#battle-room-code");
const toastEl = document.querySelector<HTMLElement>("#battle-toast");
const announcerEl = document.querySelector<HTMLElement>("#battle-announcer");
const effectLayer = requiredElement<HTMLElement>("#battle-effect-layer");
const coachEl = document.querySelector<HTMLElement>("#battle-coach");
const dialog = requiredElement<HTMLDialogElement>("#battle-dialog");
const dialogContent = requiredElement<HTMLElement>("#battle-dialog-content");
const catalogNode = requiredElement<HTMLScriptElement>("#battle-catalog");
const catalog = JSON.parse(catalogNode.textContent || "{}") as Catalog;
const catalogCards = Object.values(catalog.cards || {});
const bodyCatalogCards = catalogCards.filter((card) => card.kind === "body");
const characterCatalogCards = catalogCards.filter((card) => card.kind === "character");
const customRoleFilterOptions = customRoleFilters(characterCatalogCards);
const customTagFilterOptions = customTagFilters(characterCatalogCards);

const API_URL = getBattleApiUrl();
const TOKEN_KEY = "qunyou-battle-token-v1";
const PENDING_KEY = "qunyou-battle-pending-v1";
const CUSTOM_DECK_ID = "custom";
const CUSTOM_DECK_KEY = "qunyou-battle-custom-deck-v1";
const COACH_KEY = "qunyou-battle-coach-v1";
const TABLE_MODE_KEY = "qunyou-battle-table-mode-v1";
const ANIMATION_MODE_KEY = "qunyou-battle-animation-mode-v1";
const roomCode = getRoomCode();
type TableMode = "compact" | "full";
let snapshot: Snapshot | undefined;
let confirmedSnapshot: Snapshot | undefined;
let socket: WebSocket | undefined;
let reconnectTimer = 0;
let reconnectDelay = 800;
let hasConnected = false;
let connectionAttempt = 0;
type CardActionDescriptor = {
  id: string;
  label: string;
  kind: "moveMode" | "move" | "flip" | "inspect" | "declare" | "marker" | "bodyFlip";
  quick: boolean;
  targetZone?: string;
  targetIndex?: number;
  targetOwnerId?: string;
  faceDown?: boolean;
};

type PendingAction = {
  actionId: string;
  type: string;
  baseRevision: number;
  payload: Record<string, unknown>;
  label: string;
  successMessage: string;
  lockKey: string;
  cardId?: string;
  targetKey?: string;
  ackRevision?: number;
  optimistic?: boolean;
  slow?: boolean;
  sent?: boolean;
  timeoutId?: number;
};

type ActiveMoveTargets = {
  cardId: string;
  actions: CardActionDescriptor[];
};

let activeMoveTargets: ActiveMoveTargets | null = null;
const pendingActions = new Map<string, PendingAction>();
let highlightedTargetKey = "";
let highlightedTargetTimer = 0;
let coachStep = 0;
let toastTimer = 0;
let coachShown = false;
let roomEnded = false;
let restartCountdownTimer = 0;
let tableMode: TableMode = localStorage.getItem(TABLE_MODE_KEY) === "full" ? "full" : "compact";
let activeRegion = "battle-player-opponent";
let regionScrollFrame = 0;
let regionScrollLockUntil = 0;
let highlightedSkillCardId = "";
let highlightedSkillUntil = 0;
let highlightedSkillTimer = 0;
let logFilter: PreservedUI["logFilter"] = "all";
let dialogReturnFocus: HTMLElement | null = null;
let animationMode = readAnimationMode();
const effectQueue: VisualEffectEvent[] = [];
const seenEffectIds = new Set<string>();
const seenEffectKeys = new Set<string>();
let effectPlaying = false;
let effectTimer = 0;
let effectResolve: (() => void) | undefined;
let effectGeneration = 0;
let bodyPortraitsPreloaded = false;

const COACH_STEPS = [
  { title: "点击卡牌查看技能", text: "点任意卡牌可阅读完整效果，并从菜单移动到其他区域。" },
  { title: "拖拽或点击落点", text: "桌面端可拖拽卡牌；移动端请用菜单里的「点击落点移动」，再点目标区域。" },
  { title: "结束回合与日志", text: "中央栏可结束回合、查看操作日志。系统不自动判定规则，请双方诚信结算。" },
  { title: "键盘也能快速操作", text: "按 D 摸牌、R 上阵角色、E 结束回合；按 Esc 可取消落点或关闭弹窗。" },
];

roomLabel.textContent = roomCode;
applyTableMode();
applyAnimationMode();

function setConnectionState(label: string, state: string) {
  statusText.textContent = label;
  status.dataset.state = state;
  if (state === "open" || state === "closed" || state === "failed") announce(label);
}

setConnectionState("连接中", "connecting");

function showToast(message: string) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function announce(message: string) {
  if (!announcerEl) return;
  announcerEl.textContent = "";
  window.requestAnimationFrame(() => {
    announcerEl.textContent = message;
  });
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

document.querySelectorAll<HTMLButtonElement>("[data-copy-invite]").forEach((button) => {
  button.addEventListener("click", async () => {
    const inviteUrl = new URL("/play", location.origin);
    inviteUrl.searchParams.set("room", roomCode);
    await copyText(inviteUrl.toString(), button, "已复制");
  });
});

document.querySelector("#battle-copy-code")?.addEventListener("click", async (event) => {
  await copyText(roomCode, event.currentTarget as HTMLButtonElement, "已复制", "复制码");
});

document.querySelector(".battle-topbar")?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const animationToggle = event.target.closest<HTMLElement>("[data-animation-mode-toggle]");
  if (animationToggle) {
    animationMode = animationMode === "on" ? "off" : "on";
    localStorage.setItem(ANIMATION_MODE_KEY, animationMode);
    applyAnimationMode();
    animationToggle.closest<HTMLDetailsElement>(".battle-topbar-menu")?.removeAttribute("open");
    return;
  }
  const shortcutHelp = event.target.closest<HTMLElement>("[data-shortcut-help]");
  if (shortcutHelp) {
    showShortcutHelp(shortcutHelp);
    shortcutHelp.closest<HTMLDetailsElement>(".battle-topbar-menu")?.removeAttribute("open");
    return;
  }
  const modeToggle = event.target.closest<HTMLElement>("[data-table-mode-toggle]");
  if (modeToggle) {
    tableMode = tableMode === "compact" ? "full" : "compact";
    localStorage.setItem(TABLE_MODE_KEY, tableMode);
    applyTableMode();
    modeToggle.closest<HTMLDetailsElement>(".battle-topbar-menu")?.removeAttribute("open");
    return;
  }
  const commandElement = event.target.closest<HTMLElement>("[data-command]");
  if (commandElement) {
    handleCommand(commandElement);
    commandElement.closest<HTMLDetailsElement>(".battle-topbar-menu")?.removeAttribute("open");
  }
});

// 点击弹窗外部（遮罩）关闭
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  dialog.classList.remove("battle-dialog--art");
  dialog.classList.remove("battle-dialog--custom-picker");
  const returnTarget = dialogReturnFocus;
  dialogReturnFocus = null;
  if (returnTarget?.isConnected) window.requestAnimationFrame(() => returnTarget.focus());
});

document.addEventListener("keydown", (event) => {
  if (shouldIgnoreShortcut(event)) return;
  if (event.key === "Escape") {
    if (activeMoveTargets) {
      activeMoveTargets = null;
      render();
      return;
    }
    if (dialog.open) {
      dialog.close();
      return;
    }
  }
  const key = event.key.toLowerCase();
  const command = key === "d"
    ? "card:draw-hand"
    : key === "r"
      ? "character:deploy"
      : key === "e"
        ? "turn:end"
        : "";
  if (command) {
    const button = root.querySelector<HTMLElement>(`[data-command="${command}"]`);
    if (button && !button.hasAttribute("disabled")) {
      event.preventDefault();
      button.click();
    }
  }
});

function shouldIgnoreShortcut(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return true;
  if (dialog.open) return event.key !== "Escape";
  if (coachEl && !coachEl.hidden) {
    if (event.key === "Escape") {
      finishCoach();
    }
    return true;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='menu']"),
  );
}

function openBattleDialog(returnFocus?: HTMLElement | null) {
  dialogReturnFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  dialog.showModal();
}

root.addEventListener("scroll", () => {
  window.cancelAnimationFrame(regionScrollFrame);
  regionScrollFrame = window.requestAnimationFrame(updateRegionFromScroll);
}, { passive: true });

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
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") as { nickname?: string; deckId?: string; customDeck?: CustomDeckConfig };
  } catch {
    return {};
  }
}

function pendingLoadout() {
  const pending = getPending();
  if (pending.deckId === CUSTOM_DECK_ID && pending.customDeck && isCustomDeckValid(pending.customDeck)) {
    return { deckId: CUSTOM_DECK_ID, customDeck: normalizeCustomDeck(pending.customDeck) };
  }
  if (catalog.decks.some((deck) => deck.id === pending.deckId)) return { deckId: pending.deckId as string };
  return { deckId: catalog.decks[0]?.id || "" };
}

function handshakeLoadout() {
  return { deckId: catalog.decks[0]?.id || "" };
}

function restorePendingLoadout(state: Snapshot) {
  const me = state.players.find((player) => player.id === state.you);
  if (!me || state.game.started || me.ready || hasPendingLock("player:selectDeck")) return;
  const desired = pendingLoadout();
  const sameCustomDeck = desired.deckId === CUSTOM_DECK_ID
    && me.deckId === CUSTOM_DECK_ID
    && JSON.stringify(normalizeCustomDeck(me.customDeck)) === JSON.stringify(desired.customDeck);
  if (me.deckId === desired.deckId && (desired.deckId !== CUSTOM_DECK_ID || sameCustomDeck)) return;
  send("player:selectDeck", desired);
}

function deckFor(player?: PlayerView) {
  return catalog.decks.find((item) => item.id === player?.deckId);
}

function defaultCustomDeck(): CustomDeckConfig {
  return {
    bodyId: bodyCatalogCards[0]?.id || "",
    characterIds: characterCatalogCards.slice(0, 16).map((card) => card.id),
  };
}

function normalizeCustomDeck(value: unknown): CustomDeckConfig {
  const raw = value && typeof value === "object" ? value as Partial<CustomDeckConfig> : {};
  const characterIds = Array.isArray(raw.characterIds)
    ? raw.characterIds
      .filter((id): id is string => typeof id === "string" && catalog.cards[id]?.kind === "character")
      .filter((id, index, items) => items.indexOf(id) === index)
      .slice(0, 16)
    : [];
  for (const card of characterCatalogCards) {
    if (characterIds.length >= 16) break;
    if (!characterIds.includes(card.id)) characterIds.push(card.id);
  }
  return {
    bodyId: typeof raw.bodyId === "string" && catalog.cards[raw.bodyId]?.kind === "body"
      ? raw.bodyId
      : bodyCatalogCards[0]?.id || "",
    characterIds,
  };
}

function readCustomDeck(player?: PlayerView): CustomDeckConfig {
  if (player?.customDeck) return normalizeCustomDeck(player.customDeck);
  try {
    return normalizeCustomDeck(JSON.parse(localStorage.getItem(CUSTOM_DECK_KEY) || "null"));
  } catch {
    return defaultCustomDeck();
  }
}

function saveCustomDeck(deck: CustomDeckConfig) {
  localStorage.setItem(CUSTOM_DECK_KEY, JSON.stringify(deck));
}

function isCustomDeckValid(deck: CustomDeckConfig) {
  return catalog.cards[deck.bodyId]?.kind === "body"
    && deck.characterIds.length === 16
    && new Set(deck.characterIds).size === 16
    && deck.characterIds.every((id) => catalog.cards[id]?.kind === "character");
}

function customDeckLabel(player?: PlayerView) {
  const deck = readCustomDeck(player);
  const body = catalog.cards[deck.bodyId];
  return `自组牌组${body ? ` · ${body.name}` : ""}`;
}

function themeClasses(theme?: string) {
  const slug = theme ?? "neutral";
  return slug === "aggro" ? "deck-theme" : `deck-theme deck-theme--${slug}`;
}

function applyTableMode() {
  const app = document.querySelector<HTMLElement>("#battle-app");
  if (app) app.dataset.tableMode = tableMode;
  document.querySelectorAll<HTMLElement>("[data-table-mode-toggle]").forEach((button) => {
    const compact = tableMode === "compact";
    button.textContent = compact ? "紧凑模式" : "完整模式";
    button.setAttribute("aria-pressed", String(compact));
    button.title = compact ? "切换到完整布局" : "切换到紧凑布局";
  });
}

function readAnimationMode(): AnimationMode {
  const saved = localStorage.getItem(ANIMATION_MODE_KEY);
  return saved === "off" ? "off" : "on";
}

function effectiveAnimationMode(): AnimationMode {
  return animationMode;
}

function applyAnimationMode() {
  app.dataset.animationMode = effectiveAnimationMode();
  const labels: Record<AnimationMode, string> = {
    on: "动画：打开",
    off: "动画：关闭",
  };
  document.querySelectorAll<HTMLElement>("[data-animation-mode-toggle]").forEach((button) => {
    button.textContent = labels[animationMode];
    button.setAttribute("aria-label", `${labels[animationMode]}，点击切换`);
    button.title = "切换战斗动画效果";
  });
  if (effectiveAnimationMode() === "off") clearVisualEffects();
}

function captureUIState(): PreservedUI {
  const scrollLeft: Record<string, number> = {};
  root.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
    if (element.dataset.scrollKey) scrollLeft[element.dataset.scrollKey] = element.scrollLeft;
  });
  const logDetails = root.querySelector<HTMLDetailsElement>(".battle-log");
  return {
    scrollLeft,
    logOpen: logDetails?.open ?? false,
    logFilter,
    activeRegion,
    rootScrollTop: root.scrollTop,
  };
}

function restoreUIState(state: PreservedUI) {
  Object.entries(state.scrollLeft).forEach(([key, value]) => {
    const element = root.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`);
    if (element) element.scrollLeft = value;
  });
  const logDetails = root.querySelector<HTMLDetailsElement>(".battle-log");
  if (logDetails && state.logOpen) logDetails.open = true;
  logFilter = state.logFilter || logFilter;
  activeRegion = state.activeRegion || activeRegion;
  root.scrollTop = state.rootScrollTop;
  updateRegionNavigation();
  if (activeMoveTargets) {
    applyMoveTargetHints(activeMoveTargets);
    showToast("请选择标注的目标区域，按 Esc 取消");
  }
  if (highlightedTargetKey) applyHighlightedTarget();
  applyInteractionAvailability();
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
  const initialLoadout = handshakeLoadout();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_URL}/rooms/${roomCode}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        nickname: pending.nickname,
        ...initialLoadout,
      }),
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
    setConnectionState(snapshot ? `已同步 · r${snapshot.revision}` : "已连接，等待同步", "open");
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "snapshot") {
      const nextSnapshot = normalizeBattleSnapshot(message.snapshot);
      const previousSnapshot = confirmedSnapshot ?? snapshot;
      const restarted = didGameRestart(previousSnapshot, nextSnapshot);
      if (restarted) resetTransientUIForRestart();
      if (!restarted) enqueueSnapshotVisualEffects(previousSnapshot, nextSnapshot);
      confirmedSnapshot = nextSnapshot;
      rebuildOptimisticSnapshot();
      settleConfirmedActions();
      setConnectionState(`已同步 · r${nextSnapshot.revision}`, "open");
      render();
      restorePendingLoadout(nextSnapshot);
      preloadBodyPortraits();
      flushVisualEffects();
      if (restarted) showToast("牌局已重新开始");
    } else if (message.type === "actionAck") {
      const pending = pendingActions.get(message.actionId);
      if (!pending) return;
      pending.ackRevision = message.revision;
      settleConfirmedActions();
    } else if (message.type === "inspection") {
      showInspection(
        message.title,
        message.cards,
        message.inspectionId,
        message.viewerId,
        message.allowedActions,
      );
    } else if (message.type === "visualEffect") {
      enqueueVisualEffect(message);
    } else if (message.type === "roomEnded") {
      roomEnded = true;
      hasConnected = false;
      connectionAttempt += 1;
      window.clearTimeout(reconnectTimer);
      root.innerHTML = `<section class="battle-loading hud-panel">
        <span class="battle-kicker">游戏结束</span>
        <h1>房间已关闭</h1>
        <p>这场游戏已经结束，房间已关闭。</p>
        <a class="btn btn--primary" href="/play">返回在线对战</a>
      </section>`;
      setConnectionState("已结束", "failed");
      syncRoomControls(false);
      clearVisualEffects();
    } else if (message.type === "error") {
      rejectPendingAction(message.actionId);
      showError(message.error);
    }
  });
  socket.addEventListener("close", () => {
    window.clearTimeout(socketTimeout);
    if (roomEnded) return;
    if (attempt !== connectionAttempt) return;
    if (socketFailureHandled) return;
    if (!hasConnected) {
      renderConnectionError("实时连接被拒绝或中断。请确认房间仍存在，并检查当前网络是否允许 WebSocket 连接。");
      return;
    }
    clearPendingActions(true);
    clearVisualEffects();
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

function actionFeedback(type: string, payload: Record<string, unknown>) {
  const targetZone = typeof payload.targetZone === "string" ? payload.targetZone : "";
  const targetIndex = Number.isInteger(payload.targetIndex) ? Number(payload.targetIndex) : undefined;
  const targetLabels: Record<string, string> = {
    resolving: "结算区",
    handDiscard: "手牌弃牌区",
    handDeckTop: "共用牌堆顶",
    handDeckBottom: "共用牌堆底",
    opponentHand: "对手手牌",
    hand: "我的手牌",
    handMarker: "角色位标记",
    characterDeckBottom: "角色牌堆底",
    characterDeckShuffle: "角色牌堆",
    retired: "退场区",
    banished: "移出游戏区",
    characterSlot: `角色位 ${Number(targetIndex) + 1}`,
  };
  if (type === "card:move") {
    const target = targetLabels[targetZone] || "目标区域";
    const cardName = cardDisplayName(String(payload.instanceId || ""));
    return {
      label: `移动至${target}`,
      successMessage: cardName ? `已将${cardName}置入${target}` : `已置入${target}`,
    };
  }
  const labels: Record<string, string> = {
    "card:draw": "已摸 1 张手牌",
    "character:deploy": "已上阵 1 张角色",
    "card:flip": "已翻转角色",
    "body:flip": "已翻转本体",
    "character:declareSkill": "已声明技能",
    "health:set": "体力已调整",
    "megaProgress:set": "Mega 已调整",
    "deck:shuffle": "牌堆已洗混",
    "deck:recycleDiscard": "弃牌已洗回牌堆底",
    "resolving:discardAll": "结算区已全部弃置",
    "turn:end": "已结束回合",
    "marker:create": "标记已创建",
    "marker:remove": "标记已移除",
    "player:ready": "准备状态已更新",
    "player:selectDeck": "预组已选择",
    "room:restartRequest": "重新开始请求已发送",
    "room:restartRespond": "重新开始回应已发送",
    "room:restartCancel": "重新开始请求已取消",
  };
  const label = labels[type] || "操作已同步";
  return { label, successMessage: label };
}

function cardDisplayName(instanceId: string) {
  const card = findVisibleCard(instanceId);
  const definition = cardDefinition(card);
  if (!definition) return "";
  const poker = card?.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank} ` : "";
  return `【${poker}${definition.name}】`;
}

function actionTargetKey(type: string, payload: Record<string, unknown>) {
  if (type === "card:move") return moveTargetKey(payload);
  const you = snapshot?.you || confirmedSnapshot?.you || "";
  if (type === "card:draw") return you ? `hand@${you}` : "hand";
  if (type === "character:deploy") return you ? `characterDeckBottom@${you}` : "characterDeckBottom";
  if (type === "card:flip" || type === "character:declareSkill") {
    return typeof payload.instanceId === "string" ? `card:${payload.instanceId}` : undefined;
  }
  if (type === "body:flip") return you ? `body@${you}` : undefined;
  if (type === "health:set" || type === "megaProgress:set") {
    const playerId = String(payload.playerId || you);
    return playerId ? `player@${playerId}` : undefined;
  }
  if (type === "deck:shuffle") return payload.deck === "hand" ? "handDeckTop" : you ? `characterDeckBottom@${you}` : "characterDeckBottom";
  if (type === "deck:recycleDiscard") return "handDeckTop";
  if (type === "resolving:discardAll") return "handDiscard";
  if (type === "turn:end") return "battle-center";
  if (type === "marker:create" && Number.isInteger(payload.slotIndex)) return `characterSlot:${String(payload.slotIndex)}@${you}`;
  return undefined;
}

function actionLockKey(type: string, payload: Record<string, unknown>) {
  if (typeof payload.instanceId === "string" && payload.instanceId) return `card:${payload.instanceId}`;
  if ((type === "health:set" || type === "megaProgress:set") && payload.playerId) {
    return `${type}:${String(payload.playerId)}`;
  }
  return type;
}

function hasPendingLock(lockKey: string) {
  return [...pendingActions.values()].some((action) => action.lockKey === lockKey);
}

function send(type: string, payload: Record<string, unknown> = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    showError("连接尚未恢复，请稍后再试。");
    return undefined;
  }
  const lockKey = actionLockKey(type, payload);
  if (hasPendingLock(lockKey)) {
    showToast("该操作正在同步，请稍候");
    return undefined;
  }
  const feedback = actionFeedback(type, payload);
  const msg = {
    type,
    actionId: crypto.randomUUID(),
    protocolVersion: 2,
    baseRevision: confirmedSnapshot?.revision ?? snapshot?.revision,
    payload,
  };
  const optimistic = type === "card:move" && applyOptimisticMove(payload);
  const pending: PendingAction = {
    actionId: msg.actionId,
    type,
    baseRevision: msg.baseRevision ?? 0,
    payload,
    label: feedback.label,
    successMessage: feedback.successMessage,
    lockKey,
    cardId: typeof payload.instanceId === "string" ? payload.instanceId : undefined,
    targetKey: actionTargetKey(type, payload),
    optimistic,
  };
  pendingActions.set(msg.actionId, pending);
  dispatchNextPendingAction();
  render();
  return msg.actionId;
}

function dispatchNextPendingAction() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  if ([...pendingActions.values()].some((action) => action.sent)) return;
  const pending = [...pendingActions.values()][0];
  if (!pending) return;
  pending.sent = true;
  pending.baseRevision = confirmedSnapshot?.revision ?? snapshot?.revision ?? 0;
  pending.timeoutId = window.setTimeout(() => {
    const current = pendingActions.get(pending.actionId);
    if (!current) return;
    current.slow = true;
    showToast("同步时间较长，正在等待服务器确认");
    render();
  }, 8000);
  socket.send(JSON.stringify({
    type: pending.type,
    actionId: pending.actionId,
    protocolVersion: 2,
    baseRevision: pending.baseRevision,
    payload: pending.payload,
  }));
}

function moveTargetKey(payload: Record<string, unknown>) {
  const targetZone = String(payload.targetZone || "");
  const targetIndex = Number.isInteger(payload.targetIndex) ? `:${String(payload.targetIndex)}` : "";
  const targetOwner = payload.targetOwnerId ? `@${String(payload.targetOwnerId)}` : "";
  return `${targetZone}${targetIndex}${targetOwner}`;
}

function cloneSnapshot(value: Snapshot) {
  return structuredClone(value);
}

function removeVisibleCard(state: Snapshot, instanceId: string) {
  for (const player of state.players) {
    if (player.body?.instanceId === instanceId) {
      const card = player.body;
      player.body = undefined;
      return { card, owner: player };
    }
    const handIndex = player.hand.findIndex((card) => card.instanceId === instanceId);
    if (handIndex >= 0) return { card: player.hand.splice(handIndex, 1)[0], owner: player };
    const retiredIndex = player.retired.findIndex((card) => card.instanceId === instanceId);
    if (retiredIndex >= 0) return { card: player.retired.splice(retiredIndex, 1)[0], owner: player };
    const banishedIndex = player.banished.findIndex((card) => card.instanceId === instanceId);
    if (banishedIndex >= 0) return { card: player.banished.splice(banishedIndex, 1)[0], owner: player };
    const slotIndex = player.characterSlots.findIndex((item) => item && "instanceId" in item && item.instanceId === instanceId);
    if (slotIndex >= 0) {
      const card = player.characterSlots[slotIndex] as CardView;
      player.characterSlots[slotIndex] = null;
      return { card, owner: player };
    }
  }
  const resolvingIndex = state.game.resolving.findIndex((card) => card.instanceId === instanceId);
  if (resolvingIndex >= 0) {
    const card = state.game.resolving.splice(resolvingIndex, 1)[0];
    return { card, owner: state.players.find((player) => player.id === card.ownerId) };
  }
  const discardIndex = state.game.handDiscard.findIndex((card) => card.instanceId === instanceId);
  if (discardIndex >= 0) {
    const card = state.game.handDiscard.splice(discardIndex, 1)[0];
    return { card, owner: state.players.find((player) => player.id === card.ownerId) };
  }
  return undefined;
}

function applyMoveToSnapshot(state: Snapshot, payload: Record<string, unknown>) {
  const instanceId = String(payload.instanceId || "");
  const targetZone = String(payload.targetZone || "");
  const targetIndex = Number(payload.targetIndex);
  const located = removeVisibleCard(state, instanceId);
  if (!located) return false;
  const { card } = located;
  const actor = state.players.find((player) => player.id === state.you);
  const owner = located.owner ?? state.players.find((player) => player.id === card.ownerId) ?? actor;
  if (!actor || !owner) return false;
  if (targetZone === "resolving") state.game.resolving.push(card);
  else if (targetZone === "handDiscard") state.game.handDiscard.push({ ...card, faceDown: false });
  else if (targetZone === "handDeckTop" || targetZone === "handDeckBottom") state.game.handDeckCount += 1;
  else if (targetZone === "hand") actor.hand.push({ ...card, ownerId: actor.id });
  else if (targetZone === "opponentHand") {
    const opponent = state.players.find((player) => player.id !== actor.id);
    if (!opponent) return false;
    opponent.handCount = (opponent.handCount ?? opponent.hand.length) + 1;
    opponent.hand.push({ faceDown: true });
  } else if (targetZone === "characterDeckBottom" || targetZone === "characterDeckShuffle") {
    owner.characterDeckCount += 1;
  } else if (targetZone === "retired") owner.retired.push({ ...card, faceDown: false });
  else if (targetZone === "banished") owner.banished.push(card);
  else if (targetZone === "characterSlot" && Number.isInteger(targetIndex) && !owner.characterSlots[targetIndex]) {
    owner.characterSlots[targetIndex] = { ...card, faceDown: Boolean(payload.faceDown), slotIndex: targetIndex };
  } else {
    return false;
  }
  if (card.ownerId === actor.id && targetZone !== "hand") {
    actor.handCount = actor.hand.length;
  }
  return true;
}

function rebuildOptimisticSnapshot() {
  if (!confirmedSnapshot) return;
  snapshot = cloneSnapshot(confirmedSnapshot);
  for (const action of pendingActions.values()) {
    if (action.type !== "card:move" || !action.optimistic || !action.cardId || !action.targetKey) continue;
    const [dropTarget] = action.targetKey.split("@");
    const [targetZone, rawIndex] = dropTarget.split(":");
    applyMoveToSnapshot(snapshot, {
      instanceId: action.cardId,
      targetZone,
      targetIndex: rawIndex === undefined ? undefined : Number(rawIndex),
      faceDown: targetZone === "characterSlot",
    });
  }
}

function applyOptimisticMove(payload: Record<string, unknown>) {
  if (!snapshot) return false;
  const next = cloneSnapshot(snapshot);
  if (!applyMoveToSnapshot(next, payload)) return false;
  snapshot = next;
  return true;
}

function settleConfirmedActions() {
  const revision = confirmedSnapshot?.revision ?? 0;
  const completed = [...pendingActions.values()].filter(
    (action) => action.ackRevision !== undefined && revision >= action.ackRevision,
  );
  if (!completed.length) return;
  for (const action of completed) {
    if (action.timeoutId) window.clearTimeout(action.timeoutId);
    pendingActions.delete(action.actionId);
  }
  rebuildOptimisticSnapshot();
  const latest = completed.at(-1);
  if (latest?.targetKey) highlightMoveTarget(latest.targetKey);
  if (latest) {
    showToast(latest.successMessage);
    announce(latest.successMessage);
    focusPendingTarget(latest);
  }
  dispatchNextPendingAction();
  render();
}

function rejectPendingAction(actionId?: string) {
  const rejected = actionId ? pendingActions.get(actionId) : undefined;
  if (actionId) {
    const pending = pendingActions.get(actionId);
    if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
    pendingActions.delete(actionId);
  }
  activeMoveTargets = null;
  rebuildOptimisticSnapshot();
  dispatchNextPendingAction();
  render();
  if (rejected?.cardId) {
    window.requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-card="${rejected.cardId}"]`)?.focus());
  }
}

function clearPendingActions(notify: boolean) {
  const hadPending = pendingActions.size > 0;
  for (const action of pendingActions.values()) {
    if (action.timeoutId) window.clearTimeout(action.timeoutId);
  }
  pendingActions.clear();
  activeMoveTargets = null;
  rebuildOptimisticSnapshot();
  render();
  if (notify && hadPending) showToast("连接中断，未确认操作已回滚；重连后请核对牌桌");
}

function highlightMoveTarget(targetKey: string) {
  highlightedTargetKey = targetKey;
  window.clearTimeout(highlightedTargetTimer);
  highlightedTargetTimer = window.setTimeout(() => {
    highlightedTargetKey = "";
    render();
  }, 700);
}

function elementForTargetKey(targetKey: string) {
  if (targetKey === "battle-center") return document.getElementById("battle-center") ?? undefined;
  if (targetKey.startsWith("card:")) {
    return root.querySelector<HTMLElement>(`[data-card="${CSS.escape(targetKey.slice(5))}"]`) ?? undefined;
  }
  if (targetKey.startsWith("body@")) {
    return root.querySelector<HTMLElement>(`[data-owner="${CSS.escape(targetKey.slice(5))}"][data-zone="body"]`) ?? undefined;
  }
  if (targetKey.startsWith("player@")) {
    return root.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(targetKey.slice(7))}"]`) ?? undefined;
  }
  const [dropTarget, ownerId] = targetKey.split("@");
  return [...root.querySelectorAll<HTMLElement>("[data-drop-target]")].find((element) =>
    element.dataset.dropTarget === dropTarget
    && (!ownerId || element.dataset.zoneOwner === ownerId)
  );
}

function focusPendingTarget(action: PendingAction) {
  if (!action.targetKey) return;
  window.requestAnimationFrame(() => {
    const target = elementForTargetKey(action.targetKey || "");
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });
}

function didGameRestart(previous: Snapshot | undefined, next: Snapshot) {
  if (!previous?.game.started || !next.game.started) return false;
  const previousMe = previous.players.find((player) => player.id === previous.you);
  const nextMe = next.players.find((player) => player.id === next.you);
  return Boolean(
    previousMe?.body?.instanceId
    && nextMe?.body?.instanceId
    && previousMe.body.instanceId !== nextMe.body.instanceId,
  );
}

function resetTransientUIForRestart() {
  activeMoveTargets = null;
  clearPendingActions(false);
  activeRegion = "battle-center";
  if (dialog.open) dialog.close();
  dialogContent.innerHTML = "";
  clearVisualEffects();
}

function visualEffectKey(event: VisualEffectEvent) {
  return [
    event.effect,
    event.ownerId,
    event.revision,
    event.definitionId || "",
    Number.isInteger(event.slotIndex) ? String(event.slotIndex) : "",
    event.faceDown ? "down" : "up",
  ].join(":");
}

function rememberVisualEffect(event: VisualEffectEvent) {
  if (seenEffectIds.has(event.eventId)) return;
  seenEffectIds.add(event.eventId);
  seenEffectKeys.add(visualEffectKey(event));
  if (seenEffectIds.size > 200) {
    const oldest = seenEffectIds.values().next().value;
    if (oldest) seenEffectIds.delete(oldest);
  }
  if (seenEffectKeys.size > 200) {
    const oldest = seenEffectKeys.values().next().value;
    if (oldest) seenEffectKeys.delete(oldest);
  }
  return true;
}

function enqueueVisualEffect(event: VisualEffectEvent) {
  if (event.effect === "characterFlip" && event.faceDown) return;
  if (seenEffectKeys.has(visualEffectKey(event))) return;
  if (!rememberVisualEffect(event)) return;
  if (effectiveAnimationMode() === "off") return;
  effectQueue.push(event);
  effectQueue.sort((left, right) => left.revision - right.revision);
  flushVisualEffects();
}

function enqueueSnapshotVisualEffects(previous: Snapshot | undefined, next: Snapshot) {
  if (!next.game.started) return;
  if (previous && previous.game.currentPlayerId !== next.game.currentPlayerId && next.game.currentPlayerId) {
    const current = next.players.find((player) => player.id === next.game.currentPlayerId);
    if (current) {
      enqueueVisualEffect({
        type: "visualEffect",
        eventId: `turn-start-${next.revision}-${current.id}`,
        revision: next.revision,
        effect: "turnStart",
        ownerId: current.id,
        definitionId: current.body?.definitionId,
      });
    }
  }
  if (!previous?.game.started) return;
  for (const player of next.players) {
    const before = previous.players.find((item) => item.id === player.id);
    if (before && before.bodyFlipped !== player.bodyFlipped && player.body?.definitionId) {
      enqueueVisualEffect({
        type: "visualEffect",
        eventId: `body-flip-${next.revision}-${player.id}-${player.bodyFlipped ? "mega" : "normal"}`,
        revision: next.revision,
        effect: "bodyMega",
        ownerId: player.id,
        definitionId: player.body.definitionId,
        faceDown: !player.bodyFlipped,
      });
    }
    player.characterSlots.forEach((slot, slotIndex) => {
      if (!slot || "label" in slot) return;
      const previousSlot = before?.characterSlots[slotIndex];
      if (!previousSlot || "label" in previousSlot) return;
      if (previousSlot.faceDown === slot.faceDown) return;
      if (slot.faceDown) return;
      enqueueVisualEffect({
        type: "visualEffect",
        eventId: `character-flip-${next.revision}-${player.id}-${slotIndex}-up`,
        revision: next.revision,
        effect: "characterFlip",
        ownerId: player.id,
        definitionId: slot.definitionId,
        slotIndex,
        faceDown: false,
      });
    });
  }
}

async function flushVisualEffects() {
  if (effectPlaying || !snapshot || effectiveAnimationMode() === "off") return;
  const next = effectQueue[0];
  if (!next || snapshot.revision < next.revision) return;
  effectQueue.shift();
  effectPlaying = true;
  const generation = effectGeneration;
  try {
    await playVisualEffect(next, generation);
  } finally {
    effectPlaying = false;
    if (generation === effectGeneration) flushVisualEffects();
  }
}

function visualEffectSource(event: VisualEffectEvent) {
  if (event.effect === "characterFlip" || event.effect === "characterSkill") {
    if (!Number.isInteger(event.slotIndex)) return undefined;
    return root.querySelector<HTMLElement>(
      `[data-owner="${event.ownerId}"][data-zone="slot:${event.slotIndex}"]`,
    ) ?? undefined;
  }
  return root.querySelector<HTMLElement>(`[data-owner="${event.ownerId}"][data-zone="body"]`) ?? undefined;
}

async function playVisualEffect(event: VisualEffectEvent, generation: number) {
  const mode = effectiveAnimationMode();
  if (mode === "off") return;
  if (event.effect === "characterFlip" && event.faceDown) return;
  const source = visualEffectSource(event);
  const sourceClass = event.effect === "turnStart"
    ? "is-effect-turn"
    : event.effect === "characterFlip"
      ? "is-effect-flip"
      : event.effect === "characterSkill"
        ? "is-effect-skill"
        : event.faceDown
          ? "is-effect-mega-return"
          : "is-effect-mega";
  source?.classList.add(sourceClass);

  const definition = event.definitionId ? catalog.cards[event.definitionId] : undefined;
  const owner = snapshot?.players.find((player) => player.id === event.ownerId);
  const isSelf = event.ownerId === snapshot?.you;
  const title = event.effect === "turnStart"
    ? (isSelf ? "你的回合" : `${owner?.nickname || "对手"}的回合`)
    : event.effect === "characterFlip"
      ? (event.faceDown ? "角色暗置" : "角色明置")
      : event.effect === "characterSkill"
        ? definition?.subtitle.split(" · ").at(-1) || "技能发动"
        : event.faceDown
          ? "回归常态"
          : definition?.extraFormLabel || "额外形态";
  const subtitle = event.effect === "characterSkill"
    ? definition?.name || "角色技能"
    : event.effect === "bodyMega"
      ? (event.faceDown ? definition?.name : definition?.extraName || definition?.name)
      : definition?.name || owner?.nickname || "";

  if (mode === "on") {
    const portrait = event.effect === "bodyMega" && !event.faceDown
      ? definition?.extraPortraitPath || definition?.extraHighResImagePath || definition?.extraImagePath
      : definition?.portraitPath || definition?.highResImagePath || definition?.imagePath;
    const normalCard = definition?.highResImagePath || definition?.imagePath;
    const megaCard = definition?.extraHighResImagePath || definition?.extraImagePath || normalCard;
    const frontCard = event.effect === "bodyMega" && event.faceDown ? megaCard : normalCard;
    const backCard = event.effect === "bodyMega" && event.faceDown ? normalCard : megaCard;
    effectLayer.innerHTML = `<section class="battle-cinematic battle-cinematic--${event.effect}${event.faceDown ? " is-returning" : ""}">
      <div class="battle-cinematic__shade"></div>
      <div class="battle-cinematic__energy" aria-hidden="true"><i></i><i></i><i></i></div>
      ${event.effect === "bodyMega" && frontCard
        ? `<div class="battle-cinematic__flip-card">
            <img class="battle-cinematic__card-front" src="${escapeHtml(frontCard)}" alt="" />
            <img class="battle-cinematic__card-back" src="${escapeHtml(backCard || frontCard)}" alt="" />
          </div>`
        : ""}
      ${portrait ? `<img class="battle-cinematic__portrait" src="${escapeHtml(portrait)}" alt="" />` : ""}
      <div class="battle-cinematic__caption">
        <small>${escapeHtml(subtitle || "")}</small>
        <strong>${escapeHtml(title)}</strong>
      </div>
    </section>`;
    effectLayer.classList.add("is-playing");
  }

  announce(`${subtitle ? `${subtitle}，` : ""}${title}`);
  const duration = mode === "on"
    ? event.effect === "bodyMega" ? 1180 : event.effect === "characterFlip" ? 720 : 980
    : 0;
  await new Promise<void>((resolve) => {
    effectResolve = resolve;
    window.clearTimeout(effectTimer);
    effectTimer = window.setTimeout(() => {
      effectResolve = undefined;
      resolve();
    }, duration);
  });
  if (generation !== effectGeneration) return;
  source?.classList.remove(sourceClass);
  effectLayer.classList.remove("is-playing");
  effectLayer.innerHTML = "";
}

function clearVisualEffects() {
  effectGeneration += 1;
  effectQueue.length = 0;
  window.clearTimeout(effectTimer);
  effectResolve?.();
  effectResolve = undefined;
  effectLayer.classList.remove("is-playing");
  effectLayer.innerHTML = "";
  root.querySelectorAll<HTMLElement>(
    ".is-effect-turn, .is-effect-flip, .is-effect-skill, .is-effect-mega, .is-effect-mega-return",
  ).forEach((element) => {
    element.classList.remove(
      "is-effect-turn",
      "is-effect-flip",
      "is-effect-skill",
      "is-effect-mega",
      "is-effect-mega-return",
    );
  });
  effectPlaying = false;
}

function preloadBodyPortraits() {
  if (bodyPortraitsPreloaded || !snapshot?.game.started) return;
  bodyPortraitsPreloaded = true;
  const paths = snapshot.players.flatMap((player) => {
    const definition = cardDefinition(player.body);
    return [definition?.portraitPath, definition?.extraPortraitPath].filter((path): path is string => Boolean(path));
  });
  for (const path of new Set(paths)) {
    const image = new Image();
    image.decoding = "async";
    image.src = path;
  }
}

function render() {
  if (!snapshot) return;
  app.dataset.phase = snapshot.game.started ? "game" : "lobby";
  syncRoomControls(snapshot.game.started && !snapshot.pendingRestart);
  window.clearInterval(restartCountdownTimer);
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
  const myHandCount = me.handCount ?? me.hand.length;
  root.innerHTML = `
    ${activeMoveTargets ? `<div class="battle-move-banner">点击落点模式 · 请选择标注的目标区域（Esc 取消）</div>` : ""}
    ${renderRestartRequest(me, opponent)}
    <div class="battle-table">
      ${opponent ? renderPlayer(opponent, false, isMyTurn) : renderWaitingSeat()}
      ${renderCenter(snapshot.game, me, opponent, isMyTurn)}
      ${renderPlayer(me, true, isMyTurn)}
    </div>
    <nav class="battle-region-nav" aria-label="牌桌区域导航">
      <button type="button" data-region-target="battle-player-opponent"><span>对手</span></button>
      <button type="button" data-region-target="battle-center"><span>公共区</span></button>
      <button type="button" data-region-target="battle-player-self"><span>我的阵地</span></button>
      <button type="button" data-region-target="battle-hand-self"><span>手牌</span><b>${myHandCount}</b></button>
    </nav>
  `;
  bindActions();
  bindRegionNavigation();
  restoreUIState(preserved);
  startRestartCountdown();
  maybeShowCoach();
}

function bindRegionNavigation() {
  root.querySelectorAll<HTMLButtonElement>("[data-region-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.dataset.regionTarget || "";
      const target = document.getElementById(targetId);
      if (!target) return;
      const rootBounds = root.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      root.scrollTop += targetBounds.top - rootBounds.top - 8;
      activeRegion = targetId;
      regionScrollLockUntil = Date.now() + 500;
      updateRegionNavigation();
    });
  });
  updateRegionNavigation();
}

function updateRegionFromScroll() {
  if (Date.now() < regionScrollLockUntil) return;
  if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
    activeRegion = "battle-hand-self";
    updateRegionNavigation();
    return;
  }
  const rootBounds = root.getBoundingClientRect();
  const focusY = rootBounds.top + Math.min(root.clientHeight * 0.38, 300);
  const regions = ["battle-player-opponent", "battle-center", "battle-player-self", "battle-hand-self"]
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => !!element);
  if (!regions.length) return;
  const closest = regions.reduce((best, element) => {
    const bounds = element.getBoundingClientRect();
    const distance = bounds.top <= focusY && bounds.bottom >= focusY
      ? 0
      : Math.min(Math.abs(bounds.top - focusY), Math.abs(bounds.bottom - focusY));
    return distance < best.distance ? { id: element.id, distance } : best;
  }, { id: activeRegion, distance: Number.POSITIVE_INFINITY });
  activeRegion = closest.id;
  updateRegionNavigation();
}

function updateRegionNavigation() {
  root.querySelectorAll<HTMLElement>("[data-region-target]").forEach((button) => {
    const active = button.dataset.regionTarget === activeRegion;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
}

function renderRestartRequest(me: PlayerView, opponent?: PlayerView) {
  const pending = snapshot?.pendingRestart;
  if (!pending) return "";
  const requester = snapshot?.players.find((player) => player.id === pending.requestedBy);
  const isRequester = pending.requestedBy === me.id;
  const remaining = Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000));
  return `<section class="battle-restart-request hud-panel" role="status">
    <div>
      <strong>${escapeHtml(requester?.nickname || "一名玩家")} 请求重新开始</strong>
      <span>双方确认后会重新洗牌和发牌 · <b data-restart-countdown>${remaining}</b> 秒后失效</span>
    </div>
    <div class="battle-restart-request__actions">
      ${isRequester
        ? `<button type="button" class="battle-small-btn" data-command="room:restartCancel" data-request-id="${pending.id}">取消请求</button>`
        : `<button type="button" class="battle-small-btn" data-command="room:restartRespond" data-request-id="${pending.id}" data-accept="false">拒绝</button>
           <button type="button" class="btn btn--primary" data-command="room:restartRespond" data-request-id="${pending.id}" data-accept="true" ${opponent?.connected === false ? "disabled" : ""}>同意重开</button>`}
    </div>
  </section>`;
}

function startRestartCountdown() {
  const pending = snapshot?.pendingRestart;
  if (!pending) return;
  restartCountdownTimer = window.setInterval(() => {
    const node = document.querySelector<HTMLElement>("[data-restart-countdown]");
    if (!node) {
      window.clearInterval(restartCountdownTimer);
      return;
    }
    node.textContent = String(Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)));
  }, 1000);
}

function renderLobby(me: PlayerView, opponent?: PlayerView) {
  const myDeck = deckFor(me);
  const myCustomDeck = readCustomDeck(me);
  const bodyCard = me.deckId === CUSTOM_DECK_ID ? catalog.cards[myCustomDeck.bodyId] : myDeck ? catalog.cards[myDeck.bodyId] : undefined;
  const activeStep = !opponent ? "invite" : !me.ready ? "loadout" : "ready";
  const roomStatus = !opponent
    ? "等待另一名玩家加入"
    : opponent.ready && !me.ready
      ? "对手已准备，等待你确认"
      : me.ready && !opponent.ready
        ? "你已准备，等待对手确认"
        : "双方确认准备后自动开始";
  root.innerHTML = `
    <section class="battle-lobby ${themeClasses(myDeck?.theme)}">
      <header class="battle-lobby__heading">
        <div>
          <span class="battle-kicker">MATCH READY ROOM</span>
          <h1>对战准备室</h1>
        </div>
        <div class="battle-lobby__headline-status">
          <span class="battle-lobby__status"><i class="${opponent ? "is-online" : ""}"></i>${opponent ? "2 / 2 玩家已加入" : "1 / 2 玩家已加入"}</span>
          <p>${roomStatus}</p>
        </div>
      </header>

      <nav class="battle-lobby__progress" aria-label="开局准备进度">
        ${renderLobbyProgressStep("01", "邀请对手", opponent ? "对手已加入" : "等待对手", activeStep === "invite", Boolean(opponent))}
        ${renderLobbyProgressStep("02", "选择阵容", myDeck?.name || customDeckLabel(me), activeStep === "loadout", true)}
        ${renderLobbyProgressStep("03", "确认准备", me.ready ? "已准备" : "待确认", activeStep === "ready", me.ready)}
      </nav>

      <section class="battle-lobby__step battle-lobby__step--invite ${activeStep === "invite" ? "is-active" : ""}">
        <header class="battle-lobby__step-heading">
          <span>01</span><div><strong>邀请对手</strong><p>复制链接发给群友，等待时也可以先选阵容。</p></div>
        </header>
        <div class="battle-invite">
          <div>
            <span class="battle-invite__label">房间码</span>
            <strong class="battle-room-display">${escapeHtml(snapshot?.roomCode || roomCode)}</strong>
          </div>
          <div class="battle-invite__actions">
            <button type="button" class="battle-small-btn" id="lobby-copy-code">复制房间码</button>
            <button type="button" class="btn btn--primary" id="lobby-copy-link">复制邀请链接</button>
          </div>
        </div>
        <div class="battle-lobby__seats">
          ${renderLobbySeat(me, true)}
          <div class="battle-lobby__versus"><span>1V1</span><i></i></div>
          ${opponent ? renderLobbySeat(opponent, false) : `<article class="battle-seat battle-seat--empty"><span class="battle-seat__status"><i></i> 对手座位</span><strong>等待加入</strong><p>对手打开邀请链接后会出现在这里。</p><em>尚未加入</em></article>`}
        </div>
      </section>

      <section class="battle-lobby__step battle-lobby__step--loadout ${activeStep === "loadout" ? "is-active" : ""}">
        <header class="battle-lobby__step-heading">
          <span>02</span><div><strong>选择阵容</strong><p>准备前可随时切换预组，或打开编辑器配置自选牌组。</p></div>
        </header>
        <div class="battle-lobby__loadout">
          <div class="battle-deck-preview" id="battle-deck-preview">
            ${renderDeckPreview(myDeck, bodyCard, me)}
          </div>
          <div class="battle-lobby__controls">
            <label>牌组类型
              <select id="battle-deck-mode" ${me.ready ? "disabled" : ""}>
                <option value="preset" ${me.deckId === CUSTOM_DECK_ID ? "" : "selected"}>预组牌组</option>
                <option value="${CUSTOM_DECK_ID}" ${me.deckId === CUSTOM_DECK_ID ? "selected" : ""}>自选牌组</option>
              </select>
            </label>
            <label data-preset-deck-field ${me.deckId === CUSTOM_DECK_ID ? "hidden" : ""}>我的预组
              <select id="battle-deck-select" ${me.ready || me.deckId === CUSTOM_DECK_ID ? "disabled" : ""}>
                ${catalog.decks.map((deck) => `<option value="${deck.id}" ${deck.id === me.deckId ? "selected" : ""}>${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}</option>`).join("")}
              </select>
            </label>
            ${me.deckId === CUSTOM_DECK_ID ? renderCustomDeckSummary(myCustomDeck, me.ready) : ""}
          </div>
        </div>
      </section>

      <section class="battle-lobby__step battle-lobby__step--ready ${activeStep === "ready" ? "is-active" : ""}">
        <header class="battle-lobby__step-heading">
          <span>03</span><div><strong>确认准备</strong><p>准备后阵容会锁定；双方都确认时自动开局。</p></div>
        </header>
        <div class="battle-lobby__ready-bar">
          <div class="battle-lobby__ready-states">
            ${renderReadyState("你", me)}
            ${opponent ? renderReadyState("对手", opponent) : `<span><i></i><b>对手</b><em>尚未加入</em></span>`}
          </div>
          <button class="btn ${me.ready ? "btn--secondary" : "btn--primary"}" data-command="player:ready" data-ready="${String(!me.ready)}">
            ${me.ready ? "取消准备并修改阵容" : "确认阵容并准备"}
          </button>
        </div>
      </section>
    </section>
  `;
  document.querySelector("#battle-deck-mode")?.addEventListener("change", (event) => {
    const mode = (event.currentTarget as HTMLSelectElement).value;
    const deckId = mode === CUSTOM_DECK_ID
      ? CUSTOM_DECK_ID
      : (document.querySelector("#battle-deck-select") as HTMLSelectElement | null)?.value || catalog.decks[0]?.id || "";
    const customDeck = deckId === CUSTOM_DECK_ID ? readCustomDeck(me) : undefined;
    if (customDeck) saveCustomDeck(customDeck);
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      nickname: me.nickname,
      deckId,
      ...(customDeck ? { customDeck } : {}),
    }));
    send("player:selectDeck", { deckId, ...(customDeck ? { customDeck } : {}) });
  });
  document.querySelector("#battle-deck-select")?.addEventListener("change", (event) => {
    const deckId = (event.currentTarget as HTMLSelectElement).value;
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      nickname: me.nickname,
      deckId,
    }));
    send("player:selectDeck", { deckId });
  });
  document.querySelector("[data-custom-open-editor]")?.addEventListener("click", () => showCustomDeckEditor(me));
  document.querySelector("#lobby-copy-code")?.addEventListener("click", () => copyText(snapshot?.roomCode || roomCode));
  document.querySelector("#lobby-copy-link")?.addEventListener("click", () => {
    const inviteUrl = new URL("/play", location.origin);
    inviteUrl.searchParams.set("room", snapshot?.roomCode || roomCode);
    copyText(inviteUrl.toString());
  });
  bindActions();
}

function renderLobbyProgressStep(number: string, label: string, status: string, active: boolean, complete: boolean) {
  return `<span class="${active ? "is-active" : ""} ${complete ? "is-complete" : ""}">
    <b>${complete ? "✓" : number}</b><i><strong>${label}</strong><small>${escapeHtml(status)}</small></i>
  </span>`;
}

function renderReadyState(label: string, player: PlayerView) {
  return `<span class="${player.ready ? "is-ready" : ""}"><i></i><b>${label}</b><em>${player.ready ? "已准备" : "未准备"}</em></span>`;
}

function renderDeckPreview(deck?: CatalogDeck, body?: CatalogCard, player?: PlayerView) {
  if (player?.deckId === CUSTOM_DECK_ID) {
    const customDeck = readCustomDeck(player);
    const selectedNames = customDeck.characterIds
      .map((id) => catalog.cards[id]?.name)
      .filter(Boolean)
      .slice(0, 4)
      .join("、");
    return `<article class="battle-deck-preview__card ${themeClasses("neutral")}">
      ${body?.imagePath ? `<img src="${body.imagePath}" alt="" class="battle-deck-preview__art" loading="lazy" />` : ""}
      <div>
        <span class="battle-deck-preview__tag">自组牌组</span>
        <strong>${escapeHtml(body?.name || "选择本体")}</strong>
        <p>1 张本体 · ${customDeck.characterIds.length}/16 张角色${selectedNames ? ` · ${escapeHtml(selectedNames)}` : ""}</p>
      </div>
    </article>`;
  }
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

function renderCustomDeckSummary(deck: CustomDeckConfig, disabled: boolean) {
  const body = catalog.cards[deck.bodyId] || bodyCatalogCards[0];
  const selectedNames = deck.characterIds
    .map((id) => catalog.cards[id]?.name)
    .filter(Boolean)
    .slice(0, 4)
    .join("、");
  return `<article class="battle-custom-summary">
    ${body?.imagePath ? `<img src="${escapeHtml(body.imagePath)}" alt="${escapeHtml(body.name)}卡面" />` : ""}
    <div>
      <span>当前自选阵容</span>
      <strong>${escapeHtml(body?.name || "未选本体")}</strong>
      <p>${deck.characterIds.length}/16 张角色${selectedNames ? ` · ${escapeHtml(selectedNames)}` : ""}</p>
    </div>
    <button type="button" class="battle-small-btn battle-small-btn--accent" data-custom-open-editor ${disabled ? "disabled" : ""}>${disabled ? "阵容已锁定" : "编辑自选牌组"}</button>
  </article>`;
}

function renderCustomBodyInfo(card?: CatalogCard) {
  if (!card) return "<p>请选择本体卡。</p>";
  return `
    <div>
      <strong>${escapeHtml(card.name)}</strong>
      <span>${escapeHtml(card.subtitle)}${card.hp ? ` · 体力 ${card.hp}` : ""}</span>
    </div>
    <p>${escapeHtml(card.text)}</p>
    ${card.megaCondition ? `<p><b>${escapeHtml(card.extraConditionLabel || "额外形态条件")}</b>：${escapeHtml(card.megaCondition)}</p>` : ""}
    ${card.extraText ? `<p class="battle-custom-body-info__mega"><b>${escapeHtml(card.extraName || card.extraFormLabel || "额外形态")}</b>：${escapeHtml(card.extraText)}</p>` : ""}
    <button type="button" class="battle-small-btn" data-custom-preview="${card.id}">查看本体详情</button>
  `;
}

function bindCustomPreviewButtons(container: ParentNode) {
  container.querySelectorAll<HTMLElement>("[data-custom-preview]").forEach((button) => {
    if (button.dataset.previewBound === "true") return;
    button.dataset.previewBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showCustomCardPreview(button.dataset.customPreview || "", button);
    });
  });
}

function readCustomDeckFilters(container: HTMLElement): CustomDeckFilters {
  return {
    query: (container.querySelector<HTMLInputElement>("[data-custom-search]")?.value || "").trim().toLowerCase(),
    role: container.querySelector<HTMLElement>("[data-custom-role].is-active")?.dataset.customRole || "",
    tag: container.querySelector<HTMLElement>("[data-custom-tag].is-active")?.dataset.customTag || "",
    selectedOnly: Boolean(container.querySelector<HTMLInputElement>("[data-custom-selected-only]")?.checked),
  };
}

function applyCustomDeckFilters(container: HTMLElement, selected: Set<string>) {
  const filters = readCustomDeckFilters(container);
  let visible = 0;
  container.querySelectorAll<HTMLElement>("[data-custom-card]").forEach((card) => {
    const definition = catalog.cards[card.dataset.cardId || ""];
    const show = Boolean(definition && matchesCustomFilters(definition, filters, selected));
    card.hidden = !show;
    if (show) visible++;
  });
  const visibleCount = container.querySelector<HTMLElement>("[data-custom-visible-count]");
  if (visibleCount) visibleCount.textContent = `${visible} 张结果`;
  const hint = container.querySelector<HTMLElement>("[data-custom-picker-hint]");
  if (hint) hint.textContent = visible === 0 ? "没有匹配的角色牌，请调整搜索或筛选。" : "点击卡牌选择；查看按钮可打开技能与高清卡图。";
}

function showCustomDeckEditor(me: PlayerView) {
  const deck = readCustomDeck(me);
  let draftBodyId = deck.bodyId;
  let draftIds = [...deck.characterIds];
  dialog.classList.add("battle-dialog--custom-picker");
  dialogContent.innerHTML = `<div class="battle-card-menu battle-custom-picker">
    <div class="battle-custom-picker__top">
      <div>
        <span>自选牌组编辑器</span>
        <h2>选择本体与 16 张角色</h2>
      </div>
      <div class="battle-custom-picker__metrics"><span data-custom-visible-count>${characterCatalogCards.length} 张结果</span><strong data-custom-picker-count>${draftIds.length}/16</strong></div>
    </div>
    <section class="battle-custom-editor__body">
      <div class="battle-custom-editor__section-title"><strong>选择本体</strong><span>本体决定牌组的核心玩法</span></div>
      <div class="battle-custom-body-select" data-custom-body-select aria-label="选择本体卡">
        ${bodyCatalogCards.map((card) => `<button type="button" class="battle-custom-body-choice ${card.id === draftBodyId ? "is-selected" : ""}" data-custom-body-option="${card.id}">
          ${card.imagePath ? `<img src="${escapeHtml(card.imagePath)}" alt="${escapeHtml(card.name)}卡面" />` : ""}
          <span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.archetype || card.subtitle)}</small></span>
        </button>`).join("")}
      </div>
      <article class="battle-custom-body-info" data-custom-body-info>${renderCustomBodyInfo(catalog.cards[draftBodyId])}</article>
    </section>
    <div class="battle-custom-editor__section-title"><strong>选择角色</strong><span>需要 16 张不重复角色</span></div>
    <div class="battle-custom-picked battle-custom-picked--tray" data-custom-picker-selected aria-label="已选角色"></div>
    <div class="battle-custom-tools">
      <input type="search" placeholder="搜索名称、群友、技能或效果…" data-custom-search autocomplete="off" />
      <div class="battle-custom-filter" aria-label="按角色定位筛选">
        ${customRoleFilterOptions.map((role) => `<button type="button" class="battle-custom-filter__chip ${role ? "" : "is-active"}" data-custom-role="${escapeHtml(role)}">${role ? escapeHtml(role) : "全部定位"}</button>`).join("")}
      </div>
      <details class="battle-custom-tags"><summary>机制标签</summary><div class="battle-custom-filter" aria-label="按机制标签筛选">
        ${customTagFilterOptions.map((tag) => `<button type="button" class="battle-custom-filter__chip ${tag ? "" : "is-active"}" data-custom-tag="${escapeHtml(tag)}">${tag ? escapeHtml(tag) : "全部标签"}</button>`).join("")}
      </div></details>
      <div class="battle-custom-picker__tools">
        <label class="battle-custom-toggle"><input type="checkbox" data-custom-selected-only /> 仅看已选</label>
        <button type="button" class="battle-small-btn" data-custom-clear>清空已选</button>
        <button type="button" class="battle-small-btn battle-small-btn--accent" data-custom-autofill>自动补齐</button>
      </div>
    </div>
    <div class="battle-custom-builder__grid battle-custom-builder__grid--modal" aria-label="选择 16 张角色卡">
      ${characterCatalogCards.map((card) => {
        const checked = draftIds.includes(card.id);
        const role = card.mainRole || card.subtitle.split(" · ")[0] || "";
        return `<label class="battle-custom-card ${checked ? "is-selected" : ""}" data-custom-card data-card-id="${card.id}" data-role="${escapeHtml(role)}" data-search="${escapeHtml(customCardSearchText(card))}">
          <input type="checkbox" value="${card.id}" data-custom-character ${checked ? "checked" : ""} />
          ${card.imagePath ? `<img src="${card.imagePath}" alt="" loading="lazy" />` : ""}
          <span>${escapeHtml(card.name)}</span>
          <small>${escapeHtml(card.subtitle)}</small>
          <button type="button" class="battle-custom-card__detail" data-custom-preview="${card.id}" aria-label="查看 ${escapeHtml(card.name)}">查看</button>
          <div class="battle-custom-card__tip" role="tooltip">
            <strong>${escapeHtml(card.skillName || card.subtitle || card.name)}</strong>
            <span>${escapeHtml(card.costText || "")}${card.timing ? ` · ${escapeHtml(card.timing)}` : ""}</span>
            <p>${escapeHtml(card.text || "")}</p>
          </div>
        </label>`;
      }).join("")}
    </div>
    <p class="battle-custom-builder__hint" data-custom-picker-hint>点击卡牌选择或取消，鼠标悬停可查看技能。</p>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-custom-picker-done>保存自选牌组</button>
    </div>
  </div>`;
  const syncPicker = () => {
    const picked = new Set(draftIds);
    dialogContent.querySelector<HTMLElement>("[data-custom-picker-count]")!.textContent = `${picked.size}/16`;
    dialogContent.querySelectorAll<HTMLInputElement>("[data-custom-character]").forEach((input) => {
      input.checked = picked.has(input.value);
      input.disabled = !input.checked && picked.size >= 16;
      input.closest(".battle-custom-card")?.classList.toggle("is-selected", input.checked);
    });
    dialogContent.querySelector<HTMLElement>("[data-custom-picker-selected]")!.innerHTML = renderSelectedCharacterTray(catalog.cards, draftIds, true);
    const clear = dialogContent.querySelector<HTMLButtonElement>("[data-custom-clear]");
    const autoFill = dialogContent.querySelector<HTMLButtonElement>("[data-custom-autofill]");
    const done = dialogContent.querySelector<HTMLButtonElement>("[data-custom-picker-done]");
    if (clear) clear.disabled = picked.size === 0;
    if (autoFill) autoFill.disabled = picked.size >= 16;
    if (done) done.disabled = picked.size !== 16 || !catalog.cards[draftBodyId];
    dialogContent.querySelectorAll<HTMLElement>("[data-custom-body-option]").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.customBodyOption === draftBodyId);
    });
    const bodyInfo = dialogContent.querySelector<HTMLElement>("[data-custom-body-info]");
    if (bodyInfo) {
      bodyInfo.innerHTML = renderCustomBodyInfo(catalog.cards[draftBodyId]);
      bindCustomPreviewButtons(bodyInfo);
    }
    applyCustomDeckFilters(dialogContent, picked);
  };
  dialogContent.querySelectorAll<HTMLElement>("[data-custom-body-option]").forEach((button) => {
    button.addEventListener("click", () => {
      draftBodyId = button.dataset.customBodyOption || draftBodyId;
      syncPicker();
    });
  });
  dialogContent.querySelector("[data-custom-search]")?.addEventListener("input", syncPicker);
  dialogContent.querySelectorAll<HTMLElement>("[data-custom-role]").forEach((button) => {
    button.addEventListener("click", () => {
      dialogContent.querySelectorAll("[data-custom-role]").forEach((chip) => chip.classList.toggle("is-active", chip === button));
      syncPicker();
    });
  });
  dialogContent.querySelectorAll<HTMLElement>("[data-custom-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      dialogContent.querySelectorAll("[data-custom-tag]").forEach((chip) => chip.classList.toggle("is-active", chip === button));
      syncPicker();
    });
  });
  dialogContent.querySelector("[data-custom-selected-only]")?.addEventListener("change", syncPicker);
  dialogContent.querySelectorAll<HTMLInputElement>("[data-custom-character]").forEach((input) => input.addEventListener("change", () => {
    draftIds = input.checked ? [...draftIds, input.value].slice(0, 16) : draftIds.filter((id) => id !== input.value);
    syncPicker();
  }));
  dialogContent.querySelector("[data-custom-picker-selected]")?.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-custom-remove]");
    if (!button) return;
    draftIds = draftIds.filter((id) => id !== button.dataset.customRemove);
    syncPicker();
  });
  dialogContent.querySelector("[data-custom-clear]")?.addEventListener("click", () => { draftIds = []; syncPicker(); });
  dialogContent.querySelector("[data-custom-autofill]")?.addEventListener("click", () => {
    draftIds = autoFillCharacters(characterCatalogCards, draftIds, readCustomDeckFilters(dialogContent));
    syncPicker();
  });
  bindCustomPreviewButtons(dialogContent);
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelector("[data-custom-picker-done]")?.addEventListener("click", () => {
    const customDeck = { bodyId: draftBodyId, characterIds: draftIds.slice(0, 16) };
    if (!isCustomDeckValid(customDeck)) return;
    saveCustomDeck(customDeck);
    localStorage.setItem(PENDING_KEY, JSON.stringify({ nickname: me.nickname, deckId: CUSTOM_DECK_ID, customDeck }));
    send("player:selectDeck", { deckId: CUSTOM_DECK_ID, customDeck });
    dialog.close();
  });
  openBattleDialog();
  syncPicker();
}

function showCustomCardPreview(cardId: string, returnTarget?: HTMLElement) {
  const card = catalog.cards[cardId];
  if (!card) return;
  const picker = dialog.open ? dialogContent.querySelector<HTMLElement>(".battle-custom-picker") : null;
  const host = document.createElement("div");
  const isOverlay = Boolean(picker);
  if (picker) {
    host.className = "battle-card-detail-overlay";
    picker.appendChild(host);
  } else {
    dialogContent.innerHTML = "";
    dialogContent.appendChild(host);
  }
  const close = () => {
    if (isOverlay) host.remove();
    else dialog.close();
    if (returnTarget?.isConnected) window.requestAnimationFrame(() => returnTarget.focus());
  };
  const renderPreview = (mode: CardDetailMode = "detail", form: BodyDetailForm = "normal") => {
    const view = resolveCardDetail({ definition: card, visible: true, initialForm: form }, form);
    host.innerHTML = mode === "art"
      ? `${renderCardArtDialog(view)}<button type="button" class="battle-dialog__close battle-card-detail-overlay__close" data-preview-close aria-label="关闭">×</button>`
      : `<div class="battle-card-menu battle-card-menu--rich battle-custom-preview">
          <div class="battle-card-detail">${renderCardArtPreview(view)}${renderCardDetailBody(view)}</div>
          <div class="battle-card-menu__actions battle-card-menu__actions--row"><button type="button" class="battle-small-btn" data-preview-close>关闭</button></div>
        </div>`;
    host.querySelector("[data-preview-close]")?.addEventListener("click", close);
    host.querySelector("[data-card-art-zoom]")?.addEventListener("click", () => renderPreview("art", form));
    host.querySelector("[data-card-detail-back]")?.addEventListener("click", () => renderPreview("detail", form));
    host.querySelectorAll<HTMLElement>("[data-card-form]").forEach((button) => {
      button.addEventListener("click", () => renderPreview("detail", button.dataset.cardForm as BodyDetailForm));
    });
    bindHighResImage(host);
  };
  renderPreview();
  if (!dialog.open) openBattleDialog(returnTarget);
}

function renderLobbySeat(player: PlayerView, isMe: boolean) {
  const deck = deckFor(player);
  const deckText = player.deckId === CUSTOM_DECK_ID
    ? (isMe ? customDeckLabel(player) : "自组牌组")
    : deck ? `${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}` : "尚未选择预组";
  return `<article class="battle-seat ${themeClasses(deck?.theme)} ${player.ready ? "is-ready" : ""}">
    <span class="battle-seat__status"><i class="${player.connected ? "is-online" : ""}"></i>${isMe ? "你的座位" : "对手座位"} · ${player.connected ? "在线" : "离线"}</span>
    <strong>${escapeHtml(player.nickname)}</strong>
    <p>${escapeHtml(deckText)}</p>
    <em>${player.ready ? "已准备" : "未准备"}</em>
  </article>`;
}

function renderPlayer(player: PlayerView, isMe: boolean, isMyTurn: boolean) {
  const body = cardDefinition(player.body);
  const deck = deckFor(player);
  const handCount = player.handCount ?? player.hand.length;
  const max = body?.megaMax;
  const megaText = max ? `${player.megaProgress || 0}/${max}` : String(player.megaProgress || 0);
  const extraFormLabel = body?.extraFormLabel || "额外形态";
  const turnClass = snapshot?.game.currentPlayerId === player.id ? " battle-player--active-turn" : "";
  return `
    <section id="battle-player-${isMe ? "self" : "opponent"}" class="battle-player ${themeClasses(deck?.theme)} ${isMe ? "battle-player--self" : "battle-player--opponent"}${turnClass}" data-side="${isMe ? "self" : "opponent"}" data-player-id="${player.id}">
      <header class="battle-player__header">
        <div class="battle-player__identity">
          <span><i class="${player.connected ? "is-online" : ""}"></i>${isMe ? "你的阵地" : "对手阵地"} · ${player.connected ? "在线" : "离线"}</span>
          <strong>${escapeHtml(player.nickname)}</strong>
          ${snapshot?.game.currentPlayerId === player.id ? `<span class="battle-turn-badge">${isMe && isMyTurn ? "你的回合" : "当前回合"}</span>` : ""}
        </div>
        <div class="battle-counters">
          ${renderCounter("体力", player.health || 0, "health:set", player.id, true)}
          ${renderCounter(extraFormLabel, megaText, "megaProgress:set", player.id, isMe, max)}
        </div>
      </header>
      <div class="battle-player__field">
        <div class="battle-body-zone">
          <span class="battle-zone-label">本体</span>
          ${renderCard(player.body, { owner: player, zone: "body", interactive: isMe, flipped: player.bodyFlipped, size: "field" })}
          ${isMe ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
          ${body?.megaCondition ? `<p class="battle-mega-condition" title="${escapeHtml(body.megaCondition)}"><strong>${escapeHtml(body.extraConditionLabel || "额外形态条件")}</strong>${escapeHtml(body.megaCondition)}</p>` : ""}
        </div>
        <div class="battle-character-slots">
          <span class="battle-zone-label battle-zone-label--row">角色区</span>
          <div class="battle-character-slots__grid">
            ${player.characterSlots.map((item, index) => renderSlot(item, index, player, isMe)).join("")}
          </div>
        </div>
      </div>
      <div class="battle-player__private">
        <div class="battle-private-rail battle-private-rail--characters battle-character-resources">
          <div class="battle-private-rail__title">
            <strong>${isMe ? "我的角色资源" : "对手角色资源"}</strong>
          </div>
          <div class="battle-side-zones">
            ${renderPile("角色牌堆", player.characterDeckCount, isMe ? "character:deploy" : "", "上阵角色", player.id, isMe ? "R" : undefined)}
            ${renderZone("退场区", player.retired, player, "retired", isMe)}
            ${renderZone("移出游戏", player.banished, player, "banished", isMe)}
          </div>
        </div>
        <div ${isMe ? 'id="battle-hand-self"' : ""} class="battle-private-rail battle-private-rail--hand"
          data-drop-target="${isMe ? "hand" : "opponentHand"}" data-zone-owner="${player.id}">
          <div class="battle-private-rail__title">
            <strong>${isMe ? "我的手牌" : "对手手牌"}</strong>
            <span>${handCount} 张</span>
            ${!isMe ? `<button class="battle-small-btn" data-command="card:inspect-zone" data-owner="${player.id}" data-zone="hand">查看手牌</button>` : ""}
          </div>
          <div class="battle-card-row" data-scroll-key="${isMe ? "hand-self" : "hand-opp"}">${player.hand.map((card) => renderCard(card, { owner: player, zone: "hand", interactive: isMe, size: isMe ? "hand" : "compact" })).join("")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number) {
  const numeric = typeof value === "number" ? value : Number(String(value).split("/")[0]);
  const ready = max !== undefined && numeric >= max;
  return `<div class="battle-counter ${ready ? "is-ready" : ""}">
    <span>${label}</span><strong>${value}</strong>
    ${editable ? `<div class="battle-counter__actions">
      <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric - 1}" aria-label="${label}减一">−</button>
      <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric + 1}" aria-label="${label}加一">＋</button>
      <button type="button" data-counter-set="${command}" data-player="${playerId}" data-current="${numeric}" data-label="${label}">设置</button>
    </div>` : ""}
  </div>`;
}

function renderCenter(game: GameView, me: PlayerView, opponent: PlayerView | undefined, isMyTurn: boolean) {
  const current = snapshot?.players.find((player) => player.id === game.currentPlayerId);
  const recentLogs = game.logs.slice(-3).reverse();
  const filteredLogs = filterBattleLogs(game.logs, logFilter, snapshot?.you || "").slice(-30).reverse() as BattleLog[];
  const endTurnDisabled = !isMyTurn ? " disabled" : "";
  const endTurnTitle = isMyTurn ? "" : ' title="当前不是你的回合"';
  return `<section id="battle-center" class="battle-center">
    <div class="battle-turnbar ${isMyTurn ? "is-your-turn" : ""}">
      <span class="battle-turnbar__round">TURN ${game.turnNumber}</span>
      <div><small>${isMyTurn ? "ACTION AVAILABLE" : "WAITING FOR OPPONENT"}</small><strong class="${isMyTurn ? "battle-turnbar__you" : ""}">${current ? `${escapeHtml(current.nickname)} 的回合` : "等待开始"}</strong></div>
      <button class="battle-small-btn battle-small-btn--accent" data-command="turn:end" aria-keyshortcuts="E"${endTurnDisabled}${endTurnTitle}>结束回合</button>
    </div>
    <div class="battle-center__stage">
      ${opponent ? renderCenterBody(opponent, false) : `<div class="battle-center-body battle-center-body--empty"></div>`}
      <div class="battle-center__common">
        <div class="battle-center__lane-title"><i></i><span>公共结算区</span><i></i></div>
        <div class="battle-common-zones">
          ${renderPile("共用牌堆", game.handDeckCount, "card:draw-hand", "摸 1 张", undefined, "D")}
          ${renderZone("结算区", game.resolving, me, "resolving", true, [
            { command: "resolving:discardAll", label: "全部弃置" },
          ])}
          ${renderZone("手牌弃牌区", game.handDiscard, me, "handDiscard", true, [
            { command: "discard:viewAll", label: "查看全部" },
            { command: "deck:recycleDiscard", label: "洗回牌堆底" },
          ])}
        </div>
      </div>
      ${renderCenterBody(me, true)}
    </div>
    <p class="battle-phase-hint">准备 → 摸牌 → 出牌 → 布阵 → 弃牌 → 结束</p>
    <div class="battle-toolbar">
      <button type="button" data-command="deck:shuffle" data-deck="hand">洗混共用牌堆</button>
      <button type="button" data-command="hand:randomSelect" data-owner="${opponent?.id || ""}">随机展示对手手牌</button>
      <button type="button" data-command="marker:create">创建标记</button>
      ${activeMoveTargets ? `<button type="button" data-command="move:cancel">取消落点</button>` : ""}
    </div>
    ${recentLogs.length ? `<ul class="battle-log-recent" aria-label="最近操作">${recentLogs.map(renderBattleLogItem).join("")}</ul>` : ""}
    <details class="battle-log">
      <summary>全部日志 · ${game.logs.length}</summary>
      <div class="battle-log__filters" role="group" aria-label="筛选操作日志">
        ${[
          ["all", "全部"],
          ["mine", "我的操作"],
          ["opponent", "对手操作"],
          ["inspection", "查看行为"],
        ].map(([value, label]) => `<button type="button" data-log-filter="${value}" aria-pressed="${String(logFilter === value)}">${label}</button>`).join("")}
      </div>
      ${filteredLogs.length
        ? `<ol>${filteredLogs.map(renderBattleLogItem).join("")}</ol>`
        : `<p class="battle-log__empty">当前筛选下暂无日志</p>`}
    </details>
  </section>`;
}

function renderBattleLogItem(log: BattleLog) {
  const canLocate = Boolean(log.target);
  const view = formatBattleLog(log);
  const detail = view.detail ? `<small>${escapeHtml(view.detail)}</small>` : "";
  const content = `<time>${formatLogTime(log.at)}</time><span class="battle-log__badge battle-log__badge--${escapeHtml(view.tone)}">${escapeHtml(view.badge)}</span><span class="battle-log__text">${escapeHtml(view.text)}${detail}</span>`;
  return `<li>${canLocate
    ? `<button type="button" class="battle-log__entry" data-log-id="${escapeHtml(log.id)}" title="${escapeHtml(log.text)}">${content}</button>`
    : `<span class="battle-log__entry">${content}</span>`
  }</li>`;
}

function renderCenterBody(player: PlayerView, isMe: boolean) {
  const body = cardDefinition(player.body);
  const deck = deckFor(player);
  return `<aside class="battle-center-body ${themeClasses(deck?.theme)} ${isMe ? "battle-center-body--self" : "battle-center-body--opponent"}">
    <span>${isMe ? "我的本体" : "对手本体"}</span>
    ${renderCard(player.body, {
      owner: player,
      zone: "body",
      interactive: isMe,
      flipped: player.bodyFlipped,
      size: "field",
    })}
    <strong>${escapeHtml(body?.name || player.nickname)}</strong>
    ${body?.megaCondition ? `<p title="${escapeHtml(body.megaCondition)}"><b>${escapeHtml(body.extraFormLabel || "额外形态")}</b>${escapeHtml(body.megaCondition)}</p>` : ""}
    ${isMe ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
  </aside>`;
}

function formatLogTime(at: number) {
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function renderWaitingSeat() {
  return `<section class="battle-player battle-player--opponent battle-player--waiting"><strong>等待对手重新连接</strong></section>`;
}

function renderPile(title: string, count: number, command: string, action: string, ownerId?: string, shortcut?: string) {
  const dropTarget = title === "共用牌堆"
    ? ` data-drop-target="handDeckTop"`
    : title === "角色牌堆"
      ? ` data-drop-target="characterDeckBottom"`
      : "";
  const owner = ownerId ? ` data-zone-owner="${ownerId}"` : "";
  return `<article class="battle-pile ${count ? "" : "is-empty"}"${dropTarget}${owner}>
    <div class="battle-card-back"><span>群友杀</span></div>
    <strong>${title}</strong><span class="battle-zone-count">${count} 张</span>
    ${command ? `<button type="button" class="battle-small-btn" data-command="${command}"${shortcut ? ` aria-keyshortcuts="${shortcut}"` : ""}>${action}</button>` : ""}
  </article>`;
}

function renderZone(
  title: string,
  cards: CardView[],
  owner: PlayerView,
  zone: string,
  interactive: boolean,
  actions: Array<{ command: string; label: string }> = [],
) {
  return `<article class="battle-zone ${cards.length ? "" : "is-empty"}" data-drop-target="${zone}" data-zone-owner="${owner.id}">
    <header>
      <strong>${title}</strong>
      <span class="battle-zone-count">${cards.length}</span>
      ${actions.length ? `<div class="battle-zone__actions">${actions.map(({ command, label }) =>
        `<button type="button" class="battle-zone__action" data-command="${command}" ${cards.length ? "" : "disabled"}>${label}</button>`
      ).join("")}</div>` : ""}
    </header>
    <div class="battle-zone__cards">${cards.slice(-5).map((card) => renderCard(card, { owner, zone, interactive, size: "pile" })).join("")}</div>
  </article>`;
}

function renderSlot(item: CardView | MarkerView | null, index: number, owner: PlayerView, isMe: boolean) {
  if (!item) return `<article class="battle-slot battle-slot--empty" data-drop-target="characterSlot:${index}" data-zone-owner="${owner.id}"><span>位 ${index + 1}</span></article>`;
  if ("label" in item) {
    const label = escapeHtml(item.label);
    return `<article class="battle-slot battle-slot--marker">
      <span class="battle-slot__marker-label">${label}</span>
      <button type="button" class="battle-slot__marker-del" data-marker="${item.id}" data-marker-label="${label}" aria-label="删除标记 ${label}">×</button>
    </article>`;
  }
  if (!item.instanceId && item.faceDown) {
    return `<article class="battle-slot">
      <button type="button" class="battle-mini-card battle-mini-card--back battle-mini-card--field"
        data-inspect-owner="${owner.id}" data-inspect-slot="${index}" aria-label="查看第 ${index + 1} 个暗置角色">
        <span>暗置</span><small>点击查看</small>
      </button>
    </article>`;
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
    const cardAttribute = card.instanceId ? ` data-card="${card.instanceId}"` : "";
    return `<button type="button" class="battle-mini-card battle-mini-card--back${sizeClass}"${cardAttribute} data-owner="${options.owner.id}" data-zone="${options.zone}" aria-label="暗置卡牌">
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
    imagePath = definition.extraHighResImagePath || definition.extraImagePath;
  } else if (definition.kind === "body") {
    imagePath = definition.highResImagePath || definition.imagePath;
  } else {
    imagePath = definition.imagePath;
  }
  const faceClass = card.faceDown ? " is-face-down" : (definition.kind === "character" && options.zone.startsWith("slot:") ? " is-face-up" : "");
  const skillClass = card.instanceId && card.instanceId === highlightedSkillCardId && Date.now() < highlightedSkillUntil ? " is-skill-declared" : "";
  const cardClass = `battle-mini-card battle-mini-card--${definition.kind}${imagePath ? " battle-mini-card--art" : ""}${sizeClass}${faceClass}${skillClass}`;
  const inSlot = definition.kind === "character" && options.zone.startsWith("slot:");
  const faceBadge = inSlot
    ? (card.faceDown ? `<span class="battle-mini-card__face-badge battle-mini-card__face-badge--down">暗</span>` : `<span class="battle-mini-card__face-badge">明</span>`)
    : "";
  const costBadge = definition.kind === "character" && definition.costText
    ? `<span class="battle-mini-card__cost" title="技能消耗：${escapeHtml(definition.costText)}">${escapeHtml(definition.costText)}</span>`
    : "";
  return `<button type="button" class="${cardClass}" draggable="${String(options.interactive)}"
    data-card="${card.instanceId || ""}" data-owner="${options.owner.id}" data-zone="${options.zone}"
    aria-label="${escapeHtml(name)}" title="${escapeHtml([definition.costText, definition.timing, definition.text].filter(Boolean).join("｜"))}">
    ${imagePath ? `<img src="${imagePath}" alt="" loading="lazy" />` : `<span class="battle-mini-card__glyph">${definition.kind === "hand" ? "牌" : "角"}</span>`}
    ${faceBadge}
    ${costBadge}
    <strong>${escapeHtml(name)}</strong><small>${escapeHtml(poker + definition.subtitle)}</small>
  </button>`;
}

function cardDefinition(card?: CardView) {
  return card?.definitionId ? catalog.cards[card.definitionId] : undefined;
}

function bindActions() {
  root.querySelectorAll<HTMLElement>("[data-log-filter]").forEach((element) => {
    element.addEventListener("click", () => {
      const next = element.dataset.logFilter;
      if (next === "all" || next === "mine" || next === "opponent" || next === "inspection") {
        logFilter = next;
        render();
      }
    });
  });
  root.querySelectorAll<HTMLElement>("[data-log-id]").forEach((element) => {
    element.addEventListener("click", () => locateBattleLog(element.dataset.logId || ""));
  });
  root.querySelectorAll<HTMLElement>("[data-command]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      handleCommand(element);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-counter-set]").forEach((element) => {
    element.addEventListener("click", () => {
      const label = element.dataset.label || "数值";
      const current = Number(element.dataset.current || 0);
      showNumberDialog(label, current, (value) => send(element.dataset.counterSet || "", {
        value,
        playerId: element.dataset.player,
      }));
    });
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (activeMoveTargets) return;
      openCardMenu(element);
      event.stopPropagation();
    });
    element.addEventListener("dragstart", (event) => {
      if (!optionsDraggable(element)) return;
      const instanceId = element.dataset.card || "";
      const definition = cardDefinition(findVisibleCard(instanceId));
      activeMoveTargets = {
        cardId: instanceId,
        actions: cardActionDescriptors(
          instanceId,
          element.dataset.owner || "",
          element.dataset.zone || "",
          definition?.kind,
        ).filter((action) => action.kind === "move"),
      };
      event.dataTransfer?.setData("text/card-instance", element.dataset.card || "");
      element.classList.add("is-dragging");
      applyMoveTargetHints(activeMoveTargets);
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("is-dragging");
      activeMoveTargets = null;
      clearMoveTargetHints();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-inspect-owner][data-inspect-slot]").forEach((element) => {
    element.addEventListener("click", () => {
      send("card:inspect", {
        ownerId: element.dataset.inspectOwner,
        zone: "characterSlot",
        slotIndex: Number(element.dataset.inspectSlot),
      });
    });
  });
  root.querySelectorAll<HTMLElement>("[data-marker]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const markerId = element.dataset.marker;
      if (!markerId) return;
      send("marker:remove", { markerId });
    });
  });
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    element.addEventListener("dragover", (event) => {
      if (!activeMoveTargets || !actionForDropElement(activeMoveTargets, element)) return;
      event.preventDefault();
      element.classList.add("is-drag-over");
    });
    element.addEventListener("dragleave", () => element.classList.remove("is-drag-over"));
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("is-drag-over");
      const instanceId = event.dataTransfer?.getData("text/card-instance");
      if (!instanceId) return;
      const action = activeMoveTargets ? actionForDropElement(activeMoveTargets, element) : undefined;
      if (action) executeMoveAction(instanceId, action);
      activeMoveTargets = null;
      clearMoveTargetHints();
    });
    element.addEventListener("click", () => {
      if (!activeMoveTargets) return;
      const action = actionForDropElement(activeMoveTargets, element);
      if (!action) return;
      executeMoveAction(activeMoveTargets.cardId, action);
      activeMoveTargets = null;
      render();
    });
  });
}

function locateBattleLog(logId: string) {
  const log = snapshot?.game.logs.find((item) => item.id === logId);
  if (!log?.target || !snapshot) return;
  const regionId = battleLogRegionId(log.target, snapshot.you);
  const region = regionId ? document.getElementById(regionId) : null;
  if (region) {
    const rootBounds = root.getBoundingClientRect();
    const regionBounds = region.getBoundingClientRect();
    root.scrollTo({
      top: root.scrollTop + regionBounds.top - rootBounds.top - 8,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    activeRegion = regionId || activeRegion;
    updateRegionNavigation();
  }
  const targetKey = battleLogTargetKey(log.target, snapshot.you);
  const target = targetKey ? elementForTargetKey(targetKey) : region;
  if (!target) return;
  target.classList.add("is-log-located");
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  window.setTimeout(() => target.classList.remove("is-log-located"), 1200);
  announce(`已定位：${log.text}`);
}

function syncRoomControls(started: boolean) {
  document.querySelectorAll<HTMLElement>('[data-room-control="restart"]').forEach((control) => {
    control.hidden = !started;
  });
}

function optionsDraggable(element: HTMLElement) {
  return element.getAttribute("draggable") === "true"
    && socket?.readyState === WebSocket.OPEN
    && !hasPendingLock(`card:${element.dataset.card || ""}`);
}

function executeMoveAction(instanceId: string, action: CardActionDescriptor) {
  send("card:move", {
    instanceId,
    targetZone: action.targetZone,
    targetIndex: action.targetIndex,
    targetOwnerId: action.targetOwnerId,
    faceDown: action.faceDown,
  });
}

function actionForDropElement(active: ActiveMoveTargets, element: HTMLElement) {
  const [targetZone, rawIndex] = (element.dataset.dropTarget || "").split(":");
  const targetIndex = rawIndex === undefined ? undefined : Number(rawIndex);
  return active.actions.find((action) =>
    action.targetZone === targetZone
    && action.targetIndex === targetIndex
    && (!action.targetOwnerId || !element.dataset.zoneOwner || action.targetOwnerId === element.dataset.zoneOwner)
  );
}

function clearMoveTargetHints() {
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    element.classList.remove("is-move-target", "is-drag-over");
    delete element.dataset.moveLabel;
  });
}

function applyMoveTargetHints(active: ActiveMoveTargets) {
  clearMoveTargetHints();
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    const action = actionForDropElement(active, element);
    if (!action) return;
    element.classList.add("is-move-target");
    element.dataset.moveLabel = action.label;
  });
}

function applyHighlightedTarget() {
  const directTarget = elementForTargetKey(highlightedTargetKey);
  if (directTarget) directTarget.classList.add("is-action-success");
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    const owner = element.dataset.zoneOwner ? `@${element.dataset.zoneOwner}` : "";
    const dropTarget = element.dataset.dropTarget || "";
    const key = `${dropTarget}${owner}`;
    if (key === highlightedTargetKey || (!highlightedTargetKey.includes("@") && dropTarget === highlightedTargetKey)) {
      element.classList.add("is-action-success");
    }
  });
}

function applyInteractionAvailability() {
  const connected = socket?.readyState === WebSocket.OPEN;
  document.querySelectorAll<HTMLElement>(
    "[data-command], [data-counter-set], [data-card-action], [data-inspection-move], [data-discard-move], [data-dialog-confirm], .battle-slot-picker__btn",
  ).forEach((element) => {
    const command = element.dataset.command || element.dataset.counterSet || "";
    const playerId = element.dataset.player;
    const lockKey = (command === "health:set" || command === "megaProgress:set") && playerId
      ? `${command}:${playerId}`
      : command;
    if (!connected || (lockKey && hasPendingLock(lockKey))) element.setAttribute("disabled", "");
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((element) => {
    const cardId = element.dataset.card || "";
    if (!connected || hasPendingLock(`card:${cardId}`)) {
      element.setAttribute("draggable", "false");
      if (hasPendingLock(`card:${cardId}`)) element.classList.add("is-action-pending");
    }
  });
}

function handleCommand(element: HTMLElement) {
  const command = element.dataset.command || "";
  if (command === "move:cancel") {
    activeMoveTargets = null;
    render();
    return;
  }
  if (command === "player:ready") {
    if (element.dataset.ready === "true" && snapshot) {
      const me = snapshot.players.find((player) => player.id === snapshot?.you);
      if (me?.deckId === CUSTOM_DECK_ID) {
        const customDeck = readCustomDeck(me);
        if (!isCustomDeckValid(customDeck)) {
          showError("自组牌组需要 1 张本体和 16 张不重复角色。");
          return;
        }
      }
    }
    send(command, { ready: element.dataset.ready === "true" });
  } else if (command === "card:draw-hand") {
    send("card:draw", { deck: "hand", count: 1 });
  } else if (command === "character:deploy") {
    send(command);
  } else if (command === "body:flip") {
    send(command);
  } else if (command === "turn:end") {
    if (element.hasAttribute("disabled")) {
      showError("当前不是你的回合。");
      return;
    }
    send(command);
  } else if (command === "health:set" || command === "megaProgress:set") {
    send(command, {
      value: Number(element.dataset.value),
      playerId: element.dataset.player,
    });
  } else if (command === "deck:shuffle") {
    send(command, { deck: element.dataset.deck });
  } else if (command === "deck:recycleDiscard") {
    const count = snapshot?.game.handDiscard.length || 0;
    if (!count) {
      showError("手牌弃牌区为空。");
      return;
    }
    send(command);
  } else if (command === "discard:viewAll") {
    showDiscardPile();
  } else if (command === "resolving:discardAll") {
    const count = snapshot?.game.resolving.length || 0;
    if (!count) {
      showError("结算区为空。");
      return;
    }
    showConfirmDialog(`将结算区的 ${count} 张牌全部置入手牌弃牌区？`, () => send(command));
  } else if (command === "card:inspect-zone") {
    send("card:inspect", { ownerId: element.dataset.owner, zone: element.dataset.zone });
  } else if (command === "hand:randomSelect") {
    send(command, { ownerId: element.dataset.owner });
  } else if (command === "marker:create") {
    showMarkerDialog((label, slotIndex) => send(command, { label, slotIndex }));
  } else if (command === "room:restartRequest") {
    showConfirmDialog("请求重新开始？对手同意后双方会重新洗牌和发牌。", () => send(command));
  } else if (command === "room:restartRespond") {
    send(command, {
      requestId: element.dataset.requestId,
      accept: element.dataset.accept === "true",
    });
  } else if (command === "room:restartCancel") {
    send(command, { requestId: element.dataset.requestId });
  } else if (command === "room:end") {
    showConfirmDialog("确定结束游戏？房间会立即关闭，双方都会退出且无法恢复。", () => send(command));
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
  openBattleDialog();
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
  openBattleDialog();
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
  openBattleDialog();
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
  openBattleDialog();
}

function resolveCardDialogView(instanceId: string, ownerId: string, form?: BodyDetailForm) {
  const card = findVisibleCard(instanceId);
  const definition = cardDefinition(card);
  const owner = snapshot?.players.find((player) => player.id === ownerId);
  return resolveCardDetail({
    card,
    definition,
    visible: Boolean(definition),
    initialForm: form || (definition?.kind === "body" && owner?.bodyFlipped ? "mega" : "normal"),
  }, form);
}

function openCardMenu(element: HTMLElement) {
  const instanceId = element.dataset.card || "";
  const ownerId = element.dataset.owner || "";
  const zone = element.dataset.zone || "";
  renderCardDialog(instanceId, ownerId, zone, "detail");
  openBattleDialog(element);
}

function renderCardDialog(instanceId: string, ownerId: string, zone: string, mode: CardDetailMode, form?: BodyDetailForm) {
  const view = resolveCardDialogView(instanceId, ownerId, form);
  const definition = view.definition;
  dialog.classList.toggle("battle-dialog--art", mode === "art");
  if (mode === "art") {
    dialogContent.innerHTML = renderCardArtDialog(view);
    bindCardMenuActions(instanceId, ownerId, zone, definition?.kind, view.form);
    return;
  }
  dialogContent.innerHTML = `
    <div class="battle-card-menu battle-card-menu--rich">
      <div class="battle-card-detail">
        ${renderCardArtPreview(view)}
        ${renderCardDetailBody(view)}
      </div>
      <div class="battle-card-menu__sections">
        ${moveButtonSections(instanceId, ownerId, zone, definition?.kind)}
      </div>
    </div>
  `;
  bindCardMenuActions(instanceId, ownerId, zone, definition?.kind, view.form);
}

function bindCardMenuActions(instanceId: string, ownerId: string, zone: string, kind?: string, form: BodyDetailForm = "normal") {
  const actions = cardActionDescriptors(instanceId, ownerId, zone, kind);
  dialogContent.querySelectorAll<HTMLElement>("[data-card-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = actions.find((item) => item.id === button.dataset.cardAction);
      if (action) executeCardAction(instanceId, action, ownerId, zone, kind);
    });
  });
  dialogContent.querySelector<HTMLElement>("[data-card-art-zoom]")?.addEventListener("click", () => {
    renderCardDialog(instanceId, ownerId, zone, "art", form);
  });
  dialogContent.querySelector<HTMLElement>("[data-card-detail-back]")?.addEventListener("click", () => {
    renderCardDialog(instanceId, ownerId, zone, "detail", form);
  });
  dialogContent.querySelectorAll<HTMLElement>("[data-card-form]").forEach((button) => {
    button.addEventListener("click", () => renderCardDialog(instanceId, ownerId, zone, "detail", button.dataset.cardForm as BodyDetailForm));
  });
  bindHighResImage(dialogContent);
}

function cardActionDescriptors(instanceId: string, ownerId: string, zone: string, kind?: string) {
  const isMine = ownerId === snapshot?.you;
  const actions: CardActionDescriptor[] = [];
  const addMove = (id: string, label: string, targetZone: string, quick: boolean, targetIndex?: number, faceDown = false) => {
    const targetOwnerId = ["characterSlot", "characterDeckBottom", "characterDeckShuffle", "retired", "banished"].includes(targetZone)
      ? ownerId
      : undefined;
    actions.push({ id, label, kind: "move", quick, targetZone, targetIndex, targetOwnerId, faceDown });
  };
  if (!kind) {
    actions.push({ id: "inspect", label: "查看暗置卡牌", kind: "inspect", quick: true });
    return actions;
  }
  if (kind === "body") {
    if (isMine) actions.push({ id: "body-flip", label: "翻转本体", kind: "bodyFlip", quick: true });
    return actions;
  }
  if (isMine) actions.push({ id: "move-mode", label: "点击落点移动", kind: "moveMode", quick: kind === "hand" });
  if (kind === "hand") {
    addMove("resolving", "打到结算区", "resolving", true);
    addMove("discard", "弃置", "handDiscard", true);
    addMove("deck-top", "放回牌堆顶", "handDeckTop", false);
    addMove("deck-bottom", "放回牌堆底", "handDeckBottom", false);
    if (isMine) addMove("opponent-hand", "交给对手", "opponentHand", false);
    if (isMine) actions.push({ id: "hand-marker", label: "暗置为标记", kind: "marker", quick: false });
    if (zone === "handDiscard" || zone === "resolving") addMove("my-hand", "加入我的手牌", "hand", true);
  } else if (kind === "character") {
    if (isMine) {
      if (zone.startsWith("slot:")) {
        actions.push({ id: "declare", label: "声明技能", kind: "declare", quick: true });
        actions.push({ id: "flip", label: "明置 / 暗置", kind: "flip", quick: true });
      }
      for (let index = 0; index < 4; index += 1) {
        addMove(`slot-${index}`, `暗置到位 ${index + 1}`, "characterSlot", false, index, true);
      }
      addMove("rest", "休整至牌堆底", "characterDeckBottom", zone.startsWith("slot:"));
      addMove("retire", "退场", "retired", zone.startsWith("slot:"));
      addMove("banish", "移出游戏", "banished", zone === "retired");
      if (zone === "retired") addMove("shuffle-back", "洗回角色牌堆", "characterDeckShuffle", true);
    }
  }
  actions.push({ id: "inspect", label: "查看卡牌", kind: "inspect", quick: false });
  return actions;
}

function renderCardActionButton(action: CardActionDescriptor, instanceId: string) {
  const pending = hasPendingLock(`card:${instanceId}`);
  const disabled = pending || socket?.readyState !== WebSocket.OPEN;
  return `<button type="button" data-card-action="${action.id}" ${disabled ? "disabled" : ""}>${pending ? "同步中…" : escapeHtml(action.label)}</button>`;
}

function moveButtonSections(instanceId: string, ownerId: string, zone: string, kind?: string) {
  const actions = cardActionDescriptors(instanceId, ownerId, zone, kind);
  const quick = actions.filter((action) => action.quick);
  const more = actions.filter((action) => !action.quick);
  return `
    ${quick.length ? `<section class="battle-card-menu__quick">
      <h3>常用操作</h3>
      <div class="battle-card-menu__actions">${quick.map((action) => renderCardActionButton(action, instanceId)).join("")}</div>
    </section>` : ""}
    ${more.length ? `<details class="battle-card-menu__more">
      <summary>更多操作 <span>${more.length}</span></summary>
      <div class="battle-card-menu__actions">${more.map((action) => renderCardActionButton(action, instanceId)).join("")}</div>
    </details>` : ""}
  `;
}

function executeCardAction(
  instanceId: string,
  action: CardActionDescriptor,
  ownerId: string,
  zone: string,
  kind?: string,
) {
  if (action.kind === "moveMode") {
    activeMoveTargets = {
      cardId: instanceId,
      actions: cardActionDescriptors(instanceId, ownerId, zone, kind)
        .filter((item) => item.kind === "move"),
    };
    dialog.close();
    render();
    return;
  }
  if (action.kind === "move") {
    send("card:move", {
      instanceId,
      targetZone: action.targetZone,
      targetIndex: action.targetIndex,
      targetOwnerId: action.targetOwnerId,
      faceDown: action.faceDown,
    });
  } else if (action.kind === "flip") {
    send("card:flip", { instanceId });
  } else if (action.kind === "inspect") {
    send("card:inspect", { instanceId });
  } else if (action.kind === "marker") {
    dialog.close();
    showHandMarkerDialog(instanceId);
    return;
  } else if (action.kind === "bodyFlip") {
    send("body:flip");
  } else if (action.kind === "declare") {
    const actionId = send("character:declareSkill", { instanceId });
    if (!actionId) return;
    highlightedSkillCardId = instanceId;
    highlightedSkillUntil = Date.now() + 1800;
    window.clearTimeout(highlightedSkillTimer);
    highlightedSkillTimer = window.setTimeout(() => {
      highlightedSkillCardId = "";
      highlightedSkillUntil = 0;
      render();
    }, 1850);
  }
  dialog.close();
  render();
}

function findVisibleCard(instanceId: string) {
  if (!snapshot) return undefined;
  const pools = snapshot.players.flatMap((player) => [
    player.body,
    ...player.hand,
    ...player.characterSlots.filter((item): item is CardView => !!item && "instanceId" in item),
    ...player.retired,
    ...player.banished,
  ]);
  return [...pools, ...snapshot.game.handDiscard, ...snapshot.game.resolving].find((card) => card?.instanceId === instanceId);
}

function showDiscardPile() {
  const cards = [...(snapshot?.game.handDiscard || [])].reverse();
  if (!cards.length) {
    showError("手牌弃牌区为空。");
    return;
  }
  dialogContent.innerHTML = `<div class="battle-card-menu battle-discard-browser">
    <h2>手牌弃牌区 · ${cards.length} 张</h2>
    <p class="battle-dialog-hint">按牌堆顺序显示，最上方为弃牌堆顶。</p>
    <div class="battle-discard-list">${cards.map((card, index) => {
      const definition = cardDefinition(card);
      const poker = card.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank}` : "点数未知";
      const position = index === 0 ? "牌堆顶" : index === cards.length - 1 ? "牌堆底" : `第 ${index + 1} 张`;
      return `<article class="battle-discard-row">
        <div class="battle-discard-row__identity">
          <small>${position}</small>
          <strong>${escapeHtml(definition?.name || "未知手牌")}</strong>
          <span>${escapeHtml(poker)}</span>
        </div>
        <div class="battle-discard-row__actions">
          <button type="button" data-discard-move="${card.instanceId || ""}" data-target="handDeckTop">牌堆顶</button>
          <button type="button" data-discard-move="${card.instanceId || ""}" data-target="handDeckBottom">牌堆底</button>
          <button type="button" data-discard-move="${card.instanceId || ""}" data-target="hand">我的手牌</button>
          <button type="button" data-discard-move="${card.instanceId || ""}" data-target="opponentHand">对方手牌</button>
        </div>
      </article>`;
    }).join("")}</div>
  </div>`;
  openBattleDialog();
  dialogContent.querySelectorAll<HTMLElement>("[data-discard-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const instanceId = button.dataset.discardMove;
      const targetZone = button.dataset.target;
      if (!instanceId || !targetZone) return;
      send("card:move", { instanceId, targetZone });
      dialog.close();
    });
  });
}

function showInspection(
  title: string,
  cards: CardView[],
  inspectionId: string,
  viewerId: string,
  allowedActions: InspectionAction[],
) {
  const canAct = viewerId === snapshot?.you;
  const actionLabels: Record<InspectionAction, string> = {
    handDeckTop: "置于牌堆顶",
    handDeckBottom: "置于牌堆底",
    handDiscard: "置入弃牌区",
    hand: "加入我的手牌",
  };
  dialogContent.innerHTML = `<div class="battle-card-menu"><h2>${escapeHtml(title)}</h2>
    <div class="battle-inspection">${cards.map((card) => {
      const definition = cardDefinition(card);
      const poker = card.suit && card.rank ? `${suitSymbol(card.suit)}${card.rank} · ` : "";
      const img = definition?.kind === "hand"
        ? handCardImagePath(definition.id, card.suit, card.rank)
        : definition?.imagePath;
      return `<article class="battle-inspection__card" ${card.instanceId ? `data-inspection-card="${card.instanceId}"` : ""}>
        ${img ? `<img src="${img}" alt="" class="battle-inspection__art" />` : ""}
        <div>
          <strong>${escapeHtml(poker + (definition?.name || "未知"))}</strong>
          <p>${escapeHtml(definition?.text || "")}</p>
          ${canAct && card.instanceId && allowedActions.length
            ? `<div class="battle-card-menu__actions">${allowedActions.map((action) =>
                `<button type="button" data-inspection-move="${card.instanceId}" data-target="${action}">${actionLabels[action]}</button>`
              ).join("")}</div>`
            : `<p class="battle-dialog-hint">${canAct ? "本次查看仅供确认牌面。" : "由展示发起者决定后续处理。"}</p>`}
        </div>
      </article>`;
    }).join("")}</div></div>`;
  openBattleDialog();
  dialogContent.querySelectorAll<HTMLElement>("[data-inspection-move]").forEach((button) => {
    button.addEventListener("click", () => {
      send("card:move", {
        instanceId: button.dataset.inspectionMove,
        targetZone: button.dataset.target,
        inspectionId,
      });
      dialog.close();
    });
  });
}

function showError(message: string) {
  dialogContent.innerHTML = `<div class="battle-card-menu"><h2>操作未完成</h2><p>${escapeHtml(message)}</p>
    <button type="button" class="btn btn--primary" data-dialog-cancel>知道了</button></div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  announce(`操作未完成：${message}`);
  openBattleDialog();
}

function showShortcutHelp(returnFocus?: HTMLElement) {
  dialogContent.innerHTML = `<div class="battle-card-menu battle-shortcut-help">
    <span class="battle-kicker">键盘操作</span>
    <h2>快捷键</h2>
    <dl>
      <div><dt><kbd>D</kbd></dt><dd>摸一张普通手牌</dd></div>
      <div><dt><kbd>R</kbd></dt><dd>从角色牌堆上阵角色</dd></div>
      <div><dt><kbd>E</kbd></dt><dd>结束当前回合</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>取消落点或关闭弹窗</dd></div>
    </dl>
    <p class="battle-dialog-hint">输入文字、操作弹窗或连接中断时不会触发快捷键。</p>
    <button type="button" class="btn btn--primary" data-dialog-cancel>知道了</button>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  openBattleDialog(returnFocus);
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

connect();
