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
 const files=['bodies','characters','hand_cards'];
 assert.equal(catalog.cards.length,files.reduce((n,f)=>n+json(`data/cards/${f}.json`).length,0));
 for(const f of files)for(const c of json(`data/cards/${f}.json`)){
  const exported=findCard(c.id);assert.ok(exported);
  if(c.effectText)assert.ok(exported.sections.some(s=>s.text===c.effectText));
 }
 for(const d of catalog.decks){assert.ok(findCard(d.bodyId));assert.equal(d.characterIds.length,16);for(const id of d.characterIds)assert.ok(findCard(id));}
});
test('every declared image resolves in the mini program and every hand print has a face',()=>{
 for(const c of catalog.cards)for(const f of c.faces)for(const key of ['image','hdImage'])if(f[key])assert.ok(fs.existsSync(path.join(root,'miniprogram/build',f[key])));
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
 list.open({detail:{id:'body_aggro_001'},currentTarget:{dataset:{}}});assert.equal(calls.at(-1).url,`/${findCard('body_aggro_001').pack}/pages/detail/index?id=body_aggro_001`);
 const detail=page('detail');detail.onLoad({id:'not-found'});assert.equal(detail.data.card,null);
 detail.onLoad({id:'body_aggro_001'});detail.switchFace({currentTarget:{dataset:{index:1}}});assert.equal(detail.data.faceIndex,1);detail.imageError();assert.equal(detail.data.imageFailed,true);assert.ok(detail.data.card.sections.length);
 detail.retry();assert.equal(detail.data.imageFailed,false);detail.preview();assert.equal(detail.data.previewOpen,true);detail.closePreview();assert.equal(detail.data.previewOpen,false);
 assert.ok(detail.onShareAppMessage().path.endsWith('body_aggro_001'));
 const decks=page('decks');decks.deck({currentTarget:{dataset:{id:catalog.decks[0].id}}});assert.ok(calls.at(-1).url.includes('/deck-detail/'));const deck=page('deck-detail');deck.onLoad({id:catalog.decks[0].id});assert.equal(deck.data.members.length,16);assert.ok(deck.data.body);
});
test('all configured pages have scripts, templates and metadata; generated data is current',()=>{
 const config=json('miniprogram/build/app.json');for(const p of config.pages)for(const ext of ['js','wxml','json'])assert.ok(fs.existsSync(path.join(root,'miniprogram/build',p+'.'+ext)));
 assert.deepEqual(require('../../miniprogram/src/generated/catalog.js'),makeCatalog());
 assert.ok(catalog.articles.every(a=>a.sections.length>0));
});
test('all 198 card faces are bundled, grouped by card, and stay within package limits',()=>{
 const build=path.join(root,'miniprogram/build');const config=json('miniprogram/build/app.json');
 assert.equal(config.subPackages.length,8);
 const packs=config.subPackages.map(p=>p.root);const faces=catalog.cards.flatMap(card=>card.faces.map(face=>({card,face})));
 assert.equal(faces.length,198);
 for(const {card,face} of faces){
  assert.ok(packs.includes(card.pack));assert.ok(face.image.startsWith('/assets/card-thumbs/'));
  assert.ok(face.hdImage.startsWith(`/${card.pack}/hd/`));
  assert.ok(fs.existsSync(path.join(build,face.image)));assert.ok(fs.existsSync(path.join(build,face.hdImage)));
  assert.ok(!face.image.startsWith('http')&&!face.hdImage.startsWith('http'));
 }
 const bytes=dir=>fs.readdirSync(dir,{withFileTypes:true}).reduce((sum,e)=>sum+(e.isDirectory()?bytes(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0);
 const packageBytes=packs.map(pack=>{for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(build,pack,'pages/detail/index.'+ext)));return bytes(path.join(build,pack));});
 const total=bytes(build),main=total-packageBytes.reduce((a,b)=>a+b,0);
 assert.ok(main<2_000_000);assert.ok(packageBytes.every(n=>n<2_000_000));assert.ok(total<20_000_000);
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
 const hand=page('collection');hand.onLoad({kind:'手牌'});hand.onShow();assert.ok(hand.data.cards.every(c=>['基础牌','行动牌'].includes(c.kind)));hand.onSub({currentTarget:{dataset:{sub:'基础牌'}}});assert.ok(hand.data.cards.every(c=>c.kind==='基础牌'));hand.onSub({currentTarget:{dataset:{sub:'基础牌'}}});assert.equal(hand.data.sub,'全部');
 const nav=require('../../miniprogram/build/services/navigation.js');nav.browse({favorites:true});assert.equal(calls.at(-1).url,'/pages/collection/index?kind=全部&fav=1');
 nav.openCollection('本体');assert.equal(calls.at(-1).url,'/pages/collection/index?kind=%E6%9C%AC%E4%BD%93');assert.equal(decodeURIComponent(calls.at(-1).url),'/pages/collection/index?kind=本体');
 const fav=page('collection');fav.onLoad({kind:'全部',fav:'1'});assert.equal(fav.data.onlyFavorites,true);
 const fallback=page('collection');fallback.onLoad({kind:'不存在的分类'});assert.equal(fallback.data.kind,'全部');assert.equal(fallback.data.title,'全部卡牌');
 // 实测：navigateTo 的中文参数到达页面时仍是百分号编码，必须解码后再匹配分类键。
 const encoded=page('collection');encoded.onLoad({kind:encodeURIComponent('本体'),q:encodeURIComponent('微笑')});
 assert.equal(encoded.data.kind,'本体');assert.equal(encoded.data.title,'本体牌');assert.equal(encoded.data.query,'微笑');encoded.onShow();assert.ok(encoded.data.cards.length>0);
});

