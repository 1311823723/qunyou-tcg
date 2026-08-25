# 自动对战 Beta

自动对战 Beta 与经典手动对战共用大厅、昵称、房间码、重连和观战入口，但使用独立的牌桌页面与 Durable Object。自动版出现问题时，不会改变经典房的状态或操作方式。

## 当前自动范围

- 自动开局：双方摸 5 张手牌、暗置上阵 2 张角色，并随机决定先手。
- 六阶段循环：准备、摸牌、出牌、布阵、弃牌、结束。
- 摸牌阶段自动摸 2 张；布阵阶段至多上阵 2 张角色，角色区最多 4 张。
- 弃牌阶段按 `min(当前体力, 4) + min(己方明置角色数, 2)` 自动检查上限。
- 54 张实体手牌的目标、响应、牌区移动、伤害、回复与阶段效果。
- 响应栈、【闪避】、【别急】、【紧急会议】、小王转化和濒死【急救】。
- 牌堆不足时将共用弃牌区洗回牌堆。
- 胜负判断、公开日志、断线重连和观战隐私。

自动版不设置倒计时。存在响应、选择、濒死或未完成结算时，当前玩家不能推进阶段。

## 角色技能辅助结算

角色技能不从中文效果文本推断规则。`data/cards/character_automation.json` 为 120 张角色登记机器可读的触发时机、次数限制和可用原子操作；技能费用仍读取角色牌 JSON 中的结构化 `cost`。

系统负责验证时机、明置发动者、支付休整或退场费用、处理休整摸牌、记录次数并写入公开日志。尚未完全自动化的效果由发动者在受限的辅助面板中完成。修改角色时机或费用后运行：

```bash
npm run automation:sync
npm run validate
```

辅助结算不会让玩家直接修改房间状态，也不会向对手或观战者公开手牌、暗置角色或私有选择。

## 接口与部署

- 经典房：`/rooms/**`，页面 `/play/room`。
- 自动房：`/auto/rooms/**`，页面 `/play/auto/room`。
- 大厅摘要以 `mode: "classic" | "auto"` 区分模式；旧摘要缺少该字段时按经典房处理。
- 自动房由 `AutoBattleRoom` 保存，Cloudflare 迁移版本为 `v3`。

部署时先发布 Worker，再发布前端。完整本地检查：

```bash
npm run validate
npm run typecheck
npm run test:battle
npm run build:battle
npm run test:battle:auto:live
npm run test:battle:e2e
npm run build:web
```
