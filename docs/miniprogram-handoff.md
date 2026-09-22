# WorkBuddy 接手清单

2026-09-21 · 分支 `codex/wechat-card-encyclopedia`。本轮实现沉浸式图鉴，本地未提交。

## 开始工作

1. 检查分支和工作区；保留已有未提交改动及 `.workbuddy/`，不要重新搭建第二份项目或卡牌数据。
2. 阅读根 AGENTS、小程序 AGENTS、[产品规格](miniprogram-product.md)、[架构](miniprogram-architecture.md)、[验收记录](miniprogram-verification.md)。
3. 根目录执行 `npm ci`、`npm run mini:test`、`npm run mini:typecheck`；在微信开发者工具导入 `miniprogram/`，指向 `build/`。
4. 配置所有者 AppID、开发成员和图源域名。`miniprogram/project.config.json` 里当前是测试号 `wx8591a63877e25cf1`（可编译、可跑模拟器，但不能配置服务器域名、不能上传发布），连同开发图源都**不是已完成上线准备**。不要索取 AppSecret 或提交个人工具配置。

## 已实现

四个 tab（首页／图鉴／预组／指南）、四个栈页（collection／detail／deck-detail／history）加官网页。首页为丰富暖色收藏室与正式精选卡牌，图鉴直接进入可搜索卡册，旧 collection 深链保留。预组网格和详情统一视觉，上头组介绍保留角色出框。详情双面配套文字、手牌 picker、高清预览、收藏和分享路径保留；指南仍含图文入门、正式规则与关键词。详见 2026-09-22 产品修订及 `miniprogram/design-qa.md`。

152 条卡牌定义、12 套预组、两份规则均取正式源。12 张压缩原画随包，卡面远程按需。展示配置在 `miniprogram/content/presentation.json`，新增介绍不在页面写技能。规则冲突保留并记入验收，不自行裁定。

## 下一步顺序

1. **真正的微信编译与体验**：~~当前机器未发现开发者工具~~ → **第四轮已完成**：工具 2.02.2608070 已装，工程编译通过、8 页全部渲染、运行时 0 报错；WXSS 通配符、WXML 实体、`user-select` 行内流三个阻塞缺陷已修并加了防回归。**第五轮**在改版后复跑：9 页全部渲染、运行时 0 报错，并抓到「中文查询参数不自动解码」这一只有真环境才暴露的缺陷。换正式 AppID 后需再复验一次。
2. **完整流程**：首页三个入口→对应 tab；卡牌分类→collection 列表→详情；预组→预组详情；查卡组合筛选、收藏筛选、返回搜索条件与原生滚动位置；本体多次连续翻面与配套文字；手牌 picker、高清预览；规则目录与返回；分享直达后的继续浏览。
3. **异常与记录**：离线随包文本、本体原画；远程图片失败／重试；模拟写存储失败；收藏重启保存；最近浏览去重、上限 30、失效 ID 清理；非法详情 ID。
4. **多端**：320／390／430 竖屏、844 横屏，真实安全区、大字号、系统减少动态效果及应用静态开关。iOS／安卓分别记录机型、微信与基础库版本、实际结果和截图。首次新玩家完成找预组／读入门的任务另作人工验收。
5. **生产准备**：验证版本一致的普通／高清图源、微信访问与域名、真实 AppID、分享路径。处理规则负责人对体力归零／救援历史冲突的确认。现有开发地址不能直接写为“生产已验收”。

## 命令

```bash
npm run mini:data
npm run mini:data:check
npm run mini:typecheck
npm run mini:test
npm run mini:review    # 浏览器排版近似检查，不替代微信
npm run validate
npm run typecheck
npm run build
```

`mini:review` 使用现有 Playwright，生成 `miniprogram/review/` 截图与 layout-results.json。若环境没有浏览器，需要先安装与现有 Playwright 对应的 Chromium；仅为开发检查，不纳入小程序运行依赖。

每次更新对应项目状态和 MP-01；区分工程、浏览器、微信、真机和发布。未经用户明确授权，不提交、推送、上传审核、发布或创建云资源。


## 首页官网入口补充