test('share deep links and out-of-range faces keep the formal text readable',()=>{
 global.wx={navigateTo:()=>{},setNavigationBarTitle:()=>{},previewImage:()=>{},getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},switchTab:()=>{}};
 global.getCurrentPages=()=>[{}];
 const shared=page('detail');shared.onLoad({id:'body_aggro_001'});assert.equal(shared.data.fromShare,true);
 assert.ok(shared.data.sections.every(s=>s.key));assert.ok(shared.data.visibleFaces.every(f=>f.key));
 global.getCurrentPages=()=>[{},{}];const nested=page('detail');nested.onLoad({id:'body_aggro_001'});assert.equal(nested.data.fromShare,false);
 shared.face(99);assert.equal(shared.data.faceIndex,0);assert.ok(shared.data.sections.length);
 delete global.getCurrentPages;
});
test('old main-package detail links redirect to the owning image pack without losing the face',()=>{
 const redirects=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},setNavigationBarTitle:()=>{},redirectTo:o=>redirects.push(o)};
 global.getCurrentPages=()=>[{route:'pages/detail/index'}];
 const detail=page('detail');detail.onLoad({id:'body_aggro_001',face:'1'});
 assert.equal(redirects[0].url,`/${findCard('body_aggro_001').pack}/pages/detail/index?id=body_aggro_001&face=1`);
 assert.equal(detail.data.faceIndex,1);
 delete global.getCurrentPages;
});

test('package download failure keeps the shared detail route readable with local thumbnails',()=>{
 const calls=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},setNavigationBarTitle:()=>{},navigateTo:o=>{calls.push(o);o.fail?.();},redirectTo:o=>calls.push(o),showToast:()=>{}};
 const nav=require('../../miniprogram/build/services/navigation.js');nav.openCard('body_aggro_001',1);
 assert.equal(calls[0].url,`/${findCard('body_aggro_001').pack}/pages/detail/index?id=body_aggro_001&face=1`);
 assert.equal(calls[1].url,'/pages/detail/index?id=body_aggro_001&face=1&fallback=1');
 global.getCurrentPages=()=>[{route:'pages/detail/index'}];
 const detail=page('detail');detail.onLoad({id:'body_aggro_001',face:'1',fallback:'1'});
 assert.equal(detail.data.faceIndex,1);assert.equal(detail.data.useThumbnail,true);assert.equal(detail.data.packageUnavailable,true);
 assert.ok(detail.data.image.startsWith('/assets/card-thumbs/'));
 assert.ok(detail.data.sections.some(s=>s.text===findCard('body_aggro_001').faces[1].sections.at(-1).text));
 detail.face(0);assert.ok(detail.data.image.startsWith('/assets/card-thumbs/'));
 assert.equal(detail.onShareAppMessage().path,'/pages/detail/index?id=body_aggro_001');
 detail.retryPackage();assert.equal(calls.at(-1).url,`/${findCard('body_aggro_001').pack}/pages/detail/index?id=body_aggro_001`);
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
 home.spotlightCard();assert.equal(calls.at(-1).url,`/${findCard(home.data.spotlight.bodyId).pack}/pages/detail/index?id=`+home.data.spotlight.bodyId);
 home.deck({currentTarget:{dataset:{id:home.data.spotlight.id}}});assert.equal(calls.at(-1).url,'/pages/deck-detail/index?id='+home.data.spotlight.id);
 for(const name of ['showcase-body.jpg','showcase-back.jpg','collector-library.jpg'])assert.ok(fs.existsSync(path.join(root,'miniprogram/build/assets',name)));
});

