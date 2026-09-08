import { test, expect, type WebSocketRoute } from "@playwright/test";

// Controlled transport exercises UI decisions and packet ordering independently of shuffled hands.
test("automatic decisions survive presence updates and out-of-order acknowledgements", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("qunyou-battle-profile-v1", JSON.stringify({ nickname: "交互测试" })));
  await page.route("**/auto/rooms/UXTEST/join", (route) => route.fulfill({ json: { ok: true } }));
  let channel: WebSocketRoute | undefined;
  const commands: any[] = [];
  await page.routeWebSocket("**/auto/rooms/UXTEST/connect?*", (socket) => {
    channel = socket;
    socket.onMessage((message) => commands.push(JSON.parse(String(message))));
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/play/auto/room?code=UXTEST");
  await page.addStyleTag({ content: "astro-dev-toolbar { display:none !important }" });
  await expect.poll(() => Boolean(channel)).toBe(true);
  const hand = Array.from({ length: 9 }, (_, index) => ({ instanceId: `hand-${index}`, definitionId: index === 0 ? "hand_basic_002" : "hand_basic_001", suit: index === 0 ? "红桃" : "黑桃", rank: String(index + 2) }));
  const player = (id: string) => ({ id, nickname: id === "p1" ? "交互测试" : "对手", connected: true, ready: true, health: 7, maxHealth: 7, hand: id === "p1" ? hand : [], handCount: id === "p1" ? hand.length : 5, characterSlots: [null, null, null, null], retired: [], markers: [], body: { instanceId: `body-${id}`, definitionId: "body_aggro_001" }, bodyState: { progress: 0, progressMax: 5, flipped: false, extraFormUsed: false, trackedCharacterInstanceIds: [] } });
  const state: any = { mode: "auto", roomCode: "UXTEST", you: "p1", revision: 1, players: [player("p1"), player("p2")], game: { started: true, currentPlayerId: "p1", turnNumber: 1, phase: "discard", handDeckCount: 30, handDiscard: [], resolving: [], stack: [], deployedThisPhase: 0, recentEvents: [], legalHandCardIds: hand.map((card) => card.instanceId), legalSkillInstanceIds: [], canAutoAdvancePhase: false, legalActions: [], legalBodyActionPlayerIds: [], skillCostRestReductionByCharacterId: {}, logs: [], prompt: { id: "discard-1", kind: "discard", playerId: "p1", title: "弃置手牌", message: "请选择 2 张手牌弃置。", min: 2, max: 2, cardInstanceIds: hand.map((card) => card.instanceId) } } };
  const publish = () => channel!.send(JSON.stringify({ type: "snapshot", snapshot: state }));
  publish();
  await expect(page).toHaveTitle(/自动对战/);
  await expect(page.locator('#auto-battle-app')).toHaveAttribute('data-phase', 'game');
  await page.locator('[data-auto-card="hand-7"]').click();
  await expect(page.locator('[data-submit-discard]')).toHaveText('确认弃牌 1/2');
  const scroll = await page.locator('.auto-hand__cards').evaluate((element) => element.scrollLeft);
  state.revision++;
  state.players[1].connected = false;
  publish();
  await expect(page.locator('.auto-player.is-opponent')).toContainText('暂离');
  await expect(page.locator('[data-auto-card="hand-7"]')).toHaveClass(/is-selected/);
  expect(await page.locator('.auto-hand__cards').evaluate((element) => element.scrollLeft)).toBeCloseTo(scroll, 0);
  await page.locator('[data-auto-card="hand-8"]').click();
  await expect(page.locator('[data-submit-discard]')).toBeEnabled();
  await page.locator('[data-submit-discard]').click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload.cardInstanceIds).toEqual(['hand-7', 'hand-8']);
  // An unsolicited snapshot while the command is pending must not cancel slow-network feedback.
  publish();
  await page.clock.runFor(2200);
  await expect(page.locator('.auto-action-pending')).toContainText('网络较慢');
  await page.clock.runFor(8000);
  await expect(page.locator('[data-auto-reconnect]')).toBeVisible();
  // The authoritative snapshot can arrive before its acknowledgement.
  state.revision++;
  state.game.phase = 'play';
  delete state.game.prompt;
  state.players[0].hand = hand.slice(0, 7);
  state.players[0].handCount = 7;
  state.game.legalHandCardIds = ['hand-1'];
  publish();
  channel!.send(JSON.stringify({ type: 'actionAck', actionId: commands[0].actionId, revision: state.revision }));
  await expect(page.locator('#auto-battle-app')).not.toHaveAttribute('data-action-pending', 'true');
  await expect(page.locator('.auto-action-pending')).toHaveCount(0);
  // A disabled response card opens its details; it must never offer an invalid confirmation.
  state.revision++;
  state.game.prompt = { id: 'response-1', kind: 'response', playerId: 'p1', title: '响应出刀', message: '打出闪避，或放弃响应。', cardInstanceIds: ['hand-0'], options: [{ value: 'pass', label: '放弃响应' }] };
  state.game.responsePlayerId = 'p1';
  state.game.legalHandCardIds = ['hand-0'];
  state.game.legalActions = [{ type: 'response:play', payload: { instanceId: 'hand-0' } }];
  publish();
  await page.locator('[data-auto-card="hand-1"]').click();
  await expect(page.locator('.auto-detail')).toBeVisible();
  await expect(page.locator('[data-confirm-play]')).toHaveCount(0);
  await page.locator('.auto-detail__close').click();
  await page.locator('[data-auto-card="hand-0"]').click();
  await expect(page.locator('[data-confirm-play]')).toHaveText('确认响应');
  await expect.poll(() => page.locator('[data-auto-card="hand-0"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/tcg-auto-response.png' });
  await page.locator('[data-confirm-play]').click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1].type).toBe('response:play');
  expect(commands[1].payload.instanceId).toBe('hand-0');
  expect(errors).toEqual([]);
});

