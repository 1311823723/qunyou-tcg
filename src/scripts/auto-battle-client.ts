import type { AutoLegalAction, AutoUnavailableReasons } from "../lib/auto-action-types";
import { AutoInteraction, type LocalSelectionAction, type LocalFormAction, type PendingAction } from "./auto-interaction";
import { getBattleApiUrl } from "../lib/battle-api";
import { escapeHtml, handCardIdentityLabel, handCardImagePath } from "./battle-format";
import {
  clearActiveRoom,
  getBattleToken,
  markActiveRoomWithMode,
  readPending,
  readProfile,
} from "./battle-profile";
import type { Catalog, CardView, PlayerView, CustomDeckConfig } from "./battle-types";
import { mountCustomDeckEditor } from "./battle-custom-deck-editor";
import { AUTO_CUSTOM_DECK_KEY, AUTO_LOADOUT_KEY, autoBodyCards, validAutoCustomDeck, resolveAutoLoadout } from "./auto-loadout";
import { resolveCardDetail, renderCardDetailBody, renderCardArtPreview, renderCardArtDialog, bindHighResImage } from "./battle-card-detail";

type AutoPrompt = {
  id: string;
  kind: string;
  playerId: string;
  title: string;
  message: string;
  min?: number;
  max?: number;
  cardInstanceIds?: string[];
  selectableCards?: CardView[];
  options?: Array<{ value: string; label: string }>;
  context?: Record<string, unknown>;
};

type AutoBodyState = {
  progress: number;
  progressMax: number;
  dynamaxEnergy?: number;
  dynamaxHealth?: number;
  flipped: boolean;
  extraFormUsed: boolean;
  trackedCharacterInstanceIds: string[];
  ambushWindow?: { remaining: number; expiresAtTurnNumber: number };
  riderCards?: Partial<Record<"强攻" | "防御" | "资源" | "控制" | "支援" | "伏击", "absent" | "normal" | "final">>;
};

type AutoPlayerView = PlayerView & { maxHealth?: number; bodyState: AutoBodyState };

type AutoSnapshot = {
  mode: "auto";
  roomCode: string;
  you: string;
  revision: number;
  players: AutoPlayerView[];
  game: {
    started: boolean;
    currentPlayerId?: string;
    firstPlayerId?: string;
    turnNumber: number;
    phase: "preparation" | "draw" | "play" | "deployment" | "discard" | "end";
    handDeckCount: number;
    handDiscard: CardView[];
    resolving: CardView[];
    stack: Array<{ kind: "hand" | "character-skill"; id: string; definitionId: string; resolvedAs?: string; sourcePlayerId: string; cancelled?: boolean; targetPlayerId?: string; targetSlotIndex?: number }>;
    prompt?: AutoPrompt;
    responsePlayerId?: string;
    winnerId?: string;
    deployedThisPhase: number;
    recentEvents: Array<{ id: string; type: string; sourcePlayerId?: string; targetPlayerId?: string; characterDefinitionId?: string; cardDefinitionId?: string }>;
    legalHandCardIds: string[];
    legalSkillInstanceIds: string[];
    canAutoAdvancePhase: boolean;
    legalActions?: AutoLegalAction[];
    unavailableReasons?: AutoUnavailableReasons;
    legalBodyActionPlayerIds: string[];
    skillCostRestReductionByCharacterId: Record<string, number>;
    logs: Array<{ id: string; text: string; actorId?: string }>;
  };
  isSpectator?: boolean;
};

type ServerMessage =
  | { type: "snapshot"; snapshot: AutoSnapshot }
  | { type: "actionAck"; actionId: string; revision: number; timings?: { applyMs: number; persistMs: number; totalMs: number } }
  | { type: "error"; error: string; actionId?: string }
  | { type: "roomEnded"; reason?: string };

const root = document.querySelector<HTMLElement>("#auto-battle-root");
const app = document.querySelector<HTMLElement>("#auto-battle-app");
const connection = document.querySelector<HTMLElement>("#auto-connection");
const roomCodeElement = document.querySelector<HTMLElement>("#auto-room-code");
const effectLayer = document.querySelector<HTMLElement>("#auto-effect-layer");
const catalog = JSON.parse(document.querySelector("#auto-battle-catalog")?.textContent || "{}") as Catalog;
const API_URL = getBattleApiUrl();
const params = new URLSearchParams(location.search);
const roomCode = (params.get("code") || "").trim().toUpperCase();
const spectate = params.get("spectate") === "true";
const perfEnabled = params.get("perf") === "1";
const profile = readProfile();
const pending = readPending() as { nickname?: string; deckId?: string; customDeck?: unknown };
const token = getBattleToken();
const interactionState = new AutoInteraction();
let socket: WebSocket | undefined;
let snapshot: AutoSnapshot | undefined;
let reconnectTimer = 0;
let toastTimer = 0;
let shouldReconnect = true;
let exitingToLobby = false;
let detailCardInstanceId = "";
let detailOwnerId = "";
let riderDetailId = "";
let riderDetailFinal = false;
let autoResponseTimer = 0;
let autoPhaseTimer = 0;
let effectTimer = 0;
let effectPlaying = false;
const effectQueue: Array<{ player: AutoPlayerView; kind: "ready" | "activate" }> = [];
const healthAnimations = new Map<string, "damage" | "heal">();
const progressAnimations = new Set<string>();
const flipAnimations = new Set<string>();
const mobileTableQuery = window.matchMedia("(max-width: 1024px), (hover: none) and (pointer: coarse)");
type MobileTableLayout = "landscape" | "portrait";
let mobileTableActive = mobileTableQuery.matches;
let mobileTableLayout = readMobileTableLayout();
let mobileLogOpen = false;
const expandedRetired = new Set<string>();
let feedbackBaseline: string | undefined;
let feedbackReady = false;
let mobileLogReturnFocus: HTMLElement | null = null;
let pendingFeedbackTimer = 0;
let pendingSlowTimer = 0;
let pendingStalledTimer = 0;
let lastSnapshotBytes = 0;
let lastRenderMs = 0;
let lastUpdatedRegions: string[] = [];
let lastAckMetrics: { rttMs: number; applyMs?: number; persistMs?: number; totalMs?: number } | undefined;
let gameStructureKey = "";
const gameRegionCache = new Map<string, string>();
let gameBindings: AbortController | undefined;
const QUICK_PLAY_KEY = "qunyou-auto-quick-play-v1";
const mouseQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
let quickPlay = false;
try { quickPlay = localStorage.getItem(QUICK_PLAY_KEY) === "true"; } catch { /* Optional local preference. */ }
let hoverTimer = 0;
let lastQuickClick: { id: string; at: number; revision: number } | undefined;
let dragGesture: { id: string; revision: number; order?: boolean } | undefined;
let suppressClickUntil = 0;
let enterHeld = false;

function readMobileTableLayout(): MobileTableLayout {
  return window.innerWidth >= window.innerHeight ? "landscape" : "portrait";
}

function syncMobileTableState() {
  if (!app) return;
  app.dataset.mobileTable = mobileTableActive ? "true" : "false";
  if (mobileTableActive) app.dataset.mobileLayout = mobileTableLayout;
  else delete app.dataset.mobileLayout;
  const layoutButton = app.querySelector<HTMLButtonElement>("[data-auto-mobile-layout]");
  const logButton = app.querySelector<HTMLButtonElement>("[data-auto-mobile-log-toggle]");
  if (layoutButton) {
    layoutButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
    layoutButton.setAttribute("aria-label", layoutButton.textContent);
  }
  const quickButton = app.querySelector<HTMLButtonElement>("[data-auto-quick-play]");
  if (quickButton) {
    quickButton.hidden = !mouseQuery.matches;
    quickButton.textContent = quickPlay ? "快捷出牌：开" : "快捷出牌：关";
    quickButton.setAttribute("aria-pressed", String(quickPlay));
  }
  logButton?.setAttribute("aria-expanded", mobileLogOpen ? "true" : "false");
}

if (roomCodeElement) roomCodeElement.textContent = roomCode || "------";

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>("#auto-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function clearPendingAction() {
  interactionState.pendingAction = undefined;
  clearTimeout(pendingFeedbackTimer);
  clearTimeout(pendingSlowTimer);
  clearTimeout(pendingStalledTimer);
  if (app) delete app.dataset.actionPending;
}

function beginPendingAction(action: PendingAction) {
  interactionState.pendingAction = action;
  if (app) app.dataset.actionPending = "true";
  clearTimeout(pendingFeedbackTimer);
  clearTimeout(pendingSlowTimer);
  clearTimeout(pendingStalledTimer);
  pendingFeedbackTimer = window.setTimeout(() => interactionState.pendingAction?.id === action.id && render(), 300);
  pendingSlowTimer = window.setTimeout(() => {
    if (interactionState.pendingAction?.id !== action.id) return;
    interactionState.pendingAction.status = "slow";
    render();
  }, 2000);
  pendingStalledTimer = window.setTimeout(() => {
    if (interactionState.pendingAction?.id !== action.id) return;
    interactionState.pendingAction.status = "stalled";
    render();
  }, 10000);
}

function renderPendingAction() {
  if (!interactionState.pendingAction || performance.now() - interactionState.pendingAction.sentAt < 300) return "";
  const label = interactionState.pendingAction.status === "stalled"
    ? "服务器长时间未响应"
    : interactionState.pendingAction.status === "slow"
      ? "网络较慢，正在等待服务器"
      : "正在处理操作";
  return `<div class="auto-action-pending is-${interactionState.pendingAction.status}" role="status"><span>${label}</span>${interactionState.pendingAction.status === "stalled" ? '<button class="btn btn--secondary" data-auto-reconnect>重新连接</button>' : ""}</div>`;
}

