import {catalog,findCard,tile} from '../../services/catalog';
import type {Section} from '../../services/types';
import {library,setReducedMotion} from '../../services/storage';
import {openCard,consumeGuideStart} from '../../services/navigation';
const scroll=(options:WechatMiniprogram.PageScrollToOption)=>wx.pageScrollTo({...options,fail:()=>{}});
Page({data:{mode:'start',query:'',sections:catalog.articles[0].sections,keywords:catalog.articles[1].sections,steps:catalog.presentation.quickStart.map((s,index)=>({...s,anchor:'lesson-'+index,card:tile(findCard(s.cardId)!)})),currentChapter:null as Section|null,chapterIndex:-1,reduceMotion:false,version:catalog.contentVersion},
onShow(){this.setData({reduceMotion:library().reduceMotion});if(consumeGuideStart()){this.setData({mode:'start'});scroll({scrollTop:0,duration:0});}},
mode(e:WechatMiniprogram.TouchEvent){const mode=e.currentTarget.dataset.mode as string;if(!['start','rules','keywords'].includes(mode))return;this.setData({mode});scroll({scrollTop:0,duration:0});},
search(e:WechatMiniprogram.Input){const query=e.detail.value;this.setData({query,keywords:catalog.articles[1].sections.filter(s=>(s.title+' '+s.text).toLowerCase().includes(query.trim().toLowerCase()))});},
clearSearch(){this.setData({query:'',keywords:catalog.articles[1].sections});},
chapter(e:WechatMiniprogram.TouchEvent){this.selectChapter(this.data.sections.findIndex(s=>s.anchor===e.currentTarget.dataset.anchor));},
selectChapter(index:number){const currentChapter=this.data.sections[index];if(!currentChapter)return;this.setData({currentChapter,chapterIndex:index});scroll({scrollTop:0,duration:0});},
previous(){this.selectChapter(this.data.chapterIndex-1);},next(){this.selectChapter(this.data.chapterIndex+1);},
contents(){this.setData({currentChapter:null,chapterIndex:-1});scroll({scrollTop:0,duration:0});},
lesson(e:WechatMiniprogram.TouchEvent){const anchor=e.currentTarget.dataset.anchor as string;if(!this.data.steps.some(s=>s.anchor===anchor))return;scroll({selector:'#'+anchor,duration:this.data.reduceMotion?0:180});},
top(){scroll({scrollTop:0,duration:this.data.reduceMotion?0:180});},
open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);},
motion(e:WechatMiniprogram.SwitchChange){setReducedMotion(e.detail.value);this.setData({reduceMotion:e.detail.value});}});
