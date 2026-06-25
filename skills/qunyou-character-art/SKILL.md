---
name: qunyou-character-art
description: Create or refine image-generation prompts and art-direction briefs for 群友杀 TCG character-card original art. Use when generating, reviewing, or replacing character-card artwork from data/cards/characters.json, especially when the art must match the card's source game role, a provided friend/reference image, and the card skill's meaning before registering art with npm run art:use.
---

# 群友杀角色原画

Use this skill for **角色牌** art only. For body, Mega, Z招式, or export mechanics, follow `docs/card-export-workflow.md` as the source of truth.

## Required Context

Before drafting a prompt or art brief:

1. Read the target card from `data/cards/characters.json`.
2. Use these fields as constraints: `name`, `id`, `source`, `mainRole`, `tags`, `cost`, `timing`, `skillName`, `effectText`, and `deck`.
3. Split `name` at the first `-`: the left side is the role/identity, the right side is the friend/player identity.
4. If the user supplied an image, treat it as the primary likeness/style anchor for the friend/player identity.
5. Search the web for the role/identity's appearance in the source game before designing the outfit, silhouette, or iconic props. Prefer official pages, official wikis, store pages, or well-maintained fan wikis with screenshots.

## Source Mapping

Use `source` to decide which game's role visual language to research:

- `鹅`: Goose Goose Duck. Use the named identity as the role reference.
- `塔`: Slay the Spire. Use the named character/card/relic archetype as the visual reference.
- `盟`: League of Legends. Use the champion or skin-line identity as the visual reference.
- `洲`: Delta Force / 三角洲行动. Use the named operator/class identity as the visual reference.

If `source` is missing or unfamiliar, inspect nearby cards and project docs first. If still unclear, ask the user before inventing a source.

## Art Direction Rules

- The generated character must clearly read as the card's role type. Do not make a generic fantasy portrait when the role has a recognizable source-game shape, costume, prop, color, or silhouette.
- Preserve the supplied friend/reference image's recognizable features where appropriate: hairstyle, expression, face shape, glasses, vibe, color preference, or posture. Do not copy unrelated copyrighted characters wholesale; blend source-role costume language with the friend likeness.
- Reflect the skill meaning through action, pose, props, or environment. Example: discard/steal effects can use snatched cards or falling documents; ambush can use hidden stance, shadow, trap, or sudden reveal; defense can use shield, barrier, cover, or interception.
- Match `mainRole` mood:
  - `强攻`: forward motion, weapon impact, pressure, aggressive lighting.
  - `防御`: guarding, barrier, armor, rescue/intercept posture.
  - `资源`: gathering, cards, tokens, supplies, engines, calculation.
  - `控制`: command gesture, restraint, traps, surveillance, manipulation.
  - `支援`: healing, buffing, coordination, guiding teammates.
  - `伏击`: concealed pose, shadows, sudden strike, hidden trigger.
- Include `tags` only as visual hints, not literal UI text.
- Use the skill's `cost` and `timing` as intensity cues: `退场自身` should look decisive, sacrificial, or explosive; `休整` should look tactical and reusable.
- Keep the image suitable for a vertical TCG card: single central character, readable silhouette, important face/upper body near center, no tiny details required to understand the concept.
- Avoid text, logos, watermarks, UI frames, card borders, speech bubbles, or numbers in the image.

## Prompt Structure

Draft prompts in this order:

1. **Subject**: role identity + friend identity, with source-game visual anchor and supplied-image likeness anchor.
2. **Action**: a concrete pose that expresses `skillName` and `effectText`.
3. **Props/Scene**: 1-3 iconic props or environmental elements tied to the source role and skill.
4. **Style**: dark neon TCG illustration, polished anime/game concept art, high-contrast readable silhouette.
5. **Composition**: vertical portrait, full-body or three-quarter body, centered, safe margins, face visible, no text.
6. **Negative constraints**: no watermark, no words, no UI, no extra card frame, no unrelated character, no photorealistic celebrity copy.

When outputting a prompt for generation, also include a short **设计理由** explaining how the source role, friend likeness, and skill meaning are encoded.

## Image File Flow

Keep candidate images, approved source images, and registered assets in separate places:

- Treat AI-generated images and intermediate edits as temporary candidates. Store them under `/private/tmp/qunyou-character-art/<card-id>/`.
- Before user approval, do not write to `data/card-art.json`, `tools/tts/assets/art/`, or `src/assets/card-art-web/`.
- After the user confirms a candidate as usable, archive the approved source image in `src/assets/card-art-source/` with a stable slug filename, for example `qindi-sheriff-v1.png`.
- When the user explicitly asks to write/register/connect the art, register it with:

```bash
npm run art:use -- --id <character-id> --source src/assets/card-art-source/<slug>.png --name <slug>
```

- The registration script is responsible for writing the formal assets and mapping:
  - `tools/tts/assets/art/<slug>.png`
  - `src/assets/card-art-web/<slug>.webp`
  - `data/card-art.json`

## Approval Gate

- Do not move temporary candidates into `src/assets/card-art-source/` until the user confirms the selected image.
- Do not run `npm run art:use` until the user explicitly says to write, register, or connect the art.
- Register multiple character images serially. Never run multiple `npm run art:use` commands in parallel.
- Do not change card data, decks, rules, or generated card faces as part of prompt drafting.

## Naming Rules

- Candidate files may use `<slug>-candidate-a.png`, `<slug>-candidate-b.png`, and so on.
- Approved source files should use `<player>-<identity>-vN.png`, such as `qindi-sheriff-v1.png`.
- The `--name` value for `npm run art:use` must be the same slug without the extension.
- Slugs must use lowercase English letters, numbers, and hyphens only.

## Quality Checklist

Before finalizing the prompt or accepting generated art, verify:

- The role before `-` is visibly recognizable from the correct source game.
- The friend/player side after `-` is represented by the provided reference image or agreed visual traits.
- The pose or props communicate the actual skill, not just the card name.
- The art remains readable when cropped into the character art stage (`598 x 960` inside a `750 x 1050` card).
- The image has no text, watermark, card border, or UI decoration.
- The prompt does not change card data, rules, cost, timing, or skill text.

## Registration Handoff

If the user asks to write/register the art after approval, follow `docs/card-export-workflow.md`:

- Use a stable lowercase slug: `<player>-<identity>` with optional version suffix.
- Register角色牌 without `--slot`:

```bash
npm run art:use -- --id <character-id> --source src/assets/card-art-source/<slug>.png --name <slug>
```

- Run `npm run validate`, then `npm run export:tts` or `npm run build` as requested.
- Never run multiple `npm run art:use` commands in parallel.
