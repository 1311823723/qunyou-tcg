import { catalog,findCard,tile } from '../../services/catalog';
import { library } from '../../services/storage';
import { browse,openCard,openDeck,openGuide } from '../../services/navigation';
Page({data:{featured:catalog.presentation.featuredDeckIds.map(id=>catalog.decks.find(d=>d.id===id)!),decks:catalog.decks,heroIndex:0,favorites:[] as ReturnType<typeof tile>[],recent:[] as ReturnType<typeof tile>[],reduceMotion:false},
onShow(){const state=library();this.setData({favorites:state.favorites.slice(0,6).map(id=>tile(findCard(id)!)),recent:state.recent.slice(0,6).map(id=>tile(findCard(id)!)),reduceMotion:state.reduceMotion});},
heroChange(e:WechatMiniprogram.SwiperChange){this.setData({heroIndex:e.detail.current});},search(){browse();},guide(){openGuide();},history(){wx.navigateTo({url:'/pages/history/index'});},deck(e:WechatMiniprogram.TouchEvent){openDeck(e.currentTarget.dataset.id);},open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);}
});
