# 原画源文件

此目录只保存已经确认并且仍在使用的原画源文件，不保存候选图、旧版本或成卡图片。

## 目录

- `bodies/`：本体正面及 Mega、Z 招式等额外形态。
- `characters/`：角色牌原画。
- `hand-cards/`：基础牌与行动牌原画。
- `shared/`：被不同卡牌类型共用的同一份原画，避免复制高清源文件。

正式源文件使用与 `data/card-art.json` 一致的英文 slug，例如：

```text
characters/qindi-sheriff-v1.png
bodies/fengyaojing-body-z-move.png
hand-cards/hand-strike.png
shared/keke-assassin.png
```

新生成的候选图放在 `/private/tmp/qunyou-character-art/<card-id>/`。淘汰但暂时保留的历史图片放在项目根目录的 `archive/card-art-source-unused/`；`archive/` 已被 Git 忽略。

`tools/tts/assets/art/` 和 `src/assets/card-art-web/` 是注册脚本生成的运行时资产，不是源文件归档。运行 `npm run art:audit` 可以检查正式引用、运行时缺失文件、孤立文件和源图归档覆盖率。

部分早期卡牌没有保留独立源文件，审计中的“未归档源图”因此只作为提醒；不要使用派生 PNG 冒充原始源文件。
