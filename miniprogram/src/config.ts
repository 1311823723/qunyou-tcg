// 当前网站仅作为开发图片来源；正式发布前验证实际图源及微信后台配置。
export const ASSET_BASE_URL = "https://qunyou-tcg.pages.dev";

// 官网独立于卡图域名。
// 2026-09-21 核验微信开放文档：web-view 需要「业务域名」，业务域名只开放给非个人主体账号，
// 且域名必须已 ICP 备案、并在根目录放置微信校验文件。pages.dev 域名无法备案，
// 因此内嵌访问在当前域名与主体条件下不可用，保持 false 并保留复制网址方案。
export const OFFICIAL_WEBSITE_URL = "https://qunyou-tcg.pages.dev";
export const OFFICIAL_WEBSITE_EMBED_ENABLED = false;