function reconnectNow() {
  clearPendingAction();
  shouldReconnect = true;
  try { socket?.close(); } catch { /* reconnect through the normal close handler */ }
  if (!socket || socket.readyState === WebSocket.CLOSED) void connect();
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

function inviteUrl() {
  const url = new URL("/play", location.origin);
  url.searchParams.set("room", snapshot?.roomCode || roomCode);
  return url.toString();
}

function setConnection(label: string, state: string) {
  if (!connection) return;
  const text = connection.querySelector("b");
  if (text) text.textContent = label;
  connection.dataset.state = state;
}

function loadout() {
  try { return resolveAutoLoadout(catalog, JSON.parse(localStorage.getItem(AUTO_LOADOUT_KEY) || "null") || pending); }
  catch { return resolveAutoLoadout(catalog, pending); }
}

function openAutoDeckEditor(me: AutoPlayerView) {
  if (me.ready || snapshot?.game.started) return;
  const dialog = document.querySelector<HTMLDialogElement>("#auto-deck-dialog")!;
  const dialogContent = document.querySelector<HTMLElement>("#auto-deck-dialog-content")!;
  dialog.querySelector<HTMLButtonElement>("[data-auto-deck-close]")!.onclick = () => dialog.close();
  const fallback = catalog.decks.find((deck) => deck.autoReady && deck.id === me.deckId) || catalog.decks.find((deck) => deck.autoReady)!;
  let deck: CustomDeckConfig = { bodyId: fallback.bodyId, characterIds: [...fallback.characterIds] };
  try {
    const saved = me.customDeck || JSON.parse(localStorage.getItem(AUTO_CUSTOM_DECK_KEY) || localStorage.getItem("qunyou-battle-custom-deck-v1") || "null");
    if (validAutoCustomDeck(catalog, saved)) deck = saved;
  } catch { /* Invalid local drafts do not alter the classic editor's saved deck. */ }
  mountCustomDeckEditor({ dialog, dialogContent, catalog, deck,
    bodyCatalogCards: autoBodyCards(catalog),
    characterCatalogCards: Object.values(catalog.cards).filter((card) => card.kind === "character" && card.automationLevel === "full"),
    openBattleDialog: () => { if (!dialog.open) dialog.showModal(); },
    onSave: (customDeck) => {
      if (!validAutoCustomDeck(catalog, customDeck)) return;
      if (send("player:selectDeck", { deckId: "custom", customDeck })) {
        localStorage.setItem(AUTO_CUSTOM_DECK_KEY, JSON.stringify(customDeck));
        localStorage.setItem(AUTO_LOADOUT_KEY, JSON.stringify({ deckId: "custom", customDeck }));
      }
    },
    onPreview: (id) => {
      const preview = document.querySelector<HTMLDialogElement>("#auto-deck-preview")!;
      const render = (form: "normal" | "mega" = "normal") => {
        preview.classList.remove("battle-dialog--art");
        const view = resolveCardDetail({ definition: catalog.cards[id] }, form);
        preview.innerHTML = `<div class="battle-dialog__frame battle-card-menu battle-card-menu--rich"><button type="button" class="battle-small-btn" data-preview-close>返回选牌</button><div class="battle-card-detail">${renderCardArtPreview(view)}${renderCardDetailBody(view)}</div></div>`;
        preview.querySelector("[data-preview-close]")?.addEventListener("click", () => preview.close());
        preview.querySelector("[data-card-art-zoom]")?.addEventListener("click", () => {
          preview.classList.add("battle-dialog--art");
          preview.innerHTML = `<div class="battle-dialog__frame">${renderCardArtDialog(view)}</div>`;
          bindHighResImage(preview);
          preview.querySelector("[data-card-detail-back]")?.addEventListener("click", () => render(form));
        });
        preview.querySelectorAll<HTMLElement>("[data-card-form]").forEach((button) => button.addEventListener("click", () => render(button.dataset.cardForm === "mega" ? "mega" : "normal")));
      };
      render(); preview.showModal();
    },
  });
}

async function ensureSeat() {
  if (spectate) return;
  if (!profile) throw new Error("请先返回大厅设置用户名。");
  const response = await fetch(`${API_URL}/auto/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: profile.nickname, token, ...loadout() }),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "加入自动房间失败。");
  markActiveRoomWithMode(roomCode, "auto");
}

function wsUrl() {
  const base = API_URL.replace(/^http/, "ws");
  const url = new URL(`${base}/auto/rooms/${roomCode}/connect`);
  url.searchParams.set("token", token);
  if (spectate) {
    url.searchParams.set("spectator", "true");
    url.searchParams.set("nickname", profile?.nickname || "观战者");
  }
  if (perfEnabled) url.searchParams.set("perf", "1");
  return url;
}

async function connect() {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return renderFatal("房间码无效。");
  try {
    setConnection("连接中", "connecting");
    await ensureSeat();
    socket = new WebSocket(wsUrl());
    socket.addEventListener("open", () => { feedbackReady = false; setConnection("已连接", "open"); });
    socket.addEventListener("message", (event) => {
      const raw = String(event.data);
      lastSnapshotBytes = raw.length;
      handleMessage(JSON.parse(raw) as ServerMessage);
    });
    socket.addEventListener("close", () => {
      clearPendingAction();
      interactionState.resetDecision();
      if (!shouldReconnect) return;
      setConnection("正在重连", "closed");
      reconnectTimer = window.setTimeout(connect, 1200);
    });
    socket.addEventListener("error", () => setConnection("连接异常", "failed"));
  } catch (error) {
    renderFatal(error instanceof Error ? error.message : "无法连接自动牌桌。");
  }
}

function handleMessage(message: ServerMessage) {
  if (message.type === "snapshot") {
    const previous = snapshot;
    healthAnimations.clear();
    progressAnimations.clear();
    flipAnimations.clear();
    if (previous?.game.started && message.snapshot.game.started) {
      for (const player of message.snapshot.players) {
        const before = previous.players.find((candidate) => candidate.id === player.id);
        if (!before) continue;
        if (player.health !== before.health || (player.bodyState.dynamaxHealth || 0) < (before.bodyState.dynamaxHealth || 0)) healthAnimations.set(player.id, Number(player.health || 0) < Number(before.health || 0) || (player.bodyState.dynamaxHealth || 0) < (before.bodyState.dynamaxHealth || 0) ? "damage" : "heal");
        if (player.bodyState.progress > before.bodyState.progress) progressAnimations.add(player.id);
        if (!before.bodyState.flipped && player.bodyState.flipped) {
          flipAnimations.add(player.id);
          effectQueue.push({ player, kind: "ready" });
        } else if (!before.bodyState.extraFormUsed && player.bodyState.extraFormUsed) {
          effectQueue.push({ player, kind: "activate" });
        }
        if (before.bodyState.flipped && !player.bodyState.flipped) flipAnimations.add(player.id);
      }
    }
    snapshot = message.snapshot;
    if (snapshot.game.started) {
      document.querySelector<HTMLDialogElement>("#auto-deck-preview")?.close();
      document.querySelector<HTMLDialogElement>("#auto-deck-dialog")?.close();
    }
    if (interactionState.pendingAction?.ackRevision !== undefined && snapshot.revision >= interactionState.pendingAction.ackRevision) clearPendingAction();
    const me = snapshot.players.find((player) => player.id === snapshot?.you);
    if (!me?.hand.some((card) => card.instanceId === interactionState.selectedPlayCardId)
      || !snapshot.game.legalHandCardIds.includes(interactionState.selectedPlayCardId)) interactionState.selectedPlayCardId = "";
    if (interactionState.selectedRoleInstanceId && !me?.characterSlots.some((card) => card && "instanceId" in card && card.instanceId === interactionState.selectedRoleInstanceId)
      && !me?.retired.some((card) => card.instanceId === interactionState.selectedRoleInstanceId)) interactionState.selectedRoleInstanceId = "";
    // Presence/log updates must not erase a choice that is still being made.
    const decisionChanged = previous?.game.prompt?.id !== snapshot.game.prompt?.id
      || previous?.game.phase !== snapshot.game.phase
      || previous?.game.turnNumber !== snapshot.game.turnNumber
      || previous?.game.currentPlayerId !== snapshot.game.currentPlayerId
      || previous?.game.winnerId !== snapshot.game.winnerId;
    if (decisionChanged) {
      interactionState.resetDecision();
    } else {
      const choices = interactionState.localSelectionAction?.cardInstanceIds || snapshot.game.prompt?.cardInstanceIds || [];
      for (const id of interactionState.selectedPromptCards) if (!choices.includes(id)) interactionState.selectedPromptCards.delete(id);
      for (const id of interactionState.selectedDiscard) if (!snapshot.game.prompt?.cardInstanceIds?.includes(id)) interactionState.selectedDiscard.delete(id);
    }
    reconcileLocalDraft();
    render();
    playNextBodyEffect();
    scheduleAutomaticActions();
  } else if (message.type === "actionAck") {
    if (interactionState.pendingAction?.id !== message.actionId) return;
    interactionState.pendingAction.ackRevision = message.revision;
    lastAckMetrics = {
      rttMs: performance.now() - interactionState.pendingAction.sentAt,
      ...(message.timings ? message.timings : {}),
    };
    if (snapshot && snapshot.revision >= message.revision) {
      clearPendingAction();
      render();
      scheduleAutomaticActions();
    }
  } else if (message.type === "error") {
    if (!message.actionId || interactionState.pendingAction?.id === message.actionId) clearPendingAction();
    showToast(message.error);
    render();
  }
  else if (message.type === "roomEnded") {
    clearPendingAction();
    shouldReconnect = false;
    clearTimeout(reconnectTimer);
    clearActiveRoom(roomCode);
    if (exitingToLobby) {
      location.href = "/play";
      return;
    }
    renderFatal(message.reason || "房间已经关闭。");
  }
}

function playNextBodyEffect() {
  if (effectPlaying || !effectLayer || !effectQueue.length) return;
  const effect = effectQueue.shift();
  if (!effect?.player.body) return playNextBodyEffect();
  const body = definition(effect.player.body);
  if (!body) return playNextBodyEffect();
  effectPlaying = true;
  const isMega = body.extraFormType === "mega";
  const title = effect.kind === "ready"
    ? body.extraFormType === "dynamax" ? "极巨化" : isMega ? "Mega 进化" : "Z 招式就绪"
    : body.extraFormType === "dynamax" ? "极巨技能" : isMega ? "Mega 特性生效" : "Z 招式发动";
  const subtitle = effect.kind === "activate"
    ? body.extraSubtitle?.split(" · ").at(-1) || body.extraName || body.name
    : body.extraName || body.name;
  const portrait = body.extraPortraitPath || body.extraHighResImagePath || body.extraImagePath || body.portraitPath || body.imagePath;
  const showFlip = effect.kind === "ready";
  effectLayer.innerHTML = `<section class="battle-cinematic battle-cinematic--bodyMega auto-body-cinematic ${showFlip ? "is-form-ready" : "is-form-activate"}">
    <div class="battle-cinematic__shade"></div>
    <div class="battle-cinematic__energy" aria-hidden="true"><i></i><i></i><i></i></div>
    ${showFlip && body.imagePath ? `<div class="battle-cinematic__flip-card"><img class="battle-cinematic__card-front" src="${escapeHtml(body.imagePath)}" alt=""><img class="battle-cinematic__card-back" src="${escapeHtml(body.extraImagePath || body.imagePath)}" alt=""></div>` : ""}
    ${portrait ? `<img class="battle-cinematic__portrait" src="${escapeHtml(portrait)}" alt="">` : ""}
    <div class="battle-cinematic__caption"><small>${escapeHtml(subtitle)}</small><strong>${escapeHtml(title)}</strong></div>
  </section>`;
  effectLayer.classList.add("is-playing");
  clearTimeout(effectTimer);
  effectTimer = window.setTimeout(() => {
    effectLayer.classList.remove("is-playing");
    effectLayer.replaceChildren();
    effectPlaying = false;
    playNextBodyEffect();
  }, 1180);
}

function send(type: string, payload: Record<string, unknown> = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !snapshot) {
    showToast("牌桌尚未连接。");
    return false;
  }
  if (interactionState.pendingAction) return false;
  const actionId = crypto.randomUUID();
  const action = { id: actionId, type, baseRevision: snapshot.revision, sentAt: performance.now(), status: "pending" as const };
  beginPendingAction(action);
  socket.send(JSON.stringify({ type, payload, actionId, protocolVersion: 2, baseRevision: snapshot.revision }));
  interactionState.submitted();
  render();
  return true;
}

function sendPromptChoice(payload: Record<string, unknown>) {
  const promptId = snapshot?.game.prompt?.id;
  return send("choice:submit", { ...payload, ...(promptId ? { promptId } : {}) });
}

function definition(card?: CardView) {
  return card?.definitionId ? catalog.cards[card.definitionId] : undefined;
}

function cardImage(card: CardView, owner?: AutoPlayerView) {
  const cardDefinition = definition(card);
  if (!cardDefinition) return undefined;
  if (cardDefinition.kind === "hand") return handCardImagePath(cardDefinition.id, card.suit, card.rank, card.joker);
  if (cardDefinition.kind === "body" && owner?.bodyState.flipped) return cardDefinition.extraImagePath || cardDefinition.imagePath;
  return cardDefinition.imagePath;
}

function cardPreviewImage(card: CardView, owner?: AutoPlayerView) {
  const cardDefinition = definition(card);
  if (!cardDefinition || cardDefinition.kind === "hand") return cardImage(card, owner);
  if (cardDefinition.kind === "body" && owner?.bodyState.flipped) {
    return cardDefinition.extraHighResImagePath || cardDefinition.extraImagePath || cardDefinition.highResImagePath || cardDefinition.imagePath;
  }
  return cardDefinition.highResImagePath || cardDefinition.imagePath;
}

function isServerPromptSelectable(instanceId?: string) {
  const prompt = snapshot?.game.prompt;
  if (!instanceId || !prompt || prompt.playerId !== snapshot?.you || prompt.max === undefined) return false;
  return !["response", "dying", "recall"].includes(prompt.kind) && Boolean(prompt.cardInstanceIds?.includes(instanceId));
}

function isLocalSelectionCard(instanceId?: string) {
  return Boolean(instanceId && interactionState.localSelectionAction?.cardInstanceIds?.includes(instanceId));
}

function isCardOnTable(instanceId?: string) {
  if (!instanceId || !snapshot) return false;
  return snapshot.players.some((player) => player.body?.instanceId === instanceId
    || player.hand.some((card) => card.instanceId === instanceId)
    || player.characterSlots.some((card) => card && "instanceId" in card && card.instanceId === instanceId)
    || player.retired.some((card) => card.instanceId === instanceId));
}

function renderCard(card: CardView, owner: AutoPlayerView, zone: string, interactive: boolean, disabledReason = "") {
  const cardDefinition = definition(card);
  if (!cardDefinition) return `<div class="auto-card auto-card--back"><span>暗置</span></div>`;
  const faceDownCharacter = cardDefinition.kind === "character" && Boolean(card.faceDown) && zone.startsWith("slot:");
  const opponentFaceDownCharacter = faceDownCharacter && owner.id !== snapshot?.you;
  const ownFaceDownCharacter = faceDownCharacter && !opponentFaceDownCharacter;
  const image = opponentFaceDownCharacter ? "/cards/backs/character.webp" : cardImage(card, owner);
  const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
  const title = disabledReason ? `${cardDefinition.text}\n当前不可用：${disabledReason}` : cardDefinition.text;
  const selectable = isServerPromptSelectable(card.instanceId) || isLocalSelectionCard(card.instanceId);
  const selected = card.instanceId === interactionState.selectedPlayCardId || card.instanceId === interactionState.selectedRoleInstanceId
    || Boolean(card.instanceId && interactionState.selectedPromptCards.has(card.instanceId))
    || Boolean(card.instanceId && interactionState.selectedDiscard.has(card.instanceId));
  const animated = cardDefinition.kind === "body" && flipAnimations.has(owner.id) ? "is-form-flipped" : "";
  return `<button type="button" class="auto-card auto-card--${cardDefinition.kind} ${interactive || selectable ? "is-legal" : ""} ${selectable ? "is-table-selectable" : ""} ${selected ? "is-selected" : ""} ${opponentFaceDownCharacter ? "is-face-down" : ownFaceDownCharacter ? "is-own-face-down" : ""} ${animated}" draggable="${mouseQuery.matches && quickPlay && zone === "hand" && !snapshot?.game.prompt && interactive ? "true" : "false"}" data-auto-card="${card.instanceId || ""}" data-owner="${owner.id}" data-zone="${zone}" data-interactive="${interactive || selectable ? "true" : "false"}" title="${escapeHtml(opponentFaceDownCharacter ? "暗置角色" : title)}">
    ${image ? `<img src="${image}" alt="" draggable="false" />` : ""}${!opponentFaceDownCharacter && cardDefinition.kind === "character" && cardDefinition.automationLevel ? `<span class="auto-card__automation">${cardDefinition.automationLevel === "full" ? "自动" : "辅助"}</span>` : ""}${opponentFaceDownCharacter ? `<span class="sr-only">暗置角色</span>` : `<strong>${escapeHtml(cardDefinition.kind === "body" && owner.bodyState.flipped ? cardDefinition.extraName || cardDefinition.name : cardDefinition.name)}</strong><small>${escapeHtml(identity || (cardDefinition.kind === "body" && owner.bodyState.flipped ? cardDefinition.extraSubtitle || cardDefinition.subtitle : cardDefinition.subtitle))}</small>`}
  </button>`;
}

function renderHealthCounter(player: AutoPlayerView) {
  const max = player.maxHealth || 7;
  const health = Math.max(0, Math.min(max, player.health || 0));
  const percent = max ? health / max * 100 : 0;
  const state = percent < 25 ? "low" : percent <= 50 ? "medium" : "high";
  const crystals = Array.from({ length: max }, (_, index) => {
    const filled = index < health;
    const icon = filled ? state : "empty";
    return `<img src="/battle-icons/health/health-crystal-${icon}.png" alt="" aria-hidden="true" class="auto-health-counter__icon is-${icon} ${filled && state === "low" && index === health - 1 ? "is-pulsing" : ""}">`;
  }).join("");
  const change = healthAnimations.get(player.id);
  return `<div class="auto-health-counter is-${state} ${change ? `is-${change}` : ""}" aria-label="体力 ${health} / ${max}">
    <span>体力</span><div class="auto-health-counter__icons">${crystals}</div><strong>${health}<small>/ ${max}</small></strong>
  </div>`;
}

function renderProgressCounter(player: AutoPlayerView, body?: ReturnType<typeof definition>) {
  if (body?.extraFormType === "dynamax") {
    const active = player.bodyState.flipped;
    const count = active ? player.bodyState.dynamaxEnergy || 0 : player.bodyState.progress;
    const max = active ? 3 : player.bodyState.progressMax;
    const label = active ? "极巨能量" : "极巨化";
    const ready = !active && !player.bodyState.extraFormUsed && max > 0 && count >= max;
    const status = active ? "极巨化中" : player.bodyState.extraFormUsed ? "已结束" : ready ? "准备阶段可变身" : "积累连携";
    return `<div class="auto-progress-counter auto-dynamax-counter ${ready ? "is-ready" : ""}" aria-label="${label} ${count} / ${max}，${status}"><span>${label}</span><strong>${count}/${max}</strong><div class="auto-dynamax-counter__pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < count ? "is-lit" : ""}"></i>`).join("")}</div><small>${status}</small></div>`;
  }
  const progress = Math.max(0, player.bodyState.progress || 0);
  const max = Math.max(1, player.bodyState.progressMax || body?.megaMax || 1);
  const percent = Math.min(100, progress / max * 100);
  const ready = player.bodyState.flipped;
  const used = player.bodyState.extraFormUsed;
  const state = ready ? "ready" : percent >= 66 ? "high" : percent >= 33 ? "medium" : "low";
  const isZMove = body?.extraFormType === "z-move";
  const iconType = isZMove ? "z-move" : "mega";
  const iconPrefix = isZMove ? "z-crystal" : "mega-crystal";
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - percent / 100 * circumference;
  const icons = Array.from({ length: max }, (_, index) => {
    const iconState = ready ? "ready" : index < progress ? state : "empty";
    const fileState = iconState === "empty" ? "low" : iconState;
    const pulse = (ready && index === max - 1) || (!ready && state === "high" && index === progress - 1) ? "is-pulsing" : "";
    return `<img src="/battle-icons/${iconType}/${iconPrefix}-${fileState}.png" alt="" aria-hidden="true" class="auto-progress-counter__icon is-${iconState} ${pulse}">`;
  }).join("");
  const status = used ? "已使用" : ready ? isZMove ? "Z 就绪" : "Mega 生效" : "";
  return `<div class="auto-progress-counter is-${state} ${used ? "is-used" : ""} ${progressAnimations.has(player.id) ? "is-progressing" : ""}" aria-label="${escapeHtml(body?.extraFormLabel || "额外形态")} ${progress} / ${max}">
    <span>${escapeHtml(body?.extraFormLabel || "额外形态")}</span>
    <div class="auto-progress-counter__ring"><svg viewBox="0 0 40 40"><circle class="ring-bg" cx="20" cy="20" r="${radius}"></circle><circle class="ring-fill" cx="20" cy="20" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle></svg><strong>${progress}/${max}</strong></div>
    <div class="auto-progress-counter__icons">${icons}</div>${status ? `<small>${status}</small>` : ""}
  </div>`;
}

const riderRoleOrder = ["强攻", "防御", "资源", "控制", "支援", "伏击"] as const;

function riderDefinitionForRole(role: string) {
  return Object.values(catalog.cards).find((card) => card.kind === "rider" && card.mainRole === role);
}

function renderRiderCards(player: AutoPlayerView, isMe: boolean) {
  if (player.body?.definitionId !== "body_roaming_001") return "";
  const legalActions = snapshot?.game.legalActions || [];
  const cards = riderRoleOrder.map((role) => {
    const card = riderDefinitionForRole(role);
    const state = player.bodyState.riderCards?.[role] || "absent";
    const legal = isMe && card && legalActions.find((action) => action.type === "rider:activate" && action.payload?.riderId === card.id);
    const status = state === "final" ? "FINAL" : state === "normal" ? "持有" : "空缺";
    return `<article class="auto-rider-card is-${state}" data-rider-role="${escapeHtml(role)}">
      <button type="button" class="auto-rider-card__detail" data-rider-detail="${escapeHtml(card?.id || "")}" data-rider-final="${player.bodyState.flipped ? "true" : "false"}" ${card ? "" : "disabled"}>
        <span>${escapeHtml(role)}</span><strong>${escapeHtml(card?.skillName || "RIDE")}</strong><small>${status}</small>
      </button>
      ${legal ? `<button type="button" class="auto-rider-card__use" data-rider-activate="${escapeHtml(card.id)}">使用</button>` : ""}
    </article>`;
  }).join("");
  return `<section class="auto-rider-zone" aria-label="骑士卡"><header><span>骑士卡</span><small>${player.bodyState.flipped ? "FINAL" : "普通"}</small></header><div>${cards}</div></section>`;
}

function renderPlayer(player: AutoPlayerView, isMe: boolean, perspectiveLabel?: string, region?: string) {
  const game = snapshot?.game;
  const current = game?.currentPlayerId === player.id;
  const slots = player.characterSlots.map((slot, index) => {
    if (!slot) return `<button class="auto-slot auto-slot--empty" data-empty-slot="${index}" disabled>空位 ${index + 1}</button>`;
    if ("faceDown" in slot && slot.faceDown && !("instanceId" in slot)) {
      const selectionKey = `slot:${player.id}:${index}`;
      const selectable = interactionState.localSelectionAction?.cardInstanceIds?.includes(selectionKey);
      return `<div class="auto-slot" data-target-player="${player.id}" data-target-slot="${index}"><button type="button" class="auto-card auto-card--back auto-card--character-back ${selectable ? "is-legal is-table-selectable" : ""} ${interactionState.selectedPromptCards.has(selectionKey) ? "is-selected" : ""}" ${selectable ? `data-local-slot="${escapeHtml(selectionKey)}"` : "disabled"}><img src="/cards/backs/character.webp" alt="暗置角色"></button></div>`;
    }
    if (!("instanceId" in slot) || !slot.instanceId) return `<div class="auto-slot auto-slot--marker"><span>${escapeHtml("label" in slot && slot.label ? slot.label : "占位标记")}</span></div>`;
    const canReveal = Boolean(isMe && game?.legalActions?.some((action) => action.type === "character:reveal" && action.payload?.slotIndex === index));
    const canUseSkill = Boolean(isMe && slot.instanceId && game?.legalSkillInstanceIds.includes(slot.instanceId));
    return `<div class="auto-slot" data-target-player="${player.id}" data-target-slot="${index}">${renderCard(slot, player, `slot:${index}`, canReveal || canUseSkill, canReveal ? "" : canUseSkill ? "" : "当前不满足技能时机")}</div>`;
  }).join("");
  const bodyDefinition = definition(player.body);
  const formLabel = bodyDefinition?.extraFormLabel || "额外形态";
  const bodyReady = player.bodyState.flipped;
  const bodyStatus = player.body ? `<div class="auto-body-status ${bodyReady ? "is-ready" : ""} ${player.bodyState.extraFormUsed ? "is-used" : ""}">
    <small>${bodyDefinition?.extraFormType === "dynamax" ? bodyReady ? `极巨体力 ${player.bodyState.dynamaxHealth || 0}/2（独立承伤）` : player.bodyState.extraFormUsed ? "极巨化已结束，正面特性生效" : escapeHtml(bodyDefinition.megaCondition || "累计连携解锁") : player.bodyState.extraFormUsed ? "本局已使用" : bodyReady ? (bodyDefinition?.extraFormType === "mega" ? "Mega 已生效" : "Z招式已就绪") : escapeHtml(bodyDefinition?.megaCondition || "累计核心操作解锁")}</small>
  </div>` : "";
  const markers = (player.markers || []).map((marker) => `<span class="battle-tag" title="${escapeHtml(marker.label)}">${escapeHtml(marker.label)} ×${marker.kind === "counter" ? marker.count : marker.cards.length}</span>`).join("");
  const retired = player.retired.map((card) => {
    const legal = Boolean(isMe && card.instanceId && game?.legalSkillInstanceIds.includes(card.instanceId));
    return renderCard(card, player, "retired", legal, legal ? "" : "当前不满足退场区发动时机");
  }).join("");
  const healthAnimation = healthAnimations.get(player.id);
  const side = perspectiveLabel || (isMe ? "我方" : "对手");
  const deciding = game?.prompt?.playerId === player.id || game?.responsePlayerId === player.id;
  const mustOpen = player.retired.some(card => card.instanceId && (interactionState.localSelectionAction?.cardInstanceIds?.includes(card.instanceId) || game?.prompt?.cardInstanceIds?.includes(card.instanceId)));
  return `<section class="auto-player ${current ? "is-current" : ""} ${isMe ? "is-self" : "is-opponent"} ${healthAnimation === "damage" ? "is-damaged" : healthAnimation === "heal" ? "is-healed" : ""}" data-player-id="${escapeHtml(player.id)}"${region ? ` data-auto-region="${region}"` : ""}>
    <header><div class="auto-player__identity"><strong class="auto-side-label">${side}</strong><h2>${escapeHtml(player.nickname)}</h2><span class="auto-presence">${player.connected ? "在线" : "暂离"}</span><em>手牌 ${player.handCount ?? player.hand.length}</em>${current ? '<b class="auto-turn-badge">当前回合</b>' : ""}${deciding ? '<b class="auto-decision-badge">正在选择</b>' : ""}</div></header>
    <div class="auto-player__field"><div class="auto-identity-cluster">${player.body ? `<div class="auto-body-wrap"><div class="auto-body-card">${renderCard(player.body, player, "body", false)}</div></div>` : ""}<div class="auto-player__counters">${renderHealthCounter(player)}${renderProgressCounter(player, bodyDefinition)}${bodyStatus}</div></div><div class="auto-slots">${slots}</div><div class="auto-public-status">${renderRiderCards(player, isMe)}${markers ? `<div class="auto-marker-summary" aria-label="本体标记">${markers}</div>` : ""}</div></div>
    ${retired ? `<details class="auto-retired" data-retired-owner="${escapeHtml(player.id)}" ${mustOpen || expandedRetired.has(player.id) ? "open" : ""}><summary>退场区 · ${player.retired.length} 张</summary><div>${retired}</div></details>` : ""}
  </section>`;
}

function renderLobby() {
  if (!snapshot || !root) return;
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = snapshot.players.find((player) => player.id !== snapshot?.you);
  const deckOptions = catalog.decks.map((deck) => `<option value="${deck.id}" ${deck.id === me?.deckId ? "selected" : ""} ${deck.autoReady ? "" : "disabled"}>${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}${deck.autoReady ? " · 已解锁" : ` · ${deck.autoImplemented}/${deck.autoTotal}`}</option>`).join("");
  root.innerHTML = `<section class="auto-lobby hud-panel">
    <span class="battle-kicker">AUTO BATTLE BETA</span><h1>自动对战准备室</h1>
    <div class="battle-invite auto-lobby__invite"><div><span class="battle-invite__label">房间码</span><strong class="battle-room-display">${escapeHtml(snapshot.roomCode)}</strong></div><div class="battle-invite__actions"><button type="button" class="battle-small-btn" data-auto-copy-code>复制房间码</button><button type="button" class="btn btn--primary" data-auto-copy-link>复制邀请链接</button></div></div>
    <div class="auto-lobby__seats"><article><strong>${escapeHtml(me?.nickname || "你的座位")}</strong><small>${me?.ready ? "已准备" : "未准备"}</small></article><article><strong>${escapeHtml(opponent?.nickname || "等待对手")}</strong><small>${opponent?.ready ? "已准备" : opponent ? "未准备" : "邀请对手加入"}</small></article></div>
    ${snapshot.you === "spectator" ? "" : `<label>选择牌组<select id="auto-deck-select" ${me?.ready ? "disabled" : ""}>${deckOptions}<option value="custom" ${me?.deckId === "custom" ? "selected" : ""}>自选卡组 · 1张本体与16张角色</option></select></label>${me?.deckId === "custom" ? `<p>${escapeHtml(catalog.cards[me.customDeck?.bodyId || ""]?.name || "自选阵容")} · ${me.customDeck?.characterIds.length || 0}/16 张角色</p>` : ""}<div class="battle-invite__actions"><button type="button" class="battle-small-btn" data-auto-custom-editor ${me?.ready ? "disabled" : ""}>${me?.deckId === "custom" ? "编辑自选卡组" : "自选卡组"}</button><button class="btn btn--primary" data-auto-command="ready">${me?.ready ? "取消准备" : "确认准备"}</button></div>`}
  </section>`;
  root.querySelector<HTMLSelectElement>("#auto-deck-select")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    if (select.value === "custom" && me) { select.value = me.deckId || ""; openAutoDeckEditor(me); return; }
    if (send("player:selectDeck", { deckId: select.value })) localStorage.setItem(AUTO_LOADOUT_KEY, JSON.stringify({ deckId: select.value }));
  });
  root.querySelector("[data-auto-custom-editor]")?.addEventListener("click", () => me && openAutoDeckEditor(me));
  root.querySelector("[data-auto-command=ready]")?.addEventListener("click", () => send("player:ready", { ready: !me?.ready }));
  root.querySelector<HTMLButtonElement>("[data-auto-copy-code]")?.addEventListener("click", (event) => copyText(snapshot?.roomCode || roomCode, event.currentTarget as HTMLButtonElement, "已复制", "复制房间码"));
  root.querySelector<HTMLButtonElement>("[data-auto-copy-link]")?.addEventListener("click", (event) => copyText(inviteUrl(), event.currentTarget as HTMLButtonElement, "已复制", "复制邀请链接"));
}

