---
name: wechat-miniprogram-verify
description: Verify the 宝旅团 TCG WeChat mini program (miniprogram/) inside the real WeChat DevTools without human clicking or screenshot reading — drive it through the CLI automation channel, reproduce compile errors with DevTools' own wcc/wcsc compilers, and bisect WXML/WXSS rendering bugs with a throwaway repro project. Use when the mini program shows a blank screen, when a WXSS/WXML change needs real-compiler validation, or when a flow (navigation, storage, picker, share) must be exercised natively.
---

# 小程序原生验证（微信开发者工具）

只做验证，不改卡牌数据、规则或对战功能。任何提交、推送、上传审核、发布都必须先获得用户明确授权。

## 环境前置

- 工具：`~/Applications/wechatwebdevtools.app`（`/Applications` 会被系统拒绝，用 `ditto --noextattr` 绕过 `com.apple.provenance`）。
- 服务端口必须由用户手动开启：设置 → 安全设置 → 服务端口。命令行无法代替这一步。开启后 `Default/.cli` 写入端口号（本轮为 `3799`）。
- 项目 AppID 在 `miniprogram/project.config.json`，当前值 `APP_ID` 是**正式注册的个人主体账号**（不是测试号）：可编译、可跑模拟器，也可配服务器域名与上传；但**未完成小程序备案时后台不允许上传／提审／发版**。

## 三条命令线

```bash
CLI=~/Applications/wechatwebdevtools.app/Contents/MacOS/cli
P="/Users/w1311823723/Developer/群友杀 TCG/miniprogram"

"$CLI" close --project "$P"          # 每次测试前先关掉上一个工程
"$CLI" open  --project "$P"          # 再打开；与 auto 之间留约 12 秒，否则自动端口抢跑失败
"$CLI" auto  --project "$P" --auto-port 9420 --trust-project
```

`--auto-port` 是给自动化用的**空闲端口，不是 IDE 的 cli 端口**（服务端口本机是 3799，只说明 IDE 在监听）。
自动化端口的 ws 地址必须与它一致：`connect({ wsEndpoint: 'ws://127.0.0.1:9420' })`。
自动化依赖装在工作区外，用 `NODE_PATH` 引入：`NODE_PATH=<workspace>/node_modules node flow.cjs`。

### 1. 本机编译（最快，秒级）

开发者工具自带真编译器，**不要用近似手段代替**：

```bash
APP=~/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec
"$APP/wcsc" -lc miniprogram/build/app.wxss -o /tmp/o.js   # 输出含 ERR: 即失败
"$APP/wcc"  miniprogram/build/app.wxml  -o /tmp/o.js      # 有任何输出即失败
```

`npm run mini:test` 第 21 项已封装这一步（无工具的环境会 `[skip]`，不会误报）。先用它，再去开工具。

### 2. 运行时驱动（`miniprogram-automator`）

`connect({ wsEndpoint: 'ws://127.0.0.1:3799' })` 之后：

- `mp.on('console' | 'exception')` 取运行时错误**原文**。工具 UI 里的报错不落日志，这是唯一的机读途径。
- `mp.evaluate(fn, arg)` 在 app service 线程里执行代码：读 `getCurrentPages()`、直接调页面方法（如 `p.switchFace({currentTarget:{dataset:{index:1}}})`）、读写 `wx.getStorageSync`、调 `wx.downloadFile` / `getImageInfo` / `previewImage` 看真实返回。
- `mp.screenshot()` 取画面。**返回 base64 字符串，不是 Buffer**；要落盘得 `Buffer.from(s, 'base64')`，并用 PNG 头 `89 50` 校验。
- `mp.disconnect()` 返回 `undefined`，**不能接 `.catch()`**（会抛 `Cannot read properties of undefined`）。收尾用 `try { await mp.disconnect(); } catch {}`。
- 自动化脚本比 `navigateBack()` 更稳的做法是 `switchTab` / `reLaunch` 回到页面上层：`navigateBack()` 在页面树上常报 `page is not on top of page stack`。
- 用 `page.callMethod('name', arg)` 直接调页面方法（如 `group`、`onSearch`、`switchFace`），比找选择器点击稳得多；传参形状按 `e.currentTarget.dataset` / `e.detail` 手工拼。

三个坑：

