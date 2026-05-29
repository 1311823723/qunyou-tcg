# 群友杀 TCG

「群友杀 TCG」是一款 1v1 对战卡牌游戏的设计项目。

## 当前状态

- **版本:** v0.2 Demo
- **模式:** 1v1 对战
- **预组:** 上头组 / 爆杀流
- **站点:** https://qunyou-tcg.pages.dev

## 设计方向

本项目采用**数据优先**的方式维护卡牌。所有卡牌效果、预组列表以 JSON 数据为核心，UI 不可硬编码卡牌文本。

UI 读取以下数据源：

- `data/cards/*.json` — 所有卡牌数据
- `data/decks/*.json` — 预组卡组数据

## 常用命令

```bash
npm run dev            # 启动本地开发服务器
npm run build          # 构建静态站点
npm run preview        # 预览构建产物
npm run validate       # 校验所有卡牌和预组数据
npm run print:aggro    # 打印爆杀组预组详情
```

## 技术栈

- **数据层:** JSON Schema + 校验脚本 (Node.js)
- **UI:** Astro + Tailwind CSS v4 + TypeScript

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
