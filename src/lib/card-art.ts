import artManifest from "../../data/card-art.json";

export interface BodyArt {
  front?: ImageMetadata;
  extra?: ImageMetadata;
}

interface BodyArtSlugs {
  front?: string;
  extra?: string;
}

const artModules = import.meta.glob("../assets/card-art-web/*.webp", {
  eager: true,
  import: "default",
}) as Record<string, ImageMetadata>;

const bodyArt = artManifest.bodies as Record<string, BodyArtSlugs>;
const characterArt = artManifest.characters as Record<string, string>;

function getArt(slug?: string): ImageMetadata | undefined {
  if (!slug) return undefined;
  return artModules[`../assets/card-art-web/${slug}.webp`];
}

export function getBodyArt(id: string): BodyArt | undefined {
  const art = bodyArt[id];
  if (!art) return undefined;
  return {
    front: getArt(art.front),
    extra: getArt(art.extra),
  };
}

export function getCharacterArt(id: string): ImageMetadata | undefined {
  return getArt(characterArt[id]);
}
