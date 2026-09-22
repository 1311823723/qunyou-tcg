import { catalog,tile } from '../../services/catalog';
import { library } from '../../services/storage';
import { openCard } from '../../services/navigation';
const GROUPS:{[key:string]:string[]}={'本体':['本体'],'角色':['角色'],'手牌':['基础牌','行动牌'],'全部':[]};
const SUBS:{[key:string]:string[]}={'手牌':['基础牌','行动牌'],'全部':['本体','角色','基础牌','行动牌','骑士卡']};
const TITLES:{[key:string]:string}={'本体':'本体牌','角色':'角色牌','手牌':'手牌','全部':'全部卡牌'};
// navigateTo 传来的中文参数在真机/模拟器里仍是百分号编码（%E6%9C%AC%E4%BD%93），
// 不会自动解码；不处理就会一路落到默认分类。已在开发者工具内实测确认。
const safeDecode=(value:string)=>{try{return decodeURIComponent(value);}catch{return value;}};
const NOTES:{[key:string]:string}={'本体':'决定体力、流派方向与额外形态。','角色':'暗置上阵、休整发动、退场爆发的战术单位。','手牌':'双方共用的基础牌与行动牌。','全部':'查询卡面、技能与完整效果。'};
Page({data:{kind:'全部',title:'全部卡牌',note:'',query:'',sub:'全部',subs:[] as string[],role:'全部',roleIndex:0,roles:['全部',...new Set(catalog.cards.map(c=>c.role).filter(Boolean))],deckId:'全部',deckName:'全部',deckIndex:0,decks:[{id:'全部',name:'全部'},...catalog.decks.map(d=>({id:d.id,name:d.name}))],filtersOpen:false,onlyFavorites:false,cards:[] as ReturnType<typeof tile>[],version:catalog.contentVersion,reduceMotion:false},
onLoad(options:{kind?:string;q?:string;fav?:string}){
 const requested=options.kind?safeDecode(options.kind):'';
 const kind=GROUPS[requested]?requested:'全部';
 this.setData({kind,title:TITLES[kind]||'全部卡牌',note:NOTES[kind]||'',subs:SUBS[kind]||[],query:options.q?safeDecode(options.q):'',sub:'全部',onlyFavorites:options.fav==='1',filtersOpen:false});
 wx.setNavigationBarTitle({title:TITLES[kind]||'全部卡牌'});
},
onShow(){this.setData({reduceMotion:library().reduceMotion});this.refresh();},
onSearch(e:WechatMiniprogram.Input){this.setData({query:e.detail.value});this.refresh();},
onSub(e:WechatMiniprogram.TouchEvent){const sub=e.currentTarget.dataset.sub as string;this.setData({sub:sub===this.data.sub&&sub!=='全部'?'全部':sub});this.refresh();},
onRole(e:WechatMiniprogram.PickerChange){this.setData({roleIndex:Number(e.detail.value),role:this.data.roles[Number(e.detail.value)]});this.refresh();},
onDeck(e:WechatMiniprogram.PickerChange){const deck=this.data.decks[Number(e.detail.value)];this.setData({deckIndex:Number(e.detail.value),deckId:deck.id,deckName:deck.name});this.refresh();},
filters(){this.setData({filtersOpen:!this.data.filtersOpen});},
mode(e:WechatMiniprogram.TouchEvent){this.setData({onlyFavorites:e.currentTarget.dataset.mode==='favorites'});this.refresh();},
reset(){this.setData({query:'',sub:'全部',role:'全部',roleIndex:0,deckId:'全部',deckName:'全部',deckIndex:0,onlyFavorites:false});this.refresh();},
refresh(){
 const kinds=GROUPS[this.data.kind]||[];
 const words=this.data.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const ids=library().favorites;
 const cards=catalog.cards.filter(card=>(!kinds.length||kinds.includes(card.kind))
  &&(this.data.sub==='全部'||card.kind===this.data.sub)
  &&(this.data.role==='全部'||card.role===this.data.role)
  &&(this.data.deckId==='全部'||catalog.decks.some(d=>d.id===this.data.deckId&&(d.bodyId===card.id||d.characterIds.includes(card.id))))
  &&(!this.data.onlyFavorites||ids.includes(card.id))
  &&words.every(word=>[card.name,card.id,...card.tags,...card.sections.map(s=>s.title+' '+s.text)].join(' ').toLocaleLowerCase().includes(word))).map(tile);
 this.setData({cards});
},
open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);}
});
