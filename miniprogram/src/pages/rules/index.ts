import {catalog,findCard,tile} from '../../services/catalog';import {library,setReducedMotion} from '../../services/storage';import {openCard,consumeGuideStart} from '../../services/navigation';
// pageScrollTo fails harmlessly before the first layout pass, so the failure is swallowed on purpose.
const scroll=(options:WechatMiniprogram.PageScrollToOption)=>wx.pageScrollTo({...options,fail:()=>{}});
Page({data:{mode:'start',query:'',sections:catalog.articles[0].sections,keywords:catalog.articles[1].sections,steps:catalog.presentation.quickStart.map(s=>({...s,card:tile(findCard(s.cardId)!)})),reduceMotion:false,version:catalog.contentVersion},
onShow(){this.setData({reduceMotion:library().reduceMotion});if(consumeGuideStart()){this.setData({mode:'start'});scroll({scrollTop:0,duration:0});}},
mode(e:WechatMiniprogram.TouchEvent){this.setData({mode:e.currentTarget.dataset.mode});scroll({scrollTop:0,duration:0});},
search(e:WechatMiniprogram.Input){const query=e.detail.value;this.setData({query,keywords:catalog.articles[1].sections.filter(s=>(s.title+' '+s.text).toLowerCase().includes(query.trim().toLowerCase()))});},
chapter(e:WechatMiniprogram.TouchEvent){scroll({selector:'#'+e.currentTarget.dataset.anchor,duration:this.data.reduceMotion?0:180});},
top(){scroll({scrollTop:0,duration:this.data.reduceMotion?0:180});},
open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);},
motion(e:WechatMiniprogram.SwitchChange){setReducedMotion(e.detail.value);this.setData({reduceMotion:e.detail.value});}});
