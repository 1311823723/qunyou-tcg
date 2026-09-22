# 微信图鉴验收记录

日期：2026-09-21。分支 `codex/wechat-card-encyclopedia`。本地实现，无提交／推送／审核／发布。

## 已执行

| 层级 | 结果与边界 |
| --- | --- |
| 静态样稿 | 首页、图鉴、真实长效果详情三页已制作并目视检查，使用真实卡图与本体原画；不是微信截图 |
| Node 逻辑 | `npm run mini:test` 19 项通过：全量数据与正式效果、图源路径／手牌卡面、搜索与过滤、页面处理和异常 ID、路由／生成一致性、正背面文字／Z 保留特性、跨预组归属、展示配置／包内原画、规则块及唯一锚点、存储持久化／清理／去重／上限、读写失败、返回条件与一次性入口意图、首页入门直达／返回详情收藏同步、分享直达与骑士卡文字、WXML 结构与组件声明、事件处理是否存在于编译产物、页面配置与包体一致、WXSS 括号与 at-rule |
| 小程序类型与构建 | `mini:typecheck`、`mini:data:check` 通过；构建 1077.5 KiB，低于项目内部 1.5 MiB 预算；非平台审核结论 |
| 共享项目回归 | `validate`、根 `typecheck`、原网站 `build`（22 页）通过；本轮未改卡牌效果、规则或对战引擎，不宣称重新完成对战浏览器全套验收 |
| 浏览器近似布局 | `mini:review` 读取实际 WXML、WXSS 和页面快照，转换为普通 HTML；首页、图鉴、长效果详情、预组详情、快速入门、最近浏览、官网 × 320／390／430 竖屏、844×390 横屏，另加 390／320 放大 1.3 近似大字号，共 42 项无横向溢出、无本地图片缺失；已目视检查首页、横屏首页、官网回退页、窄屏入门与长效果详情 |
| 远端图源全量比对（2026-09-21） | 对全部 396 条卡面／高清路径逐一请求并与本地构建产物做 SHA-1 比对：全部 HTTP 200，0 条不一致，0 条失败（下载 25.4 MiB）。只能证明「本次请求时刻」的图文一致，不等于已锁定生产版本 |

浏览器布局转换器只用于提前发现排版问题，不运行微信事件系统，不包含真正的 tabBar、安全区、微信字体缩放或原生 picker／swiper／previewImage。截图库在忽略目录 `miniprogram/review/`，可运行命令重建。Node wx mock 不代表微信分享、冷启动或离线网络行为验证。

## 原生及设备待验

状态已按第四轮（真实工具内闭环）更新，逐项证据见下文「真实工具内闭环验证」一节。

| 项目 | 当前状态 | 通过条件 |
| --- | --- | --- |
| 微信工具编译 | **已通过**（2026-09-21 第四轮）：工具 2.02.2608070、基础库 3.17.3、测试号 `wx8591a63877e25cf1` 下编译成功，8 个页面全部渲染，运行时 console 0 报错 | 已达成；换正式 AppID 后需复验一次 |
| 微信完整流程 | **大部分已走通**（第四轮，模拟器 + 自动化驱动）：首页→预组→角色详情、搜索／筛选、收藏落盘、返回滚动位置、本体翻面、手牌花色点数、高清预览、规则三模式与目录、关键词、分享直达、重启清理均已实测，0 报错 | 剩余：真机手势与字体缩放下的手感；`wx.previewImage` 真机待验 |
| 异常网络 | 部分核验 | 已在域名被拦时确认文字仍完整可读（不等于已验断网）；断网／弱网／存储写入失败仍待真机演练 |
| 分享 | 分享直达路径已验证（第四轮）：以 `reLaunch` 模拟「页面栈只剩 1 页」时提示正确出现、「前往图鉴」可用、分享参数含编码后的 id | 真实账号在真机上从聊天卡片进入并返回，仍待验 |
| 本机记录 | **已通过**（第四轮）：重启后收藏保留、最近浏览去重并截断至 30、失效 ID 与非法记录被剔除、`reduceMotion` 持久化 | 已达成 |
| iOS 真机 | 待验 | 记录设备／微信／基础库；320／390／430 或对应设备尺寸、安全区、大字体、横屏、高清和减少动态效果 |
| 安卓真机 | 待验 | 同上；单独验证图片格式、系统动作偏好、字体和返回行为 |
| 首次玩家体验 | 待验 | 新玩家完成认识本体→找到喜欢预组→阅读入门；老玩家完成查效果与收藏，记录困惑点，不以代码完成推断体验改善 |
| 生产图源 | **发现阻断，未验收**：见「生产级阻断：卡图域名」一节。远端 396 条路径可达且与本地构建逐字节一致，但真机受 downloadFile 合法域名管控，`pages.dev` 无法备案 | 需先决定图源托管方案并完成备案域名白名单配置 |
| 正式发布 | 未执行 | 后续单独获得用户授权 |

