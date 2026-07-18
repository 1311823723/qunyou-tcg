# 实战记录

`matches.csv` 用于玩家主动记录已完成的 1v1 对局。项目不会自动收集群友的对战数据。

## 字段

| 字段 | 填写规则 |
|---|---|
| `date` | `YYYY-MM-DD` |
| `version` | 完整语义版本，例如 `0.2.0` |
| `player1Deck` / `player2Deck` | 正式预组 ID，例如 `deck_aggro_001` |
| `firstPlayer` | `p1` 或 `p2` |
| `winner` | `p1`、`p2` 或 `draw` |
| `turns` | 结束时的正整数回合数 |
| `player1EndHealth` / `player2EndHealth` | 0–7 |
| `problemCards` | 可选，多张卡用英文分号 `;` 分隔，优先填卡牌 ID |
| `notes` | 可选；包含逗号时用双引号包住整个字段 |

运行 `npm run playtest:report` 会先校验数据，再输出预组胜率、先手胜率、平均回合数、对局组合和高频问题牌。