首页标题旁新增“官网 ↗”，进入独立 website 页。固定官网地址来自项目 README：`https://qunyou-tcg.pages.dev`，在 `src/config.ts` 单独维护，不随卡图域名变化。当前 `OFFICIAL_WEBSITE_EMBED_ENABLED=false`，展示可选中网址与明确的复制按钮；不自动操作剪贴板，不声称已打开浏览器。已实现 web-view 路径及加载失败回退，但必须核验真实账号 web-view 能力、当前微信官方要求及业务域名后才启用，不能仅在工具里关闭校验。页面不接受任意外部 URL 参数。

官网原生打开／复制、返回保留图鉴状态仍待微信与真机验证。Node 测试增至 14 项且通过，小程序类型检查通过，包体约 1167 KiB。未提交、推送或发布。


## 2026-09-21 第二轮：原生预检后的接手状态

### 本轮已完成（不需要账号即可推进的部分）

- `mini:test` 从 14 项增到 19 项，新增 4 项原生静态校验（WXML 结构与组件声明、事件处理是否存在于编译产物、页面配置与包体一致、WXSS 括号与 at-rule），并用人为造错的临时模板反向验证过能报错。
- 修掉依赖实体解码的 `&&`、`wx:key="index"/"runIndex"` 这类空键、`inset` 简写、横屏下 hero 固定高度过高、`pageScrollTo` 无兜底、详情页越界卡面等问题；详情页新增「从分享打开」提示。
- `catalog.json` 改压缩输出，包体 1167 → **1077.5 KiB**。
- `mini:review` 扩到 42 项（7 页 × 320／390／430 竖屏 + 844×390 横屏 + 390／320 放大 1.3 近似大字号），无横向溢出、无本地图片缺失。
- 线上 396 条卡面／高清路径全部 200，且与本地构建产物逐字节一致（SHA-1，下载 25.4 MiB，0 不一致）。这只是「此刻一致」，不是版本锁定。
- web-view 能力核验：业务域名不开放给个人主体、必须 ICP 备案并放校验文件，`pages.dev` 无法备案 → **内嵌不可开启**，保持复制网址方案。

### 下一步（都需要账号、设备或规则确认，无法自行推进）

1. **导入 `miniprogram/` 并登录**：微信开发者工具已安装（2026-09-21，2.02.2608070 arm64，位于 `~/Applications/wechatwebdevtools.app`）。启动后扫码登录，选择「导入项目」→ 目录 `miniprogram/`（`miniprogramRoot` 已指向 `build/`），AppID 先用游客或填入真实 AppID。先看编译控制台：模板错误、`wx:key` 警告、组件样式、属性兼容、图片模式。这是唯一能真正替代静态校验的步骤。
   - 想用命令行／自动化：需先在 IDE「设置 → 安全设置」手动打开**服务端口**（默认关闭；2026-09-21 实测命令行管道输入 `y` 与伪终端均无法代替这步）。开启后可用 `~/Applications/wechatwebdevtools.app/Contents/MacOS/cli`（`open`／`preview`／`upload` 等；`preview`／`upload` 仍需登录与真实 AppID）。
2. **AppID 分两步，不必等正式注册**（2026-09-21 结论）：
   - 先就地验证编译：导入时直接选**游客 AppID**（`touristappid`）即可创建项目，能编译、能跑模拟器；但不能生成预览二维码、不能真机、不能分享上传。
   - 要真机与分享：申请**小程序测试号**（开发者工具导入框里点「测试号」，或访问官方测试号申请页扫码，约 1 分钟，免费、无需备案）。测试号支持真机预览与调试，但不能上传发布、不支持支付、不能配置服务器域名／业务域名。之后在「项目 → 更换 AppID」切换。
   - 正式注册仅在上线时需要：个人主体可做「工具」类目，需邮箱＋身份验证，且**必须完成小程序备案**（免费，审核需数周）；个人主体不支持 web-view、微信支付、手机号获取。只需 AppID，任何时候都不要提供 AppSecret。
3. **核心流程逐项走查**（工具里先走一遍，再上真机）：首页→预组→角色详情；组合搜索与收藏筛选；返回后的条件与滚动位置；本体连续翻面与文字同步；手牌花色点数 picker；高清预览与失败重试；收藏重启保存；最近浏览去重与失效 ID 清理；规则目录、关键词与长文；分享直达后继续浏览；断网时随包文字与原画。
4. **真机记录**：iOS 与安卓分别记机型／微信版本／基础库，覆盖 320／390／430、横屏、安全区、大字号、系统减少动态效果。
5. **规则冲突待裁定**：关键词「本体」体力归零即失败 vs 濒死救援；不自行统一。
6. **生产图源版本锁定**：普通／高清卡图需绑定同一内容发布版本（例如按 `contentVersion` 分目录发布），并确认微信内实际加载；当前开发域名不得写成「生产已验收」。

