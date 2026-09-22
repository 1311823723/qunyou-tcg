import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {makeCatalog,root} from './catalog.mjs';
const require=createRequire(import.meta.url);
const {searchCards,findCard,catalog}=require('../../miniprogram/build/services/catalog.js');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
test('catalog is deterministic, complete, and preserves formal effects',()=>{
 assert.deepEqual(makeCatalog(),makeCatalog());
 const files=['bodies','characters','hand_cards','rider_cards'];
 assert.equal(catalog.cards.length,files.reduce((n,f)=>n+json(`data/cards/${f}.json`).length,0));
 for(const f of files)for(const c of json(`data/cards/${f}.json`)){
  const exported=findCard(c.id);assert.ok(exported);
  if(c.effectText)assert.ok(exported.sections.some(s=>s.text===c.effectText));
 }
 for(const d of catalog.decks){assert.ok(findCard(d.bodyId));assert.equal(d.characterIds.length,16);for(const id of d.characterIds)assert.ok(findCard(id));}
});
test('every declared image resolves locally and every hand print has a face',()=>{
 for(const c of catalog.cards)for(const f of c.faces)for(const key of ['image','hdImage'])if(f[key])assert.ok(fs.existsSync(path.join(root,'public',f[key])));
 for(const c of json('data/cards/hand_cards.json'))assert.equal(findCard(c.id).faces.length,c.cards.length);
 for(const c of json('data/cards/bodies.json'))assert.equal(findCard(c.id).faces.length,c.extraForm?2:1);
});
test('search supports names, effects, case normalization and independent filters',()=>{
 assert.ok(searchCards(' DONG ').length>0);assert.deepEqual(searchCards(' DONG '),searchCards('dong'));
 assert.ok(searchCards('休整','角色').length>0);
 assert.ok(searchCards('','角色','伏击').every(c=>c.kind==='角色'&&c.role==='伏击'));
 assert.equal(searchCards('definitely-not-a-card').length,0);assert.equal(searchCards('').length,catalog.cards.length);
 assert.equal(findCard('unknown'),undefined);
});
function page(name){let definition;global.Page=p=>{definition=p;};const p=require.resolve(`../../miniprogram/build/pages/${name}/index.js`);delete require.cache[p];require(p);const instance={...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};return instance;}
test('page handlers navigate safely, handle unknown ids, switch faces and retain text after image failure',()=>{
 const calls=[];global.wx={navigateTo:p=>calls.push(p),setNavigationBarTitle:()=>{},previewImage:p=>calls.push(p),getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},switchTab:p=>calls.push(p)};
 // 分类列表页（collection）承载搜索与筛选；cards 页只做分类入口。
 const list=page('collection');list.onLoad({kind:'全部'});list.onSearch({detail:{value:'dong'}});assert.ok(list.data.cards.length>0);assert.ok(list.data.cards.every(c=>c.name.toLowerCase().includes('dong')));
 list.open({detail:{id:'body_aggro_001'},currentTarget:{dataset:{}}});assert.equal(calls.at(-1).url,'/pages/detail/index?id=body_aggro_001');
 const detail=page('detail');detail.onLoad({id:'not-found'});assert.equal(detail.data.card,null);
 detail.onLoad({id:'body_aggro_001'});detail.switchFace({currentTarget:{dataset:{index:1}}});assert.equal(detail.data.faceIndex,1);detail.imageError();assert.equal(detail.data.imageFailed,true);assert.ok(detail.data.card.sections.length);
 detail.retry();assert.equal(detail.data.imageFailed,false);detail.preview();assert.ok(calls.at(-1).current.includes('cards-hd'));
 assert.ok(detail.onShareAppMessage().path.endsWith('body_aggro_001'));
 const decks=page('decks');decks.deck({currentTarget:{dataset:{id:catalog.decks[0].id}}});assert.ok(calls.at(-1).url.includes('/deck-detail/'));const deck=page('deck-detail');deck.onLoad({id:catalog.decks[0].id});assert.equal(deck.data.members.length,16);assert.ok(deck.data.body);
});
test('all configured pages have scripts, templates and metadata; generated data is current',()=>{
 const config=json('miniprogram/build/app.json');for(const p of config.pages)for(const ext of ['js','wxml','json'])assert.ok(fs.existsSync(path.join(root,'miniprogram/build',p+'.'+ext)));
 assert.deepEqual(require('../../miniprogram/src/generated/catalog.js'),makeCatalog());
 assert.ok(catalog.articles.every(a=>a.sections.length>0));
});

