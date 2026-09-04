import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const COACH_KEY = "qunyou-battle-coach-v1";

function watchAutoSnapshots(page: Page) {
  let latest: { revision: number; you: string; game: { phase: string; currentPlayerId: string; canAutoAdvancePhase: boolean; prompt?: { playerId: string } } } | undefined;
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.type === "snapshot" && message.snapshot.mode === "auto") latest = message.snapshot; } catch { /* Non-JSON control frames. */ }
  }));
  return () => latest;
}

async function reachAutoPlay(host: Page, guest: Page, state: ReturnType<typeof watchAutoSnapshots>) {
  for (let i = 0; i < 12 && state()?.game.phase !== "play"; i++) {
    const before = state()!;
    if (!before.game.canAutoAdvancePhase || before.game.prompt) {
      const actorId = before.game.prompt?.playerId || before.game.currentPlayerId;
      const actor = actorId === before.you ? host : guest;
      if (before.game.prompt) await actor.locator('.auto-prompt.is-mine [data-prompt-value="pass"]').click();
      else await actor.locator("[data-phase-advance]").click();
    }
    await expect.poll(() => state()?.revision || 0).toBeGreaterThan(before.revision);
  }
  await expect(host.locator(".auto-phase strong")).toHaveText("出牌阶段");
}

