# 微信图鉴架构

2026-09-21 · `codex/wechat-card-encyclopedia` · [产品规格](miniprogram-product.md)

## 工程边界

同仓库独立原生微信应用：TypeScript + WXML + WXSS，复用根依赖和锁文件。不引入 Astro、React、对战 Worker、登录、云数据库或远程内容更新。正式卡牌／预组／规则始终只有一套来源。根 mini:* 脚本与网站、服务端构建相互独立；不迁移存档。

## 数据流

`data/cards/*.json`、`data/decks/*.json`、正式规则 Markdown → `tools/miniprogram/catalog.mjs` → 随包 `src/generated/catalog.json` → `services/catalog.ts` → 页面。

展示文案独立于规则：`miniprogram/content/presentation.json` 管理精选预组顺序、各预组简介／核心操作、六步入门和规则章节引用。所有卡牌／预组／章节引用构建时校验，页面不解析技能文本制定规则。扩展此配置即可替换精选内容。

Catalog schemaVersion 为 2：
- Card 保留稳定 ID、名字、牌种、定位、标签、faces、全部 sections。每个本体 Face 带对应 sections；普通查询仍检索所有正式技能。Z 背面包含继续生效的正面特性，其余额外形态不重复正面技能。
- Deck 包含正式本体和角色 ID、编辑简介、原画路径、本体名；归属从所有 Deck 引用计算。
- Article 按章节生成唯一 anchor 和安全原生 blocks。`markdown.mjs` 生成段落、列表、强调、引用、表格行及单元格；外链保留标题、不加载远程 HTML。重复标题不丢弃。组件使用 text，不把文本交给 HTML 执行器。
- contentVersion 为内容、展示配置和原画哈希的摘要，构建结果可重现；它不是发布状态，也不证明远端卡图与文字一致。

生成目录和 build 不手改、不提交。正式卡牌数据仍按根约定维护。

## 图源与包体

统一 `imageUrl` 适配现在只接受包内绝对路径。`/assets/card-thumbs/` 放 198 张卡册图；`/cardpack-01/` 至 `/cardpack-08/` 按卡牌分配全部高清面。同一张卡的正背面或手牌花色都在同一分包。卡册打开无需下载高清包，进入单卡详情时由路由加载对应分包；旧 `/pages/detail/index?id=` 链接会转到新路径。分享链接保留主包兼容入口：分包可用时跳转高清详情，下载失败时在主包显示对应缩略图、完整文字及重试入口。普通入口加载分包失败时也回退到该主包页面，不自动重试请求。

构建从 `public/cards-hd/` 的正式成卡图重编码，不修改原图或 manifest：本体缩略图 240px／WebP 质量 60，角色 150px／质量 60，手牌 120px／质量 48；本体与角色高清图保留 750px／质量 70，手牌高清图降至 650px／质量 58。12 张本地本体原画为 320px／JPEG 质量 60。图片配置随目录版本一起进入 `contentVersion`。构建逐项检查主包和每个分包低于 2,000,000 字节、总包低于 20,000,000 字节，不再使用旧 1.5 MiB 主包内部预算。

详情页脚本由同一源码复制到 8 个分包，只调整相对共享服务导入；WXML／WXSS／JSON 同步复制，避免分包版与旧深链版行为分叉。微信原生 `wx.previewImage` 在本轮工具中对包内路径停留加载画面，高清查看改为详情页内的全屏 `movable-view` 缩放，仍显示同一张本地图。真机双指操作尚未验收。

本轮正式本地构建约 1.83 MB 主包、最大 1.67 MB 分包、总计 13.91 MB；精确字节数和实际覆盖见[第十轮验收记录](miniprogram-verification.md)。正式上传包大小及 iOS／安卓真机画质、缩放性能仍待验，不能把本地文件尺寸等同于已过上线审核。

## 页面与服务

四个 tab：home、cards、decks、rules；栈页：collection、detail、deck-detail、history、website、about。tabBar 文案为 首页／图鉴／预组／指南。