命令保持不变；`mini:test` 现在同时跑原生静态校验，`mini:review` 仍只是浏览器近似。


## 2026-09-21 第三轮：真实工具首启后的实测状态

环境已就位：微信开发者工具 **2.02.2608070**（arm64，`~/Applications/wechatwebdevtools.app`）+ **测试号 AppID `wx8591a63877e25cf1`**，基础库 `libVersion=3.17.3`。

**黑屏已找到确定性根因，不是项目代码问题。** 首次导入时基础库 3.17.3 尚未下载（40.6 MB，官方 CDN），工具在下载完成前就启动模拟器，子进程被 SIGTERM，WXML bridge 三次握手超时，页面树从未建立。详见[验收记录](miniprogram-verification.md)「真实开发者工具首启排查」一节，含完整日志摘录与两种「判断 App 是否真的起来了」的可复用判据。

三条经验，下次别再绕：

1. 冷启动失败后工具会一直复用同一个已死 builder（日志里 `[BuilderFactory] shouldCreate=false generation=7`），此时 `Cmd/Cmd+B` 重新编译无效，**重新打开项目或退出工具重进**才可靠。
2. 报错内容只存在于工具 UI，**不写进任何日志文件**，所以看不到就是看不到——需要人工把原文贴回来。
3. `[ideplugin] get extensions manifest.json catch error Error: not found` 是工具自身插件清单噪音，反复出现也可忽略。

当前缺口（按依赖排序）：

| # | 缺口 | 卡在谁 | 备注 |
| --- | --- | --- | --- |
| 1 | ~~Wxml 面板 2 条报错的原文~~ | **已关闭** | 第四轮改用自动化通道直接订阅运行时 `console`/`exception`，拿到原文并修掉，见下文 |
| 2 | ~~IDE 服务端口授权~~ | **已关闭** | 用户已开启服务端口，`cli open/close/auto` 全通道可用 |
| 3 | ~~模拟器内卡图全失败~~ | **判断已更正** | `wx.downloadFile`/`getImageInfo` 确实被拦，但 `<image src>` 在模拟器里由 IDE 自身网络栈渲染、画面正常，**看不出降级**；真机才会整片白图。仍不得据此判定图片功能已通过 |
| 4 | 上面「下一步」第 3～6 项 | 用户 + 设备 + 规则负责人 | 第 3 项已在第四轮工具内走完；4～6 未变 |

request 合法域名配置需要真实账号在与小程序后台完成；`preview`／`upload` 一律不执行。


## 2026-09-21 第四轮：工具内闭环已完成，只剩账号与设备

小程序现在**在真实微信开发者工具里编译并运行通过**：8 个页面全部渲染，运行时 console **0 报错**，核心流程在工具内实测走通。首启黑屏的根因不是环境时序，而是两个真实代码缺陷（详见[验收记录](miniprogram-verification.md)「真实工具内闭环验证」）。本轮已修：

1. `app.wxss` 里的 `*` 通配选择器——**WXSS 不支持任何形式的通配符**，`wcsc` 遇到即让整个文件编译失败，全站白屏。
2. 规则页 `&amp;` 被当字面量显示——WXML 文本节点不解码 HTML 实体。
3. `document-blocks` 的 `<text user-select wx:for>` 把项目符号顶到单独一行、混排段落被拆行——205 个正文块里 101 个受影响。
4. 生成物 `require` 的 `.json` 后缀问题（微信会自动补 `.js`）。

### 你现在只需要做三件事

1. **决定卡图托管方案**（唯一的生产级阻断）。`<image>` 加载网络图同样受 `downloadFile 合法域名` 管控，真机不配置就整片白图；`pages.dev` 无法 ICP 备案。高清图共 22.4 MB，已超「所有分包合计 20 MB」上限，**不能打进包**。可选：自有已备案域名／已备案 CDN／微信云开发云存储（域名自动进白名单）。决定前请在后台把域名加进 `downloadFile 合法域名`。
2. **裁定规则冲突**：`docs/keywords.md` 第 6 行关键词「本体」写「体力降至 0 时该玩家失败」，与完整规则濒死救援流程冲突。改这一行会同时影响文档与小程序语料，**本轮未改**。
3. **上真机**：iOS／安卓各记机型、微信版本、基础库；覆盖 320／390／430、横屏、安全区、大字号、系统减少动态效果。顺带复验 `wx.previewImage` 真机是否也受域名限制（工具里是成功的）。