## 规则核对记录

六步入门分别引用并核对游戏简介／濒死、组件／区域、开局、回合／摸牌／布阵／弃牌、出牌／结算顺序、休整／退场／濒死。没有新增玩法或改变费用时点。

待规则负责人确认：关键词“本体”的“体力降至 0 即失败”与同文件濒死条款及完整规则的救援流程冲突；导出保持正式源，未自行统一。正式规则已有重复判定／拼点章节，本轮不合并，使用不同锚点完整保留。钛晶化待定文字不变。


## 首页官网入口补充

首页标题旁新增“官网 ↗”，进入独立 website 页。固定官网地址来自项目 README：`https://qunyou-tcg.pages.dev`，在 `src/config.ts` 单独维护，不随卡图域名变化。当前 `OFFICIAL_WEBSITE_EMBED_ENABLED=false`，展示可选中网址与明确的复制按钮；不自动操作剪贴板，不声称已打开浏览器。已实现 web-view 路径及加载失败回退，但必须核验真实账号 web-view 能力、当前微信官方要求及业务域名后才启用，不能仅在工具里关闭校验。页面不接受任意外部 URL 参数。

官网原生打开／复制、返回保留图鉴状态仍待微信与真机验证。Node 测试增至 14 项且通过，小程序类型检查通过，包体约 1167 KiB。未提交、推送或发布。


## 原生预检与体验修整（2026-09-21 第二轮）

目标：在没有开发者工具、没有真机的前提下，把「微信编译／原生交互」的风险尽量前移，并完成不依赖账号的修整。**以下结论全部是静态或浏览器近似结论，不是微信编译或真机结论。**

### 新增的原生静态校验

`tools/miniprogram/native-lint.test.mjs`，随 `npm run mini:test` 执行 4 项：

1. WXML 结构：标签闭合、`{{ }}` 配对、只使用内置组件或本页 `usingComponents` 已声明的组件、`wx:key` 不得解析为空或重复值、禁止模板内 `&&`（`&amp;&amp;` 转义同样禁止，改为页面数据预计算）。
2. 事件处理：每个 `bind*/catch*` 的处理函数必须存在于编译产物中。
3. 配置：`app.json` 的页面／tabBar 与 build 产物一致，各 `usingComponents` 指向存在 `.js/.json/.wxml` 的组件。
4. WXSS：括号配对、`@import` 存在、`@media` 只使用受支持条件。

已用一份人为造错的临时模板反向验证：未闭合标签、`&&`、未声明组件、`wx:key="index"`、缺失处理函数、WXSS 括号与 `min-widthg` 拼写错误均被准确报出（验证后删除该临时文件）。

### 本轮代码修整

- 去掉 WXML 中的 `&&`（`card-tile`、`detail`），改为数据字段与 `wx:if/wx:elif/wx:else` 分支，避免依赖实体解码或非严格 XML 解析。
- 列表键稳定化：`sections`／`visibleFaces` 在页面内附 `key`，规则块与内嵌文本在 `markdown.mjs` 生成 `key`，表格单元格改为 `{key,runs}`；消除 `wx:key="index"`／`wx:key="runIndex"` 这类解析为空值的写法。
- `app.wxss`：`inset:0` 展开为 `top/left/right/bottom`（兼容较旧内核）；`.screen` 与 340px 断点补左右安全区；新增横屏媒体查询（hero 改 56vh、网格 4 列、详情图 58vh），修复 844×390 下 hero 固定 360px 过高的问题。
- 详情页越界卡面不再改变当前卡面；`retry()` 同时刷新图片与卡面列表；分享直达（页面栈只有本页）时显示提示并把「前往图鉴」提升为主按钮。
- 规则页 `pageScrollTo` 统一带 `fail` 兜底，避免首屏布局前的失败提示。
- `catalog.json` 改为压缩输出：包体从约 1167 KiB 降到 1077.5 KiB（省约 90 KiB），低于内部 1.5 MiB 预算。
- `src/config.ts` 补记 web-view 核验结论（见下）。

