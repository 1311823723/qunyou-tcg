import { escapeHtml } from "./battle-format";
import { autoFillCharacters, customCardSearchText, customRoleFilters, customTagFilters, matchesCustomFilters, renderSelectedCharacterTray, type CustomDeckFilters } from "./battle-custom-deck";
import type { Catalog, CatalogCard, CustomDeckConfig } from "./battle-types";

export function mountCustomDeckEditor({
  dialog, dialogContent, catalog, bodyCatalogCards, characterCatalogCards, deck, onSave, onPreview, openBattleDialog,
}: {
  dialog: HTMLDialogElement; dialogContent: HTMLElement; catalog: Catalog;
  bodyCatalogCards: CatalogCard[]; characterCatalogCards: CatalogCard[]; deck: CustomDeckConfig;
  onSave: (deck: CustomDeckConfig) => void;
  onPreview: (id: string, target?: HTMLElement) => void;
  openBattleDialog: () => void;
}) {
  const customRoleFilterOptions = customRoleFilters(characterCatalogCards);
  const customTagFilterOptions = customTagFilters(characterCatalogCards);
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
        onPreview(button.dataset.customPreview || "", button);
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

  function showCustomDeckEditor() {
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
      if (customDeck.characterIds.length !== 16 || !bodyCatalogCards.some((c) => c.id === customDeck.bodyId)) return;
      onSave(customDeck);
      dialog.close();
    });
    openBattleDialog();
    syncPicker();
  }


  showCustomDeckEditor();
}

