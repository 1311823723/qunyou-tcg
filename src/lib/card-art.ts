import baiziBody from "../assets/card-art-web/baizi-body.webp";
import baiziBodyMega from "../assets/card-art-web/baizi-body-mega-v2.webp";
import fengyaojingDesertButcher from "../assets/card-art-web/fengyaojing-desert-butcher-v2.webp";
import guamaoBody from "../assets/card-art-web/guamao-body.webp";
import guamaoBodyMega from "../assets/card-art-web/guamao-body-mega.webp";
import kekeAssassin from "../assets/card-art-web/keke-assassin.webp";
import kekeAssassinMega from "../assets/card-art-web/keke-assassin-mega.webp";
import xiangcaiNeo from "../assets/card-art-web/xiangcai-neo-final-v2.webp";
import xiangcaiPolitician from "../assets/card-art-web/xiangcai-politician-final.webp";
import xiangcaiProphet from "../assets/card-art-web/xiangcai-prophet-final-v2.webp";
import xiangcaiWatcher from "../assets/card-art-web/xiangcai-watcher-final-v2.webp";

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
  body_combo_001: {
    front: guamaoBody,
    extra: guamaoBodyMega,
  },
};

const characterArt: Record<string, ImageMetadata> = {
  char_aggro_001: kekeAssassin,
  char_combo_001: xiangcaiProphet,
  char_combo_004: xiangcaiPolitician,
  char_combo_007: xiangcaiWatcher,
  char_combo_013: xiangcaiNeo,
  char_general_017: fengyaojingDesertButcher,
};

export function getBodyArt(id: string): BodyArt | undefined {
  return bodyArt[id];
}

export function getCharacterArt(id: string): ImageMetadata | undefined {
  return characterArt[id];
}
