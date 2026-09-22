# 宝旅团图鉴 · 微信小程序

原生 TypeScript / WXML / WXSS，同仓库独立应用。底部四入口：首页、卡牌、预组、规则。首页是启动台（规则 / 卡牌 / 预组三个入口 + 全量搜索）；卡牌页按本体牌／角色牌／手牌分类进入卡列表；预组页展示精选主视觉、新手入口与全部 12 套预组。提供真实卡图与完整效果、本体双面、预组介绍、图文入门、正式规则、本机收藏及最近浏览。

页面结构（`src/pages/`）：

| 页面 | 类型 | 职责 |
| --- | --- | --- |
| `home` | tabBar | 启动台：品牌、全量搜索、规则／卡牌／预组三个入口、收藏与最近浏览 |
| `cards` | tabBar | 图鉴入口：本体牌 12 / 角色牌 120 / 手牌 20 |
| `collection` | 栈页 | 分类卡列表：搜索、手牌子筛选、角色定位／预组筛选、收藏筛选 |
| `decks` | tabBar | 预组：精选 swiper、新手入口、12 套网格、收藏与最近浏览 |
| `deck-detail` | 栈页 | 单套预组：本体、简介、核心操作、16 张角色 |
| `detail` | 栈页 | 单卡：完整卡面与高清预览、双面文字、收藏、相关预组、分享 |
| `rules` | tabBar | 六步入门、正式规则目录、关键词 |
| `history` | 栈页 | 最近浏览全部 |
| `website` | 栈页 | 官网地址展示与复制（内嵌开关见 `src/config.ts`） |

`collection` 必须是非 tabBar 页面：tabBar 页面之间只能 `switchTab`，`navigateTo` 会报 `can not navigate to a tabBar page`。
它接收 `?kind=` 与 `?fav=1`；`kind` 只认 本体／角色／手牌／全部，非法值回落「全部卡牌」。

## 本地构建

在仓库根目录运行：

```bash
npm ci
npm run mini:test
npm run mini:typecheck
```

在微信开发者工具中导入 `miniprogram/`，项目配置指向生成的 `build/`，不要导入 `src/`。代码或数据修改后重新运行 `npm run mini:build`。占位 `touristappid` 不代表具备真实预览、分享或上传权限；需要所有者提供后台「开发管理 → 开发设置」里的 **AppID**（不要 AppSecret）以及开发者／体验成员微信号，才能真机预览与分享。2026-09-21 已安装微信开发者工具 2.02.2608070（arm64）到 `~/Applications/wechatwebdevtools.app`（官方 dmg，SHA-256 已核对）；导入与登录后的微信编译、真机仍未验证。

`mini:test` 除数据、页面逻辑、存储与文档测试外，还包含原生静态校验（WXML 结构与组件声明、`wx:key`、事件处理是否存在于编译产物、页面配置、WXSS 括号与 at-rule），可把一部分编译期错误前移，但**不能替代微信开发者工具编译**。

`npm run mini:review` 可生成浏览器近似布局截图到忽略目录 `review/`（含竖屏、横屏与大字号近似），仅用于排版检查，不能替代微信工具编译或真机测试。

## 内容入口

- 正式文字：根 `data/cards/`、`data/decks/`、`docs/rules.md`、`docs/keywords.md`。
- 展示配置：`content/presentation.json`，维护精选顺序、预组简介和入门；引用由构建校验。
- 图源：`src/config.ts`。包内 12 张压缩本体原画；普通卡面／高清图按需从开发默认域名加载。2026-09-21 已核对全部 396 条路径可达且与本地构建逐字节一致，但这是「此刻一致」，不是版本锁定；发布前仍需绑定同一内容发布版本并在微信内实际加载。
- 骑士卡无正式成卡图，显示正式文字。手牌一条定义含多种花色／点数卡面。
- 收藏和最近浏览仅在本机存储；离线仍能看随包文字和本体原画，未缓存的远程卡图不可保证可用。
- `build/`、`src/generated/catalog.json`、`review/` 都是生成物，不手改。

[产品规格](../docs/miniprogram-product.md) · [架构](../docs/miniprogram-architecture.md) · [验收状态](../docs/miniprogram-verification.md) · [WorkBuddy 交接](../docs/miniprogram-handoff.md)

当前微信开发者工具、iOS／安卓真机与首次玩家体验仍待验；官网内嵌因个人主体与备案要求不满足而保持关闭，仅提供复制网址。未提交、推送、上传审核或发布；现有 `.workbuddy/` 内容未改动。
