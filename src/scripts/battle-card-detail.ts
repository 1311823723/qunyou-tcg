import { escapeHtml, handCardHighResImagePath, handCardIdentityLabel, handCardImagePath } from "./battle-format";
import type { CardView, CatalogCard } from "./battle-types";

export type CardDetailMode = "detail" | "art";
export type BodyDetailForm = "normal" | "mega";

export type CardDetailContext = {
  definition?: CatalogCard;
  card?: CardView;
  visible?: boolean;
  initialForm?: BodyDetailForm;
};

export type CardDetailView = {
  definition?: CatalogCard;
  card?: CardView;
  form: BodyDetailForm;
  displayName: string;
  displaySubtitle: string;
  displayText: string;
  imagePath?: string;
  highResImagePath?: string;
  titleHtml: string;
  roleTag: string;
  faceStatus: string;
};

function splitCharacterName(name: string) {
  const separator = name.indexOf("-");
  return separator < 0 ? ["", name] : [name.slice(0, separator), name.slice(separator + 1)];
}

export function resolveCardDetail(context: CardDetailContext, form = context.initialForm ?? "normal"): CardDetailView {
  const definition = context.visible === false ? undefined : context.definition;
  const card = context.card;
  const isMega = definition?.kind === "body" && form === "mega";
  const displayName = isMega ? definition.extraName || definition.name : definition?.name || "暗置卡牌";
  const displaySubtitle = isMega ? definition.extraSubtitle || definition.subtitle : definition?.subtitle || "身份未知";
  const displayText = isMega ? definition.extraText || definition.text : definition?.text || "";
  let imagePath = isMega ? definition?.extraImagePath || definition?.imagePath : definition?.imagePath;
  let highResImagePath = isMega ? definition?.extraHighResImagePath || definition?.highResImagePath : definition?.highResImagePath;

  if (definition?.kind === "hand" && card) {
    imagePath = handCardImagePath(definition.id, card.suit, card.rank, card.joker) || imagePath;
    highResImagePath = handCardHighResImagePath(definition.id, card.suit, card.rank, card.joker) || highResImagePath;
  }

  const [roleName, characterName] = splitCharacterName(displayName);
  const titleHtml = definition?.kind === "character"
    ? `${roleName ? `<span class="battle-card-detail__role">${escapeHtml(roleName)}</span>` : ""}${escapeHtml(characterName)}`
    : escapeHtml(displayName);
  const roleTag = definition?.kind === "character" ? definition.mainRole || definition.subtitle.split(" · ")[0] || "" : "";
  const faceStatus = definition?.kind === "character"
    ? (card?.faceDown ? `<span class="battle-tag battle-tag--facedown">暗置</span>` : `<span class="battle-tag battle-tag--faceup">已明置</span>`)
    : "";

  return { definition, card, form, displayName, displaySubtitle, displayText, imagePath, highResImagePath, titleHtml, roleTag, faceStatus };
}

export function renderCardDetailTabs(view: CardDetailView) {
  if (view.definition?.kind !== "body" || !view.definition.extraText) return "";
  return `<div class="battle-card-detail__tabs" role="tablist" aria-label="本体形态">
    <button type="button" role="tab" data-card-form="normal" aria-selected="${view.form === "normal"}" class="${view.form === "normal" ? "is-active" : ""}">普通形态</button>
    <button type="button" role="tab" data-card-form="mega" aria-selected="${view.form === "mega"}" class="${view.form === "mega" ? "is-active" : ""}">${escapeHtml(view.definition.extraFormLabel || "额外形态")}</button>
  </div>`;
}

export function renderCardArtPreview(view: CardDetailView) {
  if (!view.imagePath) {
    return `<div class="battle-card-detail__placeholder battle-card-detail__placeholder--back"><span>暗</span><small>身份未知</small></div>`;
  }
  return `<button type="button" class="battle-card-detail__art-button" data-card-art-zoom aria-label="放大查看 ${escapeHtml(view.displayName)}">
    <img class="battle-card-detail__art" src="${escapeHtml(view.imagePath)}" width="250" height="350" alt="${escapeHtml(view.displayName)}" decoding="async" />
    <span>点击查看高清大图</span>
  </button>`;
}

