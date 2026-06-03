import baiziBody from "../../tools/tts/assets/art/baizi-body.png";
import baiziBodyMega from "../../tools/tts/assets/art/baizi-body-mega-v2.png";
import kekeAssassin from "../../tools/tts/assets/art/keke-assassin.png";
import kekeAssassinMega from "../../tools/tts/assets/art/keke-assassin-mega.png";
import xiangcaiNeo from "../../tools/tts/assets/art/xiangcai-neo-final-v2.png";
import xiangcaiPolitician from "../../tools/tts/assets/art/xiangcai-politician-final.png";
import xiangcaiProphet from "../../tools/tts/assets/art/xiangcai-prophet-final-v2.png";
import xiangcaiWatcher from "../../tools/tts/assets/art/xiangcai-watcher-final-v2.png";

export interface BodyArt {
  front?: ImageMetadata;
  extra?: ImageMetadata;
}

const bodyArt: Record<string, BodyArt> = {
  body_mizai_001: {
    front: kekeAssassin,
    extra: kekeAssassinMega,
  },
  body_trans_001: {
    front: baiziBody,
    extra: baiziBodyMega,
  },
};

const characterArt: Record<string, ImageMetadata> = {
  char_aggro_001: kekeAssassin,
  char_combo_001: xiangcaiProphet,
  char_combo_004: xiangcaiPolitician,
  char_combo_007: xiangcaiWatcher,
  char_combo_013: xiangcaiNeo,
};

export function getBodyArt(id: string): BodyArt | undefined {
  return bodyArt[id];
}

export function getCharacterArt(id: string): ImageMetadata | undefined {
  return characterArt[id];
}
