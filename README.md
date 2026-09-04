# 宝旅团 TCG

「宝旅团 TCG」是一款 1v1 对战卡牌游戏的设计项目。

## 当前状态

- **版本:** v0.2.0 Demo
- **模式:** 1v1 对战
- **预组:** 上头组 / 密裁组 / 操作组 / 变通组 / 执棋组 / 逆命组 / 幽幕组 / 不落组
- **站点:** https://qunyou-tcg.pages.dev

## 设计方向

本项目采用**数据优先**的方式维护卡牌。所有卡牌效果、预组列表以 JSON 数据为核心，UI 不可硬编码卡牌文本。

UI 读取以下数据源：

- `data/cards/*.json` — 所有卡牌数据
- `data/decks/*.json` — 预组卡组数据

## 常用命令

```bash
npm run dev            # 启动本地开发服务器
npm run dev:battle     # 启动本地实时对战 Worker（端口 8787）
npm run build          # 只构建静态站点（等同 build:web）
npm run build:cards    # 重新生成卡面与网页卡图
npm run build:all      # 重新生成卡面后构建站点
npm run build:battle   # 检查 Worker 是否可以部署
npm run preview        # 预览构建产物
npm run validate       # 校验所有卡牌和预组数据
npm run typecheck      # 检查前端与 Worker TypeScript 类型
npm run print:aggro    # 打印爆杀组预组详情
npm run export:tts     # 导出 Tabletop Simulator 本地资源
npm run cards:sync     # 生成网页缩略图与高清预览图
npm run test:battle    # 校验在线牌桌的卡组与 Mega 数据
npm run test:battle:auto:live # 对本地 Worker 运行自动对战生命周期检查
npm run test:battle:e2e # 启动本地站点与 Worker，运行 Chromium 端到端测试
npm run automation:sync # 根据角色数据与实现状态同步结构化自动化元数据
npm run automation:report # 更新 120 张角色实现状态文档
npm run playtest:report # 校验实战记录并输出胜率、先手与问题牌统计
```

普通站点构建不会重新制卡。修改卡牌数据、卡面模板或原画后先运行
`npm run build:cards`；需要一次完成制卡和站点构建时运行 `npm run build:all`。
卡牌数据与原画是唯一源文件，`public/cards`（250px）和
`public/cards-hd`（750px）均为自动生成资源，无需手工维护多份画质。

## 技术栈

- **数据层:** JSON Schema + 校验脚本 (Node.js)
- **UI:** Astro + Tailwind CSS v4 + TypeScript
- **在线对战:** Cloudflare Worker + Durable Objects + WebSocket

## 在线对战本地开发

分别启动站点和实时服务：

```bash
npm run dev
npm run dev:battle
```

前端默认连接 `http://localhost:8787`。线上部署时在 Pages 构建环境设置
`PUBLIC_BATTLE_API_URL` 为对战 Worker 地址，并执行
`npm run deploy:battle` 部署实时服务。

大厅同时提供两种互不影响的房间：经典手动对战继续使用 `/play/room` 与
`BattleRoom`；自动对战 Beta 使用 `/play/auto/room` 与独立的
`AutoBattleRoom`。自动版由服务端管理阶段、54 张手牌、响应、伤害、濒死与
胜负。当前 9 张已开放本体（含 Joker 的极巨化）与全部 120 张角色已接入自动结算；可选 9 套正式预组，也可使用已开放本体和 16 张不重复角色组建自选卡组。KGY 的骑士卡引擎已经实现，但会等巡界预组完成后再开放；南山五与花生壳尚未接入自动模式。详细范围见
[`docs/auto-battle-beta.md`](docs/auto-battle-beta.md)。彻底自动结算的产品基线见
[`docs/auto-battle-product.md`](docs/auto-battle-product.md)，技能模块和持久化结算的开发规范见
[`docs/auto-battle-skill-engine.md`](docs/auto-battle-skill-engine.md)，角色完成度见
[`docs/auto-battle-character-status.md`](docs/auto-battle-character-status.md)。

`worker/wrangler.jsonc` 的 `v3` 迁移会创建 `AutoBattleRoom`。发布自动版时必须
先部署包含该迁移的 Worker，再让 Pages 上线新入口。

## CI 与自动部署

Pull Request 和 `main` 分支推送会运行数据校验、原画审计、类型检查、
对战单元与 Chromium 端到端测试、Worker 干构建和网站构建。`main` 的 CI 全部通过后，GitHub
Actions 会自动部署对战 Worker；Cloudflare Pages 继续使用现有 GitHub
集成构建前端。

在 GitHub 仓库中配置：

- Secret `CLOUDFLARE_API_TOKEN`：具备目标 Worker 编辑权限。
- Secret `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。
- Variable `BATTLE_WORKER_URL`：已部署 Worker 的完整公开地址，供部署后检查 `/lobby`。

## 项目结构

```text
data/           # 卡牌 JSON 数据 + JSON Schema
docs/           # 规则、关键词、设计原则、style guide
playtest/       # 测试记录、平衡笔记
tools/          # 校验脚本、打印脚本
src/            # Astro UI 源码
  pages/        # 路由页面
  components/   # Astro 组件
  lib/          # 类型定义、数据读取
  styles/       # 全局样式
```
