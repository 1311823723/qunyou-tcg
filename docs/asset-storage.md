# 原画与生成资产管理

## 资产分层

- `src/assets/card-art-source/`：用户确认后的正式原画源文件，不可由派生图替代。
- `tools/tts/assets/art/`：制卡运行时使用的 PNG；早期卡牌中有部分文件仍是唯一可用资产。
- `src/assets/card-art-web/`：网页展示用 WebP，由原画注册流程生成。
- `public/cards/`、`public/cards-hd/`：完整卡面 WebP，由制卡流程生成并供 Pages 直接发布。
- `exports/`：本地 TTS 导出物，不进入 Git。

## Git LFS

新加入或修改的正式源图、TTS 原画、卡背和字体使用 Git LFS。首次参与原画维护前安装并初始化：

```bash
brew install git-lfs
git lfs install
```

本次规则不执行 `git lfs migrate`，不重写现有历史。历史压缩必须先制作可恢复备份，并作为独立维护任务执行。

`public/cards`、`public/cards-hd` 和 `src/assets/card-art-web` 暂不使用 LFS，确保 Cloudflare Pages 无需制卡即可发布现有卡面。

## 审计与删除规则

```bash
npm run art:audit
npm run art:audit:backlog
```

审计会报告源图覆盖率、运行资产缺失、目录体积和完全相同的重复文件。重复报告仅供判断，不代表文件可以直接删除。

删除或迁移任何原画前必须确认：

1. `data/card-art.json` 已有稳定映射。
2. 对应正式源图已归档，或明确记录该文件仍是唯一运行资产。
3. `npm run art:audit`、`npm run build:cards` 和视觉抽查均通过。
4. 不把 `tools/tts/assets/art/` 中的派生 PNG 复制到源图目录冒充原始文件。

当前缺失源图的明细保存在 `docs/card-art-source-backlog.md`。
