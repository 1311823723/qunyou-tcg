import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const COACH_KEY = "qunyou-battle-coach-v1";

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
  const guestContext = await browser.newContext();
  const spectatorContext = await browser.newContext();
  await Promise.all([skipCoach(hostContext), skipCoach(guestContext), skipCoach(spectatorContext)]);

  try {
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();
    const spectatorPage = await spectatorContext.newPage();
    observePage(hostPage, "auto-host", consoleEntries);
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
    await expect(hostPage.locator("#auto-deck-select option:not([disabled])")).toHaveCount(8);
    await expect(hostPage.locator("#auto-deck-select option[disabled]")).toHaveCount(0);
    expect((await hostPage.locator("#auto-deck-select option").allTextContents()).join(" ")).not.toContain("自选");

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
    await expect(hostPage.locator(".auto-phase strong")).toHaveText("准备阶段");
    await expect(hostPage.locator(".auto-body-status")).toHaveCount(2);
    await expect(hostPage.locator('.auto-progress-counter[aria-label="Mega 0 / 6"]')).toHaveCount(1);
    await expect(hostPage.locator('.auto-progress-counter[aria-label="Mega 0 / 5"]')).toHaveCount(1);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const hostPass = hostPage.locator('.auto-prompt.is-mine [data-prompt-value="pass"]');
      const guestPass = guestPage.locator('.auto-prompt.is-mine [data-prompt-value="pass"]');
      if (await hostPass.isVisible().catch(() => false)) await hostPass.click();
      else if (await guestPass.isVisible().catch(() => false)) await guestPass.click();
      else break;
    }

    const hostTurn = await hostPage.locator(".auto-phase small").textContent() === "你的回合";
    const currentPage = hostTurn ? hostPage : guestPage;
    await currentPage.locator("[data-phase-advance]").click();
    await expect(currentPage.locator(".auto-phase strong")).toHaveText("摸牌阶段");
    await expect(currentPage.locator(".auto-hand [data-auto-card]")).toHaveCount(7);

    await setProfile(spectatorPage, "E2E-自动观战");
    await spectatorPage.goto(`/play/auto/room?code=${code}&spectate=true`);
    await expect(spectatorPage.locator("#auto-battle-app")).toHaveAttribute("data-phase", "game");
    await expect(spectatorPage.locator(".auto-hand [data-auto-card]")).toHaveCount(0);
    await expect(spectatorPage.locator(".auto-hand")).toHaveCount(0);
    await expect(spectatorPage.locator(".auto-player")).toHaveCount(2);
    await expect(spectatorPage.getByText("玩家 A ·", { exact: false })).toBeVisible();
    await expect(spectatorPage.getByText("玩家 B ·", { exact: false })).toBeVisible();
    await expect(spectatorPage.locator("[data-phase-advance]")).toBeDisabled();

    await currentPage.setViewportSize({ width: 390, height: 844 });
    const overflow = await currentPage.locator("#auto-battle-app").evaluate((element) => ({
      app: element.scrollWidth - element.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.app).toBeLessThanOrEqual(1);
    expect(overflow.page).toBeLessThanOrEqual(1);

    const revision = await currentPage.locator("#auto-battle-app").getAttribute("data-phase");
    expect(revision).toBe("game");
  } finally {
    await attachConsole(testInfo, consoleEntries);
    await Promise.allSettled([hostContext.close(), guestContext.close(), spectatorContext.close()]);
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