### 官网 web-view 能力核验（2026-09-21）

按微信开放文档《业务域名》与《域名管理》核验：

- web-view 必须配置「业务域名」，**不开放给个人类型账号**（个人主体不支持）；配置需管理员扫码。
- 业务域名必须已 ICP 备案、HTTPS、且在域名根目录放置微信校验文件，新备案域名需 24 小时后才能配置。
- 当前官网 `https://qunyou-tcg.pages.dev` 是 Cloudflare Pages 的 `pages.dev` 二级域名，无法 ICP 备案。

结论：在当前域名与未确认主体类型的前提下，内嵌 web-view **不具备开启条件**，`OFFICIAL_WEBSITE_EMBED_ENABLED` 保持 `false`，继续使用诚实的「复制网址 + 请在浏览器打开」方案。不通过关闭开发者工具域名校验来假装完成配置，也不声称小程序能直接唤起外部浏览器。若后续具备「非个人主体 + 已备案自有域名」，再按业务域名流程验证后开启。

### 仍需账号／设备／规则才能推进

| 事项 | 需要什么 | 谁提供 |
| --- | --- | --- |
| 微信编译与原生交互 | ~~本机安装微信开发者工具~~ 已装 2.02.2608070（arm64）。剩余需要：Wxml 面板那 2 条报错的原文、以及 IDE 服务端口授权 | 用户 |
| 真实预览／分享／体验版 | 小程序 AppID（后台「开发管理 → 开发设置」，非 AppSecret）、开发者与体验成员微信号 | 用户 |
| 图源白名单 | **第四轮更正**：此前记录的「当前用 `<image src>` 直连不需白名单」**不成立**。`<image>` 加载网络图同样走 downloadFile 合法域名管控，只是开发者工具的模拟器用了自己的网络栈才显示正常，真机不配置必然失败。详见下文「生产级阻断：卡图域名」 | 用户决定托管方案 + 在小程序后台配置已备案域名 |
| 业务域名 | 主体类型（个人／企业）＋ 已备案自有域名＋校验文件 | 用户 |
| iOS／安卓真机 | 设备与微信版本，逐项记录 320／390／430、横屏、安全区、大字体、减少动态效果 | 用户 |
| 规则冲突 | 关键词「本体」体力归零即失败 vs 濒死救援的裁定 | 规则负责人 |

未提交、推送、部署、上传审核或发布。


## 真实开发者工具首启排查（2026-09-21 第三轮）

环境：微信开发者工具 **2.02.2608070**（arm64），装于 `~/Applications/wechatwebdevtools.app`（`/Applications` 写入被系统拒绝，`ditto --noextattr` 绕过 `com.apple.provenance` 后成功）；测试号 AppID `wx8591a63877e25cf1`；项目路径 `/Users/w1311823723/Developer/群友杀 TCG/miniprogram`；基础库锁定 `libVersion=3.17.3`。

### 现象

首次打开后模拟器全黑，左侧 Wxml 面板出现报错条数。

### 根因（已从工具日志证实，非推测）

工具日志目录：`~/Library/Application Support/微信开发者工具/422df18f5fd78e913ac99c1bfc3970b6/WeappLog/logs/`

```
20:31:03 [ERROR][PROJECT] [appservice] simulator launch catch error Error: simulator launch failed
20:31:03 [ERROR][BACKEND][SummerProcess][ForkProcess] child exit … signal=SIGTERM settled=true
20:31:08..20:31:20 [WARN][PROJECT][WXML bridge] ack timeout { handshakeId: 1, reason: 'hello', retries: 3 }
20:31:02 [ERROR][MAIN][ideplugin] get extensions manifest.json catch error Error: not found   ← 工具自身噪音，反复出现，与本项目无关
```

同一个时间点，`WeappLog/logs/2026-09-21-17-53-23-652.log` 记录了真正的原因：**基础库 3.17.3 当时还没有下载**。`simulator launch failed` 发生在这之前 1 秒：

