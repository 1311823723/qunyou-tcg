# 制卡导出工作流

本文档用于处理原画接入、原画替换、成卡同步、Tabletop Simulator 导出，以及用户明确要求时的提交推送。

## 适用场景

- 为角色牌、本体牌、额外形态或手牌接入新原画。
- 替换已有原画，并同步 TTS PNG 与前端 WebP。
- 重新生成 `exports/tts` 下的本地 TTS 卡包资源。
- 重新生成 `public/cards` 和 `public/cards-hd` 下的前端成卡图。
- 用户明确要求时，将本次制卡导出相关改动提交并推送。

## 核心规则

大图存储、Git LFS 和源图缺口处理同时遵循 `docs/asset-storage.md`。

1. **禁止并行注册原画。**
   多个 `npm run art:use` 命令必须串行执行，等上一条命令完成后再执行下一条。
   原因：`tools/use-card-art.js` 会读写同一个 `data/card-art.json`，并行执行可能互相覆盖 manifest。

2. **不要为了制卡修改卡牌数据。**
   卡牌名称、技能、标签、预组构成仍以 `data/cards/*.json` 和 `data/decks/*.json` 为准。

3. **原画 slug 使用稳定小写命名。**
   只能使用小写英文、数字和短横线。不要使用中文、空格、下划线或版本含义不清的临时名。

4. **导出文件以脚本生成结果为准。**
   不手工改 `exports/tts`、`public/cards`、`public/cards-hd` 下的成卡文件名。

5. **正式源图与候选图分开保存。**
   - 本体源图：`src/assets/card-art-source/bodies/<slug>.png`
   - 角色源图：`src/assets/card-art-source/characters/<slug>.png`
   - 手牌源图：`src/assets/card-art-source/hand-cards/<slug>.png`
   - 跨牌种共用源图：`src/assets/card-art-source/shared/<slug>.png`
   - 未确认候选图：`/private/tmp/qunyou-character-art/<card-id>/`
   - 淘汰但暂时保留的版本：`archive/card-art-source-unused/`（不进入 Git）

## 原画命名建议

- 本体正面：`<player>-body`
  - 例：`fengyaojing-body`
- Mega / Z招式 / 其他额外形态：`<player>-body-mega`、`<player>-body-z-move`
  - 例：`fengyaojing-body-z-move`
- 角色牌：`<player>-<identity>`，必要时追加稳定版本号
  - 例：`xiaoapan-warlock`、`fengyaojing-desert-butcher-v2`
- 手牌：`hand-<英文短名>`
  - 例：`hand-strike`、`hand-first-aid`

## 标准执行顺序

1. **确认目标卡牌。**
   - 在 `data/cards/bodies.json` 或 `data/cards/characters.json` 中确认目标 `id`。
   - 本体正面使用 `--slot front`。
   - 本体额外形态使用 `--slot extra`。
   - 角色牌不使用 `--slot`。
   - 手牌不使用 `--slot`，同名牌的不同花色与点数共用一张原画。

2. **串行注册原画。**

   单张角色牌示例：

   ```bash
   npm run art:use -- --id char_052_fengyaojing_desert-butcher --source src/assets/card-art-source/characters/fengyaojing-desert-butcher-v3.png --name fengyaojing-desert-butcher-v3
   ```

   单张手牌示例：

   ```bash
   npm run art:use -- --id hand_basic_001 --source src/assets/card-art-source/hand-cards/hand-strike.png --name hand-strike
   ```

   本体双面示例：

   ```bash
   npm run art:use -- --id body_blood_001 --slot front --source src/assets/card-art-source/bodies/fengyaojing-body.png --name fengyaojing-body
   npm run art:use -- --id body_blood_001 --slot extra --source src/assets/card-art-source/bodies/fengyaojing-body-z-move.png --name fengyaojing-body-z-move
   ```

3. **运行数据校验。**

   ```bash
   npm run validate
   ```

   同时检查原画引用：

   ```bash
   npm run art:audit
   ```

4. **生成 TTS 导出。**

   ```bash
   npm run export:tts
   ```

5. **同步前端成卡并构建。**

   ```bash
   npm run build
   ```

   `npm run build` 会先执行 `cards:sync`，从 TTS 单卡 PNG 生成 `public/cards` 与 `public/cards-hd` 的 WebP 成卡。

6. **抽查导出结果。**
   - 确认 `exports/tts/cards/...` 下目标 PNG 存在。
   - 确认 `public/cards/...` 和 `public/cards-hd/...` 下目标 WebP 存在。
   - Mega 背面应为 `_mega_back`。
   - Z招式背面应为 `_z_move_back`。
   - 钛晶化背面应为 `_terastal_back`。
   - 极巨化背面应为 `_dynamax_back`。
   - 必要时用图片预览确认不是空图、旧图或明显裁切错误。

## 常见任务

### 清理原画资产

1. 运行 `npm run art:audit`，确认缺失和未引用列表。
2. 未引用的派生 PNG/WebP 和旧版源图先移入 `archive/card-art-source-unused/<日期>/`，不要直接删除。
3. 当前采用的源图按牌种放入 `src/assets/card-art-source/` 的对应子目录，文件名与正式 slug 一致。
4. 不要将 `tools/tts/assets/art/` 的派生 PNG 复制回来冒充缺失的原始源文件。
5. 再次运行审计、`npm run validate` 和 `npm run build`。

需要查看尚未归档的早期源图明细时，运行：

```bash
npm run art:audit -- --verbose
```

### 单张角色原画替换

1. 确认角色 `id`。
2. 运行一条 `npm run art:use`。
3. 运行 `npm run validate`。
4. 运行 `npm run export:tts`。
5. 运行 `npm run build`。
6. 抽查角色 PNG、WebP 和相关预设卡组文件夹。

### 本体正反面原画替换

1. 确认本体 `id` 和 `extraForm.type`。
2. 串行运行 `front` 与 `extra` 两条 `npm run art:use`。
3. 运行 `npm run validate`。
4. 运行 `npm run export:tts`。
5. 运行 `npm run build`。
6. 抽查本体正面、额外形态背面、TTS sheet 正反面和前端 WebP。

### 只重新导出 TTS

1. 不修改原画映射时，直接运行：

   ```bash
   npm run export:tts
   ```

2. 如果前端成卡也需要同步，运行：

   ```bash
   npm run build
   ```

### 导出后提交推送

只有用户明确要求提交或推送时才执行。

1. 先检查工作区：

   ```bash
   git status --short
   ```

2. 只 stage 本次制卡导出相关文件。
   不主动纳入用户未说明的前端、规则、卡牌文本或其他无关改动。

3. 提交信息使用简短中文或英文，说明卡图或导出更新。

4. push 前确认当前分支，并使用已有 GitHub 工作流。

## 验收标准

- `npm run validate` 通过。
- `npm run art:audit` 不报告缺失的 TTS PNG 或网页 WebP。
- 修改制卡导出脚本或前端成卡路径时，`npm run export:tts` 和 `npm run build` 通过。
- 目标卡图在 TTS 单卡、TTS sheet、前端普通图、前端高清图中都能找到。
- `data/card-art.json` 中目标映射正确，没有因为并行注册丢失另一面的映射。
