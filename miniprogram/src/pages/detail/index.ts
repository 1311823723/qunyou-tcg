import { findCard,imageUrl,catalog,relatedDecks } from '../../services/catalog';
import type { Card,Section,Deck } from '../../services/types';
import { library,toggleFavorite,visit } from '../../services/storage';
import { openDeck } from '../../services/navigation';
// Stable wx:key values: list keys must never resolve to duplicate or undefined values in WXML.
const keyedSections=(list:Section[])=>list.map((section,index)=>({...section,key:'s'+index}));
interface FaceView { face?:Card['faces'][number]; image:string; views:{index:number;key:string;image:string}[] }
function faceView(card:Card,index:number):FaceView {const face=card.faces[index];const image=face?imageUrl(face.hdImage||face.image):'';return{face,image,views:image?[{index,key:'f'+index,image}]:[]};}
Page({data:{card:null as Card|null,faceIndex:0,image:'',imageFailed:false,version:catalog.contentVersion,visibleFaces:[] as {index:number;key:string;image:string}[],sections:[] as Section[],decks:[] as Deck[],favorite:false,reduceMotion:false,fromShare:false},
onLoad(options:Record<string,string|undefined>){const card=findCard(options.id||'');this.setData({card:card||null});if(card){visit(card.id);const first=faceView(card,0);const stack=typeof getCurrentPages==='function'?getCurrentPages():[];this.setData({faceIndex:0,visibleFaces:first.views,image:first.image,sections:keyedSections(first.face?.sections||card.sections),decks:relatedDecks(card.id),favorite:library().favorites.includes(card.id),reduceMotion:library().reduceMotion,fromShare:stack.length<=1});wx.setNavigationBarTitle({title:card.name});}},
onShow(){if(this.data.card)this.setData({favorite:library().favorites.includes(this.data.card.id),reduceMotion:library().reduceMotion});},
switchFace(e:WechatMiniprogram.TouchEvent){this.face(Number(e.currentTarget.dataset.index));},pickFace(e:WechatMiniprogram.PickerChange){this.face(Number(e.detail.value));},
face(faceIndex:number){const card=this.data.card;if(!card)return;const view=faceView(card,faceIndex);if(!view.face)return;this.setData({faceIndex,visibleFaces:view.views,image:view.image,imageFailed:false,sections:keyedSections(view.face.sections||card.sections)});},
favorite(){if(this.data.card)this.setData({favorite:toggleFavorite(this.data.card.id)});},
imageError(){this.setData({imageFailed:true});},
retry(){const card=this.data.card;if(!card)return;const view=faceView(card,this.data.faceIndex);this.setData({image:'',imageFailed:false,visibleFaces:[]});this.setData({image:view.image,visibleFaces:view.views});},
preview(){const card=this.data.card;if(!card)return;const urls=card.faces.map(f=>imageUrl(f.hdImage||f.image)).filter(Boolean);const current=this.data.image;if(current)wx.previewImage({current,urls,fail:()=>wx.showToast({title:'高清图暂不可用',icon:'none'})});},
deck(e:WechatMiniprogram.TouchEvent){openDeck(e.currentTarget.dataset.id);},back(){wx.switchTab({url:'/pages/cards/index'});},
onShareAppMessage(){return{title:this.data.card?.name||'宝旅团图鉴',path:'/pages/detail/index?id='+encodeURIComponent(this.data.card?.id||'')};}
});