async function flowTable(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.setItem('qunyou-battle-profile-v1', JSON.stringify({ nickname: '流程测试' })));
  await page.route('**/auto/rooms/FLOW01/join', (route) => route.fulfill({ json: { ok: true } }));
  let channel: WebSocketRoute | undefined;
  const commands: any[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/auto/rooms/FLOW01/connect?*', (socket) => { channel = socket; socket.onMessage((message) => commands.push(JSON.parse(String(message)))); });
  await page.goto('/play/auto/room?code=FLOW01');
  await page.addStyleTag({ content: 'astro-dev-toolbar { display:none !important }' });
  await expect.poll(() => Boolean(channel)).toBe(true);
  const hand = [
    { instanceId: 'strike', definitionId: 'hand_basic_001', suit: '黑桃', rank: '3' },
    { instanceId: 'target', definitionId: 'hand_trick_004', suit: '梅花', rank: '8' },
    { instanceId: 'joker', definitionId: 'hand_basic_004', joker: 'small' },
  ];
  const role = (instanceId: string, definitionId: string, ownerId: string) => ({ instanceId, definitionId, ownerId, faceDown: false });
  const player = (id: string) => ({ id, nickname: id === 'p1' ? '流程测试' : '对手', connected: true, health: 7, maxHealth: 7, hand: id === 'p1' ? hand : [], handCount: id === 'p1' ? 3 : 0, characterSlots: id === 'p1' ? [role('role-a', 'char_001_keke_assassin', id), role('role-b', 'char_002_weixiaokele_assassin', id), null, null] : [role('target-a', 'char_001_keke_assassin', id), role('target-b', 'char_002_weixiaokele_assassin', id), null, null], retired: [], markers: [], body: { instanceId: `body-${id}`, definitionId: 'body_aggro_001' }, bodyState: { progress: 0, progressMax: 5, flipped: false, extraFormUsed: false, trackedCharacterInstanceIds: [] } });
  const actions = [
    { type: 'hand:play', payload: { instanceId: 'strike' }, interaction: { quickPlay: true, label: '出刀' } },
    ...[0, 1].map((index) => ({ type: 'hand:play', payload: { instanceId: 'target', targetSlotIndex: index }, interaction: { quickPlay: true, target: { playerId: 'p2', slotIndex: index } } })),
    ...['hand_basic_001', 'hand_basic_003'].map((resolvedAs) => ({ type: 'hand:play', payload: { instanceId: 'joker', resolvedAs }, interaction: { quickPlay: false } })),
    { type: 'skill:activate', payload: { instanceId: 'role-a' }, selection: { kind: 'skill-cost', cardInstanceIds: ['role-a', 'role-b'], min: 1, max: 1 }, interaction: { label: '暗杀', cost: { kind: 'rest', amount: 1 } } },
  ];
  const state: any = { mode: 'auto', roomCode: 'FLOW01', you: 'p1', revision: 1, players: [player('p1'), player('p2')], game: { started: true, currentPlayerId: 'p1', turnNumber: 1, phase: 'play', handDeckCount: 30, handDiscard: [], resolving: [], stack: [], deployedThisPhase: 0, recentEvents: [], legalHandCardIds: hand.map((card) => card.instanceId), legalSkillInstanceIds: ['role-a'], canAutoAdvancePhase: false, legalActions: actions, legalBodyActionPlayerIds: [], skillCostRestReductionByCharacterId: {}, logs: [], unavailableReasons: { 'role-b': '本回合技能次数已用尽' } } };
  const publish = () => channel!.send(JSON.stringify({ type: 'snapshot', snapshot: state }));
  const ack = async () => {
    state.revision++;
    channel!.send(JSON.stringify({ type: 'actionAck', actionId: commands.at(-1).actionId, revision: state.revision }));
    publish();
    await expect(page.locator('#auto-battle-app')).not.toHaveAttribute('data-action-pending', 'true');
  };
  publish(); await expect(page.locator('.auto-hand')).toBeVisible();
  return { state, commands, errors, publish, ack, reconnect: () => channel!.close() };
}

