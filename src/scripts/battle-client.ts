import { getBattleApiUrl } from "../lib/battle-api";
import { deckGuides } from "../lib/deck-guides";
import { escapeHtml, handCardIdentityLabel, handCardImagePath } from "./battle-format";
import {
  DECLARATION_CATEGORIES,
  declarationOptions,
  type DeclarationCategory,
} from "./battle-declaration.mjs";
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
import { defaultHandLimit, normalizeBattleSnapshot } from "./battle-state.mjs";
import {
  PENDING_KEY,
  clearActiveRoom,
  getBattleToken,
  markActiveRoom,
  readPending,
} from "./battle-profile";
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
  BodyMarkerView,
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
const declarationHandCards = catalogCards.filter((card) => card.kind === "hand");
const customRoleFilterOptions = customRoleFilters(characterCatalogCards);
const customTagFilterOptions = customTagFilters(characterCatalogCards);

const API_URL = getBattleApiUrl();
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
  sentAt?: number;
  timeoutId?: number;
};

type ActiveMoveTargets = {
  cardId: string;
  actions: CardActionDescriptor[];
  cardLabel: string;
  sourceLabel: string;
};

type TableDensity = "dense" | "balanced" | "spacious";
type NetworkQuality = "unknown" | "good" | "slow" | "weak";
type NetworkInformationLike = EventTarget & {
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
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
let tableDensity: TableDensity = "balanced";
let networkQuality: NetworkQuality = "unknown";
let lastRoundTripMs: number | undefined;
let lastErrorCategory = "none";
const latencySamples: number[] = [];

const COACH_STEPS = [
  { title: "点击卡牌查看技能", text: "点任意卡牌可阅读完整效果，并从菜单移动到其他区域。" },
  { title: "拖拽或点击落点", text: "桌面端可拖拽卡牌；移动端请用菜单里的「点击落点移动」，再点目标区域。" },
  { title: "结束回合与日志", text: "中央栏可结束回合、查看操作日志。系统不自动判定规则，请双方诚信结算。" },
  { title: "键盘也能快速操作", text: "按 D 摸牌、R 上阵角色、E 结束回合；按 Esc 可取消落点或关闭弹窗。" },
];

roomLabel.textContent = roomCode;
applyTableMode();
applyTableDensity();
refreshNetworkQuality();
applyAnimationMode();

function setConnectionState(label: string, state: string) {
  statusText.textContent = label;
  status.dataset.state = state;
  if (state === "open" || state === "closed" || state === "failed") announce(label);
}

function networkInformation() {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function detectTableDensity(): TableDensity {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  if (window.innerWidth >= 1680 && viewportHeight >= 880) return "spacious";
  if (window.innerWidth <= 1366 || viewportHeight <= 760) return "dense";
  return "balanced";
}

function applyTableDensity() {
  tableDensity = detectTableDensity();
  app.dataset.tableDensity = tableDensity;
}

function inferNetworkQuality() {
  const info = networkInformation();
  if (info?.saveData) return "weak" as const;
  if (lastRoundTripMs !== undefined) {
    if (lastRoundTripMs >= 1200) return "weak" as const;
    if (lastRoundTripMs >= 500) return "slow" as const;
    return "good" as const;
  }
  if (info?.effectiveType === "slow-2g" || info?.effectiveType === "2g") return "weak" as const;
  if (info?.effectiveType === "3g") return "slow" as const;
  return info?.effectiveType === "4g" ? "good" as const : "unknown" as const;
}

function refreshNetworkQuality() {
  const next = inferNetworkQuality();
  const changed = next !== networkQuality;
  networkQuality = next;
  app.dataset.networkQuality = networkQuality;
  status.dataset.quality = networkQuality;
  if (changed) applyAnimationMode();
}

function recordRoundTrip(duration: number) {
  if (!Number.isFinite(duration) || duration < 0) return;
  latencySamples.push(Math.round(duration));
  if (latencySamples.length > 4) latencySamples.shift();
  lastRoundTripMs = Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length);
  refreshNetworkQuality();
}

function syncedConnectionLabel(revision: number) {
  const latency = lastRoundTripMs === undefined ? "" : ` · ${lastRoundTripMs}ms`;
  if (networkInformation()?.saveData) return `省流 · r${revision}${latency}`;
  if (networkQuality === "weak") return `弱网 · r${revision}${latency}`;
  if (networkQuality === "slow") return `较慢 · r${revision}${latency}`;
  return `已同步 · r${revision}${latency}`;
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
  const markCopied = () => {
    if (button) {
      const original = button.textContent;
      button.textContent = doneLabel;
      window.setTimeout(() => { button.textContent = resetLabel ?? original; }, 1400);
    }
    showToast(doneLabel);
  };
  try {
    await navigator.clipboard.writeText(text);
    markCopied();
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (copied) markCopied();
    else showToast("复制失败，请检查浏览器剪贴板权限");
  }
}

function webSocketStateLabel() {
  const labels = ["连接中", "已连接", "关闭中", "已断开"];
  return socket ? labels[socket.readyState] || "未知" : "未创建";
}

function buildDiagnostics() {
  const info = networkInformation();
  const role = snapshot?.you === "spectator" ? "spectator" : snapshot?.you || "unknown";
  return [
    "宝旅团 TCG 对战诊断",
    `时间: ${new Date().toISOString()}`,
    `房间: ${roomCode}`,
    `客户端: ${app.dataset.clientVersion || "unknown"}`,
    `身份: ${role}`,
    `连接: ${status.dataset.state || "unknown"} / ${webSocketStateLabel()}`,
    `网络: ${networkQuality}${lastRoundTripMs === undefined ? "" : ` / ${lastRoundTripMs}ms`}`,
    `网络提示: ${info?.effectiveType || "unknown"}${info?.saveData ? " / save-data" : ""}`,
    `Revision: ${confirmedSnapshot?.revision ?? snapshot?.revision ?? "none"}`,
    `待确认操作: ${pendingActions.size}`,
    `移动模式: ${activeMoveTargets ? "active" : "inactive"}`,
    `最近错误分类: ${lastErrorCategory}`,
    `布局: ${tableMode} / ${tableDensity}`,
    `动画: ${animationMode} / effective-${effectiveAnimationMode()}`,
    `视口: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}`,
    `页面: ${location.origin}${location.pathname}`,
    `API: ${new URL(API_URL).origin}`,
    `浏览器: ${navigator.userAgent}`,
  ].join("\n");
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
  const diagnosticsButton = event.target.closest<HTMLButtonElement>("[data-copy-diagnostics]");
  if (diagnosticsButton) {
    void copyText(buildDiagnostics(), diagnosticsButton, "诊断已复制", diagnosticsButton.textContent || "诊断");
    diagnosticsButton.closest<HTMLDetailsElement>(".battle-topbar-menu")?.removeAttribute("open");
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

let densityResizeFrame = 0;
window.addEventListener("resize", () => {
  window.cancelAnimationFrame(densityResizeFrame);
  densityResizeFrame = window.requestAnimationFrame(applyTableDensity);
}, { passive: true });
networkInformation()?.addEventListener("change", refreshNetworkQuality);

function getRoomCode() {
  const parts = location.pathname.split("/").filter(Boolean);
  const last = parts.at(-1);
  const query = new URLSearchParams(location.search).get("code");
  return (last === "room" ? query : last)?.toUpperCase() || "";
}

function getPending() {
  return readPending() as { nickname?: string; deckId?: string; customDeck?: CustomDeckConfig };
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
  return animationMode === "off" || networkQuality === "weak" ? "off" : "on";
}

function applyAnimationMode() {
  app.dataset.animationMode = effectiveAnimationMode();
  const labels: Record<AnimationMode, string> = {
    on: "动画：打开",
    off: "动画：关闭",
  };
  document.querySelectorAll<HTMLElement>("[data-animation-mode-toggle]").forEach((button) => {
    const pausedLabel = networkInformation()?.saveData ? "动画：省流暂停" : "动画：弱网暂停";
    const label = animationMode === "on" && effectiveAnimationMode() === "off" ? pausedLabel : labels[animationMode];
    button.textContent = label;
    button.setAttribute("aria-label", `${label}，点击切换`);
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

  // 检查是否是观战模式
  const urlParams = new URLSearchParams(location.search);
  const isSpectator = urlParams.get("spectate") === "true";

  const pending = getPending();
  if (!pending.nickname) {
    const joinUrl = new URL("/play", location.origin);
    joinUrl.searchParams.set("room", roomCode);
    location.replace(joinUrl);
    return;
  }
  window.clearTimeout(reconnectTimer);
  setConnectionState("连接中", "connecting");
  if (!snapshot) renderConnecting(isSpectator ? "正在连接观战模式。" : "正在确认房间与玩家座位。");
  const token = getBattleToken();
  const initialLoadout = handshakeLoadout();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);

  try {
    if (!isSpectator) {
      // 玩家加入房间
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
      if (!response.ok) {
        if (response.status === 404 || response.status === 409) clearActiveRoom(roomCode);
        throw new Error(result.error || `加入房间失败（${response.status}）`);
      }
      markActiveRoom(roomCode);
    }
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
  const wsUrl = new URL(`${wsBase}/rooms/${roomCode}/connect`);
  wsUrl.searchParams.set("token", token);
  if (isSpectator) {
    wsUrl.searchParams.set("spectator", "true");
    wsUrl.searchParams.set("nickname", pending.nickname || "观战者");
  }
  const socketStartedAt = performance.now();
  socket = new WebSocket(wsUrl);
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
    recordRoundTrip(performance.now() - socketStartedAt);
    setConnectionState(snapshot ? syncedConnectionLabel(snapshot.revision) : "已连接，等待同步", "open");
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
      setConnectionState(syncedConnectionLabel(nextSnapshot.revision), "open");
      render();
      restorePendingLoadout(nextSnapshot);
      preloadBodyPortraits();
      flushVisualEffects();
      if (restarted) showToast("牌局已重新开始");
    } else if (message.type === "actionAck") {
      const pending = pendingActions.get(message.actionId);
      if (!pending) return;
      if (pending.sentAt) recordRoundTrip(Date.now() - pending.sentAt);
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
      clearActiveRoom(roomCode);
      hasConnected = false;
      connectionAttempt += 1;
      window.clearTimeout(reconnectTimer);
      root.innerHTML = `<section class="battle-loading hud-panel">
        <span class="battle-kicker">游戏结束</span>
        <h1>房间已关闭</h1>
        <p>${escapeHtml(message.reason || "这场游戏已经结束，房间已关闭。")}</p>
        <a class="btn btn--primary" href="/play">返回在线对战</a>
      </section>`;
      setConnectionState("已结束", "failed");
      syncRoomControls(false);
      clearVisualEffects();
    } else if (message.type === "roomLeft") {
      roomEnded = true;
      clearActiveRoom(roomCode);
      connectionAttempt += 1;
      window.clearTimeout(reconnectTimer);
      root.innerHTML = `<section class="battle-loading hud-panel">
        <span class="battle-kicker">已退出</span>
        <h1>你已离开等待房间</h1>
        <p>座位已经释放，可以返回大厅加入其他对局。</p>
        <a class="btn btn--primary" href="/play">返回在线对战大厅</a>
      </section>`;
      setConnectionState("已退出", "failed");
      syncRoomControls(false);
    } else if (message.type === "error") {
      lastErrorCategory = message.category || "operation_error";
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
    lastErrorCategory = "socket_closed";
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
  lastErrorCategory = "connection_error";
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
    bodyMarker: "本体标记区",
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
    "declaration:create": "声明已记录",
    "health:set": "体力已调整",
    "megaProgress:set": "Mega 已调整",
    "deck:shuffle": "牌堆已洗混",
    "deck:recycleDiscard": "弃牌已洗回牌堆底",
    "resolving:discardAll": "结算区已全部弃置",
    "turn:end": "已结束回合",
    "marker:create": "标记已创建",
    "marker:adjust": "标记数量已调整",
    "marker:rename": "标记已改名",
    "marker:remove": "标记已移除",
    "marker:card-remove": "标记牌已移去",
    "slot-marker:create": "占位标记已创建",
    "slot-marker:remove": "占位标记已移除",
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
  const identity = card ? handCardIdentityLabel(card.suit, card.rank, card.joker) : "";
  const poker = identity ? `${identity} ` : "";
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
  if (type === "declaration:create") return "battle-center";
  if (type.startsWith("marker:")) {
    const markerOwnerId = typeof payload.markerId === "string"
      ? findBodyMarkerView(payload.markerId)?.player.id
      : undefined;
    const playerId = String(payload.playerId || markerOwnerId || you);
    return playerId ? `bodyMarker@${playerId}` : undefined;
  }
  if (type.startsWith("slot-marker:") && Number.isInteger(payload.slotIndex)) {
    return `characterSlot:${String(payload.slotIndex)}@${String(payload.playerId || you)}`;
  }
  return undefined;
}

function actionLockKey(type: string, payload: Record<string, unknown>) {
  if (typeof payload.instanceId === "string" && payload.instanceId) return `card:${payload.instanceId}`;
  if ((type === "health:set" || type === "megaProgress:set") && payload.playerId) {
    return `${type}:${String(payload.playerId)}`;
  }
  if (type.startsWith("marker:") && payload.markerId) return `marker:${String(payload.markerId)}`;
  if (type.startsWith("slot-marker:") && payload.markerId) return `slot-marker:${String(payload.markerId)}`;
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
  pending.sentAt = Date.now();
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
  if (targetKey.startsWith("bodyMarker@")) {
    return root.querySelector<HTMLElement>(`[data-marker-rack-owner="${CSS.escape(targetKey.slice(11))}"]`) ?? undefined;
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
  if (bodyPortraitsPreloaded || !snapshot?.game.started || networkQuality === "weak") return;
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
  const isSpectator = snapshot.you === "spectator";
  app.dataset.phase = snapshot.game.started ? "game" : "lobby";
  app.dataset.spectator = isSpectator ? "true" : "false";
  syncRoomControls(snapshot.game.started && !snapshot.pendingRestart);
  window.clearInterval(restartCountdownTimer);
  const preserved = captureUIState();

  // 观战时沿用上下方布局，但界面文案始终使用玩家昵称区分双方。
  const me = isSpectator
    ? snapshot.players[0]
    : snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = isSpectator
    ? snapshot.players[1]
    : snapshot.players.find((player) => player.id !== snapshot?.you);

  if (!me) {
    renderFatal(isSpectator ? "观战失败，房间不存在或已关闭。" : "未能认回你的座位。");
    return;
  }
  if (!snapshot.game.started) {
    if (isSpectator) {
      renderFatal("游戏尚未开始，请等待双方准备。");
    } else {
      renderLobby(me, opponent);
    }
    restoreUIState(preserved);
    return;
  }

  const isMyTurn = snapshot.game.currentPlayerId === snapshot.you;
  const myHandCount = me.handCount ?? me.hand.length;
  root.innerHTML = `
    ${renderMoveBanner(activeMoveTargets)}
    ${isSpectator ? `<div class="battle-spectator-banner">${escapeHtml(getPending().nickname || "观战者")} · 观战模式 · 只能观看公开信息</div>` : ""}
    ${isSpectator ? "" : renderRestartRequest(me, opponent)}
    <div class="battle-table">
      ${opponent ? renderPlayer(opponent, false, isMyTurn) : renderWaitingSeat()}
      ${renderCenter(snapshot.game, me, opponent, isMyTurn)}
      ${renderPlayer(me, true, isMyTurn)}
    </div>
    <nav class="battle-region-nav" aria-label="牌桌区域导航">
      <button type="button" data-region-target="battle-player-opponent"><span>${isSpectator && opponent ? escapeHtml(opponent.nickname) : "对手"}</span></button>
      <button type="button" data-region-target="battle-center"><span>公共区</span></button>
      <button type="button" data-region-target="battle-player-self"><span>${isSpectator ? escapeHtml(me.nickname) : "我的阵地"}</span></button>
      ${!isSpectator ? `<button type="button" data-region-target="battle-hand-self"><span>手牌</span><b>${myHandCount}</b></button>` : ""}
    </nav>
  `;
  bindActions();
  bindRegionNavigation();
  restoreUIState(preserved);
  startRestartCountdown();
  if (!isSpectator) maybeShowCoach();
}

function moveSourceLabel(zone: string, ownerId: string) {
  const side = ownerId === snapshot?.you ? "我的" : "对手";
  if (zone.startsWith("slot:")) return `${side}角色位 ${Number(zone.split(":")[1]) + 1}`;
  const labels: Record<string, string> = {
    hand: `${side}手牌`,
    body: `${side}本体`,
    retired: `${side}退场区`,
    banished: `${side}移出游戏区`,
    resolving: "公共结算区",
    handDiscard: "手牌弃牌区",
  };
  return labels[zone] || "牌桌区域";
}

function createMoveTargets(cardId: string, ownerId: string, zone: string, kind?: string): ActiveMoveTargets {
  return {
    cardId,
    cardLabel: cardDisplayName(cardId) || "一张卡牌",
    sourceLabel: moveSourceLabel(zone, ownerId),
    actions: cardActionDescriptors(cardId, ownerId, zone, kind).filter((action) => action.kind === "move"),
  };
}

function renderMoveBannerContent(active: ActiveMoveTargets) {
  const targets = active.actions.map((action, index) =>
    `<span><b>${index + 1}</b>${escapeHtml(action.label)}</span>`
  ).join("");
  return `<div class="battle-move-banner__identity">
      <small>正在移动 · 来自${escapeHtml(active.sourceLabel)}</small>
      <strong>${escapeHtml(active.cardLabel)}</strong>
    </div>
    <div class="battle-move-banner__targets" aria-label="可用目标">${targets}</div>
    <button type="button" class="battle-move-banner__cancel" data-command="move:cancel" aria-label="取消移动">取消 <kbd>Esc</kbd></button>`;
}

function renderMoveBanner(active: ActiveMoveTargets | null) {
  return `<aside id="battle-move-hud" class="battle-move-banner" role="status" ${active ? "" : "hidden"}>
    ${active ? renderMoveBannerContent(active) : ""}
  </aside>`;
}

function syncMoveBanner(active: ActiveMoveTargets | null) {
  const banner = root.querySelector<HTMLElement>("#battle-move-hud");
  if (!banner) return;
  banner.hidden = !active;
  banner.innerHTML = active ? renderMoveBannerContent(active) : "";
  banner.querySelector<HTMLElement>("[data-command='move:cancel']")?.addEventListener("click", () => {
    activeMoveTargets = null;
    clearMoveTargetHints();
    syncMoveBanner(null);
  });
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
          <button class="battle-small-btn battle-lobby__leave" data-command="room:leave">退出等待房间</button>
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
    <div class="battle-deck-preview__actions">
      <button type="button" class="battle-small-btn" data-deck-detail="${deck.id}">查看详情</button>
    </div>
  </article>`;
}

function showDeckDetail(deckId: string) {
  const deck = catalog.decks.find(d => d.id === deckId);
  if (!deck) return;

  const body = catalog.cards[deck.bodyId];
  const content = renderDeckDetailContent(deck, body);

  dialogContent.innerHTML = content;
  dialog.classList.add("battle-dialog--deck-detail");
  openBattleDialog();

  // 绑定关闭按钮
  dialogContent.querySelector("[data-deck-detail-close]")?.addEventListener("click", () => {
    dialog.close();
  });

  // 绑定查看大图按钮
  dialogContent.querySelectorAll<HTMLElement>("[data-card-art-zoom]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const cardId = button.dataset.cardId || "";
      const card = catalog.cards[cardId];
      if (!card) return;

      // 创建临时的 CardDetailView 对象
      const view = {
        definition: card,
        form: "normal" as const,
        displayName: card.name,
        displaySubtitle: card.subtitle,
        displayText: card.text,
        imagePath: card.imagePath,
        highResImagePath: card.highResImagePath,
        titleHtml: card.name,
        roleTag: card.mainRole || "",
        faceStatus: "",
      };

      // 渲染大图对话框
      const artContent = renderCardArtDialog(view);
      dialogContent.innerHTML = artContent;
      dialog.classList.remove("battle-dialog--deck-detail");
      dialog.classList.add("battle-dialog--art");

      // 绑定返回按钮
      dialogContent.querySelector("[data-card-detail-back]")?.addEventListener("click", () => {
        // 重新渲染预组详情
        showDeckDetail(deckId);
      });

      // 绑定高清图片加载
      bindHighResImage(dialogContent);
    });
  });
}

function renderDeckDetailContent(deck: CatalogDeck, body?: CatalogCard) {
  // 获取攻略数据
  const guide = deckGuides[deck.id];

  // 渲染角色列表
  const charactersHtml = deck.characterIds.map((charId) => {
    const charCard = catalog.cards[charId];
    if (!charCard) return "";
    return `<div class="battle-deck-detail__character">
      ${charCard.imagePath ? `<button type="button" class="battle-deck-detail__art-button" data-card-art-zoom data-card-id="${charId}" aria-label="查看 ${escapeHtml(charCard.name)} 大图"><img src="${charCard.imagePath}" alt="" loading="lazy" /><span>点击查看大图</span></button>` : ""}
      <strong>${escapeHtml(charCard.name)}</strong>
      <small>${escapeHtml(charCard.mainRole || "")}</small>
    </div>`;
  }).join("");

  // 渲染定位分布
  const roleOrder = ["强攻", "防御", "资源", "控制", "支援", "伏击"];
  const roleDistributionHtml = roleOrder
    .filter(role => deck.roleDistribution[role])
    .map(role => `<span class="battle-tag">${escapeHtml(role)}: ${deck.roleDistribution[role]}</span>`)
    .join("");

  // 渲染标签分布（按数量排序，取前8个）
  const sortedTags = Object.entries(deck.tagDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const tagDistributionHtml = sortedTags
    .map(([tag, count]) => `<span class="battle-tag battle-tag--muted">${escapeHtml(tag)}: ${count}</span>`)
    .join("");

  // 渲染核心角色
  const coreCardsHtml = guide?.coreCards?.map((cardId) => {
    const card = catalog.cards[cardId];
    if (!card) return "";
    return `<li>
      <strong>${escapeHtml(card.name)}</strong>
      <span>— ${escapeHtml(card.skillName || card.subtitle)}</span>
    </li>`;
  }).join("") || "";

  // 渲染可替换角色
  const replaceableCardsHtml = guide?.replaceableCards?.map((cardId) => {
    const card = catalog.cards[cardId];
    if (!card) return "";
    return `<li>
      <strong>${escapeHtml(card.name)}</strong>
      <span>— ${escapeHtml(card.skillName || card.subtitle)}</span>
    </li>`;
  }).join("") || "";

  // 渲染替换建议
  const replaceSuggestionsHtml = guide?.replaceSuggestions?.map((suggestion) => {
    const card = catalog.cards[suggestion.card];
    if (!card) return "";
    return `<li>
      <strong>${escapeHtml(card.name)}</strong>
      <span>— ${escapeHtml(suggestion.reason)}</span>
    </li>`;
  }).join("") || "";

  return `<div class="battle-deck-detail">
    <div class="battle-deck-detail__header">
      ${body?.imagePath ? `<button type="button" class="battle-deck-detail__art-button" data-card-art-zoom data-card-id="${deck.bodyId}" aria-label="查看 ${escapeHtml(body.name)} 大图"><img src="${body.imagePath}" alt="${escapeHtml(body.name)}卡面" class="battle-deck-detail__art" /><span>点击查看大图</span></button>` : ""}
      <div>
        <span class="battle-deck-detail__tag">${escapeHtml(deck.archetype)}</span>
        <h2>${escapeHtml(deck.name)}</h2>
        <p>${escapeHtml(deck.blurb || body?.subtitle || "")}</p>
      </div>
    </div>

    ${body ? `<div class="battle-deck-detail__body-info">
      <h3>本体信息</h3>
      <div class="battle-deck-detail__body-card">
        <strong>${escapeHtml(body.name)}</strong>
        <span>${escapeHtml(body.subtitle)}${body.hp ? ` · 体力 ${body.hp}` : ""}</span>
        <p>${escapeHtml(body.text)}</p>
        ${body.megaCondition ? `<p><b>${escapeHtml(body.extraConditionLabel || "额外形态条件")}</b>：${escapeHtml(body.megaCondition)}</p>` : ""}
        ${body.extraText ? `<p><b>${escapeHtml(body.extraName || body.extraFormLabel || "额外形态")}</b>：${escapeHtml(body.extraText)}</p>` : ""}
      </div>
    </div>` : ""}

    <div class="battle-deck-detail__section">
      <h3>角色牌（${deck.characterIds.length} 张）</h3>
      <div class="battle-deck-detail__characters">
        ${charactersHtml}
      </div>
    </div>

    <div class="battle-deck-detail__stats">
      <div class="battle-deck-detail__section">
        <h3>定位分布</h3>
        <div class="battle-deck-detail__tags">
          ${roleDistributionHtml || "<span class='battle-tag'>无数据</span>"}
        </div>
      </div>
      <div class="battle-deck-detail__section">
        <h3>标签分布</h3>
        <div class="battle-deck-detail__tags">
          ${tagDistributionHtml || "<span class='battle-tag'>无数据</span>"}
        </div>
      </div>
    </div>

    ${coreCardsHtml ? `<div class="battle-deck-detail__section">
      <h3>核心角色</h3>
      <ul class="battle-deck-detail__list">
        ${coreCardsHtml}
      </ul>
    </div>` : ""}

    ${replaceableCardsHtml ? `<div class="battle-deck-detail__section">
      <h3>可替换角色</h3>
      <ul class="battle-deck-detail__list">
        ${replaceableCardsHtml}
      </ul>
    </div>` : ""}

    ${replaceSuggestionsHtml ? `<div class="battle-deck-detail__section">
      <h3>替换建议</h3>
      <ul class="battle-deck-detail__list">
        ${replaceSuggestionsHtml}
      </ul>
    </div>` : ""}

    <div class="battle-deck-detail__actions">
      <button type="button" class="battle-small-btn" data-deck-detail-close>关闭</button>
    </div>
  </div>`;
}

function renderCustomDeckSummary(deck: CustomDeckConfig, disabled: boolean) {
  const body = catalog.cards[deck.bodyId] || bodyCatalogCards[0];
  const selectedNames = deck.characterIds
    .map((id) => catalog.cards[id]?.name)
    .filter(Boolean)
    .slice(0, 4)
    .join("、");
  return `<article class="battle-custom-summary">
    ${body?.imagePath ? `<img src="${escapeHtml(body.imagePath)}" width="250" height="350" alt="${escapeHtml(body.name)}卡面" loading="lazy" decoding="async" />` : ""}
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
          ${card.imagePath ? `<img src="${escapeHtml(card.imagePath)}" width="250" height="350" alt="${escapeHtml(card.name)}卡面" loading="lazy" decoding="async" />` : ""}
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
          ${card.imagePath ? `<img src="${card.imagePath}" width="250" height="350" alt="" loading="lazy" decoding="async" />` : ""}
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
  if (isOverlay) {
    host.addEventListener("click", (event) => {
      if (event.target === host) close();
    });
  }
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
  const isSpectator = snapshot?.you === "spectator";
  const canInteract = isMe && !isSpectator;
  const sideLabel = isSpectator ? player.nickname : isMe ? "我的" : "对手";
  const fieldLabel = isSpectator ? `${player.nickname}的阵地` : isMe ? "你的阵地" : "对手阵地";
  const body = cardDefinition(player.body);
  const deck = deckFor(player);
  const handCount = player.handCount ?? player.hand.length;
  const handLimit = defaultHandLimit(player);
  const excessHandCount = Math.max(0, handCount - handLimit);
  const handSummaryLabel = `${sideLabel}手牌 ${handCount} 张，默认手牌上限 ${handLimit}${excessHandCount ? `，按默认规则超出 ${excessHandCount} 张` : ""}，点击查看计算方式`;
  const max = body?.megaMax;
  const megaText = max ? `${player.megaProgress || 0}/${max}` : String(player.megaProgress || 0);
  const extraFormLabel = body?.extraFormLabel || "额外形态";
  const extraFormType = body?.extraFormType || "";
  const isMega = extraFormType === "mega";
  const isZMove = extraFormType === "z-move";
  const turnClass = snapshot?.game.currentPlayerId === player.id ? " battle-player--active-turn" : "";
  return `
    <section id="battle-player-${isMe ? "self" : "opponent"}" class="battle-player ${themeClasses(deck?.theme)} ${isMe ? "battle-player--self" : "battle-player--opponent"}${turnClass}" data-side="${isMe ? "self" : "opponent"}" data-player-id="${player.id}">
      <header class="battle-player__header">
        <div class="battle-player__identity">
          <span><i class="${player.connected ? "is-online" : ""}"></i>${escapeHtml(fieldLabel)} · ${player.connected ? "在线" : "离线"}</span>
          <strong>${escapeHtml(player.nickname)}</strong>
          ${snapshot?.game.currentPlayerId === player.id ? `<span class="battle-turn-badge">${isMe && isMyTurn ? "你的回合" : "当前回合"}</span>` : ""}
        </div>
        <div class="battle-counters">
          ${renderCounter("体力", player.health || 0, "health:set", player.id, !isSpectator, 7, "hp")}
          ${renderCounter(extraFormLabel, megaText, "megaProgress:set", player.id, canInteract, max, "progress", isMega ? (player.megaUsed || false) : isZMove ? (player.zMoveUsed || false) : false)}
        </div>
      </header>
      <div class="battle-player__field">
        <div class="battle-body-zone">
          <span class="battle-zone-label">本体</span>
          ${renderCard(player.body, { owner: player, zone: "body", interactive: canInteract, flipped: player.bodyFlipped, size: "field" })}
          ${canInteract ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
          ${body?.megaCondition ? `<p class="battle-mega-condition" title="${escapeHtml(body.megaCondition)}"><strong>${escapeHtml(body.extraConditionLabel || "额外形态条件")}</strong>${escapeHtml(body.megaCondition)}</p>` : ""}
          ${renderBodyMarkers(player, !isSpectator)}
        </div>
        <div class="battle-character-slots">
          <span class="battle-zone-label battle-zone-label--row">角色区</span>
          <div class="battle-character-slots__grid">
            ${player.characterSlots.map((item, index) => renderSlot(item, index, player, canInteract, !isSpectator)).join("")}
          </div>
        </div>
      </div>
      <div class="battle-player__private">
        <div class="battle-private-rail battle-private-rail--characters battle-character-resources">
          <div class="battle-private-rail__title">
            <strong>${escapeHtml(sideLabel)}角色资源</strong>
          </div>
          <div class="battle-side-zones">
            ${renderPile("角色牌堆", player.characterDeckCount, canInteract ? "character:deploy" : "", "上阵角色", player.id, canInteract ? "R" : undefined)}
            ${renderZone("退场区", player.retired, player, "retired", canInteract)}
            ${renderZone("移出游戏", player.banished, player, "banished", canInteract)}
          </div>
        </div>
        <div ${isMe ? 'id="battle-hand-self"' : ""} class="battle-private-rail battle-private-rail--hand"
          data-drop-target="${isSpectator ? "" : isMe ? "hand" : "opponentHand"}" data-zone-owner="${player.id}">
          <div class="battle-private-rail__title">
            <strong>${escapeHtml(sideLabel)}手牌</strong>
            <button type="button" class="battle-hand-summary ${excessHandCount ? "is-over-limit" : ""}" data-hand-limit-help
              aria-label="${escapeHtml(handSummaryLabel)}" title="点击查看默认手牌上限计算方式">
              <b>${handCount}</b> 张 / 默认 <b>${handLimit}</b>${excessHandCount ? `<em>· 按默认超出 ${excessHandCount}</em>` : ""}
            </button>
            ${!isMe && !isSpectator ? `<button class="battle-small-btn" data-command="card:inspect-zone" data-owner="${player.id}" data-zone="hand">查看手牌</button>` : ""}
          </div>
          <div class="battle-card-row" data-scroll-key="${isMe ? "hand-self" : "hand-opp"}">${player.hand.map((card) => renderCard(card, { owner: player, zone: "hand", interactive: canInteract, size: isMe ? "hand" : "compact" })).join("")}</div>
        </div>
      </div>
    </section>
  `;
}

function renderCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number, type: "hp" | "progress" = "hp", isUsed?: boolean) {
  if (type === "progress") {
    return renderProgressCounter(label, value, command, playerId, editable, max, isUsed);
  }
  return renderHpCounter(label, value, command, playerId, editable, max);
}

function renderHpCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number) {
  const numericRaw = typeof value === "number" ? value : Number(String(value).split("/")[0]);
  const maxHp = max || 7;
  // clamp numeric to 0..maxHp
  const numeric = Math.max(0, Math.min(maxHp, numericRaw));
  const percent = maxHp > 0 ? (numeric / maxHp) * 100 : 0;
  // 严格按 <25% 判断低血量，25%-50% 为中血量，>50% 为高血量
  const isLow = percent < 25;
  const isMedium = percent >= 25 && percent <= 50;
  const isHigh = percent > 50;

  const counterClass = isLow ? "is-low-hp" : "";

  // 生成命晶图标
  const crystals = [];
  for (let i = 0; i < maxHp; i++) {
    if (i < numeric) {
      // 剩余命晶：根据血量百分比选择图标
      const iconClass = isLow ? "battle-counter__hp-icon--low" : isMedium ? "battle-counter__hp-icon--medium" : "battle-counter__hp-icon--high";
      const pulseClass = isLow ? "battle-counter__hp-icon--pulse" : "";
      crystals.push(`<img src="/battle-icons/health/health-crystal-${isLow ? 'low' : isMedium ? 'medium' : 'high'}.png" alt="" aria-hidden="true" class="battle-counter__hp-icon ${iconClass} ${pulseClass}" />`);
    } else {
      // 已损失命晶
      crystals.push(`<img src="/battle-icons/health/health-crystal-empty.png" alt="" aria-hidden="true" class="battle-counter__hp-icon battle-counter__hp-icon--empty" />`);
    }
  }

  return `<div class="battle-counter battle-counter--hp ${counterClass}" aria-label="${label} ${numeric} / ${maxHp}">
    <span class="battle-counter__label">${label}</span>
    <div class="battle-counter__hp-icons">
      ${crystals.join("")}
    </div>
    <div class="battle-counter__hp-value">
      <span class="battle-counter__hp-current">${numeric}</span>
      <span class="battle-counter__hp-max">/ ${maxHp}</span>
    </div>
    ${editable ? `<div class="battle-counter__actions">
      <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric - 1}" aria-label="${label}减一">−</button>
      <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric + 1}" aria-label="${label}加一">＋</button>
      <button type="button" data-counter-set="${command}" data-player="${playerId}" data-current="${numeric}" data-label="${label}">设置</button>
    </div>` : ""}
  </div>`;
}

function renderProgressCounter(label: string, value: string | number, command: string, playerId: string, editable: boolean, max?: number, isUsed?: boolean) {
  const numeric = typeof value === "number" ? value : Number(String(value).split("/")[0]);
  const maxProgress = max || 6;
  const percent = maxProgress > 0 ? (numeric / maxProgress) * 100 : 0;
  const ready = numeric >= maxProgress;

  // 根据进度百分比确定状态
  // 低进度：0 或低于 33%
  // 中进度：33% 到 66%
  // 高进度：66% 到未满
  // 就绪：>= maxProgress
  let stateClass: string;
  if (ready) {
    stateClass = "is-ready";
  } else if (percent >= 66) {
    stateClass = "is-high";
  } else if (percent >= 33) {
    stateClass = "is-medium";
  } else {
    stateClass = "is-low";
  }

  // 根据额外形态类型确定图标类型
  // Mega: 菱形能量晶核
  // Z招式: 星形棱片
  const isMega = label === "Mega";
  const isZMove = label === "Z招式";
  const iconType = isMega ? "mega" : isZMove ? "z-move" : "mega"; // 默认使用 mega
  const iconPrefix = isMega ? "mega-crystal" : isZMove ? "z-crystal" : "mega-crystal";

  // 激活命令和标签
  const activateCommand = isMega ? "mega:activate" : isZMove ? "zmove:activate" : "";
  const activateLabel = isMega ? "Mega 化" : isZMove ? "Z 招式" : "";
  const usedLabel = isMega ? "已 Mega" : isZMove ? "已使用" : "";

  // SVG progress ring calculations
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percent) / 100) * circumference;

  // Generate milestones，使用图标替代普通节点
  const milestones = Array.from({ length: maxProgress }, (_, i) => {
    let iconState = "";
    let pulseClass = "";

    if (ready) {
      // 就绪状态：所有节点都是就绪状态
      iconState = "ready";
      pulseClass = "battle-counter__progress-icon--pulse";
    } else if (i < numeric) {
      // 已完成的节点：根据当前进度状态着色
      iconState = stateClass === "is-low" ? "low" : stateClass === "is-medium" ? "medium" : "high";
    } else if (i === numeric) {
      // 当前节点
      iconState = stateClass === "is-low" ? "low" : stateClass === "is-medium" ? "medium" : "high";
      pulseClass = stateClass === "is-high" ? "battle-counter__progress-icon--pulse" : "";
    } else {
      // 未完成节点
      iconState = "empty";
    }

    const iconPath = iconState === "empty"
      ? `/battle-icons/${iconType}/${iconPrefix}-low.png`
      : `/battle-icons/${iconType}/${iconPrefix}-${iconState}.png`;

    return `<img src="${iconPath}" alt="" aria-hidden="true" class="battle-counter__progress-icon battle-counter__progress-icon--${iconState} ${pulseClass}" />`;
  }).join("");

  const statusLabel = isUsed ? usedLabel : ready ? (isMega ? "可 Mega" : isZMove ? "Z 就绪" : "已就绪") : "";

  return `<div class="battle-counter-wrapper ${ready ? "is-ready" : ""} ${isUsed ? "is-used" : ""}">
    <div class="battle-counter ${stateClass} ${isUsed ? "is-used" : ""} battle-counter--${iconType}">
      <span class="battle-counter__label">${label}</span>
      <div class="battle-counter__progress-ring">
        <svg viewBox="0 0 44 44">
          <circle class="ring-bg" cx="22" cy="22" r="${radius}" />
          <circle class="ring-fill ${stateClass}" cx="22" cy="22" r="${radius}"
                  stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" />
        </svg>
        <span class="battle-counter__progress-value">${numeric}/${maxProgress}</span>
      </div>
      <div class="battle-counter__progress-icons">
        ${milestones}
      </div>
      ${statusLabel ? `<span class="battle-counter__state">${statusLabel}</span>` : ""}

      ${editable ? `<div class="battle-counter__actions">
        <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric - 1}" aria-label="${label}减一">−</button>
        <button type="button" data-command="${command}" data-player="${playerId}" data-value="${numeric + 1}" aria-label="${label}加一">＋</button>
        <button type="button" data-counter-set="${command}" data-player="${playerId}" data-current="${numeric}" data-label="${label}">设置</button>
      </div>` : ""}
    </div>

    ${ready && editable ? `
      <button type="button"
              class="battle-counter__activate-btn ${isUsed ? "is-used" : ""}"
              data-command="${isUsed ? "" : activateCommand}"
              data-player="${playerId}"
              ${isUsed ? "disabled" : ""}>
        ${isUsed ? usedLabel : activateLabel}
      </button>
    ` : ""}
  </div>`;
}

