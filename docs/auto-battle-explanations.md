# 对战可理解性：实现与覆盖记录

更新：2026-09-08。本轮仅本地实现，不包含提交、推送或部署。验收事实见[项目状态](project-status.md)。

## 展示约定

采用简短常驻、详情展开。事件条在无待决策时展示已确认结果及可靠的直接原因；有栈、响应或选择时优先当前决策。近期详情单独标为已发生事件，新决策到来关闭该详情。未知事件使用“公开事件已处理”，不猜测原因。

确认预览展示来源、实际费用、费用承担者和目标归属；未选齐显示缺项。技能后续对象明确为结算中选择，不承诺最终伤害或收益。详情展示正式效果和已知费用修正。打开详情不修改草稿，关闭恢复入口焦点，Enter 不穿透提交。来源失效并清空草稿时收起旧预览。

己方角色的小标识显示可发动或阻塞状态；具体说明来自服务端同一合法性遍历。对手及观战视角不接收他人的私有可用性。保留体力／Mega／Z 原图标与动画、敌我位置、紧凑横竖屏、快捷操作默认关闭与防重复提交。

休整仍离开角色区并进入角色牌堆。此次没有新增横置或自动恢复状态，没有修改效果、支付时点或响应顺序。

## 服务端描述与隐私

共享可选类型为 `AutoBlocker`、`AutoEventCause`、`AutoPublicEvent`，操作描述增加正式效果、费用修正及后续选择提示。旧快照缺少字段时维持结果／通用说明，不迁移存档。

原因在效果适配器和费用执行点显式赋值。角色技能的原因随可序列化 `SkillContinuation` 保存；伤害原因经过 `PendingDamage` 与原有选择上下文继续传递，不从当时栈顶反推。休整费用与休整发动者的摸牌收益使用不同原因。

公开事件只新增数量、原因类别及来源所属方；不广播内部 metadata、私有卡名、实例编号或抽到的牌。事件描述目前故意不携带角色名字，即使其在其他公共区域已明置。伤害／回复／摸牌／休整／退场都能展示已确认结果；角色适配器、休整收益、费用与部分公开效果提供原因，未接入的历史／特殊效果只展示结果。尚不能逐事件还原所有修正来源，不能当作完整回放。

费用详情使用实际费用预览，修正提示只告知已应用修正；不公开隐藏修正来源。公共阻塞区分时机、计次、费用、明置限制及封锁；模块条件区分无目标和其他专属条件。复杂条件缺少细分时保留通用说明。

发布必须先部署兼容服务端，再部署客户端；本轮没有发布授权。

## 技能专属条件覆盖

已为 41 个单一或明确条件提供模块内说明。以下 35 项多条件、被动或事件限定检查暂用诚实通用提示；其合法性仍由原谓词控制。