```
20:31:04 [vendor-download] downloadVendor start  url=https://res.servicewechat.com/weapp/public/commlib/1647.wxapkg version=3.17.3
20:31:27 [vendor-download] step2: download completed  downloadElapsedMs=23076  fileSizeBytes=40639664
20:31:27 [vendor-download] step3: verify passed
   → ~/Library/Application Support/微信开发者工具/422df18f5fd78e913ac99c1bfc3970b6/WeappVendor/3.17.3.wxvpkg（40,639,664 B）
```

即：**首次冷启动抢跑，基础库包（40.6 MB）尚在下载，模拟器进程被 SIGTERM，WXML bridge 三次握手超时，页面树从未建立**——黑屏是环境时序问题，不是本项目模板被拒。

> `[ideplugin] get extensions manifest.json catch error Error: not found` 在同一份日志里重复十余次，出现在窗口初始化阶段，**属于工具自身的插件清单噪音，可以放心忽略**。

### 恢复验证

基础库落盘后，20:46 的重新构建触发文件监听 → 重新编译 → **小程序已真正起来**，证据来自 App 生命周期日志：

```
~/…/WeappSimulator/WeappFileSystem/o6zAJs5BwhrO1GZo0nmLdo8MYLz8/wx8591a63877e25cf1/usr/miniprogramLog/log1
20:46:36 [log] App onLaunch have been invoked
20:46:36 [log] App onShow   have been invoked
20:47:52 [log] App onLaunch have been invoked
20:47:52 [log] App onShow   have been invoked
```

反向印证：`App onLaunch` 之前，全盘搜索不到本项目存储键 `baolvtuan-library-v1`（只在 `WeappCompileCache` 里命中源码字符串）——说明在此之前 **App 进程根本没有执行过**，黑屏不是业务代码崩溃。反向印证之二：期间 `[BuilderFactory] getBuilder … shouldCreate=false generation=7` 反复复用同一个已死的 builder，`Ctrl/Cmd+B` 的重新编译在冷启动失败后不会自动换掉它，**需要重新打开项目或退出工具重进**才可靠。

### 仍未闭环（待人工）

1. ~~Wxml 面板那 2 条报错的**原文未取到**~~ → **第四轮已解决**。不必读截图：用 `cli auto` 开启自动化端口后，`miniprogram-automator` 订阅 `console`／`exception` 事件即可直接拿到运行时错误原文。那 2 条报错是两条互不相干的真实缺陷，均已在第四轮定位修复。
2. ~~IDE 服务端口仍关闭~~ → **第四轮已解决**：用户开启服务端口后（`Default/.cli` = `3799`），`cli open / close / auto` 全通道可用，本轮全部动态结论都建立在这条通道上。
3. **第四轮更正**：`urlCheck: true` 下模拟器并非「卡图全部请求失败」。`wx.downloadFile`／`wx.getImageInfo` 确实报 `url not in domain list`，但 `<image src>` 由 IDE 自身网络栈渲染，截图中卡图照常显示——因此看不出回退，反而容易误判成「真机也没问题」。真机上 `<image>` 同样受 downloadFile 合法域名管控，不配置会整片白图。**不计为图片功能验收通过**。

本轮再次全绿：`mini:build` → `1077.5 KiB`；`mini:test` 19 项通过；`mini:typecheck`、`mini:data:check` 通过。未提交、推送、部署、上传审核或发布。


## 真实工具内闭环验证（2026-09-21 第四轮）

环境同上一节（工具 2.02.2608070 / 基础库 3.17.3 / 测试号 `wx8591a63877e25cf1` / `urlCheck: true`）。这一轮**在真实微信工具里编译并驱动运行**，不再依靠静态推断。

### 可复现的自动化验证通道

不必人肉点击，也不必让模型读截图：

```bash
CLI=~/Applications/wechatwebdevtools.app/Contents/MacOS/cli
P="/Users/w1311823723/Developer/群友杀 TCG/miniprogram"
"$CLI" open --project "$P"                                    # 打开工程
"$CLI" auto --project "$P" --auto-port 3799 --trust-project    # 开自动化端口
```

