import { getBattleApiUrl } from "../lib/battle-api";
import { escapeHtml, handCardIdentityLabel, handCardImagePath } from "./battle-format";
import {
  clearActiveRoom,
  getBattleToken,
  markActiveRoomWithMode,
  readPending,
  readProfile,
} from "./battle-profile";
import type { Catalog, CardView, PlayerView } from "./battle-types";

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
  flipped: boolean;
  extraFormUsed: boolean;
  trackedCharacterInstanceIds: string[];
  ambushWindow?: { remaining: number; expiresAtTurnNumber: number };
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
    stack: Array<{ kind: "hand" | "character-skill"; id: string; definitionId: string; resolvedAs?: string; sourcePlayerId: string; cancelled?: boolean }>;
    prompt?: AutoPrompt;
    responsePlayerId?: string;
    winnerId?: string;
    deployedThisPhase: number;
    recentEvents: Array<{ id: string; type: string; sourcePlayerId?: string; targetPlayerId?: string; characterDefinitionId?: string; cardDefinitionId?: string }>;
    legalHandCardIds: string[];
    legalSkillInstanceIds: string[];
    canAutoAdvancePhase: boolean;
    legalActions?: Array<{
      type: string;
      payload?: Record<string, string | number | boolean | string[]>;
      selection?: { kind: "cards" | "skill-cost" | "order"; cardInstanceIds: string[]; min: number; max: number };
    }>;
    legalBodyActionPlayerIds: string[];
    skillCostRestReductionByCharacterId: Record<string, number>;
    logs: Array<{ id: string; text: string; actorId?: string }>;
  };
  isSpectator?: boolean;
};

type LocalSelectionAction = {
  command: string;
  payload: Record<string, unknown>;
  title: string;
  message: string;
  cardInstanceIds?: string[];
  min?: number;
  max?: number;
  selectionKind?: "cost" | "target-slot";
  options?: Array<{ label: string; payload: Record<string, unknown> }>;
};

type LocalFormAction =
  | { kind: "order"; title: string; message: string }
  | { kind: "assisted"; action: string; title: string; message: string };

type ServerMessage =
  | { type: "snapshot"; snapshot: AutoSnapshot }
  | { type: "actionAck"; actionId: string; revision: number }
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
const profile = readProfile();
const pending = readPending() as { nickname?: string; deckId?: string; customDeck?: unknown };
const token = getBattleToken();
let socket: WebSocket | undefined;
let snapshot: AutoSnapshot | undefined;
let reconnectTimer = 0;
let toastTimer = 0;
let shouldReconnect = true;
let exitingToLobby = false;
let selectedPlayCardId = "";
let selectedRoleInstanceId = "";
let detailCardInstanceId = "";
let detailOwnerId = "";
let localSelectionAction: LocalSelectionAction | undefined;
let localFormAction: LocalFormAction | undefined;
let autoResponseTimer = 0;
let autoPhaseTimer = 0;
let effectTimer = 0;
let effectPlaying = false;
const effectQueue: Array<{ player: AutoPlayerView; kind: "ready" | "activate" }> = [];
const healthAnimations = new Map<string, "damage" | "heal">();
const progressAnimations = new Set<string>();
const flipAnimations = new Set<string>();
const selectedDiscard = new Set<string>();
const selectedPromptCards = new Set<string>();

if (roomCodeElement) roomCodeElement.textContent = roomCode || "------";

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>("#auto-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
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
  const readyDecks = catalog.decks.filter((deck) => deck.autoReady);
  const deckId = typeof pending.deckId === "string" && readyDecks.some((deck) => deck.id === pending.deckId)
    ? pending.deckId
    : readyDecks[0]?.id || "";
  return { deckId };
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
  return url;
}