test('unified targets, costs, back navigation, desktop quick gestures and keyboard guards', async ({ page }) => {
  const { state, commands, errors, publish, ack } = await flowTable(page);
  await expect(page.locator('[data-auto-quick-play]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-auto-card="target"]').click();
  await expect(page.locator('[data-local-selection-confirm]')).toBeDisabled();
  await expect(page.locator('[data-auto-card="target-a"]')).toHaveClass(/is-table-selectable/);
  await page.locator('[data-auto-card="target-b"]').click();
  await expect(page.locator('[data-local-selection-confirm]')).toBeEnabled();
  expect(commands).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-confirm-play]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-confirm-play]')).toHaveCount(0);

  await page.locator('[data-auto-card="role-a"]').click();
  await page.locator('[data-role-action="skill"]').click();
  await page.locator('[data-auto-card="role-b"]').click();
  await expect(page.locator('.auto-local-selection')).toContainText('休整 1 张角色：我方的刺客-微笑尅乐');
  await page.locator('[data-local-selection-cancel]').click();
  await expect(page.locator('[data-role-action="skill"]')).toBeVisible();
  await page.locator('[data-role-action="skill"]').click();
  await page.locator('[data-auto-card="role-b"]').click();
  // A changed cost pool must remove the old selection before it can be submitted.
  state.game.legalActions.find((action: any) => action.type === 'skill:activate').selection.cardInstanceIds = ['role-a'];
  state.revision++; publish();
  await expect(page.locator('[data-local-selection-confirm]')).toBeDisabled();
  await page.locator('[data-auto-card="role-a"]').click();
  await page.locator('[data-local-selection-confirm]').click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload.costCharacterIds).toEqual(['role-a']);
  await ack();

  await page.locator('[data-auto-card="joker"]').click();
  await page.locator('[data-local-option="0"]').click();
  await expect(page.locator('[data-local-selection-confirm]')).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-local-option="1"]')).toBeVisible();
  await page.locator('[data-local-selection-exit]').click();

  await page.locator('[data-auto-card="strike"]').click();
  await page.keyboard.down('Enter');
  await expect.poll(() => commands.length).toBe(2);
  await ack();
  await page.keyboard.down('Enter');
  expect(commands).toHaveLength(2);
  await page.keyboard.up('Enter');
  await page.locator('[data-auto-quick-play]').click();
  await expect(page.locator('[data-auto-quick-play]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-auto-card="strike"]').dblclick();
  await expect.poll(() => commands.length).toBe(3);
  await ack();
  await page.waitForTimeout(400); // The same physical gesture remains suppressed after a fast ACK.
  await page.locator('[data-auto-card="target"]').dragTo(page.locator('[data-target-player="p2"][data-target-slot="1"]'));
  await expect.poll(() => commands.length).toBe(4);
  expect(commands[3].payload.targetSlotIndex).toBe(1);
  await ack();
  await page.waitForTimeout(400);
  await page.locator('[data-auto-card="target"]').dragTo(page.locator('.auto-hand header'));
  expect(commands).toHaveLength(4);
  await page.waitForTimeout(400);
  await page.locator('[data-auto-card="joker"]').dblclick();
  expect(commands).toHaveLength(4);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('[data-auto-card="strike"]').click();
  await page.locator('.auto-hand header').click({ button: 'right' });
  await expect(page.locator('[data-confirm-play]')).toHaveCount(0);
  await page.locator('[data-auto-card="target"]').click();
  await page.locator('[data-auto-card="target-a"]').click();
  await expect(page.locator('#auto-target-layer line')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/tcg-flow-desktop.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.auto-game')).toHaveCSS('transform', 'none');
  const layout = await page.locator('.auto-game').boundingBox();
  expect(layout!.width).toBeLessThanOrEqual(1920);
  expect(errors).toEqual([]);
});

