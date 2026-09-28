// 不要写成 "../generated/catalog.json"：微信 require 会给路径追加 ".js"，
// 引入 .json 会在运行时报 "module 'generated/catalog.json.js' is not defined"。
// 生成物是 CommonJS 模块，类型由同目录手写的 catalog.d.ts 提供。
import raw from "../generated/catalog";
import type { Catalog, Card } from "./types";
export const catalog: Catalog = raw;
export function imageUrl(path: string) { return path.startsWith("/") ? path : ""; }
export function findCard(id: string) { return catalog.cards.find(card => card.id === id); }
export function searchCards(query: string, kind = "全部", role = "全部", deckId = "全部") {
 const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return catalog.cards.filter(card => (kind === "全部" || card.kind === kind) && (role === "全部" || card.role === role)
  && (deckId === "全部" || catalog.decks.some(d=>d.id===deckId && (d.bodyId===card.id || d.characterIds.includes(card.id))))
  && words.every(word => [card.name,card.id,...card.tags,...card.sections.map(s => s.title + " " + s.text)].join(" ").toLocaleLowerCase().includes(word)));
}
export function tile(card: Card) { return {id:card.id,name:card.name,kind:card.kind,role:card.role,image:imageUrl(card.faces[0]?.image || "")}; }

export function relatedDecks(id:string) { return catalog.decks.filter(d=>d.bodyId===id || d.characterIds.includes(id)); }