test('body faces expose matching formal effects, Z retains original trait, hand labels identify prints',()=>{
 for(const body of json('data/cards/bodies.json')){
  const card=findCard(body.id);assert.ok(card.faces[0].sections.some(s=>s.text===body.effectText));
  if(body.extraForm){assert.ok(!card.faces[0].sections.some(s=>s.text===body.extraForm.effectText));assert.ok(card.faces[1].sections.some(s=>s.text===body.extraForm.effectText));assert.equal(card.faces[1].sections.some(s=>s.text===body.effectText),body.extraForm.type==='z-move');}
 }
 for(const c of catalog.cards.filter(c=>c.kind==='基础牌'||c.kind==='行动牌'))for(const face of c.faces)assert.ok(!face.label.startsWith('卡面'));
});
test('deck membership supports shared characters and all combined filters',()=>{
 const shared=catalog.cards.find(c=>catalog.decks.filter(d=>d.characterIds.includes(c.id)).length>1);assert.ok(shared);
 for(const d of catalog.decks.filter(d=>d.characterIds.includes(shared.id)))assert.ok(searchCards(shared.name,'角色',shared.role,d.id).some(c=>c.id===shared.id));
 assert.equal(searchCards('','全部','全部','missing').length,0);
});
test('editorial references and bundled portrait assets are complete',()=>{
 assert.deepEqual(catalog.presentation.featuredDeckIds,['deck_aggro_001','deck_combo_001','deck_dispatch_001']);
 for(const d of catalog.decks){assert.ok(d.summary&&d.core);assert.ok(fs.existsSync(path.join(root,'miniprogram/build',d.portrait)));}
 for(const step of catalog.presentation.quickStart){assert.ok(findCard(step.cardId));for(const title of step.ruleHeadings)assert.ok(catalog.articles[0].sections.some(s=>s.title===title));}
});
test('native rule blocks preserve readable content and unique duplicate-heading anchors',async()=>{
 const {blocks}=await import('./markdown.mjs');
 const parsed=blocks('**强调** 与 [链接](https://example.com)\n\n- 列表\n\n| 一 | 二 |\n| --- | --- |\n| 三 | 四 |\n\n<script>alert(1)</script>');
 assert.equal(parsed[0].runs[0].strong,true);assert.ok(parsed[0].runs.some(r=>r.text==='链接'));
 assert.equal(parsed.filter(b=>b.type==='table').length,2);assert.equal(parsed[1].marker,'•');assert.equal(parsed.at(-1).runs[0].text,'<script>alert(1)</script>');
 for(const a of catalog.articles){assert.equal(new Set(a.sections.map(s=>s.anchor)).size,a.sections.length);assert.ok(a.sections.every(s=>s.blocks.length));}
});
function freshStorage(){const p=require.resolve('../../miniprogram/build/services/storage.js');delete require.cache[p];return require(p);}
test('local library cleans invalid IDs, survives restart, deduplicates and bounds recent history',()=>{
 let disk={favorites:[catalog.cards[0].id,'deleted',catalog.cards[0].id],recent:['deleted'],reduceMotion:false};
 global.wx={getStorageSync:()=>structuredClone(disk),setStorageSync:(_,data)=>{disk=structuredClone(data);},showToast:()=>{}};
 let store=freshStorage();assert.deepEqual(store.library().favorites,[catalog.cards[0].id]);assert.deepEqual(disk.recent,[]);
 for(const c of catalog.cards.slice(0,35))store.visit(c.id);assert.equal(store.library().recent.length,30);
 store.visit(catalog.cards[30].id);assert.equal(store.library().recent[0],catalog.cards[30].id);assert.equal(new Set(store.library().recent).size,30);
 store.toggleFavorite(catalog.cards[1].id);store.setReducedMotion(true);store=freshStorage();assert.ok(store.library().favorites.includes(catalog.cards[1].id));assert.equal(store.library().reduceMotion,true);
 store.visit('invalid');assert.equal(store.library().recent.length,30);store.toggleFavorite(catalog.cards[1].id);assert.ok(!store.library().favorites.includes(catalog.cards[1].id));
});
test('storage failure reports failure without blocking lookup or session favorites',()=>{
 const messages=[];global.wx={getStorageSync:()=>{throw Error('unavailable');},setStorageSync:()=>{throw Error('quota');},showToast:o=>messages.push(o.title)};
 const store=freshStorage();assert.doesNotThrow(()=>store.visit(catalog.cards[0].id));assert.equal(store.toggleFavorite(catalog.cards[0].id),true);assert.ok(messages.some(m=>m.includes('保存失败')));assert.ok(findCard(catalog.cards[0].id));
});
test('collection keeps category, query and favorite scope from its deep link',()=>{
 const calls=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},switchTab:()=>{},navigateTo:p=>calls.push(p),setNavigationBarTitle:()=>{}};
 const list=page('collection');list.onLoad({kind:'角色',q:'休整'});assert.equal(list.data.kind,'角色');assert.equal(list.data.query,'休整');list.onShow();assert.ok(list.data.cards.length>0);assert.ok(list.data.cards.every(c=>c.kind==='角色'));
 const hand=page('collection');hand.onLoad({kind:'手牌'});hand.onShow();assert.ok(hand.data.cards.every(c=>['基础牌','行动牌','骑士卡'].includes(c.kind)));hand.onSub({currentTarget:{dataset:{sub:'基础牌'}}});assert.ok(hand.data.cards.every(c=>c.kind==='基础牌'));hand.onSub({currentTarget:{dataset:{sub:'基础牌'}}});assert.equal(hand.data.sub,'全部');
 const nav=require('../../miniprogram/build/services/navigation.js');nav.browse({favorites:true});assert.equal(calls.at(-1).url,'/pages/collection/index?kind=全部&fav=1');
 nav.openCollection('本体');assert.equal(calls.at(-1).url,'/pages/collection/index?kind=%E6%9C%AC%E4%BD%93');assert.equal(decodeURIComponent(calls.at(-1).url),'/pages/collection/index?kind=本体');
 const fav=page('collection');fav.onLoad({kind:'全部',fav:'1'});assert.equal(fav.data.onlyFavorites,true);
 const fallback=page('collection');fallback.onLoad({kind:'不存在的分类'});assert.equal(fallback.data.kind,'全部');assert.equal(fallback.data.title,'全部卡牌');
 // 实测：navigateTo 的中文参数到达页面时仍是百分号编码，必须解码后再匹配分类键。
 const encoded=page('collection');encoded.onLoad({kind:encodeURIComponent('本体'),q:encodeURIComponent('微笑')});
 assert.equal(encoded.data.kind,'本体');assert.equal(encoded.data.title,'本体牌');assert.equal(encoded.data.query,'微笑');encoded.onShow();assert.ok(encoded.data.cards.length>0);
});