test('visual order editing preserves private choices, serializes order and guards text input', async ({ page }) => {
  const { state, commands, errors, publish } = await flowTable(page);
  state.revision++;
  state.game.phase = 'preparation';
  state.game.prompt = { id: 'order-1', kind: 'character-skill', playerId: 'p1', title: '鱼群预演', message: '整理牌序', cardInstanceIds: ['order-a', 'order-b', 'order-c'], selectableCards: [3, 4, 5].map((rank, i) => ({ instanceId: `order-${['a','b','c'][i]}`, definitionId: 'hand_basic_001', suit: '黑桃', rank: String(rank) })), context: { continuation: { step: 'prophet-order' } } };
  state.game.legalActions = [{ type: 'choice:submit', selection: { kind: 'order', cardInstanceIds: ['order-a','order-b','order-c'], min: 3, max: 3 } }];
  publish();
  await expect(page.getByRole('dialog', { name: '整理牌序' })).toBeVisible();
  await page.locator('[data-order-id="order-b"]').dragTo(page.locator('[data-order-zone="bottom"]'));
  await expect(page.locator('[data-order-zone="bottom"] [data-order-id="order-b"]')).toHaveCount(1);
  state.revision++; state.players[1].connected = false; publish();
  await expect(page.locator('[data-order-zone="bottom"] [data-order-id="order-b"]')).toHaveCount(1);
  await page.locator('[data-order-shift="order-c"][data-order-delta="-1"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.auto-order')).toBeVisible();
  await page.screenshot({ path: '/tmp/tcg-flow-order.png' });
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'keyboard-test'; document.querySelector('.auto-order')!.append(input); input.focus(); });
  await page.keyboard.press('Enter');
  expect(commands).toHaveLength(0);
  await page.evaluate(() => document.querySelector('#keyboard-test')!.remove());
  await page.locator('[data-submit-order]').click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0].payload).toEqual({ value: '3,1 | 2', promptId: 'order-1' });
  expect(errors).toEqual([]);
});