function renderPromptCard(card: CardView, owner: AutoPlayerView, interactive: boolean) {
  const cardDefinition = definition(card);
  if (!cardDefinition) return `<div class="auto-card auto-card--back"><img src="/cards/backs/hand.webp" alt="暗置手牌"></div>`;
  const image = cardImage(card, owner);
  const selected = Boolean(card.instanceId && interactionState.selectedPromptCards.has(card.instanceId));
  return `<button type="button" class="auto-card ${interactive ? "is-legal" : ""} ${selected ? "is-selected" : ""}" ${interactive ? `data-prompt-card="${card.instanceId}"` : "disabled"}>
    ${image ? `<img src="${image}" alt="" draggable="false" />` : ""}<strong>${escapeHtml(cardDefinition.name)}</strong><small>${escapeHtml(handCardIdentityLabel(card.suit, card.rank, card.joker) || cardDefinition.subtitle)}</small>
  </button>`;
}

function responseContext(prompt: AutoPrompt) {
  if (prompt.kind !== "response" || !snapshot) return "";
  const item = snapshot.game.stack.at(-1);
  if (!item) return "";
  const source = snapshot.players.find((player) => player.id === item.sourcePlayerId);
  const card = catalog.cards[item.resolvedAs || item.definitionId];
  return `<div class="auto-response-context"><span>正在响应</span><strong>${escapeHtml(source?.nickname || "对手")}</strong><i>使用了</i><b>【${escapeHtml(card?.name || "未知牌")}】</b></div>`;
}

