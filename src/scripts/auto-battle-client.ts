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
  options?: Array<{ value: string; label: string }>;
  context?: Record<string, unknown>;
};

type AutoSnapshot = {
  mode: "auto";
  roomCode: string;
  you: string;
  revision: number;
  players: Array<PlayerView & { maxHealth?: number }>;
  game: {
    started: boolean;
    currentPlayerId?: string;
    firstPlayerId?: string;
    turnNumber: number;
    phase: "preparation" | "draw" | "play" | "deployment" | "discard" | "end";
    handDeckCount: number;
    handDiscard: CardView[];
    resolving: CardView[];
    stack: Array<{ id: string; definitionId: string; resolvedAs?: string; sourcePlayerId: string; cancelled?: boolean }>;
    prompt?: AutoPrompt;
    responsePlayerId?: string;
    winnerId?: string;
    deployedThisPhase: number;
    recentEvents: Array<{ id: string; type: string; sourcePlayerId?: string; targetPlayerId?: string }>;
    legalHandCardIds: string[];
    legalSkillInstanceIds: string[];
    logs: Array<{ id: string; text: string; actorId?: string }>;
  };
  isSpectator?: boolean;
};

type ServerMessage =
  | { type: "snapshot"; snapshot: AutoSnapshot }
  | { type: "actionAck"; actionId: string; revision: number }
  | { type: "error"; error: string; actionId?: string }
  | { type: "roomEnded"; reason?: string };

const root = document.querySelector<HTMLElement>("#auto-battle-root");
const app = document.querySelector<HTMLElement>("#auto-battle-app");
const connection = document.querySelector<HTMLElement>("#auto-connection");
const roomCodeElement = document.querySelector<HTMLElement>("#auto-room-code");
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
const selectedDiscard = new Set<string>();

if (roomCodeElement) roomCodeElement.textContent = roomCode || "------";

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>("#auto-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function setConnection(label: string, state: string) {
  if (!connection) return;
  const text = connection.querySelector("b");
  if (text) text.textContent = label;
  connection.dataset.state = state;
}

function loadout() {
  const deckId = typeof pending.deckId === "string" && (pending.deckId === "custom" || catalog.decks.some((deck) => deck.id === pending.deckId))
    ? pending.deckId
    : catalog.decks[0]?.id || "";
  return { deckId, ...(deckId === "custom" && pending.customDeck ? { customDeck: pending.customDeck } : {}) };
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
    snapshot = message.snapshot;
    selectedDiscard.clear();
    render();
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

function send(type: string, payload: Record<string, unknown> = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !snapshot) return showToast("牌桌尚未连接。");
  socket.send(JSON.stringify({ type, payload, actionId: crypto.randomUUID(), protocolVersion: 2, baseRevision: snapshot.revision }));
}

function definition(card?: CardView) {
  return card?.definitionId ? catalog.cards[card.definitionId] : undefined;
}

function cardImage(card: CardView) {
  const cardDefinition = definition(card);
  if (!cardDefinition) return undefined;
  if (cardDefinition.kind === "hand") return handCardImagePath(cardDefinition.id, card.suit, card.rank, card.joker);
  return cardDefinition.imagePath;
}

function renderCard(card: CardView, owner: PlayerView, zone: string, interactive: boolean, disabledReason = "") {
  const cardDefinition = definition(card);
  if (!cardDefinition) return `<div class="auto-card auto-card--back"><span>暗置</span></div>`;
  const image = cardImage(card);
  const identity = handCardIdentityLabel(card.suit, card.rank, card.joker);
  const title = disabledReason ? `${cardDefinition.text}\n当前不可用：${disabledReason}` : cardDefinition.text;
  return `<button type="button" class="auto-card auto-card--${cardDefinition.kind} ${interactive ? "is-legal" : ""}" data-auto-card="${card.instanceId || ""}" data-owner="${owner.id}" data-zone="${zone}" ${interactive ? "" : "disabled"} title="${escapeHtml(title)}">
    ${image ? `<img src="${image}" alt="" />` : ""}${cardDefinition.kind === "character" && cardDefinition.automationLevel ? `<span class="auto-card__automation">${cardDefinition.automationLevel === "full" ? "自动" : "辅助"}</span>` : ""}<strong>${escapeHtml(cardDefinition.name)}</strong><small>${escapeHtml(identity || cardDefinition.subtitle)}</small>
  </button>`;
}