test('detail copies only the current face and preserves retry behavior',()=>{
 const copied=[];const notices=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:o=>notices.push(o.title),setNavigationBarTitle:()=>{},setClipboardData:o=>copied.push(o)};
 const detail=page('detail');detail.onLoad({id:'body_aggro_001'});detail.face(1);detail.copyEffect();
 const card=findCard('body_aggro_001');assert.ok(copied[0].data.includes(card.faces[1].sections.at(-1).text));assert.ok(!copied[0].data.includes(card.faces[0].sections[2].text));
 copied[0].fail();assert.ok(notices.at(-1).includes('复制失败'));
 detail.face(0);assert.equal(detail.data.faceLabel,'正面');assert.equal(detail.data.imageReady,false);detail.imageLoaded();assert.equal(detail.data.imageReady,true);detail.retry();assert.equal(detail.data.imageReady,false);
});
test('deck role counts cover the original roster and filters can be reversed',()=>{
 global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},setNavigationBarTitle:()=>{},showToast:()=>{}};
 for(const deck of catalog.decks){const view=page('deck-detail');view.onLoad({id:deck.id});assert.equal(view.data.members.length,16);assert.equal(view.data.roles.reduce((n,r)=>n+r.count,0),16);const role=view.data.roles[0];view.filter({currentTarget:{dataset:{role:role.name}}});assert.equal(view.data.visibleMembers.length,role.count);assert.ok(view.data.visibleMembers.every(c=>c.role===role.name));view.filter({currentTarget:{dataset:{role:role.name}}});assert.equal(view.data.visibleMembers.length,16);}
});
test('rule reader reaches every formal chapter without crossing bounds or losing content',()=>{
 global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},pageScrollTo:()=>{}};
 const rules=page('rules');rules.chapter({currentTarget:{dataset:{anchor:rules.data.sections[0].anchor}}});rules.previous();assert.equal(rules.data.chapterIndex,0);
 for(let i=0;i<rules.data.sections.length;i++){assert.deepEqual(rules.data.currentChapter,rules.data.sections[i]);rules.next();}
 assert.equal(rules.data.chapterIndex,rules.data.sections.length-1);rules.contents();assert.equal(rules.data.currentChapter,null);
 rules.chapter({currentTarget:{dataset:{anchor:'missing'}}});assert.equal(rules.data.currentChapter,null);
 rules.search({detail:{value:'unlikely-no-match-12345'}});assert.equal(rules.data.keywords.length,0);rules.clearSearch();assert.equal(rules.data.keywords.length,catalog.articles[1].sections.length);
});

test('rider tokens are excluded from the encyclopedia and stale library records are cleaned',()=>{
 const riderIds=json('data/cards/rider_cards.json').map(c=>c.id);
 assert.equal(catalog.cards.length,146);
 for(const id of riderIds){assert.equal(findCard(id),undefined);assert.ok(!searchCards(id).length);}
 let disk={favorites:[catalog.cards[0].id,...riderIds],recent:[...riderIds,catalog.cards[0].id]};
 global.wx={getStorageSync:()=>disk,setStorageSync:(_,value)=>{disk=structuredClone(value);},showToast:()=>{},setNavigationBarTitle:()=>{}};
 const storage=freshStorage();assert.deepEqual(storage.library().favorites,[catalog.cards[0].id]);assert.deepEqual(storage.library().recent,[catalog.cards[0].id]);
 const removed=page('detail');removed.onLoad({id:riderIds[0]});assert.equal(removed.data.card,null);
 for(const name of ['cards','collection']){const view=page(name);view.onLoad({});view.onShow();assert.ok(!view.data.subs.includes('骑士卡'));assert.ok(view.data.cards.every(c=>!riderIds.includes(c.id)));}
});