function renderCenter(game: GameView, me: PlayerView, opponent: PlayerView | undefined, isMyTurn: boolean) {
  const isSpectator = snapshot?.you === "spectator";
  const current = snapshot?.players.find((player) => player.id === game.currentPlayerId);
  const recentLogs = game.logs.slice(-3).reverse();
  const activeLogFilter = isSpectator && (logFilter === "mine" || logFilter === "opponent") ? "all" : logFilter;
  const filteredLogs = filterBattleLogs(game.logs, activeLogFilter, snapshot?.you || "").slice(-30).reverse() as BattleLog[];
  const endTurnDisabled = !isMyTurn ? " disabled" : "";
  const endTurnTitle = isMyTurn ? "" : ' title="当前不是你的回合"';
  return `<section id="battle-center" class="battle-center">
    <div class="battle-turnbar ${isMyTurn ? "is-your-turn" : ""}">
      <span class="battle-turnbar__round">TURN ${game.turnNumber}</span>
      <div><small>${isSpectator ? "SPECTATING" : isMyTurn ? "ACTION AVAILABLE" : "WAITING FOR OPPONENT"}</small><strong class="${isMyTurn ? "battle-turnbar__you" : ""}">${current ? `${escapeHtml(current.nickname)} 的回合` : "等待开始"}</strong></div>
      ${isSpectator ? "" : `<button class="battle-small-btn battle-small-btn--accent" data-command="turn:end" aria-keyshortcuts="E"${endTurnDisabled}${endTurnTitle}>结束回合</button>`}
    </div>
    <div class="battle-center__stage">
      ${opponent ? renderCenterBody(opponent, false) : `<div class="battle-center-body battle-center-body--empty"></div>`}
      <div class="battle-center__common">
        <div class="battle-center__lane-title"><i></i><span>公共结算区</span><i></i></div>
        <div class="battle-common-zones">
          ${renderPile("共用牌堆", game.handDeckCount, isSpectator ? "" : "card:draw-hand", "摸 1 张", undefined, isSpectator ? undefined : "D")}
          ${renderZone("结算区", game.resolving, me, "resolving", !isSpectator, isSpectator ? [] : [
            { command: "resolving:discardAll", label: "全部弃置" },
          ])}
          ${renderZone("手牌弃牌区", game.handDiscard, me, "handDiscard", !isSpectator, isSpectator ? [] : [
            { command: "discard:viewAll", label: "查看全部" },
            { command: "deck:recycleDiscard", label: "洗回牌堆底" },
          ])}
        </div>
      </div>
      ${renderCenterBody(me, true)}
    </div>
    <p class="battle-phase-hint">准备 → 摸牌 → 出牌 → 布阵 → 弃牌 → 结束</p>
    <div class="battle-toolbar">
      ${isSpectator ? "" : `<button type="button" class="battle-toolbar__declare" data-command="declaration:open">声明</button>`}
      <button type="button" data-command="deck:shuffle" data-deck="hand">洗混共用牌堆</button>
      <button type="button" data-command="hand:randomSelect" data-owner="${opponent?.id || ""}">随机展示对手手牌</button>
      ${activeMoveTargets ? `<button type="button" data-command="move:cancel">取消落点</button>` : ""}
    </div>
    ${recentLogs.length ? `<ul class="battle-log-recent" aria-label="最近操作">${recentLogs.map(renderBattleLogItem).join("")}</ul>` : ""}
    <details class="battle-log">
      <summary>全部日志 · ${game.logs.length}</summary>
      <div class="battle-log__filters" role="group" aria-label="筛选操作日志">
        ${(isSpectator ? [
          ["all", "全部"],
          ["inspection", "查看行为"],
        ] : [
          ["all", "全部"],
          ["mine", "我的操作"],
          ["opponent", "对手操作"],
          ["inspection", "查看行为"],
        ]).map(([value, label]) => `<button type="button" data-log-filter="${value}" aria-pressed="${String(activeLogFilter === value)}">${label}</button>`).join("")}
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
  const isSpectator = snapshot?.you === "spectator";
  const bodyLabel = isSpectator ? `${player.nickname}的本体` : isMe ? "我的本体" : "对手本体";
  return `<aside class="battle-center-body ${themeClasses(deck?.theme)} ${isMe ? "battle-center-body--self" : "battle-center-body--opponent"}">
    <span>${escapeHtml(bodyLabel)}</span>
    ${renderCard(player.body, {
      owner: player,
      zone: "body",
      interactive: isMe && !isSpectator,
      flipped: player.bodyFlipped,
      size: "field",
    })}
    <strong>${escapeHtml(body?.name || player.nickname)}</strong>
    ${body?.megaCondition ? `<p title="${escapeHtml(body.megaCondition)}"><b>${escapeHtml(body.extraFormLabel || "额外形态")}</b>${escapeHtml(body.megaCondition)}</p>` : ""}
    ${isMe && !isSpectator ? `<button class="battle-small-btn" data-command="body:flip">翻转本体</button>` : ""}
    ${renderBodyMarkers(player, !isSpectator)}
  </aside>`;
}

function renderBodyMarkers(player: PlayerView, editable: boolean) {
  const markers = player.markers || [];
  return `<section class="battle-marker-rack" data-marker-rack-owner="${player.id}" aria-label="${escapeHtml(player.nickname)}的本体标记">
    <header><span>标记</span>${editable ? `<button type="button" data-command="marker:create" data-player="${player.id}" aria-label="为${escapeHtml(player.nickname)}添加标记">＋</button>` : ""}</header>
    <div class="battle-marker-rack__list">
      ${markers.length ? markers.map((marker) => renderBodyMarker(marker, editable)).join("") : `<span class="battle-marker-rack__empty">暂无</span>`}
    </div>
  </section>`;
}

function renderBodyMarker(marker: BodyMarkerView, editable: boolean) {
  const count = marker.kind === "counter" ? marker.count : marker.count || marker.cards.length;
  const cardStack = marker.kind === "cards"
    ? `<span class="battle-marker-chip__cards" aria-hidden="true"><i></i><i></i></span>`
    : `<span class="battle-marker-chip__dot" aria-hidden="true"></span>`;
  return `<button type="button" class="battle-marker-chip battle-marker-chip--${marker.kind}"
    data-body-marker="${marker.id}" ${editable ? "" : "disabled"}
    aria-label="${escapeHtml(marker.label)}，数量 ${count}${editable ? "，点击管理" : ""}">
    ${cardStack}<span>${escapeHtml(marker.label)}</span><b>×${count}</b>
  </button>`;
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
    <div class="battle-card-back"><span>宝旅团</span></div>
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

function renderSlot(item: CardView | MarkerView | null, index: number, owner: PlayerView, isMe: boolean, canManageMarkers: boolean) {
  if (!item) return `<article class="battle-slot battle-slot--empty" data-drop-target="characterSlot:${index}" data-zone-owner="${owner.id}">
    <span>位 ${index + 1}</span>
    ${canManageMarkers ? `<button type="button" class="battle-slot__marker-add" data-slot-marker-create data-player="${owner.id}" data-slot="${index}">占位标记</button>` : ""}
  </article>`;
  if ("label" in item) {
    const label = escapeHtml(item.label);
    return `<article class="battle-slot battle-slot--marker">
      <span class="battle-slot__marker-label">${label}</span>
      ${canManageMarkers ? `<button type="button" class="battle-slot__marker-del" data-slot-marker="${item.id}" data-marker-label="${label}" aria-label="删除标记 ${label}">×</button>` : ""}
    </article>`;
  }
  if (!item.instanceId && item.faceDown) {
    if (snapshot?.you === "spectator") {
      return `<article class="battle-slot">
        <div class="battle-mini-card battle-mini-card--back battle-mini-card--field" aria-label="第 ${index + 1} 个暗置角色，身份未知">
          <span>暗置</span><small>身份未知</small>
        </div>
      </article>`;
    }
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
    if (snapshot?.you === "spectator") {
      return `<div class="battle-mini-card battle-mini-card--back${sizeClass}" aria-label="暗置卡牌，身份未知">
        <span>暗置</span><small>身份未知</small>
      </div>`;
    }
    const cardAttribute = card.instanceId ? ` data-card="${card.instanceId}"` : "";
    return `<button type="button" class="battle-mini-card battle-mini-card--back${sizeClass}"${cardAttribute} data-owner="${options.owner.id}" data-zone="${options.zone}" aria-label="暗置卡牌">
      <span>暗置</span><small>身份未知</small>
    </button>`;
  }
  const isFlipped = options.flipped && definition.kind === "body";
  const name = isFlipped ? definition.extraName || definition.name : definition.name;
  const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
  const poker = identity ? `${identity} · ` : "";
  let imagePath: string | undefined;
  if (definition.kind === "hand") {
    imagePath = handCardImagePath(definition.id, card.suit, card.rank, card.joker);
  } else if (definition.kind === "body" && isFlipped) {
    imagePath = definition.extraImagePath || definition.extraHighResImagePath;
  } else if (definition.kind === "body") {
    imagePath = definition.imagePath || definition.highResImagePath;
  } else {
    imagePath = definition.imagePath;
  }
  const faceClass = card.faceDown ? " is-face-down" : (definition.kind === "character" && options.zone.startsWith("slot:") ? " is-face-up" : "");
  const skillClass = card.instanceId && card.instanceId === highlightedSkillCardId && Date.now() < highlightedSkillUntil ? " is-skill-declared" : "";
  const cardClass = `battle-mini-card battle-mini-card--${definition.kind}${imagePath ? " battle-mini-card--art" : ""}${sizeClass}${faceClass}${skillClass}`;
  const inSlot = definition.kind === "character" && options.zone.startsWith("slot:");
  const priorityImage = definition.kind === "body" || inSlot;
  const imageLoading = priorityImage ? "eager" : "lazy";
  const imagePriority = definition.kind === "body" ? "high" : priorityImage ? "auto" : "low";
  const faceBadge = inSlot
    ? (card.faceDown ? `<span class="battle-mini-card__face-badge battle-mini-card__face-badge--down">暗置</span>` : `<span class="battle-mini-card__face-badge">明置</span>`)
    : "";
  const costBadge = definition.kind === "character" && definition.costText
    ? `<span class="battle-mini-card__cost battle-mini-card__cost--${definition.costKind || "other"}" title="技能消耗：${escapeHtml(definition.costText)}">${escapeHtml(definition.costText)}</span>`
    : "";
  const declaredBadge = skillClass ? `<span class="battle-mini-card__declared">已声明</span>` : "";
  return `<button type="button" class="${cardClass}" draggable="${String(options.interactive)}"
    data-card="${card.instanceId || ""}" data-owner="${options.owner.id}" data-zone="${options.zone}"
    aria-label="${escapeHtml(name)}" title="${escapeHtml([definition.costText, definition.timing, definition.text].filter(Boolean).join("｜"))}">
    ${imagePath ? `<img src="${imagePath}" width="250" height="350" alt="" loading="${imageLoading}" fetchpriority="${imagePriority}" decoding="async" />` : `<span class="battle-mini-card__glyph">${definition.kind === "hand" ? "牌" : "角"}</span>`}
    ${faceBadge}
    ${costBadge}
    ${declaredBadge}
    <strong>${escapeHtml(name)}</strong><small>${escapeHtml(poker + definition.subtitle)}</small>
  </button>`;
}

function cardDefinition(card?: CardView) {
  return card?.definitionId ? catalog.cards[card.definitionId] : undefined;
}

function bindActions() {
  root.querySelectorAll<HTMLElement>("[data-hand-limit-help]").forEach((element) => {
    element.addEventListener("click", () => showHandLimitHelp(element));
  });
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
  root.querySelectorAll<HTMLElement>("[data-deck-detail]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showDeckDetail(element.dataset.deckDetail || "");
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
      activeMoveTargets = createMoveTargets(
        instanceId,
        element.dataset.owner || "",
        element.dataset.zone || "",
        definition?.kind,
      );
      event.dataTransfer?.setData("text/card-instance", element.dataset.card || "");
      element.classList.add("is-dragging");
      syncMoveBanner(activeMoveTargets);
      applyMoveTargetHints(activeMoveTargets);
    });
    element.addEventListener("dragend", () => {
      element.classList.remove("is-dragging");
      activeMoveTargets = null;
      clearMoveTargetHints();
      syncMoveBanner(null);
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
  root.querySelectorAll<HTMLElement>("[data-slot-marker]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const markerId = element.dataset.slotMarker;
      if (!markerId) return;
      showConfirmDialog(`移除角色位中的「${element.dataset.markerLabel || "标记"}」？`, () => send("slot-marker:remove", { markerId }));
    });
  });
  root.querySelectorAll<HTMLElement>("[data-slot-marker-create]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSlotMarkerDialog(element.dataset.player || "", Number(element.dataset.slot));
    });
  });
  root.querySelectorAll<HTMLElement>("[data-body-marker]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showBodyMarkerDialog(element.dataset.bodyMarker || "", element);
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
      syncMoveBanner(null);
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
    delete element.dataset.moveOrder;
  });
}

function applyMoveTargetHints(active: ActiveMoveTargets) {
  clearMoveTargetHints();
  root.querySelectorAll<HTMLElement>("[data-drop-target]").forEach((element) => {
    const action = actionForDropElement(active, element);
    if (!action) return;
    const order = active.actions.indexOf(action) + 1;
    element.classList.add("is-move-target");
    element.dataset.moveOrder = String(order);
    element.dataset.moveLabel = `${order}. ${action.label}`;
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
  const canInteract = connected && snapshot?.you !== "spectator";
  document.querySelectorAll<HTMLElement>(
    "[data-command], [data-counter-set], [data-card-action], [data-inspection-move], [data-discard-move], [data-dialog-confirm], .battle-slot-picker__btn",
  ).forEach((element) => {
    const command = element.dataset.command || element.dataset.counterSet || "";
    const playerId = element.dataset.player;
    const lockKey = (command === "health:set" || command === "megaProgress:set") && playerId
      ? `${command}:${playerId}`
      : command;
    if (!canInteract || (lockKey && hasPendingLock(lockKey))) element.setAttribute("disabled", "");
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach((element) => {
    const cardId = element.dataset.card || "";
    if (!canInteract || hasPendingLock(`card:${cardId}`)) {
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
  } else if (command === "declaration:open") {
    showDeclarationDialog(element);
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
  } else if (command === "mega:activate" || command === "zmove:activate") {
    send(command, { playerId: element.dataset.player });
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
    showMarkerDialog(element.dataset.player || snapshot?.you || "");
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
  } else if (command === "room:leave") {
    const isHost = snapshot?.you === "p1";
    showConfirmDialog(
      isHost ? "确定退出？房主退出后等待房间会立即关闭。" : "确定退出？你的座位会立即释放。",
      () => send(command),
    );
  }
}

function showHandLimitHelp(returnFocus?: HTMLElement) {
  dialogContent.innerHTML = `<div class="battle-card-menu battle-hand-limit-help">
    <span class="battle-kicker">默认手牌上限</span>
    <h2>手牌上限如何计算</h2>
    <p class="battle-hand-limit-formula">先取当前体力和 4 中较小的数字，再加上己方明置角色数量；明置角色最多只计算 2 张。</p>
    <p>例如：当前体力为 5，己方有 3 张明置角色时，默认手牌上限为 4 + 2 = 6。暗置角色和角色位中的标记不计入。</p>
    <p class="battle-dialog-hint">这里显示的是默认值。技能造成的临时修正不包含在内，需双方另行结算。</p>
    <button type="button" class="btn btn--primary" data-dialog-cancel autofocus>知道了</button>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  openBattleDialog(returnFocus);
}