const phaseOrder: AutoSnapshot["game"]["phase"][] = ["preparation", "draw", "play", "deployment", "discard", "end"];
const phaseLabels: Record<AutoSnapshot["game"]["phase"], string> = {
  preparation: "准备", draw: "摸牌", play: "出牌", deployment: "布阵", discard: "弃牌", end: "结束",
};

function renderPhaseTrack(phase: AutoSnapshot["game"]["phase"]) {
  const active = phaseOrder.indexOf(phase);
  return `<ol class="auto-phase-track" aria-label="回合阶段">${phaseOrder.map((item, index) => `<li class="${index === active ? "is-current" : index < active ? "is-complete" : ""}" ${index === active ? 'aria-current="step"' : ""}><i>${index + 1}</i><span>${phaseLabels[item]}</span></li>`).join("")}</ol>`;
}

function promptNeedsDialog(prompt: AutoPrompt | undefined, me?: AutoPlayerView) {
  if (!prompt || prompt.playerId !== snapshot?.you || !me) return false;
  const continuation = prompt.context?.continuation as { step?: string } | undefined;
  return prompt.kind === "reveal-choice"
    || continuation?.step === "prophet-order"
    || Boolean(prompt.selectableCards?.some((card) => !isCardOnTable(card.instanceId)));
}

function renderOrderPrompt(prompt: AutoPrompt, me: AutoPlayerView) {
  const cards = prompt.selectableCards || [];
  const ids = cards.map((card) => card.instanceId!).filter(Boolean);
  let order = interactionState.order;
  if (!order || order.promptId !== prompt.id) order = interactionState.order = { promptId: prompt.id, top: [...ids], bottom: [] };
  order.top = order.top.filter((id) => ids.includes(id));
  order.bottom = order.bottom.filter((id) => ids.includes(id));
  for (const id of ids) if (![...order.top, ...order.bottom].includes(id)) order.top.push(id);
  const zone = (key: "top" | "bottom") => `<section class="auto-order-zone" data-order-zone="${key}"><h4>${key === "top" ? "牌顶 · 最左边先摸到" : "牌底 · 从左到右排列"}</h4><div class="auto-order-cards">${order![key].map((id, index) => {
    const card = cards.find((card) => card.instanceId === id)!;
    return `<article class="auto-order-card" data-order-id="${escapeHtml(id)}" draggable="${mouseQuery.matches}">${renderPromptCard(card, me, false)}<div><button class="battle-small-btn" data-order-move="${escapeHtml(id)}" data-order-destination="${key === "top" ? "bottom" : "top"}">${key === "top" ? "放到牌底" : "放到牌顶"}</button><button class="battle-small-btn" data-order-shift="${escapeHtml(id)}" data-order-delta="-1" ${index === 0 ? "disabled" : ""} aria-label="向前移动">←</button><button class="battle-small-btn" data-order-shift="${escapeHtml(id)}" data-order-delta="1" ${index === order![key].length - 1 ? "disabled" : ""} aria-label="向后移动">→</button></div></article>`;
  }).join("") || '<p class="auto-order-empty">将牌放到这里</p>'}</div></section>`;
  return `<div class="auto-prompt-modal"><div class="auto-prompt-modal__backdrop" aria-hidden="true"></div><aside class="auto-prompt is-mine is-overlay-panel auto-order" role="dialog" aria-modal="true" aria-label="整理牌序"><h3>${escapeHtml(prompt.title)}</h3><p>拖动卡牌或使用移动按钮整理顺序。确认后继续结算。</p>${zone("top")}${zone("bottom")}<div class="auto-prompt__actions"><button class="btn btn--secondary" data-reset-order>恢复原顺序</button><button class="btn btn--primary" data-submit-order>确认牌序</button></div></aside></div>`;
}

function moveOrderCard(id: string, destination: "top" | "bottom", before?: string) {
  const order = interactionState.order;
  if (!order || order.promptId !== snapshot?.game.prompt?.id || interactionState.pendingAction || id === before) return;
  if (![...order.top, ...order.bottom].includes(id)) return;
  order.top = order.top.filter((card) => card !== id); order.bottom = order.bottom.filter((card) => card !== id);
  const index = before ? order[destination].indexOf(before) : -1;
  order[destination].splice(index < 0 ? order[destination].length : index, 0, id);
  render();
}
function submitOrder() {
  const order = interactionState.order, prompt = snapshot?.game.prompt;
  if (!order || !prompt || order.promptId !== prompt.id || interactionState.pendingAction) return;
  const ids = (prompt.selectableCards || []).map((card) => card.instanceId);
  const selected = [...order.top, ...order.bottom];
  if (selected.length !== ids.length || new Set(selected).size !== ids.length || selected.some((id) => !ids.includes(id))) return showToast("可选牌已变化，请重新整理。");
  const encode = (cards: string[]) => cards.map((id) => ids.indexOf(id) + 1).join(",");
  sendPromptChoice({ value: `${encode(order.top)} | ${encode(order.bottom)}` });
}

function renderPrompt(prompt: AutoPrompt | undefined, me?: AutoPlayerView, dialog = false) {
  if (!prompt) return "";
  const mine = prompt.playerId === snapshot?.you;
  if (mine && me && (prompt.context?.continuation as { step?: string } | undefined)?.step === "prophet-order") return renderOrderPrompt(prompt, me);
  const allowedCards = new Set(prompt.cardInstanceIds || []);
  const selectableCards = mine && me && prompt.selectableCards ? prompt.selectableCards.filter((card) => !isCardOnTable(card.instanceId)).map((card) => {
    const owner = snapshot?.players.find((candidate) => candidate.id === card.ownerId) || me;
    return renderPromptCard(card, owner, Boolean(card.instanceId && allowedCards.has(card.instanceId) && prompt.max !== undefined));
  }).join("") : "";
  const inspectedCard = mine && me && prompt.kind === "reveal-choice" && prompt.context?.inspectedCard
    ? renderCard(prompt.context.inspectedCard as CardView, me, "inspection", false)
    : "";
  const options = mine ? (prompt.options || []).map((option) => `<button class="btn btn--secondary" ${prompt.kind === "assisted-skill" ? `data-assisted-action="${escapeHtml(option.value)}"` : `data-prompt-value="${escapeHtml(option.value)}"`}>${escapeHtml(option.label)}</button>`).join("") : "";
  const cardSelection = mine && prompt.max !== undefined && prompt.kind !== "discard" && prompt.cardInstanceIds?.length
    ? `<button class="btn btn--primary" data-submit-prompt-selection ${interactionState.selectedPromptCards.size < Number(prompt.min || 0) || interactionState.selectedPromptCards.size > prompt.max ? "disabled" : ""}>确认选择</button>` : "";
  const autoPass = mine && prompt.kind === "response" && !prompt.options?.some((o) => o.value !== "pass") && snapshot?.game.legalHandCardIds.length === 0 && snapshot.game.legalSkillInstanceIds.length === 0
    ? `<small class="auto-prompt__auto">没有可用的牌或技能，2 秒后自动放弃响应。</small>` : "";
  const detachedChoices = Boolean(selectableCards || inspectedCard);
  const panel = `<aside class="auto-prompt ${mine ? "is-mine" : ""} ${selectableCards || inspectedCard ? "has-card-choices" : ""} ${detachedChoices ? "is-overlay-panel" : ""}" ${dialog ? 'role="dialog" aria-modal="true"' : ""}>${responseContext(prompt)}<span>${mine ? "需要你的操作" : "等待对手"}</span><h3>${escapeHtml(prompt.title)}</h3><p>${escapeHtml(prompt.message)}</p>${autoPass}${inspectedCard ? `<div class="auto-prompt__inspection">${inspectedCard}</div>` : ""}${selectableCards ? `<div class="auto-prompt__cards">${selectableCards}</div>` : ""}<div class="auto-prompt__actions">${options}${cardSelection}${prompt.kind === "discard" && mine ? `<button class="btn btn--primary" data-submit-discard ${interactionState.selectedDiscard.size === Number(prompt.min || 0) ? "" : "disabled"}>确认弃牌 ${interactionState.selectedDiscard.size}/${Number(prompt.min || 0)}</button>` : ""}${prompt.kind === "assisted-skill" && mine ? `<button class="btn btn--primary" data-assisted-finish>完成技能结算</button>` : ""}</div></aside>`;
  return dialog ? `<div class="auto-prompt-modal"><div class="auto-prompt-modal__backdrop" aria-hidden="true"></div>${panel}</div>` : panel;
}

function findCard(instanceId: string, ownerId = "") {
  const owner = snapshot?.players.find((player) => player.id === ownerId)
    || snapshot?.players.find((player) => player.hand.some((card) => card.instanceId === instanceId)
      || player.body?.instanceId === instanceId
      || player.characterSlots.some((card) => card && "instanceId" in card && card.instanceId === instanceId)
      || player.retired.some((card) => card.instanceId === instanceId));
  if (!owner) return {};
  const card = owner.body?.instanceId === instanceId ? owner.body
    : owner.hand.find((item) => item.instanceId === instanceId)
      || owner.characterSlots.find((item): item is CardView => Boolean(item && "instanceId" in item && item.instanceId === instanceId))
      || owner.retired.find((item) => item.instanceId === instanceId);
  return { owner, card };
}

function renderCardDetail() {
  if (!snapshot || !detailCardInstanceId) return "";
  const { owner, card } = findCard(detailCardInstanceId, detailOwnerId);
  const cardDefinition = definition(card);
  if (!owner || !card || !cardDefinition) return "";
  const image = cardPreviewImage(card, owner);
  const extra = cardDefinition.kind === "body" && owner.bodyState.flipped;
  const name = extra ? cardDefinition.extraName || cardDefinition.name : cardDefinition.name;
  const text = extra ? cardDefinition.extraText || cardDefinition.text : cardDefinition.text;
  return `<div class="auto-detail" role="dialog" aria-modal="true" aria-label="卡牌详情"><button class="auto-detail__backdrop" data-detail-close aria-label="关闭详情"></button><article><button class="auto-detail__close" data-detail-close aria-label="关闭">×</button>${image ? `<img src="${image}" alt="${escapeHtml(name)}" />` : ""}${renderCardInformation(cardDefinition, name, text, extra, owner.id === snapshot.you ? snapshot.game.unavailableReasons?.[card.instanceId || ""] : undefined)}</article></div>`;
}

function renderRiderDetail() {
  if (!riderDetailId) return "";
  const card = catalog.cards[riderDetailId];
  if (!card || card.kind !== "rider") return "";
  const final = riderDetailFinal;
  const name = final ? card.extraName || `FINAL ${card.name}` : card.name;
  const timing = final ? card.extraTiming || card.timing : card.timing;
  const text = final ? card.extraText || card.text : card.text;
  const cost = final ? card.extraCostText || card.costText : card.costText;
  return `<div class="auto-detail auto-rider-detail" role="dialog" aria-modal="true" aria-label="骑士卡详情"><button class="auto-detail__backdrop" data-rider-detail-close aria-label="关闭详情"></button><article><button class="auto-detail__close" data-rider-detail-close aria-label="关闭">×</button><div class="auto-rider-detail__card is-${final ? "final" : "normal"}"><span>${escapeHtml(card.mainRole || "骑士")}</span><strong>${escapeHtml(card.skillName || "RIDE")}</strong><h3>${escapeHtml(name)}</h3></div><div class="auto-card-info"><span>骑士卡 · ${escapeHtml(card.mainRole || "")}</span><h3>${escapeHtml(name)}</h3><p><b>费用</b>${escapeHtml(cost || "")}</p><p><b>发动时机</b>${escapeHtml(timing || "")}</p><p><b>效果</b>${escapeHtml(text)}</p></div></article></div>`;
}

function renderCardInformation(cardDefinition: NonNullable<ReturnType<typeof definition>>, name: string, text: string, extra = false, unavailableReason?: string) {
  const type = cardDefinition.kind === "character" ? cardDefinition.mainRole || "角色" : cardDefinition.kind === "body" ? cardDefinition.archetype || "本体" : "手牌";
  const isZMove = cardDefinition.kind === "body" && extra && cardDefinition.extraFormType === "z-move";
  const isDynamax = cardDefinition.kind === "body" && extra && cardDefinition.extraFormType === "dynamax";
  const detailLabel = cardDefinition.kind === "hand" ? "效果" : cardDefinition.kind === "body" ? isZMove ? "Z招式详情" : isDynamax ? "极巨技能详情" : "特性详情" : "技能详情";
  const abilityName = extra ? cardDefinition.extraSubtitle?.split(" · ").at(-1) || cardDefinition.skillName : cardDefinition.skillName;
  const abilityLabel = cardDefinition.kind === "body" ? isZMove ? "Z招式" : isDynamax ? "极巨技能" : "特性" : "";
  return `<div class="auto-card-info"><span>${escapeHtml(type)}</span><h3>${escapeHtml(name)}</h3>${unavailableReason ? `<p class="auto-unavailable"><b>当前不可用</b>${escapeHtml(unavailableReason)}</p>` : ""}${abilityName ? `<strong>${abilityLabel ? `${abilityLabel}` : ""}【${escapeHtml(abilityName)}】</strong>` : ""}${cardDefinition.timing ? `<p><b>发动时机</b>${escapeHtml(cardDefinition.timing)}</p>` : ""}${cardDefinition.costText ? `<p><b>费用</b>${escapeHtml(cardDefinition.costText)}</p>` : ""}<p><b>${detailLabel}</b>${escapeHtml(text)}</p></div>`;
}

