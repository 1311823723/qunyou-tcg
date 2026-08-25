# 自动对战技能引擎规范

| 字段 | 内容 |
| --- | --- |
| 文档状态 | 实施中 |
| 架构版本 | Skill Engine v1 |
| 最后更新 | 2026-08-25 |
| 首批迁移 | 上头、密裁、操作本体；操作组与上头组 32 张角色 |

本文档定义自动对战技能的工程约束。目标是支持 8 张本体和 120 张角色长期维护，避免技能继续堆入 `AutoBattleRoom` 或依赖中文正则推断。

## 1. 架构决策

技能引擎采用“事件驱动内核 + 注册技能模块 + 可序列化选择”。

- **规则内核：** 管理阶段、牌区、伤害、回复、响应栈、提示和胜负。
- **技能注册表：** 使用稳定卡牌 ID 找到对应模块。
- **技能模块：** 只描述本技能的进度、触发、选择和效果组合。
- **运行上下文：** 向技能暴露受控的通用操作，技能不持有房间类。
- **序列化提示：** 需要玩家选择时写入 `state.prompt`，不在内存中等待 Promise。
- **兼容层：** 未迁移本体暂时由 `body-automation.mts` 处理，每迁移一张就删除其兼容分支。

## 2. 不可破坏的约束

1. 服务端是唯一权威来源。
2. 自动化逻辑不解析 `timing` 或 `effectText`。
3. 卡牌 ID、技能处理器 ID、提示 `action` 和计数器 key 一旦进入线上状态就必须稳定。
4. 等待玩家时，全部继续信息必须存在 Durable Object 状态中。
5. 技能不直接接收 WebSocket、Durable Object 存储或前端节点。
6. 新技能优先组合通用原子操作，但不为了“全 JSON”制造另一门难以调试的脚本语言。
7. 前端只根据服务端发来的合法操作和提示渲染，不自行判定技能能否发动。

## 3. 当前目录与职责

```text
worker/src/
  auto-room.ts                 # 房间、命令、快照与技能调度
  auto-engine.mts              # 阶段、手牌、伤害等通用规则
  auto-types.ts                # 可持久化的对局类型
  body-automation.mts          # 未迁移本体的临时兼容层
  skills/
    body-ids.mts               # 稳定本体 ID
    body-skill.mts             # 本体模块和运行上下文接口
    body-registry.mts          # 本体技能注册表
    bodies/
      aggro.mts                # 上头本体
      mizai.mts                # 密裁本体
      combo.mts                # 操作本体
    character-skill.mts        # 角色模块与运行上下文协议
    character-registry.mts     # 角色技能注册表
    characters/
      aggro.mts                # 上头组 16 张角色
      combo.mts                # 操作组 16 张角色
```

本体与角色分别注册，共用房间事件、费用、牌区移动和结算队列；角色处理器不得注册进本体注册表。

## 4. 技能模块协议

当前本体模块使用 `BodySkillModule`：

```ts
interface BodySkillModule {
  bodyId: string;
  progressDelta(player, event): number;
  collectTrigger(context, event): BodyTriggerSpec | undefined;
  extraStrikeAllowance?(player): number;
  onPhaseEntered?(context, phase, previousPlayer): void;
  openPrompt(context, trigger): boolean;
  resolveChoice(context, prompt, payload): boolean;
}
```

- `progressDelta` 只计算该事件增加的 Mega/Z 进度。
- `collectTrigger` 检查触发条件和入队前次数，返回结构化触发。
- `extraStrikeAllowance` 是持续性规则修正的第一个接口。后续应抽象为通用 `modifiers`。
- `onPhaseEntered` 用于阶段型触发，不得在其中等待客户端。
- `openPrompt` 把已入队触发转化为可持久化提示。
- `resolveChoice` 验证玩家输入并执行一步结算；返回 `false` 表示该模块不识别当前 `action`。

