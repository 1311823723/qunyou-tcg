# 宝旅团图鉴 · 微信小程序

原生 TypeScript / WXML / WXSS，同仓库独立应用。底部四入口：首页、图鉴、预组、指南。首页是暖色收藏室场景（本体精选卡架 + 全量搜索 + 预组卡册）；图鉴页直接是可搜索的卡面网格（本体／角色／基础牌／行动牌，定位与预组筛选折叠）；预组页展示精选主视觉、新手入口与全部 12 套预组；指南含图文入门、章节式正式规则与关键词。另有完整卡图与效果、本体双面、预组介绍、本机收藏及最近浏览。

页面结构（`src/pages/`）：

| 页面 | 类型 | 职责 |
| --- | --- | --- |
| `home` | tabBar | 收藏室场景：品牌与官网、全量搜索、本体精选卡架、图鉴／入门入口、预组卡册、收藏与最近浏览 |
| `cards` | tabBar | 图鉴：直接显示卡面网格；牌种切换常驻，定位／预组筛选折叠，支持搜索与「全部／已收藏」 |
| `collection` | 栈页 | 旧深链兼容页：与 `cards` 同一套筛选逻辑，承接 `?kind=`／`?q=`／`?fav=1` 直达 |
| `decks` | tabBar | 预组：精选主视觉、新手入口、12 套网格、收藏与最近浏览 |
| `deck-detail` | 栈页 | 单套预组：本体摘要、简介、核心操作、16 张角色（可按定位筛选并显示数量） |
| `detail` | 栈页 | 单卡：视觉列（卡面／形态切换／高清图）+ 阅读列（卡牌事实／完整效果，可复制）、收藏、相关预组、分享 |
| `rules` | tabBar | 六步入门、正式规则（章节目录 → 单章阅读）、关键词 |
| `history` | 栈页 | 最近浏览全部 |
| `website` | 栈页 | 官网地址展示与复制（内嵌开关见 `src/config.ts`） |
| `about` | 栈页 | 关于与隐私：隐私说明、功能范围、备案号、随包版本与包内图源说明（首页底部进入） |

牌种口径：本体 12 ／ 角色 120 ／ 基础牌 4 ／ 行动牌 10，合计 146。骑士卡不作为真实卡牌进入图鉴。
`cards` 与 `collection` 的 `kind` 只认 本体／角色／手牌／全部，非法值回落「全部卡牌」。

`collection` 必须是非 tabBar 页面：tabBar 页面之间只能 `switchTab`，`navigateTo` 会报 `can not navigate to a tabBar page`。
此外 `navigateTo` 传来的中文参数**仍是百分号编码**，两个列表页的 `onLoad` 都要先 `decodeURIComponent`（安全包装，失败不抛）。

## 本地构建

在仓库根目录运行：

```bash
npm ci
npm run mini:test
npm run mini:typecheck
```

在微信开发者工具中导入 `miniprogram/`，项目配置指向生成的 `build/`，不要导入 `src/`。代码或数据修改后重新运行 `npm run mini:build`。`project.config.json` 里的 AppID 是当前使用的正式账号 `APP_ID`（个人主体，原始ID `（仅账号后台可见）`），不再需要替换；**任何时候都不要提供 AppSecret**。真机预览与分享需要把微信号加进后台「管理 → 成员管理」的项目成员／体验成员。2026-09-21 已安装微信开发者工具 2.02.2608070（arm64）到 `~/Applications/wechatwebdevtools.app`（官方 dmg，SHA-256 已核对）；导入与登录后的微信编译、真机仍未验证。

**上线前置条件：小程序备案。** 未完成备案时后台不允许上传代码、提交审核或更新版本，所以备案必须先启动；其余上线事项见[上线检查清单](../docs/miniprogram-release-checklist.md)。

`mini:test` 除数据、页面逻辑、存储与文档测试外，还包含原生静态校验（WXML 结构与组件声明、`wx:key`、事件处理是否存在于编译产物、页面配置、WXSS 括号与 at-rule），可把一部分编译期错误前移，但**不能替代微信开发者工具编译**。

`npm run mini:review` 可生成浏览器近似布局截图到忽略目录 `review/`（含竖屏、横屏与大字号近似），仅用于排版检查，不能替代微信工具编译或真机测试。

## 内容入口

- 正式文字：根 `data/cards/`、`data/decks/`、`docs/rules.md`、`docs/keywords.md`。
- 展示配置：`content/presentation.json`，维护精选顺序、预组简介和入门；引用由构建校验。
- 图源：卡册 198 张缩略图在主包，高清卡图按卡牌分到 8 个分包；本体与角色高清 750px，手牌高清 650px、缩略图 120px。`mini:build` 从正式原图生成并校验包体。图片不再请求开发域名；官网地址仍单独维护在 `src/config.ts`。
- 合规配置：`src/config.ts` 的 `ICP_FILING_NUMBER`（备案号，备案通过后填写，展示在 `pages/about`）、`OFFICIAL_WEBSITE_URL` 与 `OFFICIAL_WEBSITE_EMBED_ENABLED`（个人主体永久为 `false`）。
- 骑士卡无正式成卡图，显示正式文字。手牌一条定义含多种花色／点数卡面。
- 收藏和最近浏览仅在本机存储；卡册图和文字随主包，进入详情时按需加载相应高清分包。分包不可用时详情回退为轻量卡图、完整文字和重试按钮；离线首次进入尚未下载过的分包需真机实测。
- `build/`、`src/generated/catalog.js`、`review/` 都是生成物，不手改。

[产品规格](../docs/miniprogram-product.md) · [架构](../docs/miniprogram-architecture.md) · [验收状态](../docs/miniprogram-verification.md) · [WorkBuddy 交接](../docs/miniprogram-handoff.md)

微信开发者工具已走通包内本体翻面、手牌卡面、高清查看与旧链接跳转；iOS／安卓真机缩放画质、实际上传包大小与首次玩家体验仍待验。官网内嵌因个人主体与备案要求不满足而保持关闭，仅提供复制网址。未提交、推送、上传审核或发布；现有 `.workbuddy/` 内容未改动。
