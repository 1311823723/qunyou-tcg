# TTS art assets

These images are used only by the local Tabletop Simulator export pipeline.

Current mappings are defined in `data/card-art.json`. Use `npm run art:use -- --id <cardId> --source <image> --name <asset-name>` to register a selected image.

For body cards, use `--slot front` for the normal face and `--slot extra` for the Mega back face.

The script copies/converts the selected source to this folder as PNG, writes the matching frontend WebP to `src/assets/card-art-web/`, updates `data/card-art.json`, and removes the previously mapped asset when it is no longer referenced.

Card data remains in `data/cards/*.json`; art mapping is export-only.