角色模块使用 `CharacterSkillModule`：模块声明结构化触发、可选次数上限、`canActivate`、`activate` 和 `resolveChoice`。立即生效的简单技能使用 `immediateCharacterSkill`类型化组合器；牌序、复制、私有选择等复杂技能保留独立处理器。通用引擎统一从正式 JSON 读取费用，技能模块不重复实现休整摸牌和退场。

## 5. 运行上下文

`BodySkillRuntimeContext` 和 `CharacterSkillRuntimeContext` 是技能与房间的边界。角色上下文已提供摸牌、牌堆顶/底移动、弃牌区获取或洗回、伤害、回复、充能标记、无效当前手牌、规则修正和行动牌效果复制等原子操作。本体上下文当前提供：

- 对局、技能所有者与对手的读取。
- 本体技能名、强化技能名和手牌名的数据查询。
- 每回合或每局计数器的读取与增加。
- 触发入队、提示建立和提示清理。
- 摸牌、取牌堆顶、获得牌、弃置牌和启动本体【出刀】。
- 公开日志与结构化事件发送。

上下文的新能力必须是至少两个技能可复用的规则原语，或是为保持服务端不变式所必需的单一入口。不要为每张卡增加一个只服务它自己的房间方法。

## 6. 事件流程

```text
规则操作或卡牌结算
  -> emitEvent
  -> 按当前玩家顺序查找技能模块
  -> 增加额外形态进度
  -> collectTrigger
  -> PendingBodyTrigger 入队
  -> 当栈和其他提示清空后 openPrompt
  -> 玩家提交 choice:submit
  -> resolveChoice
  -> 产生新事件或结束
```

事件只应携带可序列化的公开上下文。卡牌定义 ID、玩家 ID、角色定义 ID、数量和明确布尔值可以进入事件；整个房间对象、函数或客户端节点不得进入。

## 7. 持久化选择与继续

技能需要玩家决策时，必须把继续点写入 `AutoPrompt.context`：

```ts
{
  kind: "body-skill",
  playerId: "p1",
  cardInstanceIds: ["card-a", "card-b"],
  context: {
    action: "combo-mega-pick",
    cardIds: ["card-a", "card-b"]
  }
}
```

本体 v1 使用稳定 `action` 找回模块内分支；角色技能已使用显式继续对象：

```ts
type SkillContinuation = {
  handlerId: string;
  sourceDefinitionId: string;
  sourceInstanceId: string;
  step: string;
  eventId?: string;
  data?: Record<string, unknown>;
};
```

不允许使用未序列化的 `await player.choose...()` 跨越网络等待，因为 Durable Object 可能在等待期间释放内存。

## 8. 计数器与临时状态

计数器 key 必须包含作用域、玩家和稳定后缀：

```text
body:turn:<turnNumber>:<playerId>:<suffix>
body:game:<playerId>:<suffix>
skill:turn:<turnNumber>:<playerId>:<characterId>
skill:event:<eventId>:<playerId>:<characterId>
skill:game:<playerId>:<characterId>
```

- 回合切换时清理回合计数器。
- 每局限一次状态必须保留至对局结束。
- 持续性数值不应塞入日志或根据日志反推。
- 可见标记使用玩家 `markers`，技术次数使用 `usageCounters`，不要混用。

## 9. 持续规则修正

“额外使用【出刀】”、“手牌上限+1”、“下一次费用减少”类效果不应通过某个时点的一次性触发模拟。目标架构应建立通用修正查询：

```ts
type RuleModifier = {
  id: string;
  sourceId: string;
  ownerId: string;
  kind: "hand-limit" | "card-usage" | "skill-cost" | "target-legality" | "damage";
  expires?: ExpirationSpec;
  value: number;
};
```

当前上头本体的 `extraStrikeAllowance` 是第一个已注册规则修正；当第二种同类需求出现时，将其升级为统一 `modifiers` 链，而不是增加更多专用函数。

## 10. 触发顺序

