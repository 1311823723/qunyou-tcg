// 官网独立于卡图域名。
// 2026-09-21 核验微信开放文档：web-view 需要「业务域名」，业务域名只开放给非个人主体账号，
// 且域名必须已 ICP 备案、并在根目录放置微信校验文件。pages.dev 域名无法备案，
// 因此内嵌访问在当前域名与主体条件下不可用，保持 false 并保留复制网址方案。
export const OFFICIAL_WEBSITE_URL = "https://qunyou-tcg.pages.dev";
export const OFFICIAL_WEBSITE_EMBED_ENABLED = false;

// 小程序备案号。备案通过后由通信管理局下发，需在此填写后再上传版本。
// 微信要求备案号在小程序内可见，展示位置见 pages/about。
// 为空时「关于与隐私」页会显示占位提示，不会把空值当成备案号渲染出来。
export const ICP_FILING_NUMBER = "";