function observePage(page: Page, label: string, entries: string[]) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      entries.push(`[${label}] console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => entries.push(`[${label}] pageerror: ${error.stack || error.message}`));
}

async function skipCoach(context: BrowserContext) {
  await context.addInitScript((key) => localStorage.setItem(key, "1"), COACH_KEY);
}

async function setProfile(page: Page, nickname: string) {
  await page.goto("/play");
  const dialog = page.locator("#battle-profile-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="nickname"]').fill(nickname);
  await dialog.getByRole("button", { name: "进入大厅" }).click();
  await expect(page.locator("[data-profile-name]")).toHaveText(nickname);
}

async function waitForRoom(page: Page, phase: "lobby" | "game") {
  await expect(page.locator("#battle-app")).toHaveAttribute("data-phase", phase);
  await expect(page.locator("#battle-connection")).toHaveAttribute("data-state", "open");
}

async function attachConsole(testInfo: TestInfo, entries: string[]) {
  await testInfo.attach("browser-console", {
    body: Buffer.from(entries.length ? entries.join("\n") : "No browser console warnings or errors."),
    contentType: "text/plain",
  });
}

test("two players can start, reconnect, declare, manage markers and spectate", async ({ browser }, testInfo) => {
  const consoleEntries: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const spectatorContext = await browser.newContext();
  await Promise.all([skipCoach(hostContext), skipCoach(guestContext), skipCoach(spectatorContext)]);

  try {
    let hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const spectatorPage = await spectatorContext.newPage();
    observePage(hostPage, "host", consoleEntries);
    observePage(guestPage, "guest", consoleEntries);
    observePage(spectatorPage, "spectator", consoleEntries);

    await setProfile(hostPage, "E2E-房主");
    await hostPage.locator("#battle-create-room").click();
    await hostPage.locator('[data-create-mode="classic"]').click();
    await hostPage.waitForURL(/\/play\/room\?code=[A-Z0-9]{6}/);
    const roomUrl = hostPage.url();
    const roomCode = new URL(roomUrl).searchParams.get("code");
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await waitForRoom(hostPage, "lobby");
    await hostPage.locator("#battle-deck-mode").selectOption("custom");
    await hostPage.locator("[data-custom-open-editor]").click();
    await expect(hostPage.locator("#battle-dialog [data-custom-character]")).toHaveCount(120);
    await expect(hostPage.locator("#battle-dialog [data-custom-body-option]")).toHaveCount(12);
    await hostPage.locator("#battle-dialog [data-dialog-cancel]").click();
    await hostPage.locator("#battle-deck-mode").selectOption("preset");
    await hostPage.locator("#battle-deck-select").selectOption("deck_aggro_001");

    await setProfile(guestPage, "E2E-对手");
    await guestPage.goto(`/play?room=${roomCode}`);
    const roomCard = guestPage.locator(`[data-room-action][data-room-code="${roomCode}"]`);
    await expect(roomCard).toBeVisible();
    await roomCard.click();
    await guestPage.waitForURL(new RegExp(`/play/room\\?code=${roomCode}`));
    await Promise.all([waitForRoom(hostPage, "lobby"), waitForRoom(guestPage, "lobby")]);
    await expect(hostPage.getByText("2 / 2 玩家已加入")).toBeVisible();

    await guestPage.locator('[data-command="player:ready"]').click();
    await hostPage.locator('[data-command="player:ready"]').click();
    await Promise.all([waitForRoom(hostPage, "game"), waitForRoom(guestPage, "game")]);

    await hostPage.close();
    hostPage = await hostContext.newPage();
    observePage(hostPage, "host-reconnected", consoleEntries);
    await hostPage.goto(roomUrl);
    await waitForRoom(hostPage, "game");
    await expect(hostPage.locator('[data-marker-rack-owner="p1"]:visible').first()).toBeVisible();

    const declarations = [
      { category: "suit", value: "黑桃", expected: "花色【黑桃】" },
      { category: "rank", value: "A", expected: "点数【A】" },
      { category: "face", value: "正面", expected: "正反面【正面】" },
      { category: "characterRole", value: "强攻", expected: "角色类型【强攻】" },
      { category: "handCard", value: "hand_basic_001", expected: "手牌【出刀】" },
    ];
    for (const declaration of declarations) {
      await hostPage.locator('[data-command="declaration:open"]').click();
      await hostPage.locator(`[data-declaration-category="${declaration.category}"]`).click();
      await hostPage.locator("#battle-declaration-value").selectOption(declaration.value);
      await hostPage.locator("[data-dialog-confirm]").click();
      await expect(hostPage.locator(".battle-log-recent")).toContainText(declaration.expected);
      await expect(guestPage.locator(".battle-log-recent")).toContainText(declaration.expected);
    }

    const hostMarkerRack = hostPage.locator('[data-marker-rack-owner="p1"]:visible').first();
    await hostMarkerRack.locator('[data-command="marker:create"]').click();
    await hostPage.locator("#battle-marker-label").fill("端到端充能");
    await hostPage.locator("#battle-marker-count").fill("2");
    await hostPage.locator("[data-dialog-confirm]").click();
    const marker = hostMarkerRack.locator('[data-body-marker]').filter({ hasText: "端到端充能" });
    await expect(marker).toContainText("×2");
    await marker.click();
    await hostPage.locator("#battle-marker-edit-count").fill("3");
    await hostPage.locator("[data-marker-count-save]").click();
    await expect(marker).toContainText("×3");
    await marker.click();
    await hostPage.locator("[data-marker-delete]").click();
    await hostPage.locator("[data-dialog-confirm]").click();
    await expect(marker).toHaveCount(0);

    const handCard = hostPage.locator('#battle-hand-self [data-card]').first();
    await handCard.click();
    await hostPage.locator('[data-card-action="discard"]').click();
    const discardZone = hostPage.locator('[data-drop-target="handDiscard"]');
    await expect(discardZone.locator(".battle-zone-count")).toHaveText("1");
    await discardZone.locator('[data-zone-browser="handDiscard"]').click();
    await expect(hostPage.locator(".battle-zone-browser h2")).toHaveText("手牌弃牌区");
    await expect(hostPage.locator(".battle-zone-browser__card")).toHaveCount(1);
    await hostPage.locator("[data-zone-browser-search]").fill("不存在的卡");
    await expect(hostPage.locator(".battle-zone-browser__empty")).toBeVisible();
    await hostPage.locator("[data-zone-browser-search]").fill("");
    await hostPage.locator(".battle-zone-browser__card").click();
    await expect(hostPage.locator("[data-zone-browser-back]")).toBeVisible();
    await hostPage.locator("[data-zone-browser-back]").click();
    await expect(hostPage.locator(".battle-zone-browser__card")).toHaveCount(1);
    await hostPage.locator(".battle-dialog__close").click();

    await setProfile(spectatorPage, "E2E-观战");
    await spectatorPage.goto(`/play/room?code=${roomCode}&spectate=true`);
    await waitForRoom(spectatorPage, "game");
    await expect(spectatorPage.locator(".battle-spectator-banner")).toContainText("观战模式");
    await expect(spectatorPage.locator('[data-command="declaration:open"]')).toHaveCount(0);
    await expect(spectatorPage.locator('[data-command="marker:create"]')).toHaveCount(0);
    const spectatorHandPrivacy = await spectatorPage.locator("#battle-hand-self").evaluate((element) => ({
      hiddenCards: element.querySelectorAll('.battle-mini-card--back[aria-label="暗置卡牌，身份未知"]').length,
      exposedCards: element.querySelectorAll("[data-card], .battle-mini-card img").length,
    }));
    expect(spectatorHandPrivacy.hiddenCards).toBeGreaterThan(0);
    expect(spectatorHandPrivacy.exposedCards).toBe(0);
    await expect(spectatorPage.locator(".battle-log")).toContainText("手牌【出刀】");
    const spectatorDiscard = spectatorPage.locator('[data-drop-target="handDiscard"]');
    await spectatorDiscard.locator('[data-zone-browser="handDiscard"]').click();
    await spectatorPage.locator(".battle-zone-browser__card").click();
    await expect(spectatorPage.locator(".battle-card-menu__sections button")).toHaveCount(0);
    await spectatorPage.locator(".battle-dialog__close").click();

    await hostPage.setViewportSize({ width: 390, height: 844 });
    await hostPage.locator('[data-command="declaration:open"]').click();
    const overflow = await hostPage.locator("#battle-dialog").evaluate((element) => ({
      dialog: element.scrollWidth - element.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.dialog).toBeLessThanOrEqual(1);
    expect(overflow.page).toBeLessThanOrEqual(1);
    await hostPage.locator("[data-dialog-cancel]").click();

    const invalidDeclarationError = await hostPage.evaluate(async (code) => {
      const token = localStorage.getItem("qunyou-battle-token-v1");
      if (!token) throw new Error("测试座位令牌不存在。");
      return new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:8787/rooms/${code}/connect?token=${encodeURIComponent(token)}`);
        const timer = window.setTimeout(() => {
          socket.close();
          reject(new Error("等待非法声明拒绝超时。"));
        }, 5_000);
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type === "snapshot") {
            socket.send(JSON.stringify({
              type: "declaration:create",
              actionId: crypto.randomUUID(),
              protocolVersion: 2,
              baseRevision: message.snapshot.revision,
              payload: { category: "suit", value: "彩虹" },
            }));
          }
          if (message.type === "error") {
            window.clearTimeout(timer);
            socket.close();
            resolve(String(message.error || ""));
          }
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("非法声明测试连接失败。"));
        });
      });
    }, roomCode);
    expect(invalidDeclarationError).toContain("声明选项无效");
  } finally {
    await attachConsole(testInfo, consoleEntries);
    await Promise.allSettled([hostContext.close(), guestContext.close(), spectatorContext.close()]);
  }
});