function renderPlayer(player: PlayerView & { maxHealth?: number }, isMe: boolean) {
  const game = snapshot?.game;
  const current = game?.currentPlayerId === player.id;
  const slots = player.characterSlots.map((slot, index) => {
    if (!slot) return `<button class="auto-slot auto-slot--empty" data-empty-slot="${index}" disabled>空位 ${index + 1}</button>`;
    if (!("instanceId" in slot) || !slot.instanceId) return `<div class="auto-slot auto-card--back"><span>暗置角色</span></div>`;
    const canReveal = Boolean(isMe && slot.faceDown && game?.currentPlayerId === snapshot?.you && game?.phase === "deployment" && !game.prompt);
    const canUseSkill = Boolean(isMe && slot.instanceId && game?.legalSkillInstanceIds.includes(slot.instanceId));
    return `<div class="auto-slot">${renderCard(slot, player, `slot:${index}`, canReveal || canUseSkill, canReveal ? "" : canUseSkill ? "" : "当前不满足技能时机")}</div>`;
  }).join("");
  return `<section class="auto-player ${current ? "is-current" : ""} ${isMe ? "is-self" : "is-opponent"}">
    <header><div><span>${isMe ? "己方" : "对手"} · ${player.connected ? "在线" : "暂离"}</span><h2>${escapeHtml(player.nickname)}</h2></div><strong class="auto-health">命晶 ${player.health ?? 0} / ${player.maxHealth ?? 7}</strong><em>手牌 ${player.handCount ?? player.hand.length}</em></header>
    <div class="auto-player__field">${player.body ? `<div class="auto-body-card">${renderCard(player.body, player, "body", false)}</div>` : ""}<div class="auto-slots">${slots}</div></div>
  </section>`;
}

function renderLobby() {
  if (!snapshot || !root) return;
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = snapshot.players.find((player) => player.id !== snapshot?.you);
  const deckOptions = catalog.decks.map((deck) => `<option value="${deck.id}" ${deck.id === me?.deckId ? "selected" : ""}>${escapeHtml(deck.name)} · ${escapeHtml(deck.archetype)}</option>`).join("");
  root.innerHTML = `<section class="auto-lobby hud-panel">
    <span class="battle-kicker">AUTO BATTLE BETA</span><h1>自动对战准备室</h1>
    <p>房间 ${escapeHtml(snapshot.roomCode)} · 基础规则与54张手牌自动结算</p>
    <div class="auto-lobby__seats"><article><strong>${escapeHtml(me?.nickname || "你的座位")}</strong><small>${me?.ready ? "已准备" : "未准备"}</small></article><article><strong>${escapeHtml(opponent?.nickname || "等待对手")}</strong><small>${opponent?.ready ? "已准备" : opponent ? "未准备" : "邀请对手加入"}</small></article></div>
    ${snapshot.you === "spectator" ? "" : `<label>选择预组<select id="auto-deck-select">${deckOptions}</select></label><button class="btn btn--primary" data-auto-command="ready">${me?.ready ? "取消准备" : "确认准备"}</button>`}
  </section>`;
  root.querySelector<HTMLSelectElement>("#auto-deck-select")?.addEventListener("change", (event) => send("player:selectDeck", { deckId: (event.currentTarget as HTMLSelectElement).value }));
  root.querySelector("[data-auto-command=ready]")?.addEventListener("click", () => send("player:ready", { ready: !me?.ready }));
}

function renderPrompt(prompt: AutoPrompt | undefined, me?: PlayerView) {
  if (!prompt) return "";
  const mine = prompt.playerId === snapshot?.you;
  const allowedCards = new Set(prompt.cardInstanceIds || []);
  const cards = mine && me ? me.hand.filter((card) => card.instanceId && allowedCards.has(card.instanceId)).map((card) => renderCard(card, me, "prompt", true)).join("") : "";
  const inspectedCard = mine && me && prompt.kind === "reveal-choice" && prompt.context?.inspectedCard
    ? renderCard(prompt.context.inspectedCard as CardView, me, "inspection", false)
    : "";
  const options = mine ? (prompt.options || []).map((option) => `<button class="btn btn--secondary" ${prompt.kind === "assisted-skill" ? `data-assisted-action="${escapeHtml(option.value)}"` : `data-prompt-value="${escapeHtml(option.value)}"`}>${escapeHtml(option.label)}</button>`).join("") : "";
  return `<aside class="auto-prompt ${mine ? "is-mine" : ""}"><span>${mine ? "需要你的操作" : "等待对手"}</span><h3>${escapeHtml(prompt.title)}</h3><p>${escapeHtml(prompt.message)}</p>${inspectedCard ? `<div class="auto-prompt__inspection">${inspectedCard}</div>` : ""}${cards ? `<div class="auto-prompt__cards">${cards}</div>` : ""}<div class="auto-prompt__actions">${options}</div>${prompt.kind === "discard" && mine ? `<button class="btn btn--primary" data-submit-discard disabled>确认弃牌</button>` : ""}${prompt.kind === "assisted-skill" && mine ? `<button class="btn btn--primary" data-assisted-finish>完成技能结算</button>` : ""}</aside>`;
}