同一事件同时触发多个技能时，使用已确认的正式顺序：当前回合玩家先排列自己的触发，非当前回合玩家后加入队列顶部，因而非当前回合玩家先结算。同一玩家有多个可选触发时，由该玩家通过点击角色决定先后；放弃会为本事件记录跳过，不会反复弹出。

“成为目标时/伤害前”、“使用时”、“结算后/受到伤害后”保持为不同的结构化事件窗口，不依赖文本描述的先后顺序。

## 11. 首批本体迁移状态

| 本体 | 自动结算 | 模块化 | 覆盖能力 |
| --- | --- | --- | --- |
| 上头组-微笑尅乐 | 完成 | 已迁移 | 伤害进度、每回合触发、额外【出刀】、Mega 结束阶段使用牌 |
| 密裁组-柯柯 | 完成 | 已迁移 | 观看进度、二选一、展示对手手牌、选择弃置、Mega 合并效果 |
| 操作组-瓜猫 | 完成 | 已迁移 | 行动牌进度、次数、伤害检查、牌堆顶私有选牌 |
| 变通组-摆子 | 完成 | 待迁移 | 兼容层 |
| 执棋组-爱吃豚侠 | 完成 | 待迁移 | 兼容层 |
| 逆命组-风妖精 | 完成 | 待迁移 | 兼容层 |
| 幽幕组-小阿潘 | 完成 | 待迁移 | 兼容层 |
| 不落组-搞莫子 | 完成 | 待迁移 | 兼容层 |

## 12. 添加一个全自动技能

1. 阅读正式卡牌 JSON、规则和相关关键词。
2. 列出它需要的事件、费用、次数、目标、分支、持续时间和私有信息。
3. 确认已有原子操作能否表达效果，不足时先扩展通用内核。
4. 在对应卡牌目录新建模块，并注册稳定 ID。
5. 把所有网络等待转换为可序列化提示和继续步骤。
6. 添加模块单元测试和房间生命周期测试。
7. 添加玩家、对手和观战三种快照隐私测试。
8. 添加断线发生在关键选择中的恢复测试。
9. 按产品规格的“单张技能完成标准”验收后，再将其标记为 `full`。

实现状态写入 `data/cards/character_implementation.json`。`needs_confirmation` 会阻止实现和预组解锁；`needs_testing` 与 `needs_optimization` 不改变正式文本的实现资格。`npm run automation:sync` 根据此状态生成 `full/assisted`，`npm run automation:report` 更新人类可读进度文档。

## 13. 测试分层

- **纯函数单元测试：** 进度、触发匹配、次数、目标和修正计算。
- **技能模块测试：** 提示内容、合法选择、放弃、非法输入和效果结果。
- **房间生命周期：** WebSocket 命令、修订号、去重、持久化和重连。
- **隐私测试：** 私有牌、暗置角色和私有提示不泄露。
- **E2E：** 双玩家和一名观战者完成真实操作，并检查移动端。

`tools/battle/fixtures/auto-scenario.mjs` 提供只在本地测试中使用的固定牌序与双方角色位场景；Worker 路由不导入该文件，生产环境不存在测试命令或隐藏接口。

最低检查命令：

```bash
npm run validate
npm run typecheck
npm run test:battle
npm run build:battle
npm run build:web
```

## 14. 近期开发顺序

1. 操作组与上头组共 32 张已完成，作为前两套自动房可选预组。
2. 按密裁、逆命、不落、幽幕、执棋、变通的顺序迁移，共享角色只实现一次。
3. 8 套预组引用的 101 张角色完成后，再补齐剩余 19 张。
4. 120 张全部完成后，使用同一合法行为接口制作固定流程新手教程。
5. 最后实现服务端确定性机器人；AI 与真人提交相同行为意图，不直接修改状态，基础版不依赖大模型调用。

自动房快照中的 `game.legalActions` 是教程和机器人的统一合法行为接口。它由服务端按观察者身份生成，包含可直接提交的命令与负责选牌、支付费用的约束；观战者始终收到空列表。
