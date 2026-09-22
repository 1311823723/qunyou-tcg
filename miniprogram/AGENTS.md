# 小程序开发约定

先读根 AGENTS.md、miniprogram/README.md、docs/miniprogram-architecture.md、docs/miniprogram-handoff.md。

- 小程序原生 TypeScript + WXML + WXSS，使用根 npm 依赖与锁文件；不引入 Astro/React/Vue/对战 Worker 运行时。
- 正式文本只来自 data/cards、data/decks、docs/rules.md、docs/keywords.md；禁止在页面内另写技能效果。
- 数据适配在 tools/miniprogram/catalog.mjs；UI 经 services/catalog.ts 读取。生成物 src/generated/catalog.json、build/ 不手工改。
- 使用稳定卡牌 ID 路由，不依赖中文名称或数组位置。卡图与文字并存，失败时保留完整文本，不隐藏卡牌。
- 不把开发工具 AppID、本地私有配置、密钥提交为公共配置；不接入对战、登录、云数据库或远程数据更新，除非有新的明确需求。
- 运行 npm run mini:test、npm run mini:typecheck、npm run validate；影响共享文件时运行根 typecheck/build。
- 微信开发者工具编译、iOS／安卓真机、发布分别记录，不能用 Node 测试或网页截图替代。
- 现有 .workbuddy/ 记忆是交接背景，不据此执行发布、计费服务或改动游戏规则。未经明确要求不提交、推送、上传审核或部署。