test('touch response and dying choices keep context and never use quick gestures', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const { state, commands, errors, publish, ack } = await flowTable(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('[data-auto-quick-play]')).toBeHidden();
    await page.locator('[data-auto-card="strike"]').dblclick();
    expect(commands).toHaveLength(0);
    state.game.prompt = { id: 'touch-response', kind: 'response', playerId: 'p1', title: '响应出刀', message: '打出闪避或放弃响应', cardInstanceIds: ['joker'], options: [{ value: 'pass', label: '放弃响应' }] };
    state.game.stack = [{ id: 'attack', kind: 'hand', definitionId: 'hand_basic_001', sourcePlayerId: 'p2' }];
    state.game.responsePlayerId = 'p1';
    state.game.legalHandCardIds = ['joker'];
    state.game.legalActions = [{ type: 'response:play', payload: { instanceId: 'joker', resolvedAs: 'hand_basic_002' } }, { type: 'response:pass' }];
    state.revision++; publish();
    await page.locator('[data-auto-card="joker"]').click();
    await expect(page.locator('.auto-response-context')).toContainText('对手');
    await expect(page.locator('.auto-response-context')).toContainText('出刀');
    await expect(page.locator('[data-confirm-play]')).toHaveText('确认响应');
    await page.locator('[data-cancel-play]').click();
    await expect(page.locator('[data-prompt-value="pass"]')).toBeVisible();
    expect(commands).toHaveLength(0);
    await page.locator('[data-auto-card="joker"]').click();
    await page.locator('[data-confirm-play]').click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].payload.resolvedAs).toBe('hand_basic_002');
    await ack();
    state.game.prompt = { id: 'dying', kind: 'dying', playerId: 'p1', title: '濒死', message: '使用急救或放弃', cardInstanceIds: ['joker'], options: [{ value: 'pass', label: '放弃急救' }] };
    state.game.legalActions = [{ type: 'choice:submit', payload: { instanceId: 'joker', value: 'aid' } }];
    state.revision++; publish();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-auto-card="joker"]').click();
    await expect(page.locator('[data-confirm-play]')).toHaveText('确认急救');
    expect(commands).toHaveLength(1);
    await page.locator('[data-confirm-play]').click();
    await expect.poll(() => commands.length).toBe(2);
    expect(commands[1].payload).toEqual({ instanceId: 'joker', value: 'aid', promptId: 'dying' });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('seat identity, public event feedback, responsive regions and spectator privacy', async ({ page }) => {
  const { state, publish, errors, reconnect } = await flowTable(page);
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    (window as any).seatAnimations = 0;
    Element.prototype.animate = function(...args: Parameters<typeof animate>) { (window as any).seatAnimations++; return animate.apply(this, args); };
  });
  state.game.recentEvents = [{id:'seat-first',type:'skill_used',sourcePlayerId:'p2'}]; state.revision++; publish();
  await expect.poll(()=>page.evaluate(()=>(window as any).seatAnimations)).toBe(1);
  state.revision++; publish();
  await expect(page.locator('.auto-table-event')).toContainText('技能');
  expect(await page.evaluate(()=>(window as any).seatAnimations)).toBe(1);
  reconnect();
  await expect(page.locator('#auto-connection')).toContainText('正在重连');
  await expect(page.locator('#auto-connection')).toContainText('已连接');
  state.revision++;publish();
  await expect(page.locator('.auto-hand')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).seatAnimations)).toBe(1);
  await page.locator('[data-auto-mobile-log-toggle]').click();
  await expect(page.locator('.auto-log')).toBeHidden();
  await page.locator('[data-auto-mobile-log-toggle]').click();
  await expect(page.locator('.auto-log')).toBeVisible();
  await page.setViewportSize({width:1100,height:800});
  await page.locator('[data-auto-mobile-log-toggle]').click();
  await expect(page.locator('.auto-log')).toHaveClass(/is-open/);
  await page.setViewportSize({width:1366,height:768});
  await expect(page.locator('.auto-log')).not.toHaveClass(/is-open/);
  await page.locator('[data-auto-card="strike"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-confirm-play]')).toHaveCount(0);
  state.players.forEach((player: any) => player.nickname = '同名玩家');
  state.game.currentPlayerId = 'p2';
  state.game.prompt = { id: 'response-seat', kind: 'response', playerId: 'p1', title: '响应', message: '请选择响应方式', options: [{ value: 'pass', label: '放弃响应' }] };
  state.game.responsePlayerId = 'p1';
  state.game.stack = [{ kind: 'hand', id: 'public', sourcePlayerId: 'p2', targetPlayerId: 'p1', definitionId: 'hand_basic_001' }];
  state.revision++; publish();
  await expect(page.locator('.is-self .auto-side-label')).toHaveText('我方');
  await expect(page.locator('.is-opponent .auto-turn-badge')).toHaveText('当前回合');
  await expect(page.locator('.auto-table-event')).toContainText('对手 → 我方');
  await expect(page.locator('.auto-table-event')).toContainText('等待你响应');
  for (const [width,height] of [[1920,1080],[1366,768],[1100,800],[390,844],[844,390],[320,640],[740,360]]) {
    await page.setViewportSize({width,height});
    const boxes = await page.locator('[data-auto-region="opponent"], [data-auto-region="event"], [data-auto-region="lower"], [data-auto-region="command"], [data-auto-region="hand"]').evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect(); return {y:r.y,bottom:r.bottom,right:r.right}; }));
    for(let i=1;i<boxes.length;i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i-1].bottom-1);
    expect(boxes.every(b=>b.right<=width)).toBe(true);
    await page.screenshot({path:`/tmp/tcg-seat-${width}.png`});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.addStyleTag({content: '#auto-battle-app { filter: grayscale(1); }'});
  await page.screenshot({path:'/tmp/tcg-seat-grayscale.png'});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  state.game.prompt = undefined; state.game.stack = []; state.game.responsePlayerId = undefined;
  state.game.recentEvents = [{id:'new-event', type:'skill_used', sourcePlayerId:'p2', characterDefinitionId:'hidden-definition'}];
  state.revision++; publish();
  await expect(page.locator('.auto-table-event')).not.toContainText('hidden-definition');
  expect(await page.locator('[data-player-id]').evaluateAll(els=>els.reduce((n,e)=>n+e.getAnimations().length,0))).toBe(0);
  state.you='spectator'; state.game.legalActions=[]; state.game.legalHandCardIds=[]; state.game.legalSkillInstanceIds=[];
  state.players.forEach((p:any)=>{p.hand=[];p.characterSlots=[{faceDown:true,ownerId:p.id,slotIndex:0},null,null,null];});
  state.revision++;publish();
  await expect(page.locator('[data-auto-region="opponent"] .auto-side-label')).toHaveText('玩家 A');
  await expect(page.locator('[data-auto-region="lower"] .auto-side-label')).toHaveText('玩家 B');
  await expect(page.locator('.auto-hand')).toHaveCount(0);
  await expect(page.locator('.auto-slot').first()).not.toContainText('刺客');
  expect(errors).toEqual([]);
});