Node 侧用 `miniprogram-automator`：`connect({ wsEndpoint: 'ws://127.0.0.1:3799' })` 之后，
`mp.on('console'|'exception')` 拿运行时错误原文，`mp.evaluate()` 在 app service 线程里直接调
`getCurrentPages()` 和页面方法，`mp.screenshot()` 取画面。

三个实测坑，记下来省一次返工：

- `mp.screenshot()` 返回的是 **base64 字符串而不是 Buffer**。直接 `writeFileSync` 会写出文本文件（本轮因此先排查了一轮「截图为空」）。
- `mp.pageStack()` / `currentPage()` / `navigateTo()` 在页面树尚未建立时会抛
  `Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null`；
  此时 `mp.evaluate()` 依然可用，**用 evaluate 代替这些 API 更稳**。
- 必须先用 `cli close` 关掉上一个工程、单窗口串行。多窗口并行时 builder 会互相干扰，
  对照试验整体失灵——本轮曾据此把「项目路径含空格」误判为黑屏原因，实为假线索。
- `cli open` 之后紧接着 `cli auto` 可能抢跑失败；两步分开、中间留约 10 秒更可靠。

### 阻塞性缺陷（均已修复，附根因与定位手法）

#### ① WXSS 通配选择器 → 全站白屏（首启黑屏的真正原因）

模拟器全白，工具只给一句 `编译 .wxss 文件错误`，Wxml 面板 2 条报错且原文不进日志。
改用**开发者工具自带的 WXSS 编译器**直接编译，几秒拿到确切位置，不必二分试错：

```bash
WCSC=~/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc
"$WCSC" -lc miniprogram/build/app.wxss -o /tmp/out.js
# ERR: app.wxss(1:3277): unexpected token `*`
```

结论：**WXSS 不支持任何形式的通配选择器**——`*`、`.a *`、`.a > *`、`*.b` 逐一实测全部报错，
且 `wcsc` 遇到即让**整个文件**编译失败（不是跳过该条规则）。受影响的是两处「减少动态效果」规则：
`.reduced *{…}` 与 `@media(prefers-reduced-motion:reduce){*{…}}`。
修法：逐个列出真正带动的类——`.reduced .fade,.reduced .face-image,.reduced .detail-image` 及其媒体查询版本。

#### ② `require("../generated/catalog.json")` → 首页抛错

微信会给 `require` 的参数补 `.js`，于是报 `module 'generated/catalog.json.js' is not defined`。
生成物改为 CommonJS 的 `catalog.js` 加手写 `catalog.d.ts`，删除旧的 `.json`。

#### ③ WXML 不解码 HTML 实体

用 `wcc` 实测：`<view>A &amp; B</view>` 编译出字面量 `'A &amp; B'`，读者看到的就是 `&amp;`；
而 `<view>A & B</view>` 编译出 `'A & B'`。规则页页眉因此一直显示 `LEARN &amp; EXPLORE`，已改为直接写 `&`。

#### ④ `<text user-select wx:for>` 破坏行内流 → 列表与混排段落碎裂

用最小复现工程做同页对照（临时目录 `_diag/inline`，验证后删除）：

| 写法 | 结果 |
| --- | --- |
| `marker` + 插值文本，无属性 | 同一行 |
| `marker` + `<text user-select>`，无 `wx:for` | 同一行 |
| `marker` + `<text wx:for>`，无 `user-select` | 同一行 |
| `marker` + `<text user-select wx:for>` | **项目符号独占一行** |
| 外层 `<text user-select>` 包住内层 `wx:for` | **仍然断行** |
| 去掉 `user-select` | 同一行，多个 run 也能连排 |

即：只要 `user-select` 与 `wx:for` 出现在同一子树内，该 `<text>` 就被提升为块级。
影响面：规则正文 205 个块中共 **101 个**（92 个列表 + 9 个「加粗 + 正文」混排段落）。
修法：`document-blocks` 去掉 `user-select`（项目文档没有「可选中／长按复制」要求，去掉无功能损失）。

### 防回归：把工具自带的编译器接进测试

此前记的「静态校验不是编译器」已不再成立——开发者工具自带 `wcc`（WXML）与 `wcsc`（WXSS），本机可直接调用：

```bash
APP=~/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec
"$APP/wcsc" -lc <file.wxss> -o /tmp/o.js   # 输出含 ERR: 即失败
"$APP/wcc"  <file.wxml> -o /tmp/o.js       # 有任何输出即失败
```