function showDeclarationDialog(returnFocus?: HTMLElement) {
  let category: DeclarationCategory = "suit";
  dialogContent.innerHTML = `<div class="battle-card-menu battle-declaration-dialog">
    <span class="battle-kicker">公开声明</span>
    <h2>声明一个结果</h2>
    <p class="battle-dialog-hint">声明只会公开记录到操作日志，不会自动结算技能或移动卡牌。</p>
    <div class="battle-declaration-types" role="group" aria-label="声明类别">
      ${DECLARATION_CATEGORIES.map((item, index) => `<button type="button" data-declaration-category="${item.value}" aria-pressed="${String(index === 0)}">${item.label}</button>`).join("")}
    </div>
    <label class="battle-dialog-label" for="battle-declaration-value">声明内容
      <select id="battle-declaration-value"></select>
    </label>
    <p class="battle-declaration-preview" aria-live="polite"></p>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>确认声明</button>
    </div>
  </div>`;

  const valueSelect = dialogContent.querySelector<HTMLSelectElement>("#battle-declaration-value");
  const preview = dialogContent.querySelector<HTMLElement>(".battle-declaration-preview");
  const confirm = dialogContent.querySelector<HTMLButtonElement>("[data-dialog-confirm]");
  const renderOptions = () => {
    const options = declarationOptions(category, declarationHandCards);
    if (valueSelect) {
      valueSelect.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
      valueSelect.disabled = options.length === 0;
    }
    if (confirm) confirm.disabled = options.length === 0;
    updatePreview();
  };
  const updatePreview = () => {
    if (!preview || !valueSelect) return;
    const categoryLabel = DECLARATION_CATEGORIES.find((item) => item.value === category)?.label || "内容";
    const valueLabel = valueSelect.selectedOptions[0]?.textContent || "未选择";
    preview.textContent = `日志将记录：${categoryLabel}【${valueLabel}】`;
  };

  dialogContent.querySelectorAll<HTMLElement>("[data-declaration-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.declarationCategory as DeclarationCategory;
      if (!DECLARATION_CATEGORIES.some((item) => item.value === next)) return;
      category = next;
      dialogContent.querySelectorAll<HTMLElement>("[data-declaration-category]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      renderOptions();
      valueSelect?.focus();
    });
  });
  valueSelect?.addEventListener("change", updatePreview);
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  confirm?.addEventListener("click", () => {
    if (!valueSelect?.value) return;
    const actionId = send("declaration:create", { category, value: valueSelect.value });
    if (actionId) dialog.close();
  });

  renderOptions();
  openBattleDialog(returnFocus);
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