test('share deep links, rider cards and out-of-range faces keep the formal text readable',()=>{
 global.wx={navigateTo:()=>{},setNavigationBarTitle:()=>{},previewImage:()=>{},getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},switchTab:()=>{}};
 global.getCurrentPages=()=>[{}];
 const shared=page('detail');shared.onLoad({id:'body_aggro_001'});assert.equal(shared.data.fromShare,true);
 assert.ok(shared.data.sections.every(s=>s.key));assert.ok(shared.data.visibleFaces.every(f=>f.key));
 global.getCurrentPages=()=>[{},{}];const nested=page('detail');nested.onLoad({id:'body_aggro_001'});assert.equal(nested.data.fromShare,false);
 shared.face(99);assert.equal(shared.data.faceIndex,0);assert.ok(shared.data.sections.length);
 const rider=catalog.cards.find(c=>c.kind==='骑士卡');const riderPage=page('detail');riderPage.onLoad({id:rider.id});
 assert.equal(riderPage.data.image,'');assert.equal(riderPage.data.visibleFaces.length,0);assert.ok(riderPage.data.sections.some(s=>s.text.includes(rider.name)||s.text.length>0));
 delete global.getCurrentPages;
});

test('home quick start always opens tutorial; detail refreshes favorites after returning',()=>{
 global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},switchTab:()=>{},pageScrollTo:()=>{},setNavigationBarTitle:()=>{}};
 const rules=page('rules');rules.data.mode='keywords';page('home').entry({currentTarget:{dataset:{key:'rules'}}});rules.onShow();assert.equal(rules.data.mode,'start');rules.data.mode='rules';rules.onShow();assert.equal(rules.data.mode,'rules');
 const detail=page('detail');detail.onLoad({id:'body_aggro_001'});const storage=require('../../miniprogram/build/services/storage.js');const previous=detail.data.favorite;storage.toggleFavorite('body_aggro_001');detail.onShow();assert.equal(detail.data.favorite,!previous);
});

