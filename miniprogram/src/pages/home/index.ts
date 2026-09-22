import { catalog,findCard,tile } from '../../services/catalog';
import { library } from '../../services/storage';
import { browse,openCard,openDeck,openGuide } from '../../services/navigation';
// 展示素材对应精选本体；正式名称、预组简介仍从随包目录读取。
const spotlight=catalog.decks.find(d=>d.id===catalog.presentation.homeExhibit.deckId)!;
Page({data:{spotlight,decks:catalog.presentation.featuredDeckIds.map(id=>catalog.decks.find(d=>d.id===id)!),favorites:[] as ReturnType<typeof tile>[],recent:[] as ReturnType<typeof tile>[],reduceMotion:false},
onShow(){const state=library();this.setData({favorites:state.favorites.slice(0,6).map(id=>tile(findCard(id)!)),recent:state.recent.slice(0,6).map(id=>tile(findCard(id)!)),reduceMotion:state.reduceMotion});},
// 三个入口分别对应三个 tab；tabBar 页面只能用 switchTab，navigateTo 会报 "can not navigate to a tabBar page"。
entry(e:WechatMiniprogram.TouchEvent){const key=e.currentTarget.dataset.key as string;if(key==='rules'){openGuide();return;}const map:{[k:string]:string}={rules:'/pages/rules/index',cards:'/pages/cards/index',decks:'/pages/decks/index'};wx.switchTab({url:map[key]||'/pages/home/index'});},
spotlightCard(){openCard(this.data.spotlight.bodyId);},
deck(e:WechatMiniprogram.TouchEvent){openDeck(e.currentTarget.dataset.id);},
website(){wx.navigateTo({url:'/pages/website/index'});},search(){browse();},favorites(){browse({favorites:true});},history(){wx.navigateTo({url:'/pages/history/index'});},open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);}
});