test('original health, Mega and Z artwork stays visible with its animations', async ({ page }) => {
  const { state, publish } = await flowTable(page);
  const zBody = await page.evaluate(() => Object.values(JSON.parse(document.querySelector('#auto-battle-catalog')!.textContent!).cards).find((card: any) => card.kind === 'body' && card.extraFormType === 'z-move') as any);
  expect(zBody).toBeTruthy();
  state.players[1].body.definitionId = zBody.id;
  state.players[1].bodyState.progressMax = 5;
  state.revision++; publish();
  for (const [width,height] of [[1366,768],[390,844],[320,640],[844,390]]) {
    await page.setViewportSize({width,height});
    for (const icons of ['.auto-health-counter__icons','.auto-progress-counter__icons']) {
      for (const row of await page.locator(icons).all()) {
        await expect(row).toBeVisible();
        expect(await row.locator('img').evaluateAll(imgs => imgs.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
      }
    }
    if (width < height) {
      const seats = await page.locator('.auto-player').evaluateAll(els => els.map(el => ({height:el.getBoundingClientRect().height, content:el.querySelector('.auto-player__field')!.getBoundingClientRect().bottom - el.getBoundingClientRect().top})));
      for(const seat of seats) expect(seat.height-seat.content).toBeLessThan(18);
    }
    await page.screenshot({path:`/tmp/tcg-crystals-${width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  state.players[0].health = 1;
  state.players[0].bodyState.progress = 4;
  state.revision++;publish();
  await expect(page.locator('.is-self .auto-health-counter')).toHaveClass(/is-damage/);
  await expect(page.locator('.is-self .auto-progress-counter')).toHaveClass(/is-progressing/);
  await expect(page.locator('.is-self .auto-health-counter__icon.is-pulsing')).toHaveCSS('animation-name','auto-counter-pulse');
  await page.screenshot({path:'/tmp/tcg-crystals-low-health.png'});
  state.players[0].health = 4;
  state.revision++;publish();
  await expect(page.locator('.is-self .auto-health-counter')).toHaveClass(/is-heal/);
  state.players[0].bodyState.flipped = true;
  state.revision++;publish();
  await expect(page.locator('.auto-body-cinematic')).toContainText('Mega 进化');
  await expect(page.locator('.auto-body-cinematic')).toHaveCount(0);
  state.players[1].bodyState.flipped = true;
  state.revision++;publish();
  await expect(page.locator('.auto-body-cinematic')).toContainText('Z 招式就绪');
  await expect(page.locator('.is-opponent .auto-progress-counter__icon.is-ready')).toHaveCount(5);
  await expect(page.locator('.auto-body-cinematic')).toHaveCount(0);
  state.players[1].bodyState.extraFormUsed = true;
  state.revision++;publish();
  await expect(page.locator('.auto-body-cinematic')).toContainText('Z 招式发动');
});

test('explanations preserve drafts, show ownership and yield to new decisions', async ({ page }) => {
  const { state, commands, errors, publish } = await flowTable(page);
  state.game.legalActions.find((a: any) => a.type === 'skill:activate').interaction.targetTiming = 'resolution';
  state.game.legalActions.find((a: any) => a.type === 'skill:activate').interaction.effectText = '正式效果长文本。'.repeat(120) + '效果结束。';
  state.game.skillBlockers = { 'role-b': { code: 'usage', message: '本回合发动次数已用尽' } };
  state.game.recentEvents = [{ id: 'explain-1', type: 'cards_drawn', sourcePlayerId: 'p1', targetPlayerId: 'p1', amount: 1, cause: { kind: 'rest-reward', sourcePlayerId: 'p1' } }];
  state.revision++; publish();
  await expect(page.locator('.auto-table-event')).toContainText('我方摸 1 张牌 · 休整发动者的收益');
  await expect(page.locator('[data-auto-card="role-b"]')).toContainText('次数已用尽');
  await expect(page.locator('.is-opponent .auto-card__availability')).toHaveCount(0);
  await page.locator('[data-auto-card="role-a"]').click();
  await page.locator('[data-role-action="skill"]').click();
  await page.locator('[data-auto-card="role-b"]').click();
  await expect(page.locator('.auto-confirmation-preview')).toContainText('我方的刺客-柯柯');
  await expect(page.locator('.auto-confirmation-preview')).toContainText('我方的刺客-微笑尅乐');
  await page.locator('[data-explain="preview"]').click();
  await expect(page.getByRole('dialog', { name: '提交详情', exact: true })).toBeVisible();
  await expect(page.locator('.auto-explanation')).toContainText('效果结束。');
  expect(await page.locator('.auto-explanation article').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.keyboard.press('Enter');
  expect(commands).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-explain="preview"]')).toBeFocused();
  await expect(page.locator('[data-auto-card="role-b"]')).toHaveClass(/is-selected/);
  for (const [width, height] of [[1920,1080],[1366,768],[900,700],[390,844],[844,390],[320,640],[740,360]]) {
    await page.setViewportSize({ width, height });
    await page.locator('[data-explain="event"]').click();
    await expect(page.getByRole('dialog', { name: '近期事件详情', exact: true })).toContainText('休整发动者的收益');
    const box = await page.locator('.auto-explanation article').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-local-selection-confirm]')).toBeEnabled();
    const confirm = await page.locator('[data-local-selection-confirm]').boundingBox();
    const command = await page.locator('.auto-command-center').boundingBox();
    const hand = await page.locator('.auto-hand').boundingBox();
    expect(confirm!.y).toBeGreaterThanOrEqual(command!.y);
    expect(confirm!.y + confirm!.height).toBeLessThanOrEqual(Math.min(command!.y + command!.height, hand!.y) + 1);
    expect(hand!.y + hand!.height).toBeLessThanOrEqual(height + 1);
    const summary = await page.locator('.auto-confirmation-preview > span').boundingBox();
    expect(summary!.y + summary!.height).toBeLessThanOrEqual(command!.y + command!.height + 1);
    if (width <= 844) {
      const card = await page.locator('.auto-hand__cards .auto-card').first().boundingBox();
      expect(card!.height).toBeGreaterThanOrEqual(44);
      expect(card!.y + card!.height).toBeLessThanOrEqual(height + 1);
    }
    await page.screenshot({ path: `/tmp/tcg-explanations-${width}.png` });
  }
  const skill = state.game.legalActions.find((a: any) => a.type === 'skill:activate');
  skill.selection.min = skill.selection.max = 2;
  skill.interaction.cost.amount = 2;
  state.revision++; publish();
  await expect(page.locator('.auto-confirmation-preview')).toContainText('还需选择 1 个费用承担者');
  await expect(page.locator('[data-local-selection-confirm]')).toBeDisabled();
  skill.selection.min = skill.selection.max = 0;
  skill.interaction.cost = { kind: 'none' };
  state.revision++; publish();
  await expect(page.locator('.auto-confirmation-preview')).toContainText('无额外费用');
  await expect(page.locator('[data-auto-card="role-b"]')).not.toHaveClass(/is-selected/);
  await page.locator('[data-explain="preview"]').click();
  state.game.legalActions = state.game.legalActions.filter((a: any) => a.type !== 'skill:activate');
  state.game.legalSkillInstanceIds = [];
  state.revision++; publish();
  await expect(page.locator('.auto-explanation')).toHaveCount(0);
  await expect(page.locator('[data-local-selection-confirm]')).toHaveCount(0);
  await page.locator('[data-explain="event"]').click();
  state.revision++;
  state.game.prompt = { id: 'new-response', kind: 'response', playerId: 'p1', title: '响应出刀', message: '请选择响应', options: [{ value: 'pass', label: '放弃响应' }] };
  state.game.responsePlayerId = 'p1'; publish();
  await expect(page.locator('.auto-explanation')).toHaveCount(0);
  await expect(page.locator('.auto-table-event')).toContainText('响应出刀');
  expect(commands).toHaveLength(0); expect(errors).toEqual([]);
});