function renderLocalSelection() {
  const draft = interactionState.localSelectionAction;
  if (!draft) return "";
  const selected = interactionState.selectedPromptCards.size;
  const min = draft.min || 0, max = draft.max || 0;
  const disabled = Boolean(draft.cardInstanceIds && (selected < min || selected > max));
  const names = [...interactionState.selectedPromptCards].map((id) => (findCard(id).owner ? sideName(findCard(id).owner!.id) + "的" : "") + (definition(findCard(id).card)?.name || (id.startsWith("slot:") ? `对手暗置角色位 ${Number(id.split(":").at(-1)) + 1}` : "已选角色")));
  const summary = names.length ? `${draft.selectionKind === "cost" ? draft.costKind === "retire" ? "退场" : "休整" : "目标"}：${names.join("、")}` : "";
  const options = (draft.options || []).map((option, index) => `<button class="btn btn--secondary" data-local-option="${index}">${escapeHtml(option.label)}</button>`).join("");
  return `<aside class="auto-prompt auto-local-selection is-mine"><span>提交前选择</span><h3>${escapeHtml(draft.title)}</h3><p>${escapeHtml(draft.message)}${summary ? `<br><b>${escapeHtml(summary)}</b>` : ""}</p><div class="auto-prompt__actions">${options}${!draft.options ? `<button class="btn btn--primary" data-local-selection-confirm ${disabled ? "disabled" : ""}>确认${draft.cardInstanceIds ? ` ${selected}/${min === max ? min : `${min}-${max}`}` : ""}</button>` : ""}<button class="btn btn--secondary" data-local-selection-cancel>上一步</button><button class="btn btn--secondary" data-local-selection-exit>取消操作</button></div></aside>`;
}

function renderLocalForm(me?: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!interactionState.localFormAction || !me) return "";
  const isInspect = interactionState.localFormAction.action === "inspect";
  const isMove = interactionState.localFormAction.action === "move";
  const isMarker = interactionState.localFormAction.action === "marker";
  return `<aside class="auto-prompt auto-local-form is-mine is-overlay-panel"><span>技能结算</span><h3>${escapeHtml(interactionState.localFormAction.title)}</h3><p>${escapeHtml(interactionState.localFormAction.message)}</p><div class="auto-inline-form">
    ${isInspect ? `<label>观看内容<select data-assisted-field="inspectionKind"><option value="handDeckTop">共用手牌堆顶</option><option value="opponentHand">对手手牌</option><option value="characterRole">角色牌</option></select></label>` : ""}
    <label>目标<select data-assisted-field="playerId"><option value="${escapeHtml(me.id)}">自己</option>${opponent ? `<option value="${escapeHtml(opponent.id)}">对手·${escapeHtml(opponent.nickname)}</option>` : ""}</select></label>
    ${isInspect || isMove ? `<label>角色位<select data-assisted-field="slotIndex">${[0, 1, 2, 3].map((index) => `<option value="${index}">${index + 1} 号位</option>`).join("")}</select></label>` : ""}
    ${isMove ? `<label>移动方式<select data-assisted-field="operation"><option value="rest">休整</option><option value="retire">退场</option></select></label>` : ""}
    ${isInspect ? "" : `<label>数量<input type="number" min="1" max="3" value="1" data-assisted-field="amount"></label>`}
    ${isMarker ? `<label>标记名称<input maxlength="20" value="技能标记" data-assisted-field="label"></label>` : ""}
  </div><div class="auto-prompt__actions"><button class="btn btn--primary" data-local-form-submit>确认结算</button><button class="btn btn--secondary" data-local-form-cancel>返回</button></div></aside>`;
}

function renderRoleAction(me?: AutoPlayerView) {
  if (!snapshot || !me || !interactionState.selectedRoleInstanceId) return "";
  const { card } = findCard(interactionState.selectedRoleInstanceId, me.id);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition || cardDefinition.kind !== "character") return "";
  const slotIndex = me.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === interactionState.selectedRoleInstanceId);
  const canReveal = snapshot.game.legalActions?.some((action) => action.type === "character:reveal" && action.payload?.slotIndex === slotIndex);
  const canUseSkill = snapshot.game.legalSkillInstanceIds.includes(interactionState.selectedRoleInstanceId);
  return `<div class="auto-role-confirm"><div><span>已选择角色</span><strong>【${escapeHtml(cardDefinition.name)}】</strong><small>${canUseSkill || canReveal ? "选择要执行的操作" : "当前只能查看卡牌详情"}</small></div><button class="btn btn--secondary" data-role-action="view">查看详情</button>${canReveal ? `<button class="btn btn--secondary" data-role-action="reveal">明置角色</button>` : ""}${canUseSkill ? `<button class="btn btn--primary" data-role-action="skill">发动技能</button>` : ""}<button class="btn btn--secondary" data-role-action="cancel">取消</button></div>`;
}

function renderSelectedCardAction(cardDefinition: NonNullable<ReturnType<typeof definition>>) {
  return `<div class="auto-play-confirm"><div><span>已选择</span><strong>【${escapeHtml(cardDefinition.name)}】</strong><small>${escapeHtml(cardDefinition.text)}</small></div><button class="btn btn--secondary" data-view-selected>查看牌面</button><button class="btn btn--secondary" data-cancel-play>取消</button><button class="btn btn--primary" data-confirm-play>${snapshot?.game.prompt?.kind === "response" ? "确认响应" : snapshot?.game.prompt?.kind === "dying" ? "确认急救" : "确认打出"}</button></div>`;
}

function renderPerfPanel() {
  if (!perfEnabled) return "";
  const metric = (value?: number) => value === undefined ? "-" : `${value.toFixed(1)} ms`;
  return `<aside class="auto-perf-panel" data-auto-region="perf"><strong>PERF</strong><span>RTT ${metric(lastAckMetrics?.rttMs)}</span><span>规则 ${metric(lastAckMetrics?.applyMs)}</span><span>保存 ${metric(lastAckMetrics?.persistMs)}</span><span>重绘 ${metric(lastRenderMs)}</span><span>快照 ${(lastSnapshotBytes / 1024).toFixed(1)} KB</span><small>${escapeHtml(lastUpdatedRegions.join(", ") || "none")}</small></aside>`;
}

function replaceGameRegion(name: string, html: string, updated: string[]) {
  if (gameRegionCache.get(name) === html) return;
  const current = root?.querySelector<HTMLElement>(`[data-auto-region="${name}"]`);
  if (!current) return;
  const scroll = [...current.querySelectorAll<HTMLElement>(".auto-hand__cards, .auto-prompt__cards, .auto-prompt, .auto-log")];
  if (current.matches(".auto-log")) scroll.push(current as HTMLElement);
  const positions = scroll.map((element) => ({ selector: `.${[...element.classList].find((name) => name.startsWith("auto-"))}`, left: element.scrollLeft, top: element.scrollTop }));
  const focused = current.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const identity = focused && [...focused.attributes].find((attribute) => attribute.name.startsWith("data-"));
  current.outerHTML = html;
  const replacement = root?.querySelector<HTMLElement>(`[data-auto-region="${name}"]`);
  for (const position of positions) {
    const element = replacement?.matches(position.selector) ? replacement : replacement?.querySelector<HTMLElement>(position.selector);
    if (element) { element.scrollLeft = position.left; element.scrollTop = position.top; }
  }
  if (identity) replacement?.querySelector<HTMLElement>(`[${identity.name}="${CSS.escape(identity.value)}"]`)?.focus({ preventScroll: true });
  gameRegionCache.set(name, html);
  updated.push(name);
}

function renderGame() {
  if (!snapshot || !root) return;
  const spectator = snapshot.you === "spectator";
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = spectator ? snapshot.players[0] : snapshot.players.find((player) => player.id !== snapshot?.you);
  const lowerPlayer = spectator ? snapshot.players[1] : me;
  const isMyTurn = snapshot.game.currentPlayerId === snapshot.you;
  const canAdvance = isMyTurn && !snapshot.game.prompt && snapshot.game.stack.length === 0 && !snapshot.game.winnerId && !interactionState.pendingAction && !interactionState.selectedPlayCardId && !interactionState.selectedRoleInstanceId && !interactionState.localSelectionAction && !interactionState.localFormAction;
  const hand = me?.hand.map((card) => {
    const legality = handLegality(card);
    return renderCard(card, me, "hand", legality.allowed, legality.reason);
  }).join("") || "";
  const stack = snapshot.game.stack.map((item) => {
    const source = snapshot?.players.find((player) => player.id === item.sourcePlayerId);
    return `<li class="${item.cancelled ? "is-cancelled" : ""}"><small>${escapeHtml(source?.nickname || "玩家")}</small><b>【${escapeHtml(catalog.cards[item.resolvedAs || item.definitionId]?.name || item.definitionId)}】</b></li>`;
  }).reverse().join("");
  const logs = snapshot.game.logs.slice(-12).reverse().map((log) => `<li>${escapeHtml(log.text)}</li>`).join("");
  const bombActions = snapshot.game.legalActions?.filter((action) => action.type === "bomb:remove") || [];
  const recentEvent = snapshot.game.recentEvents.at(-1);
  const selectedCard = me?.hand.find((card) => card.instanceId === interactionState.selectedPlayCardId);
  const selectedDefinition = definition(selectedCard);
  const selectedCardAction = selectedCard && selectedDefinition ? renderSelectedCardAction(selectedDefinition) : "";
  const canDeployCharacter = Boolean(snapshot.game.legalActions?.some((action) => action.type === "character:deploy"));
  const promptDialog = !interactionState.localFormAction && !interactionState.localSelectionAction && !interactionState.selectedRoleInstanceId
    && promptNeedsDialog(snapshot.game.prompt, me)
    ? renderPrompt(snapshot.game.prompt, me, true)
    : "";
  const hasInteractionOverlay = Boolean(snapshot.game.prompt || interactionState.selectedRoleInstanceId || interactionState.localSelectionAction || interactionState.localFormAction || selectedCardAction);
  const interaction = interactionState.localFormAction ? renderLocalForm(me, opponent)
    : interactionState.localSelectionAction ? renderLocalSelection()
      : interactionState.selectedRoleInstanceId ? renderRoleAction(me)
        : selectedCardAction ? selectedCardAction
          : promptDialog ? "" : renderPrompt(snapshot.game.prompt, me);
  const regions = new Map<string, string>();
  regions.set("event", renderTableEvent());
  regions.set("opponent", opponent ? renderPlayer(opponent, false, spectator ? "玩家 A" : undefined, "opponent") : "");
  regions.set("command", `<section class="auto-command-center ${hasInteractionOverlay ? "has-interaction-overlay" : ""}" data-auto-region="command">
      <div class="auto-phase"><span>第 ${snapshot.game.turnNumber} 回合 · ${escapeHtml(sideName(snapshot.game.currentPlayerId))}回合</span><strong>${phaseLabels[snapshot.game.phase]}阶段</strong><small>${recentEvent ? escapeHtml(eventLabel(recentEvent.type)) : "等待行动"}</small></div>
      ${renderPhaseTrack(snapshot.game.phase)}
      <button class="btn btn--primary" data-phase-advance ${canAdvance ? "" : "disabled"}>${!isMyTurn ? "等待对手" : snapshot.game.phase === "play" ? "结束出牌" : snapshot.game.phase === "deployment" ? "完成布阵" : "进入下一阶段"}</button>
      ${snapshot.game.phase === "deployment" && isMyTurn ? `<button class="btn btn--secondary" data-deploy ${snapshot.game.deployedThisPhase >= 2 || !canDeployCharacter || interactionState.pendingAction ? "disabled" : ""}>上阵角色（${snapshot.game.deployedThisPhase}/2）</button>` : ""}
      ${me && snapshot.game.legalBodyActionPlayerIds.includes(me.id) ? `<button class="btn btn--secondary" data-body-activate>发动${escapeHtml(definition(me.body)?.extraFormLabel || "本体技能")}</button>` : ""}
      ${bombActions.map((action) => `<button class="btn btn--secondary" data-remove-bomb="${escapeHtml(String(action.payload?.markerId || ""))}">休整1张角色拆除炸弹</button>`).join("")}
      <div class="auto-stack"><span>结算栈 ${snapshot.game.stack.length}</span><ol>${stack || "<li>当前为空</li>"}</ol></div>
      ${snapshot.game.prompt && interactionState.localSelectionAction || snapshot.game.prompt && selectedCardAction || snapshot.game.prompt && interactionState.selectedRoleInstanceId ? responseContext(snapshot.game.prompt!) : ""}
      ${interaction}
      ${renderPendingAction()}
      ${snapshot.game.winnerId ? `<div class="auto-winner"><strong>${snapshot.game.winnerId === snapshot.you ? "你获胜了" : "对手获胜"}</strong><a href="/play" class="btn btn--primary">返回大厅</a></div>` : ""}
    </section>`);
  regions.set("lower", lowerPlayer ? renderPlayer(lowerPlayer, !spectator, spectator ? "玩家 B" : undefined, "lower") : "");
  if (me) regions.set("hand", `<section class="auto-hand" data-auto-region="hand"><header><strong>我的手牌</strong><span>${me.hand.length} 张 · 牌堆 ${snapshot.game.handDeckCount} · 弃牌 ${snapshot.game.handDiscard.length}</span></header><div class="auto-hand__cards">${hand || "<p>没有手牌</p>"}</div></section>`);
  regions.set("backdrop", `<button type="button" class="auto-mobile-log-backdrop ${mobileLogOpen ? "is-open" : ""}" data-auto-region="backdrop" data-auto-mobile-log-close aria-label="关闭日志" tabindex="-1"></button>`);
  regions.set("log", `<aside id="auto-mobile-log" class="auto-log ${mobileLogOpen ? "is-open" : ""}" data-auto-region="log" aria-label="公开日志" ${mobileTableActive ? 'role="dialog"' : ""}><header><span>公开日志</span><button type="button" class="auto-mobile-log-close" data-auto-mobile-log-close aria-label="关闭日志">×</button></header><ol>${logs}</ol></aside>`);
  regions.set("overlay", `<div data-auto-region="overlay" style="display:contents">${promptDialog}${renderCardDetail()}${renderRiderDetail()}</div>`);
  regions.set("perf", renderPerfPanel());
  const nextStructureKey = `${spectator}:${opponent?.id || ""}:${lowerPlayer?.id || ""}:${me?.id || ""}`;
  const fullRender = gameStructureKey !== nextStructureKey || !root.querySelector(".auto-game");
  const updated: string[] = [];
  if (fullRender) {
    root.innerHTML = `<div class="auto-game-stage"><div class="auto-game" data-phase="${snapshot.game.phase}">${regions.get("opponent") || ""}${regions.get("event") || ""}${regions.get("lower") || ""}${regions.get("command") || ""}${regions.get("hand") || ""}${regions.get("backdrop") || ""}${regions.get("log") || ""}</div></div>${regions.get("overlay") || ""}<div class="auto-hover-preview" id="auto-hover-preview" hidden></div>${regions.get("perf") || ""}`;
    gameStructureKey = nextStructureKey;
    gameRegionCache.clear();
    for (const [name, html] of regions) if (html) gameRegionCache.set(name, html);
    updated.push("full");
  } else {
    root.querySelector<HTMLElement>(".auto-game")?.setAttribute("data-phase", snapshot.game.phase);
    for (const [name, html] of regions) if (html) replaceGameRegion(name, html, updated);
  }
  lastUpdatedRegions = updated;
  root.querySelectorAll<HTMLDetailsElement>("[data-retired-owner]").forEach(el => el.addEventListener("toggle", () => {
    if (el.open) expandedRetired.add(el.dataset.retiredOwner!); else expandedRetired.delete(el.dataset.retiredOwner!);
  }));
  root.querySelector<HTMLElement>(".auto-game")?.classList.toggle("has-local-choice", Boolean(interactionState.localSelectionAction));
  bindGameActions(me, opponent);
  fitDesktopTable();
  updateTableFeedback();
}

