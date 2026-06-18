import { escapeHtml } from "./battle-format";
import type { CatalogCard, CustomDeckConfig } from "./battle-types";

export type CustomDeckDraft = CustomDeckConfig;
export type CustomDeckFilters = { query: string; role: string; tag: string; selectedOnly: boolean };

export function customRoleFilters(cards: CatalogCard[]) {
  return ["", ...new Set(cards.map((card) => card.mainRole || "").filter(Boolean))];
}

export function customTagFilters(cards: CatalogCard[]) {
  return ["", ...new Set(cards.flatMap((card) => card.tags || []).filter(Boolean))];
}

export function customCardSearchText(card: CatalogCard) {
  return `${card.name} ${card.subtitle} ${card.skillName || ""} ${card.text} ${(card.tags || []).join(" ")}`.toLowerCase();
}

export function matchesCustomFilters(card: CatalogCard, filters: CustomDeckFilters, selected: Set<string>) {
  return (!filters.query || customCardSearchText(card).includes(filters.query.toLowerCase()))
    && (!filters.role || card.mainRole === filters.role)
    && (!filters.tag || (card.tags || []).includes(filters.tag))
    && (!filters.selectedOnly || selected.has(card.id));
}

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function autoFillCharacters(cards: CatalogCard[], selectedIds: string[], filters: CustomDeckFilters, limit = 16) {
  const selected = new Set(selectedIds);
  const matching = shuffled(cards.filter((card) => !selected.has(card.id) && matchesCustomFilters(card, filters, selected)));
  const fallback = shuffled(cards.filter((card) => !selected.has(card.id) && !matching.includes(card)));
  for (const card of [...matching, ...fallback]) {
    if (selected.size >= limit) break;
    selected.add(card.id);
  }
  return [...selected].slice(0, limit);
}

export function renderSelectedCharacterTray(cardsById: Record<string, CatalogCard>, ids: string[], removable = false) {
  if (!ids.length) return `<span class="battle-custom-picked__empty">尚未选择角色。</span>`;
  return ids.map((id) => {
    const card = cardsById[id];
    return `<button type="button" class="battle-custom-picked__card" ${removable ? `data-custom-remove="${escapeHtml(id)}"` : "disabled"} title="${removable ? "点击移除" : "已选择"}">
      ${card?.imagePath ? `<img src="${escapeHtml(card.imagePath)}" alt="" />` : ""}
      <span><strong>${escapeHtml(card?.name || id)}</strong><small>${escapeHtml(card?.mainRole || "角色")}</small></span>
      ${removable ? "<b aria-hidden=\"true\">×</b>" : ""}
    </button>`;
  }).join("");
}