已接入 `tools/miniprogram/native-lint.test.mjs` 第 21 项「packaged WXML/WXSS compile with the real WeChat compilers」：
装了工具就逐文件真编译，**没装则 `[skip]` 并打印提示**，CI 无 IDE 也不会误报。

另加两条纯静态兜底（不依赖工具，任何环境都跑）：禁用通配选择器；禁止 `<text user-select wx:for>`。

三条防线都做了人为注入的反向验证：把 `*` 塞回 `app.wxss` → 第 19、21 项同时失败并给出原始行号 `(1:3458)`；
把 `user-select` 塞回 `document-blocks` → 第 16 项失败并给出 `components/document-blocks/index.wxml:2`。
注入后均已还原，`mini:test` 停在 **21/21 通过**。

### 工具内实测通过的核心流程

| 流程 | 实测结果 |
| --- | --- |
| 四个 tab 页 | 首页／图鉴／预组／指南全部渲染，运行时 console 0 报错 |
| 非 tab 页 | 卡牌详情、预组详情、最近浏览、官网页全部渲染 |
| 搜索 | `出刀`→38、`刺客`→4、`柯柯`→10、不存在词→0，重置回到 152 |
| 筛选 | 类型=角色→120、定位=伏击→20、预组=上头组→2，组合筛选正确 |
| 收藏 | 点击开、再点关；`baolvtuan-library-v1` 同步写入；仅收藏过滤生效 |
| 返回与滚动 | 卡册页滚到 1200 px 进详情再返回，`scrollTop` 仍为 1200（未重置） |
| 本体翻面 | `switchFace(1)` → 卡面切到 `body_aggro_001_mega_back.webp`，小节切到额外形态，`imageFailed=false` |
| 手牌花色点数 | 16 面 picker，`pickFace(5)` → 「红桃 J」+ `hand_basic_001_heart_j.webp` |
| 高清预览 | `wx.previewImage` 在工具里**确实弹出原生预览浮层**（截图为全屏高清卡面 + `1/1`）；真机待验，见下节 |
| 规则页 | 快速入门／完整规则／关键词三种模式切换正常；章节锚点跳转与 `top()` 回顶正常；页面可滚动约 1.9 万 px，长文可读 |
| 关键词搜索 | `濒死`→2、`体力`→8、`抽`→0（**正确**：规则统一用「摸牌」，全文 11 次，从不写「抽牌」）|
| 减少动态效果 | 开关切换写入 `reduceMotion` 并持久化；规则页与首页均按该值切换动效标记 |
| 分享直达 | 以 `reLaunch` 造出「页面栈只剩 1 页」→ `fromShare=true`、提示语正确、`back()` 走 `switchTab` 回图鉴继续浏览；分享参数标题/路径正确 |
| 首页入口意图 | 搜索→图鉴（重置条件）、我的收藏→图鉴仅收藏（1 张）、新手引导→规则页 `mode=start`、hero 轮播 `heroChange(2)`、预组入口→变通组 16 名成员 |
| 官网页 | 复制按钮写入剪贴板并提示；`opening=false`（未启用内嵌），符合既定方案 |
| 重启恢复与清理 | 注入 42 条含 2 个幽灵 ID 的脏数据后重启：`recent` 修复为 30 条且去重、幽灵 ID 被剔除、`favorites` 3→1、`reduceMotion` 保留 |

### 生产级阻断：卡图域名（需用户决策，本轮未改）

- 实测：`urlCheck: true` 下 `wx.downloadFile` 与 `wx.getImageInfo` 对 `qunyou-tcg.pages.dev` 均返回
  `url not in domain list`；但 `<image src>` 在**模拟器**里照常渲染（走 IDE 自身网络栈），
  所以画面看起来完全正常，**这正是最容易把问题带到线上的假象**。
- 多个资料源一致说明：小程序的 `<image>` 加载网络图**同样受 `downloadFile` 合法域名管控**，
  开发者工具可以宽松，真机不会。按现状上线，真机上卡面会整片加载不出来。
