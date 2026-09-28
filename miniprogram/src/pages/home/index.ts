import { catalog,findCard,tile,imageUrl } from '../../services/catalog';
import { library } from '../../services/storage';
import { browse,openCard,openDeck,openGuide,openAbout } from '../../services/navigation';
// 展示素材对应精选本体；正式名称、预组简介仍从随包目录读取。
const spotlight=catalog.decks.find(d=>d.id===catalog.presentation.homeExhibit.deckId)!;
const orderedDecks=[spotlight,...catalog.decks.filter(d=>d.id!==spotlight.id)];
const exhibits=orderedDecks.map(deck=>({...deck,faces:findCard(deck.bodyId)!.faces}));
const exhibitImage=(index:number,face:number)=>index===0&&face===0?'/assets/showcase-body.jpg':imageUrl(exhibits[index].faces[face].image);
const slideViews=(index:number,face:number,revision:number)=>exhibits.map((item,i)=>({...item,views:[{key:i+'-'+(i===index?face:0)+'-'+(i===index?revision:0),url:exhibitImage(i,i===index?face:0)}]}));
Page({data:{spotlight,exhibits:slideViews(0,0,0),exhibitIndex:0,exhibitFace:0,exhibitRevision:0,exhibitImage:exhibitImage(0,0),exhibitFailed:false,flipFrom:'',faceLabel:exhibits[0].faces[0].label,faceSections:exhibits[0].faces[0].sections||[],showEffects:false,decks:catalog.presentation.featuredDeckIds.map(id=>catalog.decks.find(d=>d.id===id)!),favorites:[] as ReturnType<typeof tile>[],recent:[] as ReturnType<typeof tile>[],reduceMotion:false},
onShow(){const state=library();this.setData({favorites:state.favorites.slice(0,6).map(id=>tile(findCard(id)!)),recent:state.recent.slice(0,6).map(id=>tile(findCard(id)!)),reduceMotion:state.reduceMotion});},
// 三个入口分别对应三个 tab；tabBar 页面只能用 switchTab，navigateTo 会报 "can not navigate to a tabBar page"。
entry(e:WechatMiniprogram.TouchEvent){const key=e.currentTarget.dataset.key as string;if(key==='rules'){openGuide();return;}const map:{[k:string]:string}={rules:'/pages/rules/index',cards:'/pages/cards/index',decks:'/pages/decks/index'};wx.switchTab({url:map[key]||'/pages/home/index'});},
selectExhibit(index:number){const next=(index+exhibits.length)%exhibits.length;if(next===this.data.exhibitIndex)return;const revision=this.data.exhibitRevision+1;this.setData({spotlight:exhibits[next],exhibitIndex:next,exhibitFace:0,exhibitRevision:revision,exhibits:slideViews(next,0,revision).map((slide,i)=>({...slide,views:this.data.exhibits[i].views[0].url===slide.views[0].url?this.data.exhibits[i].views:slide.views})),exhibitImage:exhibitImage(next,0),exhibitFailed:false,flipFrom:'',faceLabel:exhibits[next].faces[0].label,faceSections:exhibits[next].faces[0].sections||[],showEffects:false});},
previousExhibit(){this.selectExhibit(this.data.exhibitIndex-1);},nextExhibit(){this.selectExhibit(this.data.exhibitIndex+1);},
exhibitChanged(e:WechatMiniprogram.SwiperChange){if(e.detail.source==='touch')this.selectExhibit(e.detail.current);},
flipExhibit(){const index=this.data.exhibitIndex;const face=(this.data.exhibitFace+1)%exhibits[index].faces.length;if(face===this.data.exhibitFace)return;const revision=this.data.exhibitRevision+1;this.setData({exhibitFace:face,exhibitRevision:revision,exhibits:slideViews(index,face,revision),exhibitImage:exhibitImage(index,face),flipFrom:this.data.reduceMotion||this.data.exhibitFailed?'':this.data.exhibitImage,exhibitFailed:false,faceLabel:exhibits[index].faces[face].label,faceSections:exhibits[index].faces[face].sections||[]});},
exhibitError(e:WechatMiniprogram.CustomEvent){if(Number(e.currentTarget.dataset.index)!==this.data.exhibitIndex||Number(e.currentTarget.dataset.revision)!==this.data.exhibitRevision)return;this.setData({exhibitFailed:true,flipFrom:'',showEffects:true});},
retryExhibit(){const revision=this.data.exhibitRevision+1;this.setData({exhibitRevision:revision,exhibits:slideViews(this.data.exhibitIndex,this.data.exhibitFace,revision),exhibitFailed:false,flipFrom:''});},
toggleEffects(){this.setData({showEffects:!this.data.showEffects});},
spotlightCard(){openCard(this.data.spotlight.bodyId,this.data.exhibitFace);},
deck(e:WechatMiniprogram.TouchEvent){openDeck(e.currentTarget.dataset.id);},
website(){wx.navigateTo({url:'/pages/website/index'});},about(){openAbout();},search(){browse();},favorites(){browse({favorites:true});},history(){wx.navigateTo({url:'/pages/history/index'});},open(e:WechatMiniprogram.CustomEvent){openCard(e.detail.id);}
});