function showMarkerDialog(defaultPlayerId: string) {
  const players = snapshot?.players || [];
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <span class="battle-kicker">本体标记区</span>
    <h2>添加数量标记</h2>
    <label class="battle-dialog-label">放置到
      <select id="battle-marker-owner">
        ${players.map((player) => `<option value="${player.id}" ${player.id === defaultPlayerId ? "selected" : ""}>${escapeHtml(player.nickname)}的本体旁</option>`).join("")}
      </select>
    </label>
    <label class="battle-dialog-label">标记名称
      <input type="text" id="battle-marker-label" maxlength="20" placeholder="充能球、护盾、怒气" value="充能球" />
    </label>
    <label class="battle-dialog-label">初始数量</label>
    <div class="battle-form-stepper">
      <button type="button" class="battle-stepper-btn" data-marker-step="-1" aria-label="减少">−</button>
      <input type="number" id="battle-marker-count" value="1" min="1" max="99" />
      <button type="button" class="battle-stepper-btn" data-marker-step="1" aria-label="增加">＋</button>
    </div>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>添加标记</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  const countInput = dialogContent.querySelector<HTMLInputElement>("#battle-marker-count");
  dialogContent.querySelectorAll<HTMLElement>("[data-marker-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!countInput) return;
      countInput.value = String(Math.max(1, Math.min(99, Number(countInput.value) + Number(btn.dataset.markerStep))));
    });
  });
  dialogContent.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    const label = dialogContent.querySelector<HTMLInputElement>("#battle-marker-label")?.value.trim();
    const playerId = dialogContent.querySelector<HTMLSelectElement>("#battle-marker-owner")?.value;
    if (!label || !playerId) return;
    send("marker:create", { label, playerId, count: Math.max(1, Math.min(99, Number(countInput?.value || 1))) });
    dialog.close();
  });
  openBattleDialog();
  dialogContent.querySelector<HTMLInputElement>("#battle-marker-label")?.select();
}

