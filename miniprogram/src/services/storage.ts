import { findCard } from './catalog';
const KEY='baolvtuan-library-v1';
interface Library { favorites:string[]; recent:string[]; reduceMotion:boolean }
let cached:Library|undefined;
function notify(){wx.showToast({title:'本机记录保存失败，仍可继续查卡',icon:'none'});}
function valid(value:unknown):string[]{return Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string' && !!findCard(id)))]:[];}
function save(){try{wx.setStorageSync(KEY,cached);}catch{notify();}}
export function library():Library {
 if(!cached){let raw:Partial<Library>={};try{const stored=wx.getStorageSync(KEY);if(stored && typeof stored==='object')raw=stored;}catch{wx.showToast({title:'本机记录暂不可读',icon:'none'});}
 cached={favorites:valid(raw.favorites),recent:valid(raw.recent).slice(0,30),reduceMotion:raw.reduceMotion===true};
 if(JSON.stringify(raw)!==JSON.stringify(cached))save();}
 return {favorites:[...cached.favorites],recent:[...cached.recent],reduceMotion:cached.reduceMotion};
}
export function toggleFavorite(id:string){library();if(!findCard(id))return false;const has=cached!.favorites.includes(id);cached!.favorites=has?cached!.favorites.filter(x=>x!==id):[id,...cached!.favorites];save();return !has;}
export function visit(id:string){library();if(!findCard(id))return;cached!.recent=[id,...cached!.recent.filter(x=>x!==id)].slice(0,30);save();}
export function setReducedMotion(value:boolean){library();cached!.reduceMotion=value;save();}
