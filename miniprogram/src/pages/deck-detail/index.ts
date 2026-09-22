import {catalog,findCard,tile} from '../../services/catalog';
import type {Deck} from '../../services/types';
import {openCard} from '../../services/navigation';
import {library} from '../../services/storage';
Page({data:{exhibit:catalog.presentation.homeExhibit,deck:null as Deck|null,body:null as ReturnType<typeof tile>|null,members:[] as ReturnType<typeof tile>[],visibleMembers:[] as ReturnType<typeof tile>[],roles:[] as {name:string;count:number}[],role:'全部',reduceMotion:false},
onLoad(options:Record<string,string|undefined>){const deck=catalog.decks.find(d=>d.id===options.id);if(!deck)return;const members=deck.characterIds.map(id=>tile(findCard(id)!));const roles=[...new Set(members.map(c=>c.role))].filter(Boolean).map(name=>({name,count:members.filter(c=>c.role===name).length}));this.setData({deck,body:tile(findCard(deck.bodyId)!),members,visibleMembers:members,roles,reduceMotion:library().reduceMotion});wx.setNavigationBarTitle({title:deck.name});},
onShow(){this.setData({reduceMotion:library().reduceMotion});},
filter(e:WechatMiniprogram.TouchEvent){const requested=e.currentTarget.dataset.role as string;const role=requested===this.data.role?'全部':requested;if(role!=='全部'&&!this.data.roles.some(r=>r.name===role))return;this.setData({role,visibleMembers:this.data.members.filter(c=>role==='全部'||c.role===role)});},
roster(){wx.pageScrollTo({selector:'#roster',duration:this.data.reduceMotion?0:180,fail:()=>{}});},
body(){if(this.data.deck)openCard(this.data.deck.bodyId);},
open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);},
back(){wx.switchTab({url:'/pages/decks/index'});}});