- **home 是收藏室场景**：包内暖色场景底 + 品牌与官网入口 + 全量搜索；中部是**本体精选卡架**（两侧卡背衬托中间正式完整成卡图，点击进详情，旁给预组入口）；下方是图鉴／入门入口、精选预组横向卡册，以及按需出现的收藏与最近浏览。名称、流派、数量都从 `catalog` 与 `presentation` 读取，页面不写死卡牌文字。
- **cards 就是图鉴列表**（tabBar，直接显示卡面网格，不再只是入口）：`GROUPS` 决定牌种，`kind` 只接受 本体／角色／手牌／全部，非法值回落「全部卡牌」。**「手牌」= 基础牌 + 行动牌**。骑士卡不从正式数据导出到图鉴目录；查找、收藏、历史清理由同一目录判定，正式骑士卡数据与规则保持不变。搜索常驻，牌种切换常用可见，定位与预组筛选折叠在「筛选 ＋」内，另有「全部／已收藏」与清空条件。
- **collection 是旧深链兼容页**（非 tabBar）：与 `cards` 共用同一套 `GROUPS`/`SUBS`/筛选逻辑，供 `?kind=`/`?q=`/`?fav=1` 直达使用。**两处筛选口径必须同步维护并回归**，改动任一侧都要跑 `mini:test`。
- **decks 承接原首页内容**：精选预组主视觉、六步入门入口、全部 12 套预组网格、收藏与最近浏览。
- **deck-detail**：本体摘要 + 玩法简介 + 核心操作，下方 16 张角色可按定位筛选并显示各定位数量，再次点击同一项复位为全部。
- **detail**：视觉列（卡面、形态切换／picker、高清预览、重新加载）+ 阅读列（「卡牌事实」与「完整效果」两段、一键复制当前卡面文字）。
- **rules**：章节目录 → 单章阅读两级，显示 n/34，上一篇／下一篇首末自动禁用越界，可返回目录。
- **about（关于与隐私）**：从首页底部进入，只读页面，无 tabBar 入口。承载隐私说明（不登录、记录只在本机、只写剪贴板、卡图随包、无统计与广告）、功能范围、备案号、随包内容版本与包内图源说明。备案号来自 `src/config.ts` 的 `ICP_FILING_NUMBER`，为空时不渲染该行；文案与数组都写在页面自身，不进 `presentation.json`。
- tabBar 页面之间只能 `switchTab`，`navigateTo` 会报 `can not navigate to a tabBar page`。
- **`navigateTo` 的中文查询参数到达页面时仍是百分号编码**，`cards` 与 `collection` 的 `onLoad` 都必须自行 `decodeURIComponent`（安全包装，失败时不抛）。已在开发者工具内实测：未解码时 `?kind=本体` 会一路落到「全部卡牌」。
- catalog 服务集中查询和归属映射，列表只下发缩略字段。
- navigation 服务集中所有跳转与返回：`browse`（全量搜索／仅收藏，走 collection 栈页以保留返回路径）、`openCollection`、`openCard`、`openDeck`、`openAbout`、`openGuide`。普通返回不会重置筛选。页内滚动交给原生页面保留，原生验收需复核。
- storage 服务使用 `baolvtuan-library-v1` 本机键，校验、去重、剔除无效 ID，历史最多 30。同步读写均捕获错误并提示；失败后会话内继续工作，不自动承诺保存成功。减少动态效果偏好也在本机。
- card-tile 组件提供卡面／缺图占位与重试、统一详情事件。document-blocks 组件以原生文字呈现正式规则。
- 图片失败不会删卡或隐藏文字；非法路由有返回入口。微信分享路径只使用稳定卡牌 ID。

## 验证与交接

`mini:test` 构建后执行数据／页面逻辑／存储／文档测试，外加原生静态校验：WXML 标签闭合与 `{{ }}` 配对、组件必须已在页面 `usingComponents` 声明、`wx:key` 不得解析为空值或重复、模板内禁止 `&&`（含 `&amp;&amp;`）、每个 `bind*/catch*` 处理函数必须出现在编译产物中、`app.json` 与 build 一致、WXSS 括号与 `@media` 条件受支持。该静态校验**不是 WXML 编译器或微信事件模拟器**，只能把编译期错误尽量前移。`mini:typecheck` 使用官方 API 类型。`mini:review` 将实际模板与页面快照近似转换为浏览器布局，检查本地图片及溢出，含 320／390／430 竖屏、844×390 横屏与放大 1.3 的大字号近似，同样不能证明分享、原生控件、安全区和真机工作。

生成物与可复现性：`src/generated/catalog.json` 以压缩形式输出（随包体积），规则块与文本片段带构建期生成的稳定 `key`，供 WXML 列表使用；包体预算仍为 1.5 MiB。

[验收记录](miniprogram-verification.md)与[WorkBuddy 清单](miniprogram-handoff.md)记录待完成原生验证。当前无需新增服务。本轮仅本地实现，不提交、推送、上传审核或发布。

新增 website 栈页：固定官网 URL 与独立内嵌开关见 config.ts；当前仅复制网址，验证账号能力／业务域名后启用 web-view，加载失败回退复制页。禁止通过路由传入任意网址。

## 收藏册素材与展示配置（2026-09-22）

`presentation.homeExhibit` 保存精选预组 ID 和介绍插画路径；导出校验正式预组引用。首页名称和流派从目录读取，构建根据预组本体的正式 `hdImage` 生成首页本地卡图，避免页面写死卡牌文字。`branding/collector-library-v2.png` 是场景，`collector-character-v2.png` 是透明介绍角色；早期 `collector-hero-v2.png` 仅保留设计素材，不进入运行包。构建压缩本地展示图及正式牌背，仍遵守 1.5 MiB 内部预算。普通查询图源与高清预览适配不变。

`branding/icons` 保存 Tabler SVG 与 MIT 许可证，构建生成默认／选中 PNG，无运行时图标依赖。`mini:review` 同时读取 app 与对应页面 WXSS，输出仅为浏览器布局近似验证。cards 直接使用完整筛选页面行为，collection 保留兼容入口，两处需同步维护并回归。

### 首页卡架轮播

`home` 以 `homeExhibit.deckId` 为首项，随后引用其余正式预组；原生 swiper 与显式上一组／下一组共用选择状态。只有 touch 来源的 swiper 变化更新选择，避免延迟的程序回调覆盖新选择。卡面、正式效果、名称与详情路由由同一预组和 face 索引派生。换组恢复正面；异步图片错误按索引与版本过滤。图源继续复用 imageUrl，首项正面沿用随包卡图，不增加全部本体的包体开销。

浏览器近似渲染为 swiper-item 补齐原生默认宽高；此适配仅影响布局检查，不替代微信手势验证。