export function renderCardDetailBody(view: CardDetailView) {
  const definition = view.definition;
  if (!definition) return `<div class="battle-card-detail__body"><h2>暗置卡牌</h2><p class="battle-card-detail__text">无权限查看这张卡牌的身份与技能。</p></div>`;
  const bodySubtitleParts = definition.kind === "body" ? view.displaySubtitle.split(" · ") : [];
  const bodyAbilityName = bodySubtitleParts.at(-1) || "";
  const bodyArchetype = bodySubtitleParts.slice(0, -1).join(" · ");
  const bodyAbilityLabel = definition.kind === "body"
    ? view.form === "mega" && definition.extraFormType === "z-move"
      ? "Z招式"
      : view.form === "mega" && definition.extraFormType === "dynamax"
        ? "极巨技能"
        : "特性"
    : "";
  const handIdentity = definition.kind === "hand" && view.card
    ? handCardIdentityLabel(view.card.suit, view.card.rank, view.card.joker)
    : "";
  const handMeta = handIdentity ? `<span class="battle-tag">${escapeHtml(handIdentity)}</span>` : "";
  return `<div class="battle-card-detail__body">
    ${renderCardDetailTabs(view)}
    <h2>${view.titleHtml}</h2>
    <div class="battle-card-detail__tags">
      ${view.roleTag ? `<span class="battle-tag">${escapeHtml(view.roleTag)}</span>` : ""}
      ${view.faceStatus}${handMeta}
      ${(definition.tags || []).map((tag) => `<span class="battle-tag battle-tag--muted">${escapeHtml(tag)}</span>`).join("")}
    </div>
    ${definition.kind === "character" ? `<div class="battle-card-detail__rules">
      <span><b>技能消耗</b>${escapeHtml(definition.costText || "无")}</span>
      <span><b>发动时机</b>${escapeHtml(definition.timing || "未注明")}</span>
    </div>` : ""}
    ${definition.kind === "body" ? `<div class="battle-card-detail__rules">
      ${view.form === "normal" && definition.hp ? `<span><b>初始体力</b>${definition.hp}</span>` : ""}
      ${view.form === "normal" && definition.megaCondition ? `<span><b>${escapeHtml(definition.extraConditionLabel || "额外形态条件")}</b>${escapeHtml(definition.megaCondition)}</span>` : ""}
      ${view.form === "mega" ? `<span><b>当前形态</b>${escapeHtml(definition.extraFormLabel || "额外形态")}</span>` : ""}
    </div>` : ""}
    <p class="battle-card-detail__subtitle">${definition.kind === "body" ? `${bodyAbilityLabel}【${escapeHtml(bodyAbilityName)}】${bodyArchetype ? ` · ${escapeHtml(bodyArchetype)}` : ""}` : escapeHtml(view.displaySubtitle)}</p>
    <p class="battle-card-detail__text">${escapeHtml(view.displayText)}</p>
  </div>`;
}

export function renderCardArtDialog(view: CardDetailView) {
  const art = view.imagePath
    ? `<div class="battle-card-zoom__image-stack">
        <img class="battle-card-zoom__image battle-card-zoom__image--placeholder" src="${escapeHtml(view.imagePath)}" width="250" height="350" alt="${escapeHtml(view.displayName)}" decoding="async" />
        ${view.highResImagePath ? `<img class="battle-card-zoom__image battle-card-zoom__image--hd" src="${escapeHtml(view.highResImagePath)}" width="750" height="1050" alt="${escapeHtml(view.displayName)} 高清卡图" decoding="async" data-card-hd-image />` : ""}
        ${view.highResImagePath ? `<span class="battle-card-zoom__loading" data-card-hd-loading>正在加载高清卡图…</span>` : ""}
      </div>`
    : `<div class="battle-card-zoom__back"><span>暗置</span><small>身份未知</small></div>`;
  return `<div class="battle-card-menu battle-card-menu--art">
    <div class="battle-card-zoom">
      <div class="battle-card-zoom__topline">
        <button type="button" class="battle-small-btn" data-card-detail-back>返回详情</button>
        <div><h2>${escapeHtml(view.displayName)}</h2><p>${escapeHtml(view.displaySubtitle)}</p></div>
        ${view.faceStatus}
      </div>
      <div class="battle-card-zoom__stage">${art}</div>
    </div>
  </div>`;
}

export function bindHighResImage(container: ParentNode) {
  const image = container.querySelector<HTMLImageElement>("[data-card-hd-image]");
  const loading = container.querySelector<HTMLElement>("[data-card-hd-loading]");
  if (!image) return;
  const loaded = () => {
    image.classList.add("is-loaded");
    if (loading) loading.hidden = true;
  };
  if (image.complete && image.naturalWidth > 0) loaded();
  else image.addEventListener("load", loaded, { once: true });
  image.addEventListener("error", () => {
    image.remove();
    if (loading) loading.textContent = "高清图加载失败，已显示普通卡图";
  }, { once: true });
}