function sideName(id?: string) {
  if (!id) return "牌桌";
  if (snapshot?.you === "spectator") return snapshot.players[0]?.id === id ? "玩家 A" : "玩家 B";
  return id === snapshot?.you ? "我方" : "对手";
}

function tablePresentation() {
  const game = snapshot!.game;
  const item = game.stack.at(-1);
  const event = game.recentEvents.at(-1);
  const source = item?.sourcePlayerId || event?.sourcePlayerId;
  const target = item?.targetPlayerId || (!item ? event?.targetPlayerId : undefined);
  // Stack cards have already been revealed. Never resolve a name from private event metadata.
  const name = item ? catalog.cards[item.resolvedAs || item.definitionId]?.name : undefined;
  const summary = `${sideName(source)}${target ? ` → ${sideName(target)}` : ""} · ${name ? `【${name}】` : event ? eventLabel(event.type) : "等待行动"}`;
  const decision = game.prompt?.playerId || game.responsePlayerId;
  const status = game.winnerId ? `${sideName(game.winnerId)}获胜` : decision ? `等待${decision === snapshot!.you ? "你" : sideName(decision)}${game.prompt?.kind === "response" ? "响应" : "选择"}` : game.stack.length ? "正在结算" : `${sideName(game.currentPlayerId)} · ${phaseLabels[game.phase]}`;
  return { summary, status, source, target, event };
}

function renderTableEvent() {
  const view = tablePresentation();
  return `<section class="auto-table-event" data-auto-region="event" aria-label="当前事件"><span>${escapeHtml(view.summary)}</span><strong role="status">${escapeHtml(view.status)}</strong></section>`;
}

function updateTableFeedback() {
  const view = tablePresentation();
  const fresh = feedbackReady && view.event && view.event.id !== feedbackBaseline;
  feedbackReady = true;
  feedbackBaseline = view.event?.id;
  if (fresh) for (const id of [view.event?.sourcePlayerId, view.event?.targetPlayerId]) {
    const el = root?.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(id || "")}"]`);
    if (el && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) el.animate([{ filter: "brightness(1.25)" }, { filter: "brightness(1)" }], { duration: 400 });
  }
  requestAnimationFrame(drawTargetLine);
}
function drawTargetLine() {
  const layer = document.getElementById("auto-target-layer");
  if (!layer) return;
  layer.innerHTML = "";
  const draft = interactionState.localSelectionAction;
  if (!draft || draft.selectionKind === "cost") return;
  const sourceId = draft.sourceId || interactionState.selectedPlayCardId || interactionState.selectedRoleInstanceId;
  const source = root?.querySelector<HTMLElement>(`[data-auto-card="${CSS.escape(sourceId || "")}"]`);
  if (!source) return;
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.bottom <= 0 || r.top >= innerHeight || r.left < 0 || r.right > innerWidth) return false;
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (/auto|scroll|hidden/.test(getComputedStyle(p).overflow + getComputedStyle(p).overflowX + getComputedStyle(p).overflowY)) {
        const b = p.getBoundingClientRect(); if (r.bottom > b.bottom + 2 || r.top < b.top - 2 || r.right > b.right + 2 || r.left < b.left - 2) return false;
      }
    }
    return true;
  };
  if (!visible(source)) return;
  const a = source.getBoundingClientRect();
  const lines = [...(root?.querySelectorAll<HTMLElement>(".auto-slot .is-selected") || [])].filter(visible).map(el => {
    const b = el.getBoundingClientRect();
    return `<line x1="${a.x + a.width / 2}" y1="${a.y + a.height / 2}" x2="${b.x + b.width / 2}" y2="${b.y + b.height / 2}" marker-end="url(#auto-direction)"/>`;
  });
  if (lines.length) layer.innerHTML = `<svg class="auto-target-lines" width="100%" height="100%"><defs><marker id="auto-direction" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="currentColor"/></marker></defs>${lines.join("")}</svg>`;
}
root?.addEventListener("scroll", drawTargetLine, true);
window.addEventListener("resize", drawTargetLine);

function eventLabel(type: string) {
  return ({ card_used: "牌已使用", card_responded: "牌已响应", card_resolved: "牌已结算", damage_after: "伤害结算后", health_recovered: "体力回复后", character_deployed: "角色上阵后", character_revealed: "角色明置后", character_rested: "角色休整后", character_retired: "角色退场后", hand_discarded: "手牌弃置后", hand_lost: "手牌失去后", inspection: "观看后", judgment_revealed: "判定展示", judgment_resolved: "判定结算后", skill_used: "技能发动后", strike_dodged: "出刀被闪避" } as Record<string, string>)[type] || "事件待结算";
}

function handLegality(card: CardView) {
  if (!snapshot || snapshot.you === "spectator") return { allowed: false, reason: "观战者不能操作" };
  if (interactionState.pendingAction) return { allowed: false, reason: "正在等待上一项操作完成" };
  const prompt = snapshot.game.prompt;
  const serverAllows = Boolean(card.instanceId && (snapshot.game.prompt || !snapshot.game.legalActions ? snapshot.game.legalHandCardIds.includes(card.instanceId) : snapshot.game.legalActions.some((action) => action.type === "hand:play" && action.payload?.instanceId === card.instanceId)));
  if (prompt) {
    if (prompt.playerId !== snapshot.you) return { allowed: false, reason: "正在等待对手选择" };
    if (["response", "dying", "discard", "recall"].includes(prompt.kind)) {
      const allowed = serverAllows;
      return { allowed, reason: allowed ? "" : "不属于当前可选牌" };
    }
    return { allowed: false, reason: "请先完成当前选择" };
  }
  if (snapshot.game.stack.length) return { allowed: false, reason: "牌正在结算" };
  if (snapshot.game.currentPlayerId !== snapshot.you) return { allowed: false, reason: "当前不是你的回合" };
  if (snapshot.game.phase !== "play") return { allowed: false, reason: "只能在出牌阶段使用" };
  if (!serverAllows && snapshot.game.unavailableReasons?.[card.instanceId || ""]) return { allowed: false, reason: snapshot.game.unavailableReasons[card.instanceId!] };
  return serverAllows
    ? { allowed: true, reason: "" }
    : { allowed: false, reason: "不满足该牌的使用时机或次数限制" };
}

function bindGameActions(me?: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!root || !snapshot) return;
  gameBindings?.abort();
  gameBindings = new AbortController();
  const listenerOptions = { signal: gameBindings.signal };
  bindMobileLogActions();
  root.querySelectorAll<HTMLButtonElement>("[data-rider-detail]").forEach((button) => button.addEventListener("click", () => {
    riderDetailId = button.dataset.riderDetail || "";
    riderDetailFinal = button.dataset.riderFinal === "true";
    render();
  }, listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-rider-detail-close]").forEach((button) => button.addEventListener("click", () => {
    riderDetailId = "";
    riderDetailFinal = false;
    render();
  }, listenerOptions));
  root.querySelector("[data-submit-order]")?.addEventListener("click", submitOrder, listenerOptions);
  root.querySelector("[data-reset-order]")?.addEventListener("click", () => { interactionState.order = undefined; render(); }, listenerOptions);
  root.querySelectorAll<HTMLElement>("[data-order-move]").forEach((button) => button.addEventListener("click", () => moveOrderCard(button.dataset.orderMove!, button.dataset.orderDestination as "top" | "bottom"), listenerOptions));
  root.querySelectorAll<HTMLElement>("[data-order-shift]").forEach((button) => button.addEventListener("click", () => {
    const order = interactionState.order;
    if (!order || interactionState.pendingAction) return;
    const zone = order.top.includes(button.dataset.orderShift!) ? order.top : order.bottom;
    const from = zone.indexOf(button.dataset.orderShift!), to = from + Number(button.dataset.orderDelta);
    if (from < 0 || to < 0 || to >= zone.length) return;
    [zone[from], zone[to]] = [zone[to], zone[from]]; render();
  }, listenerOptions));
  if (!me) {
    root.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => button.addEventListener("click", () => {
      detailCardInstanceId = button.dataset.autoCard || "";
      detailOwnerId = button.dataset.owner || "";
      render();
    }, listenerOptions));
    root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", () => { detailCardInstanceId = ""; detailOwnerId = ""; render(); }, listenerOptions));
    bindHoverPreviews();
    return;
  }
  root.querySelector("[data-phase-advance]")?.addEventListener("click", () => send("phase:advance"), listenerOptions);
  root.querySelector<HTMLButtonElement>("[data-deploy]")?.addEventListener("click", () => send("character:deploy"), listenerOptions);
  root.querySelector("[data-body-activate]")?.addEventListener("click", () => { const action = snapshot?.game.legalActions?.find((action) => action.type === "body:activate"); if (action) stageAction(action, me.body?.instanceId); }, listenerOptions);
  root.querySelectorAll<HTMLButtonElement>("[data-rider-activate]").forEach((button) => button.addEventListener("click", () => {
    const riderId = button.dataset.riderActivate || "";
    const action = snapshot?.game.legalActions?.find((candidate) => candidate.type === "rider:activate" && candidate.payload?.riderId === riderId);
    const card = catalog.cards[riderId];
    if (action && card) stageAction(action);
  }, listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-remove-bomb]").forEach((button) => button.addEventListener("click", () => {
    const action = snapshot?.game.legalActions?.find((candidate) => candidate.type === "bomb:remove" && candidate.payload?.markerId === button.dataset.removeBomb);
    if (action) stageAction(action);
  }, listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => button.addEventListener("click", () => handleCard(button, me, opponent), listenerOptions));
  root.querySelector("[data-confirm-play]")?.addEventListener("click", () => confirmSelectedHand(me, opponent), listenerOptions);
  root.querySelector("[data-cancel-play]")?.addEventListener("click", () => { interactionState.clearDraft(); render(); }, listenerOptions);
  root.querySelector("[data-view-selected]")?.addEventListener("click", () => { detailCardInstanceId = interactionState.selectedPlayCardId; detailOwnerId = me.id; render(); }, listenerOptions);
  root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", () => { detailCardInstanceId = ""; detailOwnerId = ""; render(); }, listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-role-action]").forEach((button) => button.addEventListener("click", () => runSelectedRoleAction(button.dataset.roleAction || "", me), listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-prompt-value]").forEach((button) => button.addEventListener("click", () => sendPromptChoice({ value: button.dataset.promptValue }), listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-prompt-card]").forEach((button) => button.addEventListener("click", () => {
    toggleServerPromptCard(button.dataset.promptCard || "");
  }, listenerOptions));
  root.querySelectorAll<HTMLButtonElement>("[data-assisted-action]").forEach((button) => button.addEventListener("click", () => runAssistedAction(button.dataset.assistedAction || "", me, opponent), listenerOptions));
  root.querySelector("[data-submit-prompt-selection]")?.addEventListener("click", () => sendPromptChoice({ cardInstanceIds: [...interactionState.selectedPromptCards] }), listenerOptions);
  root.querySelector("[data-submit-discard]")?.addEventListener("click", () => sendPromptChoice({ cardInstanceIds: [...interactionState.selectedDiscard] }), listenerOptions);
  root.querySelector("[data-assisted-finish]")?.addEventListener("click", () => send("assisted:finish"), listenerOptions);
  root.querySelector("[data-local-selection-confirm]")?.addEventListener("click", submitLocalSelection, listenerOptions);
  root.querySelector("[data-local-selection-cancel]")?.addEventListener("click", returnLocalStep, listenerOptions);
  root.querySelector("[data-local-selection-exit]")?.addEventListener("click", () => { interactionState.clearDraft(); render(); }, listenerOptions);
  root.querySelectorAll<HTMLButtonElement>("[data-local-option]").forEach((button) => button.addEventListener("click", () => {
    const option = interactionState.localSelectionAction?.options?.[Number(button.dataset.localOption)];
    if (!option || !interactionState.localSelectionAction) return;
    interactionState.checkpoint();
    interactionState.localSelectionAction = { ...interactionState.localSelectionAction, payload: { ...interactionState.localSelectionAction.payload, ...option.payload }, options: undefined, message: `已选择：${option.label}。确认后开始结算。` };
    render();
  }, listenerOptions));
  root.querySelector("[data-local-form-cancel]")?.addEventListener("click", () => {
    interactionState.localFormAction = undefined;
    render();
  }, listenerOptions);
  root.querySelector("[data-local-form-submit]")?.addEventListener("click", () => submitLocalForm(me), listenerOptions);
  root.querySelectorAll<HTMLButtonElement>("[data-local-slot]").forEach((button) => button.addEventListener("click", () => {
    toggleSelection(button.dataset.localSlot || "", interactionState.selectedPromptCards, Number(interactionState.localSelectionAction?.max || 0));
  }, listenerOptions));
  root.querySelector("[data-auto-reconnect]")?.addEventListener("click", reconnectNow, listenerOptions);
  bindHoverPreviews();
}

