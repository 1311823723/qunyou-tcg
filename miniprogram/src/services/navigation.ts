type Intent={query?:string; favorites?:boolean};
import { findCard } from './catalog';

// 图鉴 tab 可直接查卡；带搜索／收藏意图的入口仍使用 collection 栈页，保留返回路径。
// collection 不是 tabBar 页面，所以这里必须用 navigateTo；switchTab 对它无效。
export function browse(intent:Intent={}) {
  const parts=['kind=全部'];
  if(intent.query)parts.push('q='+encodeURIComponent(intent.query));
  if(intent.favorites)parts.push('fav=1');
  wx.navigateTo({url:'/pages/collection/index?'+parts.join('&')});
}
export function openCollection(group:string){wx.navigateTo({url:'/pages/collection/index?kind='+encodeURIComponent(group)});}
export function sharedCardUrl(id:string,face=0){return'/pages/detail/index?id='+encodeURIComponent(id)+(face?'&face='+face:'');}
export function cardDetailUrl(id:string,face=0){const pack=findCard(id)?.pack;return(pack?`/${pack}`:'')+sharedCardUrl(id,face);}
export function openCard(id:string,face=0){wx.navigateTo({url:cardDetailUrl(id,face),fail:()=>wx.navigateTo({url:sharedCardUrl(id,face)+'&fallback=1'})});}
export function openDeck(id:string){wx.navigateTo({url:'/pages/deck-detail/index?id='+encodeURIComponent(id)});}
export function openAbout(){wx.navigateTo({url:'/pages/about/index'});}

let guideStart=false;
export function openGuide(){guideStart=true;wx.switchTab({url:'/pages/rules/index'});}
export function consumeGuideStart(){const value=guideStart;guideStart=false;return value;}