function showHandMarkerDialog(instanceId: string) {
  const me = snapshot?.players.find((player) => player.id === snapshot?.you);
  const cardMarkers = (me?.markers || []).filter((marker) => marker.kind === "cards");
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <h2>暗置为标记</h2>
    ${cardMarkers.length ? `<label class="battle-dialog-label">加入已有标记
      <select id="battle-card-marker-existing">
        <option value="">新建牌类标记</option>
        ${cardMarkers.map((marker) => `<option value="${marker.id}" data-label="${escapeHtml(marker.label)}">${escapeHtml(marker.label)} ×${marker.count}</option>`).join("")}
      </select>
    </label>` : ""}
    <label class="battle-dialog-label">标记名称
      <input type="text" id="battle-marker-label" maxlength="20" value="藤蔓" />
    </label>
    <p class="battle-dialog-hint">这张牌会正面朝下放在你的本体旁，不占角色位。</p>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>确认放置</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  const select = dialogContent.querySelector<HTMLSelectElement>("#battle-card-marker-existing");
  select?.addEventListener("change", () => {
    const option = select.selectedOptions[0];
    const input = dialogContent.querySelector<HTMLInputElement>("#battle-marker-label");
    if (input && option?.dataset.label) input.value = option.dataset.label;
  });
  dialogContent.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    const label = dialogContent.querySelector<HTMLInputElement>("#battle-marker-label")?.value.trim();
    if (!label) return;
    send("card:move", { instanceId, targetZone: "bodyMarker", markerId: select?.value || undefined, label });
    dialog.close();
  });
  openBattleDialog();
}

