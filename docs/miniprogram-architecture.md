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

统一 `imageUrl` 适配：`/assets/` 为包内精选原画；`/cards/` 和 `/cards-hd/` 由 `src/config.ts` 的 HTTPS 基址提供。卡册加载普通缩略图，详情只加载当前卡面高清图，点击预览使用原生图片预览。

构建读取 `data/card-art.json` 中本体正面原画对应的已有 Web 原画，使用 sharp 缩至 600px、JPEG 质量 76，输出 12 张包内原画。不修改 manifest、原画或正式成卡。包内原画让首页和预组在离线时仍可展示，全部卡面和高清图不入包；构建内部预算 1.5 MiB，当前约 1.14 MiB，以日志为准。

当前卡图域名仅为开发默认值。生产 AppID、图源可达性、域名配置、版本固定资源方案及图文一致性均未验收。上线前必须将普通／高清卡面绑定同一内容发布版本，检查全量资源；不能靠添加查询参数或内容摘要宣称远端版本已锁定。

## 页面与服务

四个 tab：home、cards、decks、rules；栈页：collection、detail、deck-detail、history、website。

- **home 是启动台**：品牌区 + 全量搜索入口 + 三个 portal（规则 / 卡牌 / 预组）+ 本机收藏与最近浏览。三个 portal 分别 `switchTab` 到 rules、cards、decks。
- **cards 是图鉴入口**：本体牌 / 角色牌 / 手牌三个分类 portal，`navigateTo` 到 collection。卡片数由 `catalog` 计算，不手写。
- **collection 是分类列表页**（非 tabBar）：`kind` 只接受 本体／角色／手牌／全部，非法值回落「全部卡牌」；手牌把基础牌、行动牌与骑士卡合在一起并提供子筛选，角色额外提供定位与预组筛选。搜索与收藏筛选都在这一页。
- **decks 承接原首页内容**：精选预组 swiper、六步入门入口、全部预组网格、收藏与最近浏览。
- tabBar 文案为 首页／卡牌／预组／规则，与三个 portal 的命名一致。
- tabBar 页面之间只能 `switchTab`，`navigateTo` 会报 `can not navigate to a tabBar page`；collection 因此必须是非 tabBar 页面。
- **`navigateTo` 的中文查询参数到达页面时仍是百分号编码**，onLoad 必须自行 `decodeURIComponent`（安全包装，失败时不抛）。已在开发者工具内实测：未解码时 `?kind=本体` 会一路落到「全部卡牌」。
- catalog 服务集中查询和归属映射，列表只下发缩略字段。
- navigation 服务集中所有跳转与返回：`browse`（全量搜索／仅收藏）、`openCollection`、`openCard`、`openDeck`、`openGuide`。普通返回不会重置筛选。页内滚动交给原生页面保留，原生验收需复核。
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