function bindMobileLogActions() {
  const options = gameBindings ? { signal: gameBindings.signal } : undefined;
  root?.querySelectorAll<HTMLElement>("[data-auto-mobile-log-close]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMobileLog();
  }, options));
}

function openMobileLog(trigger: HTMLElement) {
  if (!snapshot?.game.started) return;
  mobileLogReturnFocus = trigger;
  mobileLogOpen = !mobileLogOpen;
  syncMobileTableState();
  render();
  window.requestAnimationFrame(() => root?.querySelector<HTMLButtonElement>(".auto-mobile-log-close")?.focus());
}

function closeMobileLog() {
  if (!mobileLogOpen) return;
  mobileLogOpen = false;
  syncMobileTableState();
  render();
  window.requestAnimationFrame(() => mobileLogReturnFocus?.focus());
}

function stageAction(action: AutoLegalAction, sourceId = "") {
  const cost = action.interaction?.cost;
  const source = sourceId ? definition(findCard(sourceId).card) : undefined;
  const title = action.interaction?.label || source?.skillName || source?.name || "确认操作";
  const fixedNames = (cost?.fixedIds || []).map((id) => (findCard(id).owner ? sideName(findCard(id).owner!.id) + "的" : "") + (definition(findCard(id).card)?.name || "己方角色")).join("、");
  beginLocalCardSelection({ command: action.type, payload: { ...action.payload }, sourceId, title,
    message: cost?.kind === "choice" ? `为【${fixedNames}】选择支付方式。`
      : cost?.kind === "retire" ? fixedNames ? `将退场【${fixedNames}】支付费用。` : `选择 ${action.selection?.min || 1} 张角色退场支付费用。`
      : cost?.kind === "rest" ? `选择 ${action.selection?.min || cost.amount || 0} 张角色支付休整费用。`
      : "确认后开始结算；后续选择将按规则继续。",
    options: cost?.options,
    ...(action.selection ? { cardInstanceIds: action.selection.cardInstanceIds, min: action.selection.min, max: action.selection.max, selectionKind: "cost" as const } : {}),
    costKind: cost?.kind === "retire" ? "retire" : "rest",
  });
}

function draftIsLegal(command: string, payload: Record<string, unknown>) {
  const actions = snapshot?.game.legalActions;
  if (!actions) return false;
  return actions.some((action) => {
    if (action.type !== command || Object.entries(action.payload || {}).some(([key, value]) => JSON.stringify(payload[key]) !== JSON.stringify(value))) return false;
    if (action.selection) {
      const ids = payload.costCharacterIds as string[] | undefined;
      if (!ids || new Set(ids).size !== ids.length || ids.length < action.selection.min || ids.length > action.selection.max || ids.some((id) => !action.selection!.cardInstanceIds.includes(id))) return false;
    }
    const modes = action.interaction?.cost?.options;
    if (modes?.length && !modes.some((option) => Object.entries(option.payload).every(([key, value]) => payload[key] === value))) return false;
    return true;
  });
}

function sendDraft(command: string, payload: Record<string, unknown>) {
  if (!draftIsLegal(command, payload)) {
    showToast("可用操作已变化，请重新选择。");
    interactionState.resetDecision(); render(); return false;
  }
  return send(command, payload);
}

function reconcileLocalDraft() {
  const draft = interactionState.localSelectionAction;
  if (!draft || !snapshot?.game.legalActions) return;
  const candidates = snapshot.game.legalActions.filter((action) => action.type === draft.command
    && Object.entries(draft.payload).every(([key, value]) => action.payload?.[key] === undefined || JSON.stringify(action.payload[key]) === JSON.stringify(value)));
  if (!candidates.length) { interactionState.clearDraft(); showToast("当前操作已不可用，请重新选择。"); return; }
  let ids = draft.cardInstanceIds;
  if (draft.selectionKind === "target-slot") ids = targetIds(candidates);
  else if (draft.selectionKind === "cost") {
    const selection = candidates[0].selection;
    if (!selection) { interactionState.clearDraft(); showToast("费用已变化，请重新选择技能。"); return; }
    ids = selection.cardInstanceIds; draft.min = selection.min; draft.max = selection.max;
  }
  if (ids) {
    draft.cardInstanceIds = ids;
    let invalid = false;
    for (const id of interactionState.selectedPromptCards) if (!ids.includes(id)) { interactionState.selectedPromptCards.delete(id); invalid = true; }
    if (invalid) showToast("部分选择已失效，请重新选择。");
  }
}

function targetIds(actions: AutoLegalAction[]) {
  return actions.flatMap((action) => {
    if (!Number.isInteger(action.payload?.targetSlotIndex)) return [];
    const opponent = snapshot?.players.find((player) => player.id !== snapshot?.you);
    const index = Number(action.payload!.targetSlotIndex);
    const slot = opponent?.characterSlots[index];
    return slot && opponent ? ["instanceId" in slot && slot.instanceId ? slot.instanceId : `slot:${opponent.id}:${index}`] : [];
  });
}

function returnLocalStep() {
  if (interactionState.pendingAction) return;
  if (interactionState.localFormAction) { interactionState.localFormAction = undefined; render(); return; }
  interactionState.back(); reconcileLocalDraft(); render();
}

function beginLocalCardSelection(action: LocalSelectionAction) {
  interactionState.checkpoint();
  interactionState.localSelectionAction = action;
  interactionState.selectedRoleInstanceId = "";
  interactionState.selectedPromptCards.clear();
  const cardInstanceIds = action.cardInstanceIds || [];
  if (cardInstanceIds.length === action.min && action.min === action.max) {
    cardInstanceIds.forEach((id) => interactionState.selectedPromptCards.add(id));
  }
  render();
}

function toggleSelection(instanceId: string, ids: Set<string>, max: number) {
  if (ids.has(instanceId)) ids.delete(instanceId);
  else if (max > 0 && ids.size < max) ids.add(instanceId);
  else return showToast(`至多选择 ${max} 张牌。`);
  render();
}

function toggleServerPromptCard(instanceId: string) {
  const prompt = snapshot?.game.prompt;
  if (!prompt || !prompt.cardInstanceIds?.includes(instanceId)) return;
  if (prompt.kind === "discard") return toggleSelection(instanceId, interactionState.selectedDiscard, Number(prompt.max || prompt.min || 0));
  toggleSelection(instanceId, interactionState.selectedPromptCards, Number(prompt.max || 0));
}

function submitLocalSelection() {
  if (!interactionState.localSelectionAction) return;
  const action = interactionState.localSelectionAction;
  const selected = [...interactionState.selectedPromptCards];
  const min = Number(action.min || 0);
  const max = Number(action.max || 0);
  if (selected.length < min || selected.length > max) return showToast(`请选择 ${min === max ? min : `${min}-${max}`} 张牌。`);
  const payload = { ...action.payload };
  if (action.selectionKind === "cost") payload.costCharacterIds = selected;
  if (action.selectionKind === "target-slot") {
    const targetId = selected[0];
    const slotMatch = /^slot:([^:]+):(\d+)$/.exec(targetId);
    const target = slotMatch
      ? snapshot?.players.find((player) => player.id === slotMatch[1])
      : snapshot?.players.find((player) => player.characterSlots.some((slot) => slot && "instanceId" in slot && slot.instanceId === targetId));
    const targetSlotIndex = slotMatch
      ? Number(slotMatch[2])
      : target?.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === targetId) ?? -1;
    if (targetSlotIndex < 0) return showToast("目标角色已不在场上。");
    payload.targetSlotIndex = targetSlotIndex;
  }
  interactionState.localSelectionAction = undefined;
  interactionState.selectedPromptCards.clear();
  sendDraft(action.command, payload);
}

function runAssistedAction(action: string, me: AutoPlayerView, opponent?: AutoPlayerView) {
  void opponent;
  interactionState.localFormAction = {
    kind: "assisted", action, title: "处理辅助结算",
    message: action === "inspect" ? "选择观看内容和目标。" : "选择此次技能结算的目标与数量。",
  };
  render();
}

function submitLocalForm(me: AutoPlayerView) {
  if (!root || !interactionState.localFormAction) return;
  const action = interactionState.localFormAction.action;
  const read = (name: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-assisted-field="${name}"]`)?.value || "";
  const amount = Math.max(1, Math.min(3, Number(read("amount")) || 1));
  const payload: Record<string, unknown> = { action, playerId: read("playerId") || me.id, amount };
  if (action === "inspect") {
    payload.inspectionKind = read("inspectionKind") || "handDeckTop";
    payload.amount = 1;
    if (payload.inspectionKind === "opponentHand") {
      const opponent = snapshot?.players.find((player) => player.id !== me.id);
      if (opponent) payload.playerId = opponent.id;
    }
    if (payload.inspectionKind === "characterRole") payload.slotIndex = Number(read("slotIndex")) || 0;
  }
  if (action === "marker") payload.label = read("label").trim().slice(0, 20) || "技能标记";
  if (action === "move") {
    payload.slotIndex = Number(read("slotIndex")) || 0;
    payload.operation = read("operation") || "rest";
  }
  interactionState.localFormAction = undefined;
  send("assisted:action", payload);
}

function handleCard(button: HTMLButtonElement, me: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!snapshot) return;
  const instanceId = button.dataset.autoCard || "";
  const zone = button.dataset.zone || "";
  const located = findCard(instanceId, button.dataset.owner);
  const card = located.card;
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  const prompt = snapshot.game.prompt;
  if (isLocalSelectionCard(instanceId)) return toggleSelection(instanceId, interactionState.selectedPromptCards, Number(interactionState.localSelectionAction?.max || 0));
  if (isServerPromptSelectable(instanceId)) return toggleServerPromptCard(instanceId);
  const roleZone = zone.startsWith("slot:") || zone === "retired";
  if (roleZone) {
    if (located.owner?.id === me.id && (!prompt || ["response", "dying", "character-trigger"].includes(prompt.kind))) {
      const nextRole = interactionState.selectedRoleInstanceId === instanceId ? "" : instanceId;
      interactionState.clearDraft();
      interactionState.selectedRoleInstanceId = nextRole;
    } else {
      detailCardInstanceId = instanceId;
      detailOwnerId = located.owner?.id || "";
    }
    render();
    return;
  }
  if (zone !== "hand" || button.dataset.interactive !== "true") {
    detailCardInstanceId = instanceId;
    detailOwnerId = button.dataset.owner || me.id;
    render();
    return;
  }
  if (prompt?.kind === "discard") return toggleSelection(instanceId, interactionState.selectedDiscard, Number(prompt.max || prompt.min || 0));
  if ((prompt?.kind as string) === "recall") return sendPromptChoice({ instanceId, value: "recall" });
  if (prompt?.kind === "assisted-skill") return;
  selectPlayableHand(instanceId);
}

function selectPlayableHand(instanceId: string) {
  if (interactionState.selectedPlayCardId === instanceId) { interactionState.clearDraft(); render(); return; }
  interactionState.clearDraft();
  interactionState.selectedPlayCardId = instanceId;
  if (!snapshot?.game.prompt) {
    const actions = snapshot?.game.legalActions?.filter((action) => action.type === "hand:play" && action.payload?.instanceId === instanceId) || [];
    const card = definition(findCard(instanceId).card);
    if (actions.some((action) => action.payload?.resolvedAs)) beginLocalCardSelection({
      command: "hand:play", payload: { instanceId }, sourceId: instanceId, title: card?.name || "选择转化", message: "选择本次视为的基础牌，然后确认。",
      options: actions.map((action) => ({ label: `当【${catalog.cards[String(action.payload?.resolvedAs)]?.name || "基础牌"}】使用`, payload: { ...action.payload } })),
    });
    else if (actions.some((action) => Number.isInteger(action.payload?.targetSlotIndex))) beginLocalCardSelection({
      command: "hand:play", payload: { instanceId }, sourceId: instanceId, title: card?.name || "选择目标", message: "点击高亮角色选择目标，然后确认打出。",
      selectionKind: "target-slot", cardInstanceIds: targetIds(actions), min: 1, max: 1,
    });
  }
  render();
}

function confirmSelectedHand(me: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!snapshot || !interactionState.selectedPlayCardId) return;
  const instanceId = interactionState.selectedPlayCardId;
  const card = me.hand.find((item) => item.instanceId === instanceId);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  const prompt = snapshot.game.prompt;
  if (prompt?.kind === "dying") {
    interactionState.selectedPlayCardId = "";
    return sendPromptChoice({ instanceId, value: "aid" });
  }
  if (prompt?.kind === "response") {
    interactionState.selectedPlayCardId = "";
    const action = snapshot.game.legalActions?.find((action) => action.type === "response:play" && action.payload?.instanceId === instanceId);
    if (action) return sendDraft(action.type, { ...action.payload });
    showToast("当前响应已不可用，请重新选择。");
    return render();
  }
  const legalPlays = snapshot.game.legalActions?.filter((action) => action.type === "hand:play" && action.payload?.instanceId === instanceId) || [];
  if (legalPlays.some((action) => action.payload?.resolvedAs || Number.isInteger(action.payload?.targetSlotIndex))) {
    interactionState.selectedPlayCardId = "";
    selectPlayableHand(instanceId);
    return;
  }
  sendDraft("hand:play", { instanceId });
}

function runSelectedRoleAction(action: string, me: AutoPlayerView) {
  if (!snapshot || !interactionState.selectedRoleInstanceId) return;
  if (action === "cancel") {
    interactionState.selectedRoleInstanceId = "";
    return render();
  }
  if (action === "view") {
    detailCardInstanceId = interactionState.selectedRoleInstanceId;
    detailOwnerId = me.id;
    return render();
  }
  const { card } = findCard(interactionState.selectedRoleInstanceId, me.id);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  if (action === "reveal") {
    const slotIndex = me.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === interactionState.selectedRoleInstanceId);
    interactionState.selectedRoleInstanceId = "";
    return send("character:reveal", { slotIndex });
  }
  if (action !== "skill") return;
  const legal = snapshot.game.legalActions?.find((candidate) => candidate.type === "skill:activate" && candidate.payload?.instanceId === interactionState.selectedRoleInstanceId);
  if (!legal) return showToast(snapshot.game.unavailableReasons?.[interactionState.selectedRoleInstanceId] || "当前技能不可用。");
  stageAction(legal, interactionState.selectedRoleInstanceId);

}

function bindHoverPreviews() {
  clearTimeout(hoverTimer);
  const preview = root?.querySelector<HTMLElement>("#auto-hover-preview");
  if (!preview) return;
  preview.hidden = true;
  const hide = () => { clearTimeout(hoverTimer); preview.hidden = true; preview.replaceChildren(); };
  root?.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => {
    const show = () => {
      if (!button.isConnected || !mouseQuery.matches || dragGesture) return;
      const instanceId = button.dataset.autoCard || "";
      const { owner, card } = findCard(instanceId, button.dataset.owner);
      const cardDefinition = definition(card);
      const image = card && owner ? cardPreviewImage(card, owner) : undefined;
      if (!cardDefinition || !image) return;
      const extra = cardDefinition.kind === "body" && Boolean(owner?.bodyState.flipped);
      const name = extra ? cardDefinition.extraName || cardDefinition.name : cardDefinition.name;
      const text = extra ? cardDefinition.extraText || cardDefinition.text : cardDefinition.text;
      preview.innerHTML = `<img src="${image}" alt="${escapeHtml(name)}">${renderCardInformation(cardDefinition, name, text, extra)}`;
      preview.hidden = false;
      const rect = button.getBoundingClientRect();
      const width = 470;
      const preferredRight = rect.right + 12;
      const preferredLeft = rect.left - width - 12;
      const left = preferredRight + width <= window.innerWidth - 8 ? preferredRight : Math.max(8, preferredLeft);
      const height = Math.min(390, preview.scrollHeight || 320);
      preview.style.left = `${left}px`;
      preview.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + rect.height / 2 - height / 2))}px`;
    };
    const options = gameBindings ? { signal: gameBindings.signal } : undefined;
    button.addEventListener("mouseenter", () => { clearTimeout(hoverTimer); hoverTimer = window.setTimeout(show, 250); }, options);
    button.addEventListener("mouseleave", hide, options);
    button.addEventListener("focus", () => { if (button.matches(":focus-visible")) show(); }, options);
    button.addEventListener("blur", hide, options);
  });
}