function showSlotMarkerDialog(playerId: string, slotIndex: number) {
  const owner = snapshot?.players.find((player) => player.id === playerId);
  dialogContent.innerHTML = `<div class="battle-card-menu">
    <span class="battle-kicker">角色位 ${slotIndex + 1}</span>
    <h2>放置占位标记</h2>
    <label class="battle-dialog-label">标记名称
      <input type="text" id="battle-slot-marker-label" maxlength="20" value="炸弹" />
    </label>
    <p class="battle-dialog-hint">该标记会占据${escapeHtml(owner?.nickname || "目标玩家")}的角色位，直到被手动移除。</p>
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>取消</button>
      <button type="button" class="btn btn--primary" data-dialog-confirm>放置</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelector("[data-dialog-confirm]")?.addEventListener("click", () => {
    const label = dialogContent.querySelector<HTMLInputElement>("#battle-slot-marker-label")?.value.trim();
    if (!label) return;
    send("slot-marker:create", { playerId, slotIndex, label });
    dialog.close();
  });
  openBattleDialog();
  dialogContent.querySelector<HTMLInputElement>("#battle-slot-marker-label")?.select();
}

function findBodyMarkerView(markerId: string) {
  for (const player of snapshot?.players || []) {
    const marker = (player.markers || []).find((item) => item.id === markerId);
    if (marker) return { player, marker };
  }
  return undefined;
}

function showBodyMarkerDialog(markerId: string, returnFocus?: HTMLElement) {
  const found = findBodyMarkerView(markerId);
  if (!found) return;
  const { player, marker } = found;
  const isCardMarker = marker.kind === "cards";
  const count = isCardMarker ? marker.count : marker.count;
  const ownsCards = player.id === snapshot?.you;
  const cardRows = isCardMarker && ownsCards
    ? marker.cards.map((card, index) => {
        const definition = cardDefinition(card);
        const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
        const poker = identity ? `${identity} · ` : "";
        return `<li><span><i class="battle-marker-card-back"></i>${escapeHtml(poker + (definition?.name || `暗置牌 ${index + 1}`))}</span>
          <button type="button" data-marker-card-remove="${card.instanceId || ""}">移去</button></li>`;
      }).join("")
    : "";
  dialogContent.innerHTML = `<div class="battle-card-menu battle-marker-manager">
    <span class="battle-kicker">${escapeHtml(player.nickname)}的本体标记</span>
    <h2>${escapeHtml(marker.label)} <small>×${count}</small></h2>
    <label class="battle-dialog-label">标记名称
      <div class="battle-marker-manager__rename">
        <input type="text" id="battle-marker-rename" maxlength="20" value="${escapeHtml(marker.label)}" />
        <button type="button" data-marker-rename>改名</button>
      </div>
    </label>
    ${isCardMarker ? `
      <p class="battle-dialog-hint">这些牌正面朝下放在本体旁。移去后会正面朝上进入共用手牌弃牌区。</p>
      ${ownsCards
        ? `<ul class="battle-marker-card-list">${cardRows}</ul>`
        : `<div class="battle-marker-hidden-stack"><span class="battle-marker-chip__cards"><i></i><i></i></span><b>${count} 张暗置牌</b></div>
           <button type="button" class="battle-small-btn" data-marker-card-remove="">移去最上方一张</button>`}
    ` : `
      <label class="battle-dialog-label">数量</label>
      <div class="battle-form-stepper">
        <button type="button" class="battle-stepper-btn" data-marker-count-step="-1" aria-label="减少">−</button>
        <input type="number" id="battle-marker-edit-count" value="${count}" min="1" max="99" />
        <button type="button" class="battle-stepper-btn" data-marker-count-step="1" aria-label="增加">＋</button>
      </div>
      <button type="button" class="btn btn--primary" data-marker-count-save>保存数量</button>
    `}
    <div class="battle-card-menu__actions battle-card-menu__actions--row">
      <button type="button" class="battle-small-btn" data-dialog-cancel>关闭</button>
      <button type="button" class="battle-small-btn battle-marker-manager__delete" data-marker-delete>删除整个标记</button>
    </div>
  </div>`;
  dialogContent.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialogContent.querySelector("[data-marker-rename]")?.addEventListener("click", () => {
    const label = dialogContent.querySelector<HTMLInputElement>("#battle-marker-rename")?.value.trim();
    if (!label || label === marker.label) return;
    send("marker:rename", { markerId, label });
    dialog.close();
  });
  dialogContent.querySelectorAll<HTMLElement>("[data-marker-count-step]").forEach((button) => {
    button.addEventListener("click", () => {
      if (marker.kind !== "counter") return;
      const input = dialogContent.querySelector<HTMLInputElement>("#battle-marker-edit-count");
      const next = Number(input?.value || marker.count) + Number(button.dataset.markerCountStep);
      if (next < 1) {
        dialog.close();
        showConfirmDialog(`「${marker.label}」已是最后一枚，确定删除？`, () => send("marker:remove", { markerId }));
        return;
      }
      if (input) input.value = String(Math.min(99, next));
    });
  });
  dialogContent.querySelector("[data-marker-count-save]")?.addEventListener("click", () => {
    const next = Math.max(1, Math.min(99, Number(dialogContent.querySelector<HTMLInputElement>("#battle-marker-edit-count")?.value || 1)));
    send("marker:adjust", { markerId, count: next });
    dialog.close();
  });
  dialogContent.querySelectorAll<HTMLElement>("[data-marker-card-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      send("marker:card-remove", { markerId, instanceId: button.dataset.markerCardRemove || undefined });
      dialog.close();
    });
  });
  dialogContent.querySelector("[data-marker-delete]")?.addEventListener("click", () => {
    dialog.close();
    showConfirmDialog(`删除整个「${marker.label}」标记${isCardMarker ? `并将其中 ${count} 张牌置入弃牌区` : ""}？`, () => send("marker:remove", { markerId }));
  });
  openBattleDialog(returnFocus);
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
    activeMoveTargets = createMoveTargets(instanceId, ownerId, zone, kind);
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
    ...(player.markers || []).flatMap((marker) => marker.kind === "cards" ? marker.cards : []),
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
      const poker = handCardIdentityLabel(card.suit, card.rank, card.joker) || "牌面未知";
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
      const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
      const poker = identity ? `${identity} · ` : "";
      const img = definition?.kind === "hand"
        ? handCardImagePath(definition.id, card.suit, card.rank, card.joker)
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
