type Intent={query?:string; favorites?:boolean};

// 图鉴 tab 可直接查卡；带搜索／收藏意图的入口仍使用 collection 栈页，保留返回路径。
// collection 不是 tabBar 页面，所以这里必须用 navigateTo；switchTab 对它无效。
export function browse(intent:Intent={}) {
  const parts=['kind=全部'];
  if(intent.query)parts.push('q='+encodeURIComponent(intent.query));
  if(intent.favorites)parts.push('fav=1');
  wx.navigateTo({url:'/pages/collection/index?'+parts.join('&')});
}
export function openCollection(group:string){wx.navigateTo({url:'/pages/collection/index?kind='+encodeURIComponent(group)});}
export function openCard(id:string){wx.navigateTo({url:'/pages/detail/index?id='+encodeURIComponent(id)});}
export function openDeck(id:string){wx.navigateTo({url:'/pages/deck-detail/index?id='+encodeURIComponent(id)});}

let guideStart=false;
export function openGuide(){guideStart=true;wx.switchTab({url:'/pages/rules/index'});}
export function consumeGuideStart(){const value=guideStart;guideStart=false;return value;}