async function connect() {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return renderFatal("房间码无效。");
  try {
    setConnection("连接中", "connecting");
    await ensureSeat();
    socket = new WebSocket(wsUrl());
    socket.addEventListener("open", () => setConnection("已连接", "open"));
    socket.addEventListener("message", (event) => handleMessage(JSON.parse(String(event.data)) as ServerMessage));
    socket.addEventListener("close", () => {
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
        if (player.health !== before.health) healthAnimations.set(player.id, Number(player.health || 0) < Number(before.health || 0) ? "damage" : "heal");
        if (player.bodyState.progress > before.bodyState.progress) progressAnimations.add(player.id);
        if (!before.bodyState.flipped && player.bodyState.flipped) {
          flipAnimations.add(player.id);
          effectQueue.push({ player, kind: "ready" });
        } else if (!before.bodyState.extraFormUsed && player.bodyState.extraFormUsed) {
          effectQueue.push({ player, kind: "activate" });
        }
      }
    }
    snapshot = message.snapshot;
    const me = snapshot.players.find((player) => player.id === snapshot?.you);
    if (!me?.hand.some((card) => card.instanceId === selectedPlayCardId)
      || !snapshot.game.legalHandCardIds.includes(selectedPlayCardId)) selectedPlayCardId = "";
    if (selectedRoleInstanceId && !me?.characterSlots.some((card) => card && "instanceId" in card && card.instanceId === selectedRoleInstanceId)
      && !me?.retired.some((card) => card.instanceId === selectedRoleInstanceId)) selectedRoleInstanceId = "";
    selectedDiscard.clear();
    selectedPromptCards.clear();
    localSelectionAction = undefined;
    localFormAction = undefined;
    render();
    playNextBodyEffect();
    scheduleAutomaticActions();
  } else if (message.type === "error") showToast(message.error);
  else if (message.type === "roomEnded") {
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
    ? isMega ? "Mega 进化" : "Z 招式就绪"
    : isMega ? "Mega 特性生效" : "Z 招式发动";
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
  if (!socket || socket.readyState !== WebSocket.OPEN || !snapshot) return showToast("牌桌尚未连接。");
  socket.send(JSON.stringify({ type, payload, actionId: crypto.randomUUID(), protocolVersion: 2, baseRevision: snapshot.revision }));
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

function isServerPromptSelectable(instanceId?: string) {
  const prompt = snapshot?.game.prompt;
  if (!instanceId || !prompt || prompt.playerId !== snapshot?.you || prompt.max === undefined) return false;
  return !["response", "dying", "recall"].includes(prompt.kind) && Boolean(prompt.cardInstanceIds?.includes(instanceId));
}

function isLocalSelectionCard(instanceId?: string) {
  return Boolean(instanceId && localSelectionAction?.cardInstanceIds?.includes(instanceId));
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
  const image = faceDownCharacter ? "/cards/backs/character.webp" : cardImage(card, owner);
  const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
  const title = disabledReason ? `${cardDefinition.text}\n当前不可用：${disabledReason}` : cardDefinition.text;
  const selectable = isServerPromptSelectable(card.instanceId) || isLocalSelectionCard(card.instanceId);
  const selected = card.instanceId === selectedPlayCardId || card.instanceId === selectedRoleInstanceId
    || Boolean(card.instanceId && selectedPromptCards.has(card.instanceId))
    || Boolean(card.instanceId && selectedDiscard.has(card.instanceId));
  const recent = snapshot?.game.recentEvents.at(-1);
  const animated = recent && recent.characterDefinitionId === card.definitionId
    ? recent.type === "skill_used" ? "is-skill-active"
      : recent.type === "character_revealed" ? "is-revealed"
        : recent.type === "character_deployed" ? "is-deployed"
          : recent.type === "character_retired" ? "is-retired"
            : ""
    : cardDefinition.kind === "body" && flipAnimations.has(owner.id) ? "is-form-flipped" : "";
  return `<button type="button" class="auto-card auto-card--${cardDefinition.kind} ${interactive || selectable ? "is-legal" : ""} ${selectable ? "is-table-selectable" : ""} ${selected ? "is-selected" : ""} ${faceDownCharacter ? "is-face-down" : ""} ${animated}" data-auto-card="${card.instanceId || ""}" data-owner="${owner.id}" data-zone="${zone}" data-interactive="${interactive || selectable ? "true" : "false"}" title="${escapeHtml(faceDownCharacter ? "暗置角色" : title)}">
    ${image ? `<img src="${image}" alt="" />` : ""}${!faceDownCharacter && cardDefinition.kind === "character" && cardDefinition.automationLevel ? `<span class="auto-card__automation">${cardDefinition.automationLevel === "full" ? "自动" : "辅助"}</span>` : ""}${faceDownCharacter ? `<span class="sr-only">暗置角色</span>` : `<strong>${escapeHtml(cardDefinition.kind === "body" && owner.bodyState.flipped ? cardDefinition.extraName || cardDefinition.name : cardDefinition.name)}</strong><small>${escapeHtml(identity || (cardDefinition.kind === "body" && owner.bodyState.flipped ? cardDefinition.extraSubtitle || cardDefinition.subtitle : cardDefinition.subtitle))}</small>`}
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

function renderPlayer(player: AutoPlayerView, isMe: boolean, perspectiveLabel?: string) {
  const game = snapshot?.game;
  const current = game?.currentPlayerId === player.id;
  const slots = player.characterSlots.map((slot, index) => {
    if (!slot) return `<button class="auto-slot auto-slot--empty" data-empty-slot="${index}" disabled>空位 ${index + 1}</button>`;
    if ("faceDown" in slot && slot.faceDown && !("instanceId" in slot)) {
      const selectionKey = `slot:${player.id}:${index}`;
      const selectable = localSelectionAction?.cardInstanceIds?.includes(selectionKey);
      return `<div class="auto-slot"><button type="button" class="auto-card auto-card--back auto-card--character-back ${selectable ? "is-legal is-table-selectable" : ""} ${selectedPromptCards.has(selectionKey) ? "is-selected" : ""}" ${selectable ? `data-local-slot="${escapeHtml(selectionKey)}"` : "disabled"}><img src="/cards/backs/character.webp" alt="暗置角色"></button></div>`;
    }
    if (!("instanceId" in slot) || !slot.instanceId) return `<div class="auto-slot auto-slot--marker"><span>${escapeHtml("label" in slot && slot.label ? slot.label : "占位标记")}</span></div>`;
    const canReveal = Boolean(isMe && slot.faceDown && game?.currentPlayerId === snapshot?.you && game?.phase === "deployment" && !game.prompt);
    const canUseSkill = Boolean(isMe && slot.instanceId && game?.legalSkillInstanceIds.includes(slot.instanceId));
    return `<div class="auto-slot">${renderCard(slot, player, `slot:${index}`, canReveal || canUseSkill, canReveal ? "" : canUseSkill ? "" : "当前不满足技能时机")}</div>`;
  }).join("");
  const bodyDefinition = definition(player.body);
  const formLabel = bodyDefinition?.extraFormLabel || "额外形态";
  const bodyReady = player.bodyState.flipped;
  const canActivateBody = Boolean(isMe && game?.legalBodyActionPlayerIds.includes(player.id));
  const bodyStatus = player.body ? `<div class="auto-body-status ${bodyReady ? "is-ready" : ""} ${player.bodyState.extraFormUsed ? "is-used" : ""}">
    <small>${player.bodyState.extraFormUsed ? "本局已使用" : bodyReady ? (bodyDefinition?.extraFormType === "mega" ? "Mega 已生效" : "Z招式已就绪") : escapeHtml(bodyDefinition?.megaCondition || "累计核心操作解锁")}</small>
    ${canActivateBody ? `<button class="btn btn--primary auto-body-activate" data-body-activate>发动 Z招式</button>` : ""}
  </div>` : "";
  const retired = player.retired.map((card) => {
    const legal = Boolean(isMe && card.instanceId && game?.legalSkillInstanceIds.includes(card.instanceId));
    return renderCard(card, player, "retired", legal, legal ? "" : "当前不满足退场区发动时机");
  }).join("");
  const healthAnimation = healthAnimations.get(player.id);
  return `<section class="auto-player ${current ? "is-current" : ""} ${isMe ? "is-self" : "is-opponent"} ${healthAnimation === "damage" ? "is-damaged" : healthAnimation === "heal" ? "is-healed" : ""}">
    <header><div class="auto-player__identity"><span>${escapeHtml(perspectiveLabel || (isMe ? "己方" : "对手"))} · ${player.connected ? "在线" : "暂离"}</span><h2>${escapeHtml(player.nickname)}</h2><em>手牌 ${player.handCount ?? player.hand.length}</em></div></header>
    <div class="auto-player__field">${player.body ? `<div class="auto-body-wrap"><div class="auto-body-card">${renderCard(player.body, player, "body", false)}</div>${bodyStatus}</div>` : ""}<div class="auto-slots">${slots}</div><div class="auto-player__counters">${renderHealthCounter(player)}${renderProgressCounter(player, bodyDefinition)}</div></div>
    ${retired ? `<div class="auto-retired"><span>退场区</span><div>${retired}</div></div>` : ""}
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
    ${snapshot.you === "spectator" ? "" : `<label>选择预组<select id="auto-deck-select">${deckOptions}</select></label><button class="btn btn--primary" data-auto-command="ready">${me?.ready ? "取消准备" : "确认准备"}</button>`}
  </section>`;
  root.querySelector<HTMLSelectElement>("#auto-deck-select")?.addEventListener("change", (event) => send("player:selectDeck", { deckId: (event.currentTarget as HTMLSelectElement).value }));
  root.querySelector("[data-auto-command=ready]")?.addEventListener("click", () => send("player:ready", { ready: !me?.ready }));
  root.querySelector<HTMLButtonElement>("[data-auto-copy-code]")?.addEventListener("click", (event) => copyText(snapshot?.roomCode || roomCode, event.currentTarget as HTMLButtonElement, "已复制", "复制房间码"));
  root.querySelector<HTMLButtonElement>("[data-auto-copy-link]")?.addEventListener("click", (event) => copyText(inviteUrl(), event.currentTarget as HTMLButtonElement, "已复制", "复制邀请链接"));
}

function renderPromptCard(card: CardView, owner: AutoPlayerView, interactive: boolean) {
  const cardDefinition = definition(card);
  if (!cardDefinition) return `<div class="auto-card auto-card--back"><img src="/cards/backs/hand.webp" alt="暗置手牌"></div>`;
  const image = cardImage(card, owner);
  const selected = Boolean(card.instanceId && selectedPromptCards.has(card.instanceId));
  return `<button type="button" class="auto-card ${interactive ? "is-legal" : ""} ${selected ? "is-selected" : ""}" ${interactive ? `data-prompt-card="${card.instanceId}"` : "disabled"}>
    ${image ? `<img src="${image}" alt="" />` : ""}<strong>${escapeHtml(cardDefinition.name)}</strong><small>${escapeHtml(handCardIdentityLabel(card.suit, card.rank, card.joker) || cardDefinition.subtitle)}</small>
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

function renderPrompt(prompt: AutoPrompt | undefined, me?: AutoPlayerView) {
  if (!prompt) return "";
  const mine = prompt.playerId === snapshot?.you;
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
    ? `<button class="btn btn--primary" data-submit-prompt-selection ${selectedPromptCards.size < Number(prompt.min || 0) || selectedPromptCards.size > prompt.max ? "disabled" : ""}>确认选择</button>` : "";
  const continuation = prompt.context?.continuation as { step?: string } | undefined;
  const orderInput = mine && continuation?.step === "prophet-order"
    ? `<button class="btn btn--primary" data-submit-character-order>输入牌序</button>` : "";
  const autoPass = mine && prompt.kind === "response" && snapshot?.game.legalHandCardIds.length === 0 && snapshot.game.legalSkillInstanceIds.length === 0
    ? `<small class="auto-prompt__auto">没有可用的牌或技能，2 秒后自动放弃响应。</small>` : "";
  return `<aside class="auto-prompt ${mine ? "is-mine" : ""} ${selectableCards || inspectedCard ? "has-card-choices" : ""}">${responseContext(prompt)}<span>${mine ? "需要你的操作" : "等待对手"}</span><h3>${escapeHtml(prompt.title)}</h3><p>${escapeHtml(prompt.message)}</p>${autoPass}${inspectedCard ? `<div class="auto-prompt__inspection">${inspectedCard}</div>` : ""}${selectableCards ? `<div class="auto-prompt__cards">${selectableCards}</div>` : ""}<div class="auto-prompt__actions">${options}${cardSelection}${orderInput}${prompt.kind === "discard" && mine ? `<button class="btn btn--primary" data-submit-discard ${selectedDiscard.size === Number(prompt.min || 0) ? "" : "disabled"}>确认弃牌</button>` : ""}${prompt.kind === "assisted-skill" && mine ? `<button class="btn btn--primary" data-assisted-finish>完成技能结算</button>` : ""}</div></aside>`;
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
  const image = cardImage(card, owner);
  const extra = cardDefinition.kind === "body" && owner.bodyState.flipped;
  const name = extra ? cardDefinition.extraName || cardDefinition.name : cardDefinition.name;
  const text = extra ? cardDefinition.extraText || cardDefinition.text : cardDefinition.text;
  return `<div class="auto-detail" role="dialog" aria-modal="true" aria-label="卡牌详情"><button class="auto-detail__backdrop" data-detail-close aria-label="关闭详情"></button><article><button class="auto-detail__close" data-detail-close aria-label="关闭">×</button>${image ? `<img src="${image}" alt="${escapeHtml(name)}" />` : ""}${renderCardInformation(cardDefinition, name, text, extra)}</article></div>`;
}

function renderCardInformation(cardDefinition: NonNullable<ReturnType<typeof definition>>, name: string, text: string, extra = false) {
  const type = cardDefinition.kind === "character" ? cardDefinition.mainRole || "角色" : cardDefinition.kind === "body" ? cardDefinition.archetype || "本体" : "手牌";
  const isZMove = cardDefinition.kind === "body" && extra && cardDefinition.extraFormType === "z-move";
  const isDynamax = cardDefinition.kind === "body" && extra && cardDefinition.extraFormType === "dynamax";
  const detailLabel = cardDefinition.kind === "hand" ? "效果" : cardDefinition.kind === "body" ? isZMove ? "Z招式详情" : isDynamax ? "极巨技能详情" : "特性详情" : "技能详情";
  const abilityName = extra ? cardDefinition.extraSubtitle?.split(" · ").at(-1) || cardDefinition.skillName : cardDefinition.skillName;
  const abilityLabel = cardDefinition.kind === "body" ? isZMove ? "Z招式" : isDynamax ? "极巨技能" : "特性" : "";
  return `<div class="auto-card-info"><span>${escapeHtml(type)}</span><h3>${escapeHtml(name)}</h3>${abilityName ? `<strong>${abilityLabel ? `${abilityLabel}` : ""}【${escapeHtml(abilityName)}】</strong>` : ""}${cardDefinition.timing ? `<p><b>发动时机</b>${escapeHtml(cardDefinition.timing)}</p>` : ""}${cardDefinition.costText ? `<p><b>费用</b>${escapeHtml(cardDefinition.costText)}</p>` : ""}<p><b>${detailLabel}</b>${escapeHtml(text)}</p></div>`;
}

function renderLocalSelection() {
  if (!localSelectionAction) return "";
  const selected = selectedPromptCards.size;
  const min = Number(localSelectionAction.min || 0);
  const max = Number(localSelectionAction.max || 0);
  const confirmDisabled = localSelectionAction.cardInstanceIds && (selected < min || selected > max);
  const options = localSelectionAction.options?.map((option, index) => `<button class="btn btn--secondary" data-local-option="${index}">${escapeHtml(option.label)}</button>`).join("") || "";
  return `<aside class="auto-prompt auto-local-selection is-mine"><span>需要你的操作</span><h3>${escapeHtml(localSelectionAction.title)}</h3><p>${escapeHtml(localSelectionAction.message)}</p><div class="auto-prompt__actions">${options}${localSelectionAction.cardInstanceIds ? `<button class="btn btn--primary" data-local-selection-confirm ${confirmDisabled ? "disabled" : ""}>确认选择 ${selected}/${min === max ? min : `${min}-${max}`}</button>` : ""}<button class="btn btn--secondary" data-local-selection-cancel>取消</button></div></aside>`;
}

function renderLocalForm(me?: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!localFormAction || !me) return "";
  if (localFormAction.kind === "order") return `<aside class="auto-prompt auto-local-form is-mine"><span>需要你的操作</span><h3>${escapeHtml(localFormAction.title)}</h3><p>${escapeHtml(localFormAction.message)}</p><div class="auto-inline-form auto-inline-form--order"><label>牌顶与牌底顺序<input data-local-form-order value="1 | 2,3" placeholder="例如 1,3 | 2,4"></label></div><div class="auto-prompt__actions"><button class="btn btn--primary" data-local-form-submit>确认牌序</button><button class="btn btn--secondary" data-local-form-cancel>返回</button></div></aside>`;
  const isInspect = localFormAction.action === "inspect";
  const isMove = localFormAction.action === "move";
  const isMarker = localFormAction.action === "marker";
  return `<aside class="auto-prompt auto-local-form is-mine"><span>技能结算</span><h3>${escapeHtml(localFormAction.title)}</h3><p>${escapeHtml(localFormAction.message)}</p><div class="auto-inline-form">
    ${isInspect ? `<label>观看内容<select data-assisted-field="inspectionKind"><option value="handDeckTop">共用手牌堆顶</option><option value="opponentHand">对手手牌</option><option value="characterRole">角色牌</option></select></label>` : ""}
    <label>目标<select data-assisted-field="playerId"><option value="${escapeHtml(me.id)}">自己</option>${opponent ? `<option value="${escapeHtml(opponent.id)}">对手·${escapeHtml(opponent.nickname)}</option>` : ""}</select></label>
    ${isInspect || isMove ? `<label>角色位<select data-assisted-field="slotIndex">${[0, 1, 2, 3].map((index) => `<option value="${index}">${index + 1} 号位</option>`).join("")}</select></label>` : ""}
    ${isMove ? `<label>移动方式<select data-assisted-field="operation"><option value="rest">休整</option><option value="retire">退场</option></select></label>` : ""}
    ${isInspect ? "" : `<label>数量<input type="number" min="1" max="3" value="1" data-assisted-field="amount"></label>`}
    ${isMarker ? `<label>标记名称<input maxlength="20" value="技能标记" data-assisted-field="label"></label>` : ""}
  </div><div class="auto-prompt__actions"><button class="btn btn--primary" data-local-form-submit>确认结算</button><button class="btn btn--secondary" data-local-form-cancel>返回</button></div></aside>`;
}

function renderRoleAction(me?: AutoPlayerView) {
  if (!snapshot || !me || !selectedRoleInstanceId) return "";
  const { card } = findCard(selectedRoleInstanceId, me.id);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition || cardDefinition.kind !== "character") return "";
  const slotIndex = me.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === selectedRoleInstanceId);
  const canReveal = slotIndex >= 0 && card.faceDown && snapshot.game.currentPlayerId === snapshot.you && snapshot.game.phase === "deployment" && !snapshot.game.prompt;
  const canUseSkill = snapshot.game.legalSkillInstanceIds.includes(selectedRoleInstanceId);
  return `<div class="auto-role-confirm"><div><span>已选择角色</span><strong>【${escapeHtml(cardDefinition.name)}】</strong><small>${canUseSkill || canReveal ? "选择要执行的操作" : "当前只能查看卡牌详情"}</small></div><button class="btn btn--secondary" data-role-action="view">查看详情</button>${canReveal ? `<button class="btn btn--secondary" data-role-action="reveal">明置角色</button>` : ""}${canUseSkill ? `<button class="btn btn--primary" data-role-action="skill">发动技能</button>` : ""}<button class="btn btn--secondary" data-role-action="cancel">取消</button></div>`;
}