test('body flip keeps latest face and ignores stale image events without blocking repeated input',()=>{
 global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},setNavigationBarTitle:()=>{},showToast:()=>{}};
 const detail=page('detail');detail.onLoad({id:'body_aggro_001'});detail.data.reduceMotion=false;detail.imageLoaded();const front=detail.data.image;
 detail.face(1);assert.equal(detail.data.flipFrom,front);assert.equal(detail.data.flipDirection,'forward');const revision=detail.data.imageRevision;detail.face(1);assert.equal(detail.data.imageRevision,revision);
 detail.face(0);detail.imageError({currentTarget:{dataset:{revision}}});assert.equal(detail.data.imageFailed,false);assert.equal(detail.data.faceLabel,'正面');detail.imageLoaded({currentTarget:{dataset:{revision:detail.data.imageRevision}}});assert.equal(detail.data.imageReady,true);
 detail.face(1);detail.imageLoaded();detail.face(0);assert.equal(detail.data.flipDirection,'backward');assert.ok(detail.data.flipFrom);detail.onHide();assert.equal(detail.data.flipFrom,'');
 detail.data.reduceMotion=true;detail.face(1);assert.equal(detail.data.flipFrom,'');assert.equal(detail.data.faceLabel,'额外形态');
});

test('home carousel wraps, flips matching formal effects, and resets faces on deck change',()=>{
 const calls=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},showToast:()=>{},setNavigationBarTitle:()=>{},navigateTo:o=>calls.push(o)};
 const home=page('home');assert.equal(home.data.exhibits.length,catalog.decks.length);
 home.flipExhibit();assert.equal(home.data.exhibitFace,1);assert.deepEqual(home.data.faceSections,findCard(home.data.spotlight.bodyId).faces[1].sections);home.spotlightCard();assert.ok(calls.at(-1).url.endsWith('&face=1'));
 const detail=page('detail');detail.onLoad({id:home.data.spotlight.bodyId,face:'1'});assert.equal(detail.data.faceIndex,1);
 home.previousExhibit();assert.equal(home.data.exhibitIndex,catalog.decks.length-1);assert.equal(home.data.exhibitFace,0);assert.equal(home.data.flipFrom,'');home.nextExhibit();assert.equal(home.data.exhibitIndex,0);
 home.exhibitChanged({detail:{current:2,source:'touch'}});assert.equal(home.data.exhibitIndex,2);home.nextExhibit();home.exhibitChanged({detail:{current:1,source:''}});assert.equal(home.data.exhibitIndex,3);
 home.exhibitError({currentTarget:{dataset:{index:0,revision:0}}});assert.equal(home.data.exhibitFailed,false);
 home.exhibitError({currentTarget:{dataset:{index:3,revision:home.data.exhibitRevision}}});assert.equal(home.data.exhibitFailed,true);assert.equal(home.data.showEffects,true);home.retryExhibit();assert.equal(home.data.exhibitFailed,false);
 home.data.reduceMotion=true;home.flipExhibit();assert.equal(home.data.flipFrom,'');home.toggleEffects();assert.equal(home.data.showEffects,false);
});

test('about page reads filing, version and counts live and reaches the official site',()=>{
 const calls=[];global.wx={getStorageSync:()=>({}),setStorageSync:()=>{},setNavigationBarTitle:()=>{},navigateTo:p=>calls.push(p)};
 const {ICP_FILING_NUMBER,OFFICIAL_WEBSITE_URL}=require('../../miniprogram/build/config.js');
 const about=page('about');about.onShow();
 assert.equal(about.data.filing,ICP_FILING_NUMBER);
 assert.equal(about.data.assetHost,'小程序包内卡图');assert.equal(about.data.website,OFFICIAL_WEBSITE_URL);
 assert.equal(about.data.version,catalog.contentVersion);
 assert.deepEqual(about.data.counts,{cards:catalog.cards.length,decks:catalog.decks.length});
 assert.ok(about.data.privacy.length>=3);assert.ok(about.data.scope.length>=2);
 assert.ok(about.data.privacy.some(item=>item.title==='卡图随包携带'));
 about.openWebsite();assert.equal(calls.at(-1).url,'/pages/website/index');
 const home=page('home');home.about();assert.equal(calls.at(-1).url,'/pages/about/index');
});
