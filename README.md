# 宝旅团 TCG

「宝旅团 TCG」是一款 1v1 对战卡牌游戏的设计项目。

## 当前状态

- **版本:** v0.2 Demo
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
npm run typecheck      # 检查前端 TypeScript 类型
npm run print:aggro    # 打印爆杀组预组详情
npm run export:tts     # 导出 Tabletop Simulator 本地资源
npm run cards:sync     # 生成网页缩略图与高清预览图
npm run test:battle    # 校验在线牌桌的卡组与 Mega 数据
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

## CI 与自动部署

Pull Request 和 `main` 分支推送会运行数据校验、原画审计、类型检查、
对战测试、Worker 干构建和网站构建。`main` 的 CI 全部通过后，GitHub
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