function renderGame() {
  if (!snapshot || !root) return;
  const spectator = snapshot.you === "spectator";
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = spectator ? snapshot.players[0] : snapshot.players.find((player) => player.id !== snapshot?.you);
  const lowerPlayer = spectator ? snapshot.players[1] : me;
  const isMyTurn = snapshot.game.currentPlayerId === snapshot.you;
  const canAdvance = isMyTurn && !snapshot.game.prompt && snapshot.game.stack.length === 0 && !snapshot.game.winnerId;
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
  const selectedCard = me?.hand.find((card) => card.instanceId === selectedPlayCardId);
  const selectedDefinition = definition(selectedCard);
  const hasInteractionOverlay = Boolean(snapshot.game.prompt || selectedRoleInstanceId || localSelectionAction || localFormAction);
  root.innerHTML = `<div class="auto-game-stage"><div class="auto-game" data-phase="${snapshot.game.phase}">
    ${opponent ? renderPlayer(opponent, false, spectator ? "玩家 A" : undefined) : ""}
    <section class="auto-command-center ${hasInteractionOverlay ? "has-interaction-overlay" : ""}">
      <div class="auto-phase"><span>第 ${snapshot.game.turnNumber} 回合 · ${isMyTurn ? "你的回合" : "对手回合"}</span><strong>${phaseLabels[snapshot.game.phase]}阶段</strong><small>${recentEvent ? escapeHtml(eventLabel(recentEvent.type)) : "等待行动"}</small></div>
      ${renderPhaseTrack(snapshot.game.phase)}
      <button class="btn btn--primary" data-phase-advance ${canAdvance ? "" : "disabled"}>进入下一阶段</button>
      ${snapshot.game.phase === "deployment" && isMyTurn ? `<button class="btn btn--secondary" data-deploy ${snapshot.game.deployedThisPhase >= 2 ? "disabled" : ""}>上阵角色（${snapshot.game.deployedThisPhase}/2）</button>` : ""}
      ${bombActions.map((action) => `<button class="btn btn--secondary" data-remove-bomb="${escapeHtml(String(action.payload?.markerId || ""))}">休整1张角色拆除炸弹</button>`).join("")}
      <div class="auto-stack"><span>结算栈 ${snapshot.game.stack.length}</span><ol>${stack || "<li>当前为空</li>"}</ol></div>
      ${localFormAction ? renderLocalForm(me, opponent)
        : localSelectionAction ? renderLocalSelection()
          : selectedRoleInstanceId ? renderRoleAction(me)
            : renderPrompt(snapshot.game.prompt, me)}
      ${snapshot.game.winnerId ? `<div class="auto-winner"><strong>${snapshot.game.winnerId === snapshot.you ? "你获胜了" : "对手获胜"}</strong><a href="/play" class="btn btn--primary">返回大厅</a></div>` : ""}
    </section>
    ${lowerPlayer ? renderPlayer(lowerPlayer, !spectator, spectator ? "玩家 B" : undefined) : ""}
    ${me ? `<section class="auto-hand"><header><strong>我的手牌</strong><span>${me.hand.length} 张 · 牌堆 ${snapshot.game.handDeckCount} · 弃牌 ${snapshot.game.handDiscard.length}</span></header><div class="auto-hand__cards">${hand || "<p>没有手牌</p>"}</div>${selectedCard && selectedDefinition ? `<div class="auto-play-confirm"><div><span>已选择</span><strong>【${escapeHtml(selectedDefinition.name)}】</strong><small>${escapeHtml(selectedDefinition.text)}</small></div><button class="btn btn--secondary" data-view-selected>查看牌面</button><button class="btn btn--secondary" data-cancel-play>取消</button><button class="btn btn--primary" data-confirm-play>${snapshot.game.prompt?.kind === "response" ? "确认响应" : snapshot.game.prompt?.kind === "dying" ? "确认急救" : "确认打出"}</button></div>` : ""}</section>` : ""}
    <aside class="auto-log"><header>公开日志</header><ol>${logs}</ol></aside>
  </div></div>${renderCardDetail()}<div class="auto-hover-preview" id="auto-hover-preview" hidden></div>`;
  bindGameActions(me, opponent);
  fitDesktopTable();
}