test('official website entry uses a fixed URL and provides honest fallback on failure',()=>{
 const calls=[];global.wx={navigateTo:o=>calls.push(o),setClipboardData:o=>{calls.push(o);o.success();},showToast:o=>calls.push(o)};
 page('home').website();assert.equal(calls[0].url,'/pages/website/index');
 const site=page('website');assert.equal(site.data.opening,false);site.copy();assert.equal(calls[1].data,'https://qunyou-tcg.pages.dev');site.setData({opening:true});site.error();assert.equal(site.data.opening,false);assert.equal(site.data.failed,true);
});

test('card tab opens a complete searchable collection and keeps combined filters on return',()=>{
 global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},setNavigationBarTitle:()=>{}};
 const list=page('cards');list.onLoad({});list.onShow();assert.equal(list.data.cards.length,catalog.cards.length);
 list.onSearch({detail:{value:'刺客'}});assert.ok(list.data.cards.length>0);
 list.onSub({currentTarget:{dataset:{sub:'角色'}}});
 const before=list.data.cards.map(c=>c.id);list.onShow();assert.deepEqual(list.data.cards.map(c=>c.id),before);assert.equal(list.data.query,'刺客');
 const hand=page('collection');hand.onLoad({kind:'手牌'});hand.onShow();assert.equal(hand.data.cards.length,14);assert.ok(hand.data.cards.every(c=>c.kind!=='骑士卡'));
});
test('home exhibit opens the formal body and the matching configured deck',()=>{
 const calls=[];global.wx={navigateTo:p=>calls.push(p),getStorageSync:()=>({}),setStorageSync:()=>{}};
 const home=page('home');assert.equal(home.data.spotlight.id,catalog.presentation.homeExhibit.deckId);
 home.spotlightCard();assert.equal(calls.at(-1).url,'/pages/detail/index?id='+home.data.spotlight.bodyId);
 home.deck({currentTarget:{dataset:{id:home.data.spotlight.id}}});assert.equal(calls.at(-1).url,'/pages/deck-detail/index?id='+home.data.spotlight.id);
 for(const name of ['showcase-body.jpg','showcase-back.jpg','collector-library.jpg'])assert.ok(fs.existsSync(path.join(root,'miniprogram/build/assets',name)));
});