test("automatic beta room starts, advances phases and protects spectator privacy", async ({ browser }, testInfo) => {
  const consoleEntries: string[] = [];
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const spectatorContext = await browser.newContext();
  await Promise.all([skipCoach(hostContext), skipCoach(guestContext), skipCoach(spectatorContext)]);

  try {
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const spectatorPage = await spectatorContext.newPage();
    observePage(hostPage, "auto-host", consoleEntries);
    const autoState = watchAutoSnapshots(hostPage);
    observePage(guestPage, "auto-guest", consoleEntries);
    observePage(spectatorPage, "auto-spectator", consoleEntries);

    await setProfile(hostPage, "E2E-自动房主");
    await hostPage.locator("#battle-create-room").click();
    await expect(hostPage.locator("#battle-mode-dialog")).toBeVisible();
    await hostPage.locator('[data-create-mode="auto"]').click();
    await hostPage.waitForURL(/\/play\/auto\/room\?code=[A-Z0-9]{6}/);
    const code = new URL(hostPage.url()).searchParams.get("code");
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await expect(hostPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "lobby");
    await hostPage.locator("#auto-deck-select").selectOption("deck_combo_001");
    await expect(hostPage.locator("#auto-deck-select")).toHaveValue("deck_combo_001");
    await expect(hostPage.locator("#auto-deck-select option:not([disabled])")).toHaveCount(10);
    await expect(hostPage.locator("#auto-deck-select option[disabled]")).toHaveCount(0);
    expect((await hostPage.locator("#auto-deck-select option").allTextContents()).join(" ")).toContain("自选");

    await setProfile(guestPage, "E2E-自动对手");
    await guestPage.goto(`/play?room=${code}`);
    const roomCard = guestPage.locator(`article[data-room-code="${code}"]`);
    await expect(roomCard).toContainText("自动 Beta");
    await roomCard.locator("[data-room-action]").click();
    await guestPage.waitForURL(new RegExp(`/play/auto/room\\?code=${code}`));
    await expect(guestPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "lobby");
    await guestPage.locator("#auto-deck-select").selectOption("deck_mizai_001");
    await expect(guestPage.locator("#auto-deck-select")).toHaveValue("deck_mizai_001");

    await guestPage.locator('[data-auto-command="ready"]').click();
    await hostPage.locator('[data-auto-command="ready"]').click();
    await Promise.all([
      expect(hostPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game"),
      expect(guestPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game"),
    ]);
    await reachAutoPlay(hostPage, guestPage, autoState);
    await expect(hostPage.locator(".auto-phase-track li")).toHaveCount(6);
    await expect(hostPage.locator(".auto-phase-track li.is-current")).toHaveText(/3出牌/);
    await expect(hostPage.locator(".auto-body-status")).toHaveCount(2);
    await expect(hostPage.locator('.auto-progress-counter[aria-label="Mega 0 / 6"]')).toHaveCount(1);
    await expect(hostPage.locator('.auto-progress-counter[aria-label="Mega 0 / 5"]')).toHaveCount(1);
    await expect(hostPage.locator("#auto-battle-app")).toHaveAttribute("data-mobile-table", "false");
    await expect(guestPage.locator("#auto-battle-app")).toHaveAttribute("data-mobile-table", "true");
    await expect(guestPage.locator("#auto-battle-app")).toHaveAttribute("data-mobile-layout", "landscape");
    await expect(guestPage.locator("#auto-battle-root")).toHaveClass(/is-mobile-table/);

    const mobileCardSizes = await guestPage.locator(".auto-slot .auto-card").evaluateAll((cards) => cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    expect(mobileCardSizes.length).toBeGreaterThan(0);
    expect(Math.max(...mobileCardSizes.map((size) => size.width)) - Math.min(...mobileCardSizes.map((size) => size.width))).toBeLessThan(.6);
    expect(Math.max(...mobileCardSizes.map((size) => size.height)) - Math.min(...mobileCardSizes.map((size) => size.height))).toBeLessThan(.6);
    await testInfo.attach("auto-mobile-landscape", { body: await guestPage.screenshot(), contentType: "image/png" });

    const tableBeforeLog = await guestPage.locator(".auto-game").boundingBox();
    await guestPage.locator(".auto-slot .auto-card").first().evaluate((card) => { card.setAttribute("data-e2e-stable-node", "true"); });
    await guestPage.locator("[data-auto-mobile-log-toggle]").click();
    await expect(guestPage.locator(".auto-log")).toHaveClass(/is-open/);
    await expect(guestPage.locator("[data-auto-mobile-log-toggle]")).toHaveAttribute("aria-expanded", "true");
    await guestPage.locator(".auto-mobile-log-close").click();
    await expect(guestPage.locator(".auto-log")).not.toHaveClass(/is-open/);
    await expect(guestPage.locator("[data-auto-mobile-log-toggle]")).toBeFocused();
    await guestPage.locator("[data-auto-mobile-log-toggle]").click();
    await guestPage.keyboard.press("Escape");
    await expect(guestPage.locator(".auto-log")).not.toHaveClass(/is-open/);
    await guestPage.locator("[data-auto-mobile-log-toggle]").click();
    await guestPage.locator(".auto-mobile-log-backdrop").click({ position: { x: 20, y: 20 } });
    await expect(guestPage.locator(".auto-log")).not.toHaveClass(/is-open/);
    await expect(guestPage.locator("[data-auto-mobile-log-toggle]")).toHaveAttribute("aria-expanded", "false");
    const tableAfterLog = await guestPage.locator(".auto-game").boundingBox();
    expect(tableAfterLog?.width).toBeCloseTo(tableBeforeLog?.width || 0, 1);
    expect(tableAfterLog?.height).toBeCloseTo(tableBeforeLog?.height || 0, 1);
    await expect(guestPage.locator('.auto-slot .auto-card[data-e2e-stable-node="true"]')).toHaveCount(1);

    const currentPage = autoState()?.game.currentPlayerId === autoState()?.you ? hostPage : guestPage;
    await expect(currentPage.locator(".auto-hand [data-auto-card]")).toHaveCount(7);

    await setProfile(spectatorPage, "E2E-自动观战");
    await spectatorPage.goto(`/play/auto/room?code=${code}&spectate=true&perf=1`);
    await expect(spectatorPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await expect(spectatorPage.locator(".auto-hand [data-auto-card]")).toHaveCount(0);
    await expect(spectatorPage.locator(".auto-hand")).toHaveCount(0);
    await expect(spectatorPage.locator(".auto-player")).toHaveCount(2);
    await expect(spectatorPage.getByText("玩家 A ·", { exact: false })).toBeVisible();
    await expect(spectatorPage.getByText("玩家 B ·", { exact: false })).toBeVisible();
    await expect(spectatorPage.locator("[data-phase-advance]")).toBeDisabled();
    await expect(spectatorPage.locator(".auto-perf-panel")).toBeVisible();
    await expect(hostPage.locator(".auto-perf-panel")).toHaveCount(0);

    await guestPage.setViewportSize({ width: 740, height: 360 });
    await expect.poll(async () => (await guestPage.locator(".auto-game").boundingBox())?.width || Infinity).toBeLessThanOrEqual(740);
    const compactLandscape = await guestPage.locator(".auto-game").boundingBox();
    expect(compactLandscape?.height).toBeLessThanOrEqual(328);

    await guestPage.setViewportSize({ width: 390, height: 844 });
    await guestPage.locator("[data-auto-mobile-layout]").click();
    await expect(guestPage.locator("#auto-battle-app")).toHaveAttribute("data-mobile-layout", "portrait");
    expect(await guestPage.evaluate(() => localStorage.getItem("qunyou-auto-mobile-layout-v1"))).toBe("portrait");
    await testInfo.attach("auto-mobile-portrait", { body: await guestPage.screenshot(), contentType: "image/png" });
    const overflow = await guestPage.locator("#auto-battle-app").evaluate((element) => ({
      app: element.scrollWidth - element.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.app).toBeLessThanOrEqual(1);
    expect(overflow.page).toBeLessThanOrEqual(1);

    await hostPage.setViewportSize({ width: 390, height: 844 });
    await expect(hostPage.locator("#auto-battle-app")).toHaveAttribute("data-mobile-table", "false");
    await expect(hostPage.locator("#auto-battle-root")).toHaveClass(/is-table-fit/);

    const revision = await guestPage.locator("#auto-battle-app").getAttribute("data-phase");
    expect(revision).toBe("game");
  } finally {
    await attachConsole(testInfo, consoleEntries);
    await Promise.allSettled([hostContext.close(), guestContext.close(), spectatorContext.close()]);
  }
});

test("automatic custom decks share the editor, cover all remaining roles and exclude unfinished bodies", async ({ browser }, testInfo) => {
  const contexts = [await browser.newContext(), await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }), await browser.newContext()];
  const entries: string[] = [];
  try {
    const [host, guest, spectator] = await Promise.all(contexts.map((context) => context.newPage()));
    [host, guest, spectator].forEach((page, i) => observePage(page, `custom-${i}`, entries));
    await setProfile(host, "E2E-自选房主");
    await host.locator("#battle-create-room").click();
    await host.locator('[data-create-mode="auto"]').click();
    await host.waitForURL(/\/play\/auto\/room\?code=/);
    await expect(host.locator('[data-auto-custom-editor]')).toBeVisible();
    const code = new URL(host.url()).searchParams.get("code")!;
    const cardPool = await host.locator("#auto-battle-catalog").evaluate((element) => {
      const catalog = JSON.parse(element.textContent || "{}");
      const prebuilt = new Set(catalog.decks.flatMap((deck: { characterIds: string[] }) => deck.characterIds));
      const all = Object.values(catalog.cards).filter((card: any) => card.kind === "character").map((card: any) => card.id) as string[];
      return { all, extra: all.filter((id) => !prebuilt.has(id)) };
    });
    expect(cardPool.extra).toHaveLength(14);
    const hostIds = [...cardPool.extra, ...cardPool.all.filter((id) => !cardPool.extra.includes(id))].slice(0, 16);
    const guestIds = [...cardPool.extra.slice(3), ...cardPool.all.filter((id) => !cardPool.extra.includes(id))].slice(0, 16);

    const edit = async (page: Page, bodyId: string, ids: string[]) => {
      await page.locator('[data-auto-custom-editor]').click();
      const dialog = page.locator("#auto-deck-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-custom-body-option]")).toHaveCount(9);
      await expect(dialog.locator("[data-custom-character]")).toHaveCount(120);
      await expect(dialog.locator('[data-custom-body-option="body_link_001"]')).toHaveCount(1);
      for (const excluded of ["body_roaming_001", "body_antimagic_001", "body_crossfire_001"]) {
        await expect(dialog.locator(`[data-custom-body-option="${excluded}"]`)).toHaveCount(0);
      }
      await dialog.locator(`[data-custom-body-option="${bodyId}"]`).click();
      await dialog.locator("[data-custom-clear]").click();
      await expect(dialog.locator("[data-custom-picker-done]")).toBeDisabled();
      for (const id of ids) await dialog.locator(`[data-custom-card][data-card-id="${id}"] img`).click();
      await expect(dialog.locator("[data-custom-picker-count]")).toHaveText("16/16");
      await dialog.locator(`[data-custom-preview="${ids[0]}"]`).click();
      await expect(page.locator("#auto-deck-preview .battle-card-detail__text")).toBeVisible();
      await page.locator("#auto-deck-preview [data-card-art-zoom]").click();
      await expect(page.locator("#auto-deck-preview [data-card-hd-image]")).toBeVisible();
      await page.locator("#auto-deck-preview [data-card-detail-back]").click();
      await page.locator("#auto-deck-preview [data-preview-close]").click();
      if ((page.viewportSize()?.width || 0) <= 600) {
        const header = await dialog.locator(".battle-custom-picker__top").boundingBox();
        const tray = await dialog.locator("[data-custom-picker-selected]").boundingBox();
        expect(tray!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
        await expect(dialog.locator(".battle-custom-card__tip:visible")).toHaveCount(0);
      }
      await testInfo.attach(`custom-editor-${bodyId}`, { body: await page.screenshot({ path: testInfo.outputPath(`custom-editor-${bodyId}.png`) }), contentType: "image/png" });
      const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await dialog.locator("[data-custom-picker-done]").click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator("#auto-deck-select")).toHaveValue("custom");
    };
    await edit(host, "body_link_001", hostIds);
    await host.reload();
    await expect(host.locator("#auto-deck-select")).toHaveValue("custom");
    expect(await host.evaluate(() => JSON.parse(localStorage.getItem("qunyou-auto-loadout-v1") || "null").customDeck.characterIds.length)).toBe(16);

    await setProfile(guest, "E2E-自选对手");
    await guest.goto(`/play?room=${code}`);
    await guest.locator(`article[data-room-code="${code}"] [data-room-action]`).click();
    await guest.waitForURL(/\/play\/auto\/room\?code=/);
    await edit(guest, "body_mizai_001", guestIds);
    await host.locator('[data-auto-command="ready"]').click();
    await guest.locator('[data-auto-command="ready"]').click();
    await expect(host.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await expect(guest.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await expect(host.locator(".auto-hand [data-auto-card]")).toHaveCount(5);
    await expect(host.locator(".auto-player.is-self .auto-slot [data-auto-card]")).toHaveCount(2);
    await expect(host.locator(".auto-player.is-opponent .auto-card--character-back")).toHaveCount(2);
    await host.reload();
    await expect(host.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await setProfile(spectator, "E2E-自选观战");
    await spectator.goto(`/play/auto/room?code=${code}&spectate=true`);
    await expect(spectator.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await expect(spectator.locator(".auto-hand")).toHaveCount(0);
    await expect(spectator.locator(".auto-card--character-back")).toHaveCount(4);
    expect(entries.filter((entry) => entry.includes("pageerror"))).toEqual([]);
  } finally {
    await attachConsole(testInfo, entries);
    await Promise.allSettled(contexts.map((context) => context.close()));
  }
});

test("joker card faces expose no-suit details", async ({ page }) => {
  await page.goto("/cards/hand-cards");
  await expect(page.getByText("14 种 · 共 54 张")).toBeVisible();

  for (const joker of [
    { kind: "small", name: "冒名顶替", rank: "小王" },
    { kind: "big", name: "紧急会议", rank: "大王" },
  ]) {
    await page.locator(`[data-hand-card-face][data-card-joker="${joker.kind}"]`).click();
    await expect(page.locator("#hand-card-zoom-dialog")).toBeVisible();
    await expect(page.locator("#hand-card-zoom-name")).toHaveText(joker.name);
    await expect(page.locator("#hand-card-zoom-suit")).toHaveText("无花色");
    await expect(page.locator("#hand-card-zoom-rank")).toHaveText(joker.rank);
    await expect(page.locator("#hand-card-zoom-image")).toBeVisible();
    await page.locator(".card-zoom-dialog__close").click();
  }
});