| 模块位置 | 检查入口 | 状态 |
|---|---|---|
| `dispatch.mts:25` | `canActivate: (context) => context.canUseBasic(HAND_IDS.strike) &#124;&#124; context.canUseBasic(HAND_IDS.aid),` | 通用专属条件提示；不推断首个子条件 |
| `dispatch.mts:95` | `canActivate: (context) => context.player.hand.length > 0` | 通用专属条件提示；不推断首个子条件 |
| `dispatch.mts:118` | `canActivate: (context) => context.event?.characterDefinitionId !== DISPATCH_CHARACTER_IDS.embalmer` | 通用专属条件提示；不推断首个子条件 |
| `dispatch.mts:130` | `canActivate: (context) => context.event?.metadata?.revealedFromFaceDown === true` | 通用专属条件提示；不推断首个子条件 |
| `dispatch.mts:167` | `canActivate: (context) => Number(context.event?.amount &#124;&#124; 0) === 2` | 通用专属条件提示；不推断首个子条件 |
| `dispatch.mts:201` | `canActivate: (context) => !handIsLocked(context.state, context.player.id, HAND_IDS.strike)` | 通用专属条件提示；不推断首个子条件 |
| `combo.mts:191` | `canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceId && context.state.handDiscard.some((card) => card.instanceId === context.event?.metadata?.cardInstanceId)),` | 通用专属条件提示；不推断首个子条件 |
| `combo.mts:205` | `canActivate: (context) => Boolean(context.event?.cardDefinitionId && context.isActionCard(context.event.cardDefinitionId)),` | 通用专属条件提示；不推断首个子条件 |
| `combo.mts:253` | `canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && !item.cancelled && context.isActionCard(item.definitionId)),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:81` | `canActivate: (context) => context.player.hand.some(isRed) && !handIsLocked(context.state, context.player.id, HAND_IDS.strike),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:162` | `canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceIds),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:177` | `canActivate: (context) => judgmentIsBlack(context) && Boolean(context.opponent()?.hand.length),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:198` | `canActivate: (context) => Boolean(context.event?.sourcePlayerId && context.event.sourcePlayerId !== context.player.id),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:212` | `canActivate: (context) => context.player.hand.length > 0 && Boolean(context.currentJudgmentCard()),` | 通用专属条件提示；不推断首个子条件 |
| `blood.mts:238` | `canActivate: (context) => context.player.hand.length > 0 && Boolean(context.currentJudgmentCard()),` | 通用专属条件提示；不推断首个子条件 |
| `aggro.mts:139` | `canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && item.sourcePlayerId === context.player.id),` | 通用专属条件提示；不推断首个子条件 |
| `aggro.mts:175` | `canActivate: () => false,` | 通用专属条件提示；不推断首个子条件 |
| `aggro.mts:270` | `canActivate: (context) => context.player.hand.length > 0 && Boolean(context.opponent()?.hand.length),` | 通用专属条件提示；不推断首个子条件 |
| `aggro.mts:317` | `canActivate: (context) => context.player.hand.length > 0 && context.currentStrikeCanBeDodged(),` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:30` | `canActivate: (context) => context.event?.characterDefinitionId !== AMBUSH_CHARACTER_IDS.avenger,` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:39` | `canActivate: (context) => context.state.stack.some((item) => item.kind === "hand" && !item.cancelled),` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:48` | `canActivate: (context) => Boolean(context.opponent()?.characterSlots.some((slot) => slot && "instanceId" in slot` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:82` | `canActivate: () => false,` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:89` | `canActivate: (context) => context.event?.characterDefinitionId !== AMBUSH_CHARACTER_IDS.loverGuamao,` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:147` | `canActivate: () => false,` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:154` | `canActivate: () => false,` | 通用专属条件提示；不推断首个子条件 |
| `ambush.mts:161` | `canActivate: (context) => Boolean(context.event?.metadata?.cardInstanceIds),` | 通用专属条件提示；不推断首个子条件 |
| `extra.mts:50` | `canActivate: (c) => c.player.hand.length > 0 && c.player.markers.filter((m) => m.kind === "cards" && m.label === "藤蔓").reduce((n, m) => n + (m.kind === "cards" ? m.cards.length : 0), 0) < 2,` | 通用专属条件提示；不推断首个子条件 |
| `extra.mts:178` | `canActivate: (c) => c.player.hand.length > 0 && basicOptions(c).length > 0,` | 通用专属条件提示；不推断首个子条件 |
| `extra.mts:218` | `canActivate: (c) => c.event?.metadata?.deploymentPhaseOrdinal === 2 && Boolean(c.opponent()?.characterSlots.some((s) => s && "instanceId" in s && s.instanceId === c.event?.metadata?.characterInstanceId)),` | 通用专属条件提示；不推断首个子条件 |
| `extra.mts:227` | `canActivate: (c) => c.event?.sourcePlayerId === c.opponent()?.id && discardedThisEvent(c).length > 0,` | 通用专属条件提示；不推断首个子条件 |
| `trans.mts:56` | `canActivate: (context) => context.markerCount("充能球") < 3 &#124;&#124; !handIsLocked(context.state, context.player.id, HAND_IDS.strike),` | 通用专属条件提示；不推断首个子条件 |
| `trans.mts:116` | `canActivate: (context) => context.player.retired.length > 0 && context.player.characterSlots.some((slot) => slot === null),` | 通用专属条件提示；不推断首个子条件 |
| `trans.mts:140` | `canActivate: (context) => Number(context.event?.amount &#124;&#124; 0) > 0` | 通用专属条件提示；不推断首个子条件 |
| `mizai.mts:168` | `canActivate: (context) => {` | 通用专属条件提示；不推断首个子条件 |

## 验收边界

新增自动测试覆盖计次／封锁／明置、原因安全字段、费用与收益分离、序列化选择及延迟伤害。浏览器检查预览不提交、费用承担者不同、关闭保留草稿和焦点、新响应优先、既有七种视口；原有快捷输入、费用、响应、牌序、快照乱序与图标动画继续回归。

iOS／安卓真机、首次玩家理解度均待验。浏览器截图不能代替真机或理解度结论。复杂条件细分与未描述的特殊效果记录在本文件及待办，不称为全量因果回放。

2026-09-08 本地验收：数据、类型、165 项规则测试、前后端构建通过；浏览器回归及最终七视口检查通过。最小竖屏为操作区预留高度，短横屏隐藏重复标题，摘要最多两行、详情保留全文；小屏手牌触控高度至少 44px。具体轮次和测试修正记录见项目状态。