- 体积实测（`public/`）：普通卡图 200 张共 3.3 MB，高清卡图 198 张共 22.4 MB；小程序主包 2 MB、
  单个分包 2 MB、所有分包合计 20 MB。**高清图 22.4 MB 已超总分包预算，无法打进包**；
  普通图 3.3 MB 也至少需要 2 个分包（当前 `build/` 已含 12 张本体原画共 868 KB）。
- 因此远程托管是必需项，而远程托管就必须是**已 ICP 备案的域名**，`pages.dev` 无法备案——
  与已在 `src/config.ts` 记录的 web-view 业务域名问题是同一类限制。
- 可选方向（待用户决定，本轮不擅自改动）：迁到自有已备案域名或已备案 CDN；改用微信云开发云存储
  （其域名自动进白名单）；或保留现状但明确标记为**未通过生产验收**。

### 本轮仍未闭环

- iOS／安卓真机、首次玩家体验：仍无设备。
- `wx.previewImage` 真机行为：工具里成功，真机是否同样受域名限制需与上条一并复验。
- 断网／弱网／存储写入失败：只验了「域名被拦时文字仍完整可读」，不等于已验断网。
- 规则冲突：关键词「本体」的「体力降至 0 时该玩家失败」与完整规则濒死救援流程冲突（源文件 `docs/keywords.md` 第 6 行），
  导出会同时影响文档与小程序语料，**本轮未改，等规则负责人确认**。
- 观察项（非缺陷，未改）：完整规则模式下的「章节目录」是 34 个整宽居中按钮（微信 `button` 默认
  `display:block` + `text-align:center` 所致），与全站左对齐的列表观感不一致，建议后续统一为左对齐胶囊式目录。

### 本轮结果

`mini:build` → **1078.4 KiB**；`mini:test` **21/21 通过**；`mini:typecheck`、`mini:data:check`、
`validate`、根 `typecheck` 全部通过。工具内 8 个页面全部渲染，运行时 console **0 报错**。
未提交、推送、部署、上传审核或发布。

---

## 首页改版与卡牌分类（2026-09-21 第五轮）

用户反馈两点：首页要的就是「规则 / 卡牌 / 预组」三个按钮，预组页承接原首页内容；整体 UI 太普通。

### 信息架构调整

| 页面 | 变化 |
| --- | --- |
| `pages/home` | 改为启动台：品牌区 + 全量搜索 + 三个分类 portal + 收藏／最近浏览 |
| `pages/cards` | 改为图鉴入口：本体牌 12 / 角色牌 120 / 手牌 20 三个分类 portal |
| `pages/collection` | **新增**（非 tabBar 栈页）：分类卡片列表，承载搜索、子筛选与收藏筛选 |
| `pages/decks` | 承接原首页内容：精选 swiper + 新手入口 + 12 套预组网格 + 收藏／最近浏览 |
| tabBar | 文案 首页／卡牌／预组／规则；选中色改为金色 `#d8b880` |
| `pages/detail`、`pages/deck-detail` | 未改，「返回图鉴」「返回预组」仍 `switchTab` 到对应 tab（文案与行为一致） |

### 新发现并修掉的真实缺陷：中文查询参数不自动解码

在开发者工具内驱动时才暴露：`openCollection('本体')` 生成的 `/pages/collection/index?kind=%E6%9C%AC%E4%BD%93`
到达页面时 `options.kind` **仍是百分号编码**，分类键匹配失败，一路回落到「全部卡牌」（152 张而不是 12 张）。

修复：`collection` 页 `onLoad` 用安全的 `decodeURIComponent` 包装后再匹配分类键，`q` 参数同样处理。
防回归已写入 `catalog.test.mjs`：`onLoad({kind: encodeURIComponent('本体')})` 必须得到 `kind='本体'`、`title='本体牌'`。

**这类问题 Node 侧测试永远发现不了**（Node 里传的是原始字符串），只有真编译器/真运行环境会暴露，是保留工具内验证通道的直接收益。

### 工具内实测（第五轮）