function eventLabel(type: string) {
  return ({ card_used: "牌已使用", card_responded: "牌已响应", card_resolved: "牌已结算", damage_after: "伤害结算后", health_recovered: "体力回复后", character_deployed: "角色上阵后", character_revealed: "角色明置后", character_rested: "角色休整后", character_retired: "角色退场后", hand_discarded: "手牌弃置后", hand_lost: "手牌失去后", inspection: "观看后", judgment_revealed: "判定展示", judgment_resolved: "判定结算后", skill_used: "技能发动后", strike_dodged: "出刀被闪避" } as Record<string, string>)[type] || "事件待结算";
}

function handLegality(card: CardView) {
  if (!snapshot || snapshot.you === "spectator") return { allowed: false, reason: "观战者不能操作" };
  const prompt = snapshot.game.prompt;
  const serverAllows = Boolean(card.instanceId && snapshot.game.legalHandCardIds.includes(card.instanceId));
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
  return serverAllows
    ? { allowed: true, reason: "" }
    : { allowed: false, reason: "不满足该牌的使用时机或次数限制" };
}

function bindGameActions(me?: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!root || !snapshot) return;
  if (!me) {
    root.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => button.addEventListener("click", () => {
      detailCardInstanceId = button.dataset.autoCard || "";
      detailOwnerId = button.dataset.owner || "";
      render();
    }));
    root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", () => { detailCardInstanceId = ""; detailOwnerId = ""; render(); }));
    bindHoverPreviews();
    return;
  }
  root.querySelector("[data-phase-advance]")?.addEventListener("click", () => send("phase:advance"));
  root.querySelector("[data-deploy]")?.addEventListener("click", () => send("character:deploy"));
  root.querySelector("[data-body-activate]")?.addEventListener("click", () => send("body:activate"));
  root.querySelectorAll<HTMLButtonElement>("[data-remove-bomb]").forEach((button) => button.addEventListener("click", () => {
    const action = snapshot?.game.legalActions?.find((candidate) => candidate.type === "bomb:remove" && candidate.payload?.markerId === button.dataset.removeBomb);
    if (action?.selection) return beginLocalCardSelection({
      command: "bomb:remove", payload: { markerId: button.dataset.removeBomb }, title: "拆除炸弹",
      message: `在己方角色区选择 ${action.selection.min} 张角色支付休整费用。`, selectionKind: "cost",
      cardInstanceIds: action.selection.cardInstanceIds, min: action.selection.min, max: action.selection.max,
    });
    send("bomb:remove", { markerId: button.dataset.removeBomb });
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => button.addEventListener("click", () => handleCard(button, me, opponent)));
  root.querySelector("[data-confirm-play]")?.addEventListener("click", () => confirmSelectedHand(me, opponent));
  root.querySelector("[data-cancel-play]")?.addEventListener("click", () => { selectedPlayCardId = ""; render(); });
  root.querySelector("[data-view-selected]")?.addEventListener("click", () => { detailCardInstanceId = selectedPlayCardId; detailOwnerId = me.id; render(); });
  root.querySelectorAll("[data-detail-close]").forEach((button) => button.addEventListener("click", () => { detailCardInstanceId = ""; detailOwnerId = ""; render(); }));
  root.querySelectorAll<HTMLButtonElement>("[data-role-action]").forEach((button) => button.addEventListener("click", () => runSelectedRoleAction(button.dataset.roleAction || "", me)));
  root.querySelectorAll<HTMLButtonElement>("[data-prompt-value]").forEach((button) => button.addEventListener("click", () => send("choice:submit", { value: button.dataset.promptValue })));
  root.querySelectorAll<HTMLButtonElement>("[data-prompt-card]").forEach((button) => button.addEventListener("click", () => {
    toggleServerPromptCard(button.dataset.promptCard || "");
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-assisted-action]").forEach((button) => button.addEventListener("click", () => runAssistedAction(button.dataset.assistedAction || "", me, opponent)));
  root.querySelector("[data-submit-prompt-selection]")?.addEventListener("click", () => send("choice:submit", { cardInstanceIds: [...selectedPromptCards] }));
  root.querySelector("[data-submit-character-order]")?.addEventListener("click", () => {
    localFormAction = { kind: "order", title: "设置牌序", message: "按当前展示编号填写牌顶与牌底，中间使用 | 分隔。" };
    render();
  });
  root.querySelector("[data-submit-discard]")?.addEventListener("click", () => send("choice:submit", { cardInstanceIds: [...selectedDiscard] }));
  root.querySelector("[data-assisted-finish]")?.addEventListener("click", () => send("assisted:finish"));
  root.querySelector("[data-local-selection-confirm]")?.addEventListener("click", submitLocalSelection);
  root.querySelector("[data-local-selection-cancel]")?.addEventListener("click", () => {
    localSelectionAction = undefined;
    selectedPromptCards.clear();
    render();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-local-option]").forEach((button) => button.addEventListener("click", () => {
    const option = localSelectionAction?.options?.[Number(button.dataset.localOption)];
    if (!option || !localSelectionAction) return;
    const { command, payload } = localSelectionAction;
    localSelectionAction = undefined;
    selectedPromptCards.clear();
    send(command, { ...payload, ...option.payload });
  }));
  root.querySelector("[data-local-form-cancel]")?.addEventListener("click", () => {
    localFormAction = undefined;
    render();
  });
  root.querySelector("[data-local-form-submit]")?.addEventListener("click", () => submitLocalForm(me));
  root.querySelectorAll<HTMLButtonElement>("[data-local-slot]").forEach((button) => button.addEventListener("click", () => {
    toggleSelection(button.dataset.localSlot || "", selectedPromptCards, Number(localSelectionAction?.max || 0));
  }));
  bindHoverPreviews();
}

function beginLocalCardSelection(action: LocalSelectionAction) {
  localSelectionAction = action;
  selectedRoleInstanceId = "";
  selectedPromptCards.clear();
  const cardInstanceIds = action.cardInstanceIds || [];
  if (cardInstanceIds.length === action.min && action.min === action.max) {
    cardInstanceIds.forEach((id) => selectedPromptCards.add(id));
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
  if (prompt.kind === "discard") return toggleSelection(instanceId, selectedDiscard, Number(prompt.max || prompt.min || 0));
  toggleSelection(instanceId, selectedPromptCards, Number(prompt.max || 0));
}

function submitLocalSelection() {
  if (!localSelectionAction) return;
  const action = localSelectionAction;
  const selected = [...selectedPromptCards];
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
  localSelectionAction = undefined;
  selectedPromptCards.clear();
  send(action.command, payload);
}

function runAssistedAction(action: string, me: AutoPlayerView, opponent?: AutoPlayerView) {
  void opponent;
  localFormAction = {
    kind: "assisted", action, title: "处理辅助结算",
    message: action === "inspect" ? "选择观看内容和目标。" : "选择此次技能结算的目标与数量。",
  };
  render();
}

function submitLocalForm(me: AutoPlayerView) {
  if (!root || !localFormAction) return;
  if (localFormAction.kind === "order") {
    const value = root.querySelector<HTMLInputElement>("[data-local-form-order]")?.value.trim();
    if (!value || !/^\s*[\d,]*\s*\|\s*[\d,]*\s*$/.test(value)) return showToast("请使用“牌顶 | 牌底”格式填写牌序。");
    localFormAction = undefined;
    send("choice:submit", { value });
    return;
  }
  const action = localFormAction.action;
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
  localFormAction = undefined;
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
  if (isLocalSelectionCard(instanceId)) return toggleSelection(instanceId, selectedPromptCards, Number(localSelectionAction?.max || 0));
  if (isServerPromptSelectable(instanceId)) return toggleServerPromptCard(instanceId);
  const roleZone = zone.startsWith("slot:") || zone === "retired";
  if (roleZone) {
    if (located.owner?.id === me.id && (!prompt || ["response", "dying", "character-trigger"].includes(prompt.kind))) {
      selectedRoleInstanceId = selectedRoleInstanceId === instanceId ? "" : instanceId;
    } else {
      detailCardInstanceId = instanceId;
      detailOwnerId = located.owner?.id || "";
    }
    render();
    return;
  }
  if (prompt?.kind === "discard") {
    if (selectedDiscard.has(instanceId)) selectedDiscard.delete(instanceId); else selectedDiscard.add(instanceId);
    button.classList.toggle("is-selected", selectedDiscard.has(instanceId));
    const submit = root?.querySelector<HTMLButtonElement>("[data-submit-discard]");
    if (submit) submit.disabled = selectedDiscard.size !== prompt.min;
    return;
  }
  if (prompt?.kind === "dying") return selectPlayableHand(instanceId);
  if ((prompt?.kind as string) === "recall") return send("choice:submit", { instanceId, value: "recall" });
  if (prompt?.kind === "response") return selectPlayableHand(instanceId);
  if (prompt?.kind === "assisted-skill") return;
  if (zone === "body") {
    detailCardInstanceId = instanceId;
    detailOwnerId = button.dataset.owner || me.id;
    render();
    return;
  }
  if (button.dataset.interactive !== "true") {
    detailCardInstanceId = instanceId;
    detailOwnerId = button.dataset.owner || me.id;
    render();
    return;
  }
  selectPlayableHand(instanceId);
}

function selectPlayableHand(instanceId: string) {
  selectedPlayCardId = selectedPlayCardId === instanceId ? "" : instanceId;
  render();
}

function confirmSelectedHand(me: AutoPlayerView, opponent?: AutoPlayerView) {
  if (!snapshot || !selectedPlayCardId) return;
  const instanceId = selectedPlayCardId;
  const card = me.hand.find((item) => item.instanceId === instanceId);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  const prompt = snapshot.game.prompt;
  if (prompt?.kind === "dying") {
    selectedPlayCardId = "";
    return send("choice:submit", { instanceId, value: "aid" });
  }
  if (prompt?.kind === "response") {
    selectedPlayCardId = "";
    return send("response:play", { instanceId, ...(cardDefinition.id === "hand_basic_004" ? { resolvedAs: "hand_basic_002" } : {}) });
  }
  const legalPlays = snapshot.game.legalActions?.filter((action) => action.type === "hand:play" && action.payload?.instanceId === instanceId) || [];
  if (cardDefinition.id === "hand_basic_004") {
    const options = legalPlays.map((action) => ({
      label: `当【${catalog.cards[String(action.payload?.resolvedAs)]?.name || "基础牌"}】使用`,
      payload: { resolvedAs: action.payload?.resolvedAs },
    }));
    localSelectionAction = { command: "hand:play", payload: { instanceId }, title: "冒名顶替", message: "选择这张牌本次视为哪张基础牌。", options };
    selectedPlayCardId = "";
    return render();
  }
  const targetPlays = legalPlays.filter((action) => Number.isInteger(action.payload?.targetSlotIndex));
  if (targetPlays.length && opponent) {
    const ids = targetPlays.flatMap((action) => {
      const targetSlotIndex = Number(action.payload?.targetSlotIndex);
      const slot = opponent.characterSlots[targetSlotIndex];
      if (!slot) return [];
      return "instanceId" in slot && slot.instanceId ? [slot.instanceId] : [`slot:${opponent.id}:${targetSlotIndex}`];
    });
    selectedPlayCardId = "";
    return beginLocalCardSelection({
      command: "hand:play", payload: { instanceId }, title: cardDefinition.name, message: "直接在对手角色区选择1张合法目标。",
      selectionKind: "target-slot", cardInstanceIds: ids, min: 1, max: 1,
    });
  }
  selectedPlayCardId = "";
  send("hand:play", { instanceId });
}

function runSelectedRoleAction(action: string, me: AutoPlayerView) {
  if (!snapshot || !selectedRoleInstanceId) return;
  if (action === "cancel") {
    selectedRoleInstanceId = "";
    return render();
  }
  if (action === "view") {
    detailCardInstanceId = selectedRoleInstanceId;
    detailOwnerId = me.id;
    return render();
  }
  const { card } = findCard(selectedRoleInstanceId, me.id);
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  if (action === "reveal") {
    const slotIndex = me.characterSlots.findIndex((slot) => slot && "instanceId" in slot && slot.instanceId === selectedRoleInstanceId);
    selectedRoleInstanceId = "";
    return send("character:reveal", { slotIndex });
  }
  if (action !== "skill") return;
  const legal = snapshot.game.legalActions?.find((candidate) => candidate.type === "skill:activate" && candidate.payload?.instanceId === selectedRoleInstanceId);
  const instanceId = selectedRoleInstanceId;
  if (legal?.selection) return beginLocalCardSelection({
    command: "skill:activate", payload: { instanceId }, title: `发动【${cardDefinition.skillName || cardDefinition.name}】`,
    message: `在己方角色区选择 ${legal.selection.min} 张角色支付休整费用。`, selectionKind: "cost",
    cardInstanceIds: legal.selection.cardInstanceIds, min: legal.selection.min, max: legal.selection.max,
  });
  if (cardDefinition.costText?.includes("休整自身/退场自身")) {
    selectedRoleInstanceId = "";
    localSelectionAction = {
      command: "skill:activate", payload: { instanceId }, title: `发动【${cardDefinition.skillName || cardDefinition.name}】`, message: "选择本次发动技能支付的费用。",
      options: [{ label: "休整自身", payload: { costMode: "rest" } }, { label: "退场自身", payload: { costMode: "retire" } }],
    };
    return render();
  }
  selectedRoleInstanceId = "";
  send("skill:activate", { instanceId });
}

function bindHoverPreviews() {
  const preview = root?.querySelector<HTMLElement>("#auto-hover-preview");
  if (!preview) return;
  const hide = () => { preview.hidden = true; preview.replaceChildren(); };
  root?.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => {
    const show = () => {
      const instanceId = button.dataset.autoCard || "";
      const { owner, card } = findCard(instanceId, button.dataset.owner);
      const cardDefinition = definition(card);
      const image = card && owner ? cardImage(card, owner) : undefined;
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
    button.addEventListener("mouseenter", show);
    button.addEventListener("mouseleave", hide);
    button.addEventListener("focus", show);
    button.addEventListener("blur", hide);
  });
}

function render() {
  if (!snapshot) return;
  if (app) app.dataset.phase = snapshot.game.started ? "game" : "lobby";
  if (snapshot.game.started) renderGame();
  else {
    root?.classList.remove("is-table-fit");
    renderLobby();
  }
}

function fitDesktopTable() {
  if (!root || !snapshot?.game.started) return;
  const desktop = window.matchMedia("(min-width: 761px)").matches;
  root.classList.toggle("is-table-fit", desktop);
  const stage = root.querySelector<HTMLElement>(".auto-game-stage");
  const table = root.querySelector<HTMLElement>(".auto-game");
  if (!desktop || !stage || !table) {
    table?.style.removeProperty("--auto-table-scale");
    return;
  }
  table.style.setProperty("--auto-table-scale", "1");
  window.requestAnimationFrame(() => {
    const scale = Math.min(1, stage.clientWidth / table.scrollWidth, stage.clientHeight / table.scrollHeight);
    table.style.setProperty("--auto-table-scale", String(Math.max(.1, scale)));
  });
}

function scheduleAutomaticActions() {
  clearTimeout(autoResponseTimer);
  clearTimeout(autoPhaseTimer);
  if (!snapshot || snapshot.you === "spectator" || snapshot.game.winnerId) return;
  const prompt = snapshot.game.prompt;
  if (prompt?.kind === "response" && prompt.playerId === snapshot.you
    && snapshot.game.legalHandCardIds.length === 0 && snapshot.game.legalSkillInstanceIds.length === 0) {
    const promptId = prompt.id;
    autoResponseTimer = window.setTimeout(() => {
      if (snapshot?.game.prompt?.id === promptId && snapshot.game.responsePlayerId === snapshot.you) send("response:pass");
    }, 2000);
    return;
  }
  if (!prompt && snapshot.game.currentPlayerId === snapshot.you && snapshot.game.stack.length === 0
    && ["preparation", "draw"].includes(snapshot.game.phase) && snapshot.game.canAutoAdvancePhase) {
    const revision = snapshot.revision;
    const phase = snapshot.game.phase;
    autoPhaseTimer = window.setTimeout(() => {
      if (snapshot?.revision === revision && snapshot.game.phase === phase && !snapshot.game.prompt) send("phase:advance");
    }, 650);
  }
}

function renderFatal(message: string) {
  if (root) root.innerHTML = `<section class="battle-loading hud-panel"><span class="battle-kicker">AUTO ROOM ERROR</span><h1>无法进入自动牌桌</h1><p>${escapeHtml(message)}</p><a href="/play" class="btn btn--primary">返回大厅</a></section>`;
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
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (detailCardInstanceId) {
    detailCardInstanceId = "";
    detailOwnerId = "";
    render();
  } else if (selectedPlayCardId) {
    selectedPlayCardId = "";
    render();
  }
});
window.addEventListener("beforeunload", () => {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
  clearTimeout(autoResponseTimer);
  clearTimeout(autoPhaseTimer);
  socket?.close();
});
window.addEventListener("resize", fitDesktopTable);
connect();
