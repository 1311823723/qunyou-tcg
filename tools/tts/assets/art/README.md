# TTS art assets

These images are used only by the local Tabletop Simulator export pipeline.

Current mappings are defined in `data/card-art.json`. Use `npm run art:use -- --id <cardId> --source <image> --name <asset-name>` to register a selected image.

Approved source images live under `src/assets/card-art-source/`, grouped into `bodies/`, `characters/`, `hand-cards/`, and `shared/`. The current `tools/tts/assets/art/` directory contains generated runtime PNG files and should stay flat because the renderer resolves assets by slug.

For body cards, use `--slot front` for the normal face and `--slot extra` for the Mega back face.

The script copies/converts the selected source to this folder as PNG, writes the matching frontend WebP to `src/assets/card-art-web/`, updates `data/card-art.json`, and removes the previously mapped asset when it is no longer referenced.

Card data remains in `data/cards/*.json`; art mapping is export-only.

Run `npm run art:audit` to find missing or unreferenced runtime assets. Move suspected leftovers to the ignored `archive/card-art-source-unused/` directory before deleting them.
