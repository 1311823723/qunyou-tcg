# AGENTS.md

本文件为 AI coding agent 提供项目约定。请遵守以下原则：

1. 所有正式卡牌数据必须写在 `data/cards/*.json`。
2. 所有预组列表必须写在 `data/decks/*.json`。
3. 不要在 UI 里硬编码卡牌效果，UI 应读取 JSON 数据。
4. 修改卡牌效果后，必须同步更新 `playtest/changelog.md`。
5. 修改规则后，必须同步更新 `docs/rules.md` 和 `docs/keywords.md`。
6. 新增角色牌时必须包含：
   - id
   - name
   - cardType
   - deck
   - mainRole
   - tags
   - cost
   - timing
   - skillName
   - effectText
7. 每次改动尽量小，不要一次性重写整个项目。
8. 如果不确定规则，不要擅自发明大机制，先在 `playtest/balance-notes.md` 里记录建议。
9. UI 开发前必须阅读 `docs/style-guide.md`，遵循暗色桌面、TCG 卡牌感、轻微霓虹的视觉方向。
10. 卡牌展示不能做成表格，必须像"收藏册里的卡"。标签使用小胶囊样式。
11. 技能效果文本必须有足够行高，不能压得太小，不能溢出卡牌。
12. 命名体系为 `[鹅鸭杀职业]-[群友名字]`（如 刺客-柯柯、忍者-微笑尅乐）。同一职业可有多张变体。