```
SYS      platform=devtools SDK=3.17.3 model=iPhone 12/13 (Pro)
BOOT     pages=[pages/home/index]
TAB      home/cards/decks/rules  全部渲染  errors=0
HOME     entries=01:规则 3节 | 02:卡牌 152张 | 03:预组 12套
ENTRY    rules -> pages/rules/index   cards -> pages/cards/index   decks -> pages/decks/index
GROUPS   本体牌=12张 | 角色牌=120张 | 手牌=20种
COLLECT  本体 -> kind=本体 title=本体牌 cards=12 first=微笑尅乐
COLLECT  角色 -> kind=角色 title=角色牌 cards=120 first=刺客-柯柯
COLLECT  手牌 -> kind=手牌 title=手牌 cards=20 first=出刀
SEARCH   角色/伏击 = 4
SUBFILTER hand=20 基础牌=4 行动牌=10 骑士卡=6
FAVONLY  手牌/仅收藏 -> onlyFavorites=true
DECKS    featured=3 decks=12 → deck-detail members=16 body=微笑尅乐
ENTRY2   home.search -> collection kind=全部 cards=152
ENTRY2   home.favorites -> collection kind=全部 fav=true cards=1
CARD     detail 微笑尅乐 faces=1 → switchFace(1) → body_aggro_001_mega_back.webp → back -> cards
ERRORS   0
```

### 顺带发现的观感问题：远程卡面加载期间是空白方块

在真实模拟器截图时发现：`<image>` 加载远程卡面要数秒（首次更久），期间只是一个**空白深色方块**，
既看不出在加载、也看不出坏了；10 秒后同一位置才出现完整卡面（已用 `wx.getImageInfo` 复现，
失败原因是 `url not in domain list`，而 `<image>` 走 IDE 网络栈所以最终能显示）。

已给 `card-tile` 加 `ready` 状态：`bindload` 前显示「卡名 + 卡面载入中…」占位层（带轻微脉冲，
`prefers-reduced-motion: reduce` 时关闭动画），加载成功即让开；失败仍走原有「图片暂不可用 · 点击读文字 + 重试图片」。
另加 15 秒兜底定时器，避免 `bindload` 万一不触发时占位层永久盖住已渲染的卡面。

### 交付物与视觉

- **手牌分类含骑士卡**：基础牌 4 + 行动牌 10 + 骑士卡 6 = 20 种。骑士卡没有正式成卡图（`faces` 为空），
  列表里退回文字卡，与既有的缺图降级一致；入口描述写明「含骑士流骑士卡」，不把它说成手牌。
- 视觉升级见[产品规格](miniprogram-product.md#视觉与反馈)。分类卡用 `<view role="button" hover-class="pressed">`，
  不用 `<button>` 做卡形容器。
- `mini:review` 的浏览器近似渲染器**不能解析裸 `&`**（WXML 合法、XML 不合法），
  已在解析前转义；这只影响近似渲染器，真实行为以 `wcc` 为准。

### 本轮结果

`mini:build` → **1091.2 KiB**（预算 1.5 MiB）；`mini:test` **21/21 通过**；`mini:typecheck`、`mini:data:check`、
`validate`、根 `typecheck` 全部通过；`mini:review` 54 个布局无横向溢出、无本地图片失败；
工具内 9 个页面全部渲染，运行时 console **0 报错**。未提交、推送、部署、上传审核或发布。

## 第六轮：收藏册视觉（2026-09-22）

- 实现：正式本体卡主视觉、暖色场景、预组介绍角色出框、卡册直达、导航图标。此前第五轮菜单型布局已被替换。
- `mini:test`：23/23，通过，包含真实微信 wcc/wcsc 模板与样式编译；新增卡册直达／搜索返回和精选卡牌／预组一致性检查。
- `mini:typecheck`、`mini:data:check`、`validate`、网站 `build` 通过；小程序包 1135.7 KiB（低于 1.5 MiB）。
- 浏览器近似：9 页面 × 320／390／430／844 横屏及 390／320 的 1.3 倍字号，共 54 组合，无横向溢出、无本地图片失败。已修正近似工具遗漏页面 WXSS 的问题。
- 微信工具实际观察：首页完整卡面和场景正常；图鉴 tab 直达 152 张，搜索“刺客”得到 4 张；首页预组按钮进入上头组，出框角色与正式卡册分开展示。截图见 `miniprogram/review/ui-audit-20260922/`。本轮没有把此前全部 9 页原生流程结果重复算作新验证。
- 待验：原生完整尺寸矩阵、iOS／安卓、系统放大字号、高清图生产域名。工具渲染远程卡图不能证明真机域名条件满足。规则争议与官网回退限制沿用第四轮记录。
