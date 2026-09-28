import { findCard,imageUrl,catalog,relatedDecks } from '../../services/catalog';
import type { Card,Section,Deck } from '../../services/types';
import { library,toggleFavorite,visit } from '../../services/storage';
import { cardDetailUrl,openDeck,sharedCardUrl } from '../../services/navigation';
// Stable wx:key values: list keys must never resolve to duplicate or undefined values in WXML.
const keyedSections=(list:Section[])=>list.map((section,index)=>({...section,key:'s'+index}));
const readingSections=(list:Section[])=>{const sections=keyedSections(list);const isSummary=(s:Section)=>['流派','体力','费用','发动时机'].includes(s.title);return{sections,summarySections:sections.filter(isSummary),effectSections:sections.filter(s=>!isSummary(s))};};
interface FaceView { face?:Card['faces'][number]; image:string; views:{index:number;key:string;image:string}[] }
function faceView(card:Card,index:number,thumbnail=false):FaceView {const face=card.faces[index];const image=face?imageUrl(thumbnail?face.image:face.hdImage||face.image):'';return{face,image,views:image?[{index,key:'f'+index,image}]:[]};}
Page({data:{card:null as Card|null,faceIndex:0,faceLabel:'完整效果',flipFrom:'',flipDirection:'forward',imageRevision:0,image:'',imageFailed:false,imageReady:false,previewOpen:false,useThumbnail:false,packageUnavailable:false,version:catalog.contentVersion,visibleFaces:[] as {index:number;key:string;image:string}[],sections:[] as Section[],summarySections:[] as Section[],effectSections:[] as Section[],decks:[] as Deck[],favorite:false,reduceMotion:false,fromShare:false},
onLoad(options:Record<string,string|undefined>){const card=findCard(options.id||'');this.setData({card:card||null});if(card){visit(card.id);const requested=Number(options.face||0);const initial=Number.isInteger(requested)&&card.faces[requested]?requested:0;const stack=typeof getCurrentPages==='function'?getCurrentPages():[];const inMain=stack[stack.length-1]?.route==='pages/detail/index';const first=faceView(card,initial,inMain);this.setData({faceIndex:initial,faceLabel:first.face?.label||'完整效果',visibleFaces:first.views,image:first.image,useThumbnail:inMain,packageUnavailable:inMain&&options.fallback==='1',...readingSections(first.face?.sections||card.sections),decks:relatedDecks(card.id),favorite:library().favorites.includes(card.id),reduceMotion:library().reduceMotion,fromShare:stack.length<=1});if(inMain&&options.fallback!=='1')wx.redirectTo({url:cardDetailUrl(card.id,initial),fail:()=>this.setData({packageUnavailable:true})});wx.setNavigationBarTitle({title:card.name});}},
onShow(){if(this.data.card)this.setData({favorite:library().favorites.includes(this.data.card.id),reduceMotion:library().reduceMotion});},
switchFace(e:WechatMiniprogram.TouchEvent){this.face(Number(e.currentTarget.dataset.index));},pickFace(e:WechatMiniprogram.PickerChange){this.face(Number(e.detail.value));},
face(faceIndex:number){const card=this.data.card;if(!card||faceIndex===this.data.faceIndex)return;const view=faceView(card,faceIndex,this.data.useThumbnail);if(!view.face)return;const imageRevision=this.data.imageRevision+1;const flipFrom=card.kind==='本体'&&!this.data.reduceMotion&&this.data.imageReady&&!this.data.imageFailed?this.data.image:'';this.setData({faceIndex,faceLabel:view.face.label,flipFrom,flipDirection:faceIndex>this.data.faceIndex?'forward':'backward',imageRevision,visibleFaces:view.views.map(v=>({...v,key:v.key+'-'+imageRevision})),image:view.image,imageFailed:false,imageReady:false,...readingSections(view.face.sections||card.sections)});},
onHide(){this.setData({flipFrom:'',previewOpen:false});},
favorite(){if(this.data.card)this.setData({favorite:toggleFavorite(this.data.card.id)});},
imageLoaded(e?:WechatMiniprogram.CustomEvent){if(e&&Number(e.currentTarget.dataset.revision)!==this.data.imageRevision)return;this.setData({imageReady:true});},
imageError(e?:WechatMiniprogram.CustomEvent){if(e&&Number(e.currentTarget.dataset.revision)!==this.data.imageRevision)return;this.setData({flipFrom:'',imageFailed:true,imageReady:true});},
readEffect(){wx.pageScrollTo({selector:'#effect-text',duration:this.data.reduceMotion?0:180,fail:()=>{}});},
copyEffect(){const card=this.data.card;if(!card)return;const label=card.faces[this.data.faceIndex]?.label;const text=[card.name,label,...this.data.sections.map(s=>s.title+'：'+s.text)].filter(Boolean).join('\n\n');wx.setClipboardData({data:text,fail:()=>wx.showToast({title:'复制失败，请长按文字复制',icon:'none'})});},
retry(){const card=this.data.card;if(!card)return;const view=faceView(card,this.data.faceIndex,this.data.useThumbnail);this.setData({flipFrom:'',imageRevision:this.data.imageRevision+1,image:'',imageFailed:false,imageReady:false,visibleFaces:[]});this.setData({image:view.image,visibleFaces:view.views});},
retryPackage(){const card=this.data.card;if(card)wx.redirectTo({url:cardDetailUrl(card.id,this.data.faceIndex),fail:()=>wx.showToast({title:'高清图包暂不可用',icon:'none'})});},
preview(){if(this.data.image&&!this.data.imageFailed)this.setData({previewOpen:true});},
closePreview(){this.setData({previewOpen:false});},
deck(e:WechatMiniprogram.TouchEvent){openDeck(e.currentTarget.dataset.id);},back(){wx.switchTab({url:'/pages/cards/index'});},
onShareAppMessage(){return{title:this.data.card?.name||'宝旅团图鉴',path:sharedCardUrl(this.data.card?.id||'')};}
});