function renderGame() {
  if (!snapshot || !root) return;
  const me = snapshot.players.find((player) => player.id === snapshot?.you);
  const opponent = snapshot.players.find((player) => player.id !== snapshot?.you);
  const phaseLabels = { preparation: "准备", draw: "摸牌", play: "出牌", deployment: "布阵", discard: "弃牌", end: "结束" };
  const isMyTurn = snapshot.game.currentPlayerId === snapshot.you;
  const canAdvance = isMyTurn && !snapshot.game.prompt && snapshot.game.stack.length === 0 && !snapshot.game.winnerId;
  const hand = me?.hand.map((card) => {
    const legality = handLegality(card);
    return renderCard(card, me, "hand", legality.allowed, legality.reason);
  }).join("") || "";
  const stack = snapshot.game.stack.map((item) => `<li class="${item.cancelled ? "is-cancelled" : ""}">【${escapeHtml(catalog.cards[item.resolvedAs || item.definitionId]?.name || item.definitionId)}】</li>`).reverse().join("");
  const logs = snapshot.game.logs.slice(-12).reverse().map((log) => `<li>${escapeHtml(log.text)}</li>`).join("");
  const recentEvent = snapshot.game.recentEvents.at(-1);
  root.innerHTML = `<div class="auto-game" data-phase="${snapshot.game.phase}">
    ${opponent ? renderPlayer(opponent, false) : ""}
    <section class="auto-command-center">
      <div class="auto-phase"><span>第 ${snapshot.game.turnNumber} 回合</span><strong>${phaseLabels[snapshot.game.phase]}阶段</strong><small>${isMyTurn ? "你的回合" : "对手回合"}${recentEvent ? ` · ${escapeHtml(eventLabel(recentEvent.type))}` : ""}</small></div>
      <button class="btn btn--primary" data-phase-advance ${canAdvance ? "" : "disabled"}>进入下一阶段</button>
      ${snapshot.game.phase === "deployment" && isMyTurn ? `<button class="btn btn--secondary" data-deploy ${snapshot.game.deployedThisPhase >= 2 ? "disabled" : ""}>上阵角色（${snapshot.game.deployedThisPhase}/2）</button>` : ""}
      <div class="auto-stack"><span>结算栈 ${snapshot.game.stack.length}</span><ol>${stack || "<li>当前为空</li>"}</ol></div>
      ${renderPrompt(snapshot.game.prompt, me)}
      ${snapshot.game.winnerId ? `<div class="auto-winner"><strong>${snapshot.game.winnerId === snapshot.you ? "你获胜了" : "对手获胜"}</strong><a href="/play" class="btn btn--primary">返回大厅</a></div>` : ""}
    </section>
    ${me ? renderPlayer(me, true) : ""}
    <section class="auto-hand"><header><strong>我的手牌</strong><span>${me?.hand.length || 0} 张 · 牌堆 ${snapshot.game.handDeckCount} · 弃牌 ${snapshot.game.handDiscard.length}</span></header><div>${hand || "<p>没有手牌</p>"}</div></section>
    <aside class="auto-log"><header>公开日志</header><ol>${logs}</ol></aside>
  </div>`;
  bindGameActions(me, opponent);
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

function bindGameActions(me?: PlayerView, opponent?: PlayerView) {
  if (!root || !snapshot || !me) return;
  root.querySelector("[data-phase-advance]")?.addEventListener("click", () => send("phase:advance"));
  root.querySelector("[data-deploy]")?.addEventListener("click", () => send("character:deploy"));
  root.querySelectorAll<HTMLButtonElement>("[data-auto-card]").forEach((button) => button.addEventListener("click", () => handleCard(button, me, opponent)));
  root.querySelectorAll<HTMLButtonElement>("[data-prompt-value]").forEach((button) => button.addEventListener("click", () => send("choice:submit", { value: button.dataset.promptValue })));
  root.querySelectorAll<HTMLButtonElement>("[data-assisted-action]").forEach((button) => button.addEventListener("click", () => runAssistedAction(button.dataset.assistedAction || "", me, opponent)));
  root.querySelector("[data-submit-discard]")?.addEventListener("click", () => send("choice:submit", { cardInstanceIds: [...selectedDiscard] }));
  root.querySelector("[data-assisted-finish]")?.addEventListener("click", () => send("assisted:finish"));
}

function runAssistedAction(action: string, me: PlayerView, opponent?: PlayerView) {
  const targetChoice = window.prompt("目标玩家：输入 自己 或 对手", "自己");
  const target = targetChoice === "对手" ? opponent : me;
  if (!target) return;
  const amount = Number(window.prompt("数量（1-3）", "1"));
  const payload: Record<string, unknown> = { action, playerId: target.id, amount: Number.isFinite(amount) ? amount : 1 };
  if (action === "marker") payload.label = window.prompt("标记名称", "技能标记") || "技能标记";
  if (action === "move") {
    payload.slotIndex = Number(window.prompt("角色位（1-4）", "1")) - 1;
    payload.operation = window.prompt("输入 rest 休整或 retire 退场", "rest") || "rest";
  }
  send("assisted:action", payload);
}

function handleCard(button: HTMLButtonElement, me: PlayerView, opponent?: PlayerView) {
  if (!snapshot) return;
  const instanceId = button.dataset.autoCard || "";
  const zone = button.dataset.zone || "";
  const card = me.hand.find((item) => item.instanceId === instanceId) || me.characterSlots.find((item) => item && "instanceId" in item && item.instanceId === instanceId) as CardView | undefined;
  const cardDefinition = definition(card);
  if (!card || !cardDefinition) return;
  const prompt = snapshot.game.prompt;
  if (prompt?.kind === "discard") {
    if (selectedDiscard.has(instanceId)) selectedDiscard.delete(instanceId); else selectedDiscard.add(instanceId);
    button.classList.toggle("is-selected", selectedDiscard.has(instanceId));
    const submit = root?.querySelector<HTMLButtonElement>("[data-submit-discard]");
    if (submit) submit.disabled = selectedDiscard.size !== prompt.min;
    return;
  }
  if (prompt?.kind === "dying") return send("choice:submit", { instanceId, value: "aid" });
  if ((prompt?.kind as string) === "recall") return send("choice:submit", { instanceId, value: "recall" });
  if (prompt?.kind === "response") {
    return send("response:play", { instanceId, ...(cardDefinition.id === "hand_basic_004" ? { resolvedAs: "hand_basic_002" } : {}) });
  }
  if (prompt?.kind === "assisted-skill") return;
  if (zone.startsWith("slot:")) {
    const slotIndex = Number(zone.split(":")[1]);
    if (snapshot.game.phase === "deployment" && snapshot.game.currentPlayerId === snapshot.you && card.faceDown) return send("character:reveal", { slotIndex });
    if (snapshot.game.prompt?.kind === "response" || ["play", "preparation", "deployment"].includes(snapshot.game.phase)) {
      const cost = skillCostPayload(cardDefinition.costText || "", me, card);
      if (cost === undefined) return;
      return send("skill:activate", { instanceId, ...cost });
    }
    return;
  }
  let resolvedAs: string | undefined;
  if (cardDefinition.id === "hand_basic_004") {
    const choice = window.prompt("冒名顶替：输入 出刀、闪避 或 急救", "出刀");
    resolvedAs = ({ "出刀": "hand_basic_001", "闪避": "hand_basic_002", "急救": "hand_basic_003" } as Record<string, string>)[choice || ""];
    if (!resolvedAs) return;
  }
  let targetSlotIndex: number | undefined;
  if (["hand_trick_004", "hand_trick_007"].includes(cardDefinition.id)) {
    const value = Number(window.prompt("选择对手角色位（1-4）", "1"));
    if (!Number.isInteger(value) || value < 1 || value > 4 || !opponent) return;
    targetSlotIndex = value - 1;
  }
  send("hand:play", { instanceId, resolvedAs, targetSlotIndex });
}

function skillCostPayload(costText: string, player: PlayerView, role: CardView) {
  if (costText.includes("休整自身/退场自身")) {
    const choice = window.prompt("选择技能费用：输入 休整 或 退场", "休整");
    if (!choice || !["休整", "退场"].includes(choice)) return undefined;
    return { costMode: choice === "退场" ? "retire" : "rest", costCharacterIds: choice === "休整" ? [role.instanceId] : [] };
  }
  if (costText.includes("休整自身")) return { costCharacterIds: [role.instanceId] };
  if (costText.includes("同等费用")) return { costCharacterIds: [] };
  const match = costText.match(/休整\s*(\d+)/);
  if (!match) return { costCharacterIds: [] };
  const amount = Number(match[1]);
  const answer = window.prompt(`选择 ${amount} 张休整角色的角色位，以逗号分隔（1-4）`, "1");
  if (!answer) return undefined;
  const ids = answer.split(/[,，\s]+/).map(Number).map((index) => player.characterSlots[index - 1]).filter((slot): slot is CardView => Boolean(slot && "instanceId" in slot && slot.instanceId)).map((slot) => slot.instanceId as string);
  return ids.length === amount ? { costCharacterIds: ids } : undefined;
}

function render() {
  if (!snapshot) return;
  if (app) app.dataset.phase = snapshot.game.started ? "game" : "lobby";
  if (snapshot.game.started) renderGame(); else renderLobby();
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
window.addEventListener("beforeunload", () => { shouldReconnect = false; clearTimeout(reconnectTimer); socket?.close(); });
connect();