### 自动化验证怎么复跑

```bash
CLI=~/Applications/wechatwebdevtools.app/Contents/MacOS/cli
"$CLI" open --project "/Users/w1311823723/Developer/群友杀 TCG/miniprogram"
"$CLI" auto --project "/Users/w1311823723/Developer/群友杀 TCG/miniprogram" --auto-port 3799 --trust-project
# 然后 Node 端 automator.connect({ wsEndpoint:'ws://127.0.0.1:3799' })
```

要点：`mp.screenshot()` 返回 **base64 字符串**不是 Buffer；页面树未建立时 `pageStack()/currentPage()` 会抛错，改用 `mp.evaluate()`；每次只开一个工程窗口，否则 builder 互相干扰。

### 新增的防回归能力

`npm run mini:test` 现为 **21 项**。第 21 项会调用开发者工具自带的 `wcc`/`wcsc` 逐文件真编译（装了工具才跑，没装 `[skip]`），另有两条纯静态兜底：禁用 `*` 选择器、禁止 `<text user-select wx:for>`。三条防线都做过人为注入的反向验证。

`mini:review` 依旧是浏览器近似，不能替代以上任何一项。


## 2026-09-21 第五轮：首页改版与卡牌分类

### 改了什么

按用户反馈重排信息架构并整体升级视觉：

- **首页**变成启动台：品牌区 + 全量搜索 + 「规则 / 卡牌 / 预组」三个分类入口（带序号、强调色、真实数量）+ 收藏／最近浏览。
- **卡牌页**变成图鉴入口：本体牌 12 / 角色牌 120 / 手牌 20 三个分类。
- **新增 `pages/collection`**（非 tabBar 栈页）承载分类列表，搜索、手牌子筛选、角色定位／预组筛选、收藏筛选都在这里。
- **预组页**承接原首页内容（精选 swiper、新手入口、12 套预组网格、收藏与最近浏览）。
- tabBar 文案统一为 首页／卡牌／预组／规则，选中色改金色。
- 视觉：多层径向渐变底色、金色细线 + 菱形节点、分类卡左侧强调竖条与大序号、青色／金色／紫色分类强调色。
  详见[产品规格](miniprogram-product.md#视觉与反馈)。

### 为什么需要新增一个页面

tabBar 页面之间只能用 `switchTab`，`navigateTo` 会报 `can not navigate to a tabBar page`。
所以「卡牌」这个 tab 只能做入口，真正的列表必须是栈页。

### 顺手抓到并修掉的真实缺陷

`navigateTo` 的中文查询参数到达页面时**仍是百分号编码**，`options.kind` 拿到的是 `%E6%9C%AC%E4%BD%93`，
分类匹配失败后静默回落到「全部卡牌」。已在 `collection` 的 `onLoad` 里安全解码，并把编码参数写进 `catalog.test.mjs`。
Node 侧测试发现不了这个（Node 传的是原始字符串），只有工具内驱动才会暴露。

### 复跑命令

```bash
npm run mini:test && npm run mini:typecheck && npm run mini:review
```

工具内驱动（本机已装工具、已开服务端口时）：

```bash
CLI=~/Applications/wechatwebdevtools.app/Contents/MacOS/cli
"$CLI" close --project "$PWD/miniprogram"
"$CLI" open  --project "$PWD/miniprogram" && sleep 12
"$CLI" auto  --project "$PWD/miniprogram" --auto-port 9420 --trust-project
# 驱动脚本见 docs/miniprogram-verification.md 第五轮；自动化依赖装在隔离工作区，用 NODE_PATH 引入
```

单窗口串行，`close` 后再 `open`，否则 builder 会互相干扰。

### 本轮结果

`mini:build` 1091.2 KiB；`mini:test` 21/21；`mini:typecheck`／`mini:data:check`／`validate`／根 `typecheck` 全通过；
`mini:review` 54 个布局无溢出；工具内 9 页 0 报错。未提交、推送、部署、上传审核或发布。
