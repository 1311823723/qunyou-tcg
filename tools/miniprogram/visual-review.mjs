// Browser approximation of local WXML/WXSS for layout review ONLY.
// This does not compile WXML or validate WeChat controls, events, sharing or devices.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import {root} from './catalog.mjs';
const require=createRequire(import.meta.url),build=path.join(root,'miniprogram/build'),out=path.join(root,'miniprogram/review');
fs.mkdirSync(out,{recursive:true});
const {catalog}=require(path.join(build,'services','catalog.js'));
const seeded={favorites:catalog.cards.slice(0,3).map(c=>c.id),recent:catalog.cards.slice(3,7).map(c=>c.id)};
global.wx={getStorageSync:()=>seeded,setStorageSync:()=>{},showToast:()=>{},setNavigationBarTitle:()=>{}};
function snapshot(name,options={}){let definition;global.Page=p=>{definition=p;};const script=path.join(build,'pages',name,'index.js');delete require.cache[require.resolve(script)];require(script);const page={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};page.onLoad?.(options);page.onShow?.();if(name==='detail')page.data.imageReady=true;return page.data;}
const templates={};for(const name of ['home','cards','collection','detail','decks','deck-detail','rules','history','website'])templates[name]=fs.readFileSync(path.join(build,'pages',name,'index.wxml'),'utf8');for(const name of ['card-tile','document-blocks'])templates[name]=fs.readFileSync(path.join(build,'components',name,'index.wxml'),'utf8');
const css=[fs.readFileSync(path.join(build,'app.wxss'),'utf8').replace(/\bpage\{/g,'body{'),...['card-tile','document-blocks'].map(n=>fs.readFileSync(path.join(build,'components',n,'index.wxss'),'utf8').replace(/\.row\{/g,'.document-row{'))].join('\n');
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);let file;if(url.startsWith('/assets/'))file=path.join(build,url);else if(url.startsWith('/cards/')||url.startsWith('/cards-hd/'))file=path.join(root,'public',url);else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}img{object-fit:contain}button{cursor:pointer}'+css+'</style><body></body></html>');return;}if(!file.startsWith(root)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.jpg')?'image/jpeg':file.endsWith('.png')?'image/png':'image/webp');fs.createReadStream(file).pipe(res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 const cases=[['home',snapshot('home')],['cards',snapshot('cards')],['collection',snapshot('collection',{kind:'角色'})],['decks',snapshot('decks')],['detail',snapshot('detail',{id:'char_002_weixiaokele_assassin'})],['deck-detail',snapshot('deck-detail',{id:'deck_aggro_001'})],['rules',snapshot('rules')],['history',snapshot('history')],['website',snapshot('website')]];
 const guide=snapshot('rules');
 const body=snapshot('detail',{id:'body_aggro_001'});
 const extra=catalog.cards.find(c=>c.id==='body_aggro_001').faces[1];
 cases.push(['detail--body',body],['detail--extra',{...body,faceIndex:1,faceLabel:extra.label,sections:extra.sections.map((s,i)=>({...s,key:'s'+i})),summarySections:extra.sections.filter(s=>['流派','体力'].includes(s.title)).map((s,i)=>({...s,key:'summary'+i})),effectSections:extra.sections.filter(s=>!['流派','体力'].includes(s.title)).map((s,i)=>({...s,key:'effect'+i})),visibleFaces:[{key:'f1',image:extra.hdImage}],image:extra.hdImage,imageReady:true}],['detail--text',snapshot('detail',{id:catalog.cards.find(c=>c.kind==='骑士卡').id})],['detail--error',{...body,imageFailed:true}],['rules--contents',{...guide,mode:'rules'}],['rules--reader',{...guide,mode:'rules',currentChapter:guide.sections.reduce((a,b)=>a.text.length>b.text.length?a:b),chapterIndex:0}],['rules--empty',{...guide,mode:'keywords',query:'无匹配',keywords:[]}]);
 const results=[];
 // zoom 1.3 approximates an enlarged system font: it is a browser trick, not WeChat font scaling.
 for(const [width,zoom] of [[320,1],[390,1],[430,1],[844,1],[390,1.3],[320,1.3]])for(const [name,data] of cases){
  await page.setViewportSize({width,height:width===844?390:844});await page.goto('http://127.0.0.1:'+port);
  const templateName=name.split('--')[0];const pageStyle=path.join(build,'pages',templateName,'index.wxss');if(fs.existsSync(pageStyle))await page.addStyleTag({content:fs.readFileSync(pageStyle,'utf8')});
  await page.evaluate(({templates,name,data})=>{
   const value=(s,scope)=>{if(s==null)return '';const exact=/^{{([^{}]*)}}$/.exec(s);const evaluate=e=>Function('scope','with(scope){return ('+e+')}')(scope);return exact?evaluate(exact[1]):s.replace(/{{([\s\S]*?)}}/g,(_,e)=>String(evaluate(e)??''));};
   // WXML 不是 XML，两处差异会让 DOMParser 直接报错，都在解析前转义（XML 解析器会把实体解回原字符，
   // 所以 getAttribute / textContent 拿到的仍是原始表达式，不影响后面的求值）：
   //   1. 裸 '&' 是合法 WXML 文本（wcc 原样输出），但 XML 报 xmlParseEntityRef；
   //   2. '{{a < b}}' 里的 '<' 是合法 WXML 表达式，但 XML 不允许属性值中出现裸 '<'。
   // 真实渲染行为以微信编译器（wcc）为准，这只影响浏览器近似渲染器。
   function parse(text){text=text.replace(/\s(lazy-load|user-select|scroll-x|wx:else)(?=[\s/>])/g,' $1="true"').replace(/\{\{([\s\S]*?)\}\}/g,m=>m.replace(/</g,'&lt;')).replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;)/g,'&amp;');const doc=new DOMParser().parseFromString('<root xmlns:wx="wx">'+text+'</root>','application/xml');if(doc.querySelector('parsererror'))throw Error(doc.querySelector('parsererror').textContent);return doc.documentElement;}
   function children(source,parent,scope){let chain=false,matched=false;for(const child of source.childNodes){if(child.nodeType!==1){if(child.nodeType===3)parent.append(document.createTextNode(value(child.textContent,scope)));continue;}if(child.hasAttribute('wx:if')){chain=true;matched=!!value(child.getAttribute('wx:if'),scope);if(!matched)continue;}else if(child.hasAttribute('wx:elif')){if(!chain||matched)continue;matched=!!value(child.getAttribute('wx:elif'),scope);if(!matched)continue;}else if(child.hasAttribute('wx:else')){if(!chain||matched)continue;matched=true;}else{chain=false;matched=false;}render(child,parent,scope);}}
   function render(source,parent,scope,looped=false){if(!looped&&source.hasAttribute('wx:for')){const values=value(source.getAttribute('wx:for'),scope);values.forEach((item,index)=>render(source,parent,{...scope,[source.getAttribute('wx:for-item')||'item']:item,[source.getAttribute('wx:for-index')||'index']:index},true));return;}const tag=source.tagName;
    // 组件内部的 data 字段要给默认值，否则模板里的 {{ready}} 会在近似渲染器里报 ReferenceError。
// 新增组件 data 字段时同步加到这里；ready=true 表示「卡面已加载」，让占位层不遮挡截图。
if(templates[tag]){const props={failed:false,ready:true};for(const attr of source.attributes)if(!attr.name.startsWith('wx:'))props[attr.name]=value(attr.value,scope);const container=document.createElement('div');parent.append(container);children(parse(templates[tag]),container,props);return;}
    if(tag==='swiper-item'&&parent.children.length)return;
    const target=document.createElement(({image:'img',text:'span',button:'button',input:'input',switch:'input'})[tag]||'div');
    for(const attr of source.attributes)if(['class','style','id','placeholder','value','src','aria-label'].includes(attr.name)){let v=value(attr.value,scope);if(attr.name==='src')v=String(v).replace(/^https:\/\/[^/]+/,'');target.setAttribute(attr.name,String(v));}
    if(tag==='image'&&source.getAttribute('mode')==='aspectFill')target.style.objectFit='cover';
    if(tag==='block')target.style.display='contents';if(tag==='switch')target.type='checkbox';
    if(tag==='scroll-view'){target.style.overflowX='auto';}
    parent.append(target);children(source,target,scope);
   }
   children(parse(templates[name]),document.body,data);
  },{templates,name:templateName,data});
  await page.evaluate(scale=>{document.body.style.zoom=scale;},zoom);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));await page.waitForTimeout(220);
  const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,images:[...document.images].filter(i=>i.naturalWidth===0).length}));results.push({page:name,width,zoom,...metrics});if(metrics.scroll>width+1||metrics.images)throw Error(JSON.stringify(results.at(-1)));
  await page.screenshot({path:path.join(out,`${name}-${width}${zoom>1?'-large-text':''}.png`),fullPage:name.startsWith('detail')});
 }
 fs.writeFileSync(path.join(out,'layout-results.json'),JSON.stringify({disclaimer:'Browser approximation only; native WeChat and device validation pending.',results},null,2));console.log(`Browser approximation: ${results.length} layouts, no horizontal overflow or failed local images. Output: ${out}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