function render() {
  if (!snapshot) return;
  const renderStartedAt = performance.now();
  syncMobileTableState();
  if (app) app.dataset.phase = snapshot.game.started ? "game" : "lobby";
  if (snapshot.game.started) renderGame();
  else {
    gameStructureKey = "";
    gameRegionCache.clear();
    root?.classList.remove("is-table-fit");
    root?.classList.remove("is-mobile-table");
    mobileLogOpen = false;
    renderLobby();
  }
  lastRenderMs = performance.now() - renderStartedAt;
}

function fitDesktopTable() {
  if (!root || !snapshot?.game.started) return;
  const stage = root.querySelector<HTMLElement>(".auto-game-stage");
  const table = root.querySelector<HTMLElement>(".auto-game");
  if (mobileTableActive) {
    root.classList.remove("is-table-fit");
    root.classList.add("is-mobile-table");
    table?.style.removeProperty("--auto-table-scale");
    if (!stage || !table) return;
    table.style.removeProperty("--auto-mobile-scale");
    return;
  }
  root.classList.remove("is-mobile-table");
  root.classList.add("is-table-fit");
  table?.style.removeProperty("--auto-mobile-scale");
  if (!stage || !table) return;
  table.style.removeProperty("--auto-table-scale");
}

function scheduleAutomaticActions() {
  clearTimeout(autoResponseTimer);
  clearTimeout(autoPhaseTimer);
  if (!snapshot || snapshot.you === "spectator" || snapshot.game.winnerId || interactionState.pendingAction) return;
  const prompt = snapshot.game.prompt;
  if (prompt?.kind === "response" && prompt.playerId === snapshot.you
    && !prompt.options?.some((option) => option.value !== "pass")
    && snapshot.game.legalHandCardIds.length === 0 && snapshot.game.legalSkillInstanceIds.length === 0) {
    const promptId = prompt.id;
    autoResponseTimer = window.setTimeout(() => {
      if (snapshot?.game.prompt?.id === promptId && snapshot.game.responsePlayerId === snapshot.you) send("response:pass");
    }, 2000);
    return;
  }
  if (!prompt && snapshot.game.currentPlayerId === snapshot.you && snapshot.game.stack.length === 0
    && ["preparation", "draw", "discard", "end"].includes(snapshot.game.phase)
    && snapshot.game.canAutoAdvancePhase) {
    const revision = snapshot.revision;
    const phase = snapshot.game.phase;
    const delay = phase === "discard" ? 500 : 650;
    autoPhaseTimer = window.setTimeout(() => {
      if (snapshot?.revision === revision && snapshot.game.phase === phase && !snapshot.game.prompt) send("phase:advance");
    }, delay);
  }
}

function renderFatal(message: string) {
  if (root) root.innerHTML = `<section class="battle-loading hud-panel"><span class="battle-kicker">AUTO ROOM ERROR</span><h1>无法进入自动牌桌</h1><p>${escapeHtml(message)}</p><a href="/play" class="btn btn--primary">返回大厅</a></section>`;
}

async function toggleMobileTableLayout() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else showToast("当前浏览器不支持全屏；旋转手机即可自动切换牌桌布局。");
  } catch {
    showToast("未能进入全屏；旋转手机即可自动切换牌桌布局。");
  }
  syncMobileTableState();
}

document.querySelector<HTMLAnchorElement>("[data-auto-exit]")?.addEventListener("click", (event) => {
  event.preventDefault();
  shouldReconnect = false;
  exitingToLobby = true;
  if (snapshot && !snapshot.game.started && snapshot.you !== "spectator") send("room:leave");
  else location.href = "/play";
  window.setTimeout(() => { location.href = "/play"; }, 800);
});
document.querySelector<HTMLButtonElement>("[data-auto-copy-invite]")?.addEventListener("click", (event) => copyText(inviteUrl(), event.currentTarget as HTMLButtonElement, "已复制", "邀请链接"));
document.querySelector<HTMLButtonElement>("[data-auto-mobile-layout]")?.addEventListener("click", () => { void toggleMobileTableLayout(); });
document.querySelector<HTMLButtonElement>("[data-auto-mobile-log-toggle]")?.addEventListener("click", (event) => openMobileLog(event.currentTarget as HTMLButtonElement));
function inputIsEditing(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable=true], a")) || Boolean(window.getSelection()?.toString());
}
function cancelCurrentStep() {
  if (mobileLogOpen) closeMobileLog();
  else if (detailCardInstanceId) { detailCardInstanceId = ""; detailOwnerId = ""; render(); }
  else if (riderDetailId) { riderDetailId = ""; render(); }
  else returnLocalStep();
}
document.addEventListener("keydown", (event) => {
  if (inputIsEditing(event.target)) return;
  if (document.querySelector("dialog[open]")) return;
  if (event.key === "Escape") { event.preventDefault(); cancelCurrentStep(); return; }
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (event.repeat || enterHeld) return;
  enterHeld = true;
  if (interactionState.pendingAction || detailCardInstanceId || riderDetailId || mobileLogOpen) return;
  const buttons = [...root?.querySelectorAll<HTMLButtonElement>("[data-confirm-play], [data-local-selection-confirm], [data-submit-discard], [data-submit-prompt-selection], [data-submit-order], [data-local-form-submit]") || []]
    .filter((button) => !button.disabled && button.getClientRects().length > 0);
  if (buttons.length === 1) buttons[0].click();
});
document.addEventListener("keyup", (event) => { if (event.key === "Enter") enterHeld = false; });
window.addEventListener("blur", () => { enterHeld = false; lastQuickClick = undefined; });
root?.addEventListener("contextmenu", (event) => {
  if (inputIsEditing(event.target) || !mouseQuery.matches) return;
  event.preventDefault(); cancelCurrentStep();
});
app?.querySelector("[data-auto-quick-play]")?.addEventListener("click", () => {
  quickPlay = !quickPlay;
  try { localStorage.setItem(QUICK_PLAY_KEY, String(quickPlay)); } catch { /* Current session still works. */ }
  lastQuickClick = undefined; render();
});
mouseQuery.addEventListener("change", () => { lastQuickClick = undefined; render(); });

function quickActions(id: string) {
  if (!mouseQuery.matches || !quickPlay || !snapshot || snapshot.game.prompt || interactionState.pendingAction || snapshot.game.winnerId) return [];
  return (snapshot.game.legalActions || []).filter((action) => action.type === "hand:play" && action.payload?.instanceId === id
    && action.interaction?.quickPlay === true && !action.payload.resolvedAs && !action.selection);
}
root?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || event.detail === 0) return;
  const card = event.target.closest<HTMLElement>('[data-zone="hand"][data-auto-card]');
  if (!card) { lastQuickClick = undefined; return; }
  if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  const id = card.dataset.autoCard || "";
  const actions = quickActions(id);
  const now = performance.now();
  if (actions.length === 1 && lastQuickClick?.id === id && lastQuickClick.revision === snapshot?.revision && now - lastQuickClick.at <= 400) {
    event.preventDefault(); event.stopImmediatePropagation(); lastQuickClick = undefined;
    suppressClickUntil = now + 350;
    sendDraft(actions[0].type, { ...actions[0].payload });
  } else lastQuickClick = { id, at: now, revision: snapshot?.revision || 0 };
}, true);
function clearDrag() {
  dragGesture = undefined;
  root?.querySelectorAll(".is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
}
root?.addEventListener("dragstart", (event) => {
  if (!(event.target instanceof Element)) return;
  const orderCard = event.target.closest<HTMLElement>("[data-order-id]");
  const card = event.target.closest<HTMLElement>('[data-zone="hand"][data-auto-card]');
  const id = orderCard?.dataset.orderId || card?.dataset.autoCard || "";
  if (!id || interactionState.pendingAction || !mouseQuery.matches || (!orderCard && !quickActions(id).some((action) => action.interaction?.target))) { event.preventDefault(); return; }
  dragGesture = { id, revision: snapshot!.revision, order: Boolean(orderCard) };
  event.dataTransfer?.setData("text/plain", id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  lastQuickClick = undefined;
  if (!orderCard) for (const action of quickActions(id)) {
    const target = action.interaction?.target;
    if (target) root?.querySelector(`[data-target-player="${CSS.escape(target.playerId)}"][data-target-slot="${target.slotIndex}"]`)?.classList.add("is-drop-target");
  }
});
root?.addEventListener("dragover", (event) => {
  if (!dragGesture || !(event.target instanceof Element)) return;
  if (event.target.closest(dragGesture.order ? "[data-order-zone]" : ".is-drop-target")) event.preventDefault();
});
root?.addEventListener("drop", (event) => {
  if (!dragGesture || !(event.target instanceof Element)) return;
  event.preventDefault();
  const gesture = dragGesture;
  clearDrag(); suppressClickUntil = performance.now() + 350;
  if (gesture.revision !== snapshot?.revision || interactionState.pendingAction) return;
  if (gesture.order) {
    const zone = event.target.closest<HTMLElement>("[data-order-zone]")?.dataset.orderZone;
    if (zone === "top" || zone === "bottom") moveOrderCard(gesture.id, zone, event.target.closest<HTMLElement>("[data-order-id]")?.dataset.orderId);
    return;
  }
  const slot = event.target.closest<HTMLElement>("[data-target-player]");
  const actions = quickActions(gesture.id).filter((action) => action.interaction?.target?.playerId === slot?.dataset.targetPlayer && action.interaction?.target?.slotIndex === Number(slot?.dataset.targetSlot));
  if (actions.length === 1) sendDraft(actions[0].type, { ...actions[0].payload });
});
root?.addEventListener("dragend", clearDrag);
window.addEventListener("beforeunload", () => {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  clearTimeout(autoResponseTimer);
  clearTimeout(autoPhaseTimer);
  socket?.close();
});
mobileTableQuery.addEventListener("change", (event) => {
  mobileTableActive = event.matches;
  mobileTableLayout = readMobileTableLayout();
  if (!mobileTableActive) mobileLogOpen = false;
  syncMobileTableState();
  render();
});
window.addEventListener("resize", () => {
  const nextLayout = readMobileTableLayout();
  if (nextLayout !== mobileTableLayout) {
    mobileTableLayout = nextLayout;
    syncMobileTableState();
  }
  fitDesktopTable();
  updateTableFeedback();
});
document.addEventListener("fullscreenchange", syncMobileTableState);
syncMobileTableState();
connect();