- `mp.pageStack()` / `currentPage()` / `navigateTo()` 在页面树未建立时抛 `Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null`。此时 `mp.evaluate()` 仍可用，**优先用 evaluate**。
- 必须单窗口串行。多工程并行时 builder 互相干扰，对照试验会整体失灵，容易导出「路径含空格」这类假线索。
- 冷启动失败后工具会复用同一个已死 builder，重新编译无效，需重开工程。

### 3. 最小复现工程（定位 WXML/WXSS 渲染缺陷）

页面侧选择器够不到自定义组件内部（独立 shadow root），所以组件级排版问题要靠复现工程：

1. 在无空格路径建极简工程：`app.js` 必须是 `App({})`（写成 `Page({})` 会让页面 `data` 为空，极难察觉）。
2. 把待考察的写法并排放进同一页（每变体一个标签），一次编译就能横向对比。
3. `project.config.json` 里关掉 `minified` / `minifyWXSS` / `minifyWXML`，`urlCheck: false`，AppID 沿用项目里那个（临时工程用游客 AppID 也可以，不要为此申请新号）。
4. 用完即删。

## 已确证且违反会导致白屏/错版的平台约束

| 约束 | 表现 | 检查 |
| --- | --- | --- |
| WXSS **不支持任何形式的通配选择器**（`*`、`.a *`、`.a > *`、`*.b`） | `wcsc` 报 `unexpected token '*'`，**整个文件**编译失败 → 全站白屏 | `mini:test` 静态兜底 + 第 21 项真编译 |
| `<text user-select wx:for>` | 该 `<text>` 被提升为块级，项目符号独占一行、加粗与正文混排段落被拆行 | `mini:test` 静态兜底 |
| WXML 文本**不解码 HTML 实体** | `&amp;` 原样显示 | `mini:test` 静态兜底 |
| `require()` 参数会被自动补 `.js` | `require("x.json")` → `module 'x.json.js' is not defined` | `mini:test` 第 20 项 |
| `navigateTo` **不能跳 tabBar 页面** | `can not navigate to a tabBar page`；tab 之间只能 `switchTab` | 目录结构审查 |
| `navigateTo` 的**中文查询参数不自动解码** | `onLoad` 拿到 `%E6%9C%AC%E4%BD%93`，匹配失败后走到默认分支且不报错 | 页面测试写 `onLoad({kind: encodeURIComponent('本体')})` 断言 |
| `mini:review` 的近似渲染器**不能解析裸 `&`** | `xmlParseEntityRef: no name` → 整个 `mini:review` 崩掉（WXML 本身合法，只有这个 XML 解析器不接受） | 解析前把裸 `&` 转义 |
| `mini:review` 的近似渲染器**不能解析属性值里的裸 `<`**（如 `{{a < b}}`） | `Unescaped '<' not allowed in attributes values`；同理整个 `mini:review` 崩掉 | 解析前把 `{{ }}` 内的 `<` 转义（XML 解析器会解回原字符，不影响求值） |
| 组件新增 data 字段 | `mini:review` 报 `xxx is not defined`——近似渲染器给组件模板的 props 只有硬编码默认值 | 在 `visual-review.mjs` 的 `props={failed:false,ready:true}` 里补上 |

## 网络图注意事项（当前卡图已改包内）

- `<image src>` 加载网络图**同样**受 `downloadFile 合法域名` 管控。开发者工具模拟器用自身网络栈渲染，**画面正常，看不出问题**；真机不配置就整片白图。
- `wx.downloadFile` / `wx.getImageInfo` 在工具里就会明确报 `url not in domain list`，可用它们做前置探测。
- 域名须已 ICP 备案，`pages.dev` 无法备案。
- 保守体积预算按十进制计算：主包 2 MB、单个分包 2 MB、全部合计 20 MB。原始高清图 22.4 MiB 不能直接入包；第九轮先用重编码临时项目验算，随后第十轮接入正式构建。
- 第十轮已把包内图接入正式构建，卡图不再请求 `pages.dev`；`wx.previewImage` 在工具中无法打开包内路径，现用本页全屏缩放查看。实际上传包、真机首次下载分包与双指操作仍待验，见验收记录第十轮。

## 记录要求

结论写进 `docs/miniprogram-verification.md`，并区分「本机编译」「工具内运行」「真机」「已上线」。工具内通过不等于真机通过；模拟器画面正常不等于域名配置正确。发现旧结论被证伪时，就地更正并标明「第 N 轮更正」，不要静默改写。
