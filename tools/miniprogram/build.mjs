import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { root, makeCatalog, CARD_PACK_COUNT } from './catalog.mjs';
const target=path.join(root,'miniprogram/build');
execFileSync(process.execPath,['tools/miniprogram/catalog.mjs'],{cwd:root,stdio:'inherit'});
fs.rmSync(target,{recursive:true,force:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','miniprogram/tsconfig.json'],{cwd:root,stdio:'inherit'});
function copy(dir,relative='') {for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(relative,e.name),source=path.join(dir,e.name);if(e.isDirectory())copy(source,name);else if(/\.(js|json|wxml|wxss)$/.test(e.name)){const dest=path.join(target,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}}}
copy(path.join(root,'miniprogram/src'));
fs.mkdirSync(path.join(target,'assets'),{recursive:true});
const catalog=makeCatalog();
for(const p of catalog.portraits)await sharp(path.join(root,p.file)).resize({width:320,withoutEnlargement:true}).jpeg({quality:60,mozjpeg:true}).toFile(path.join(target,'assets',p.id+'.jpg'));
// Decorative artwork is local and compressed separately from formal card images.
await sharp(path.join(root,'miniprogram/branding/collector-library-v2.png')).resize({width:780}).jpeg({quality:72,mozjpeg:true}).toFile(path.join(target,'assets/collector-library.jpg'));
await sharp(path.join(root,'miniprogram/branding/collector-character-v2.png')).resize({width:620}).png({palette:true,quality:82,effort:10}).toFile(path.join(target,'assets/collector-hero.png'));
fs.mkdirSync(path.join(target,'assets/icons'),{recursive:true});
for(const name of ['home','cards','stack-2','book-2','search']) {
 const svg=fs.readFileSync(path.join(root,'miniprogram/branding/icons',name+'.svg'),'utf8');
 for(const [suffix,color] of [['','#c1b398'],['-selected','#8cd6ca']])await sharp(Buffer.from(svg.replace(/currentColor/g,color))).resize(48,48).png().toFile(path.join(target,'assets/icons',name+suffix+'.png'));
}
const exhibitDeck=catalog.decks.find(d=>d.id===catalog.presentation.homeExhibit.deckId);
const exhibitFace=catalog.cards.find(c=>c.id===exhibitDeck.bodyId).faces[0];
const sourceFace=exhibitFace.hdImage.split('/hd/')[1];
await sharp(path.join(root,'public/cards-hd',sourceFace)).resize({width:720}).jpeg({quality:74,mozjpeg:true}).toFile(path.join(target,'assets/showcase-body.jpg'));
await sharp(path.join(root,'public/cards/backs/character.webp')).resize({width:360}).jpeg({quality:76,mozjpeg:true}).toFile(path.join(target,'assets/showcase-back.jpg'));

// A subpackage owns every HD face of its cards. The shared detail page is copied into
// each package; its relative imports still point to the main package's shared services.
const detailDir=path.join(target,'pages/detail');
const detailScript=fs.readFileSync(path.join(detailDir,'index.js'),'utf8');
const packageScript=detailScript.replaceAll('require("../../','require("../../../');
if(packageScript===detailScript)throw Error('详情页分包入口未重写共享服务路径');
for(let i=1;i<=CARD_PACK_COUNT;i++){
 const pack=`cardpack-${String(i).padStart(2,'0')}`;
 const pageDir=path.join(target,pack,'pages/detail');fs.mkdirSync(pageDir,{recursive:true});
 fs.writeFileSync(path.join(pageDir,'index.js'),packageScript);
 for(const ext of ['json','wxml','wxss'])fs.copyFileSync(path.join(detailDir,`index.${ext}`),path.join(pageDir,`index.${ext}`));
}
let faceCount=0;
for(const card of catalog.cards)for(const face of card.faces){
 if(!face.hdImage||!face.image)continue;
 const rel=face.hdImage.split('/hd/')[1];
 const source=path.join(root,'public/cards-hd',rel);
 const kind=rel.split('/')[0];
 const thumb=kind==='bodies'?{width:240,quality:60}:kind==='characters'?{width:150,quality:60}:{width:120,quality:48};
 const full=kind==='hand_cards'?{width:650,quality:58}:{width:750,quality:70};
 for(const [dest,settings] of [[face.image,thumb],[face.hdImage,full]]){
  const output=path.join(target,dest.slice(1));fs.mkdirSync(path.dirname(output),{recursive:true});
  await sharp(source).resize({width:settings.width}).webp({quality:settings.quality,effort:5}).toFile(output);
 }
 faceCount++;
}
function size(dir){let bytes=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);bytes+=e.isDirectory()?size(p):fs.statSync(p).size;}return bytes;}
const packageSizes=Array.from({length:CARD_PACK_COUNT},(_,index)=>size(path.join(target,`cardpack-${String(index+1).padStart(2,'0')}`)));
const total=size(target),main=total-packageSizes.reduce((a,b)=>a+b,0);
const expectedFaces=catalog.cards.reduce((n,card)=>n+card.faces.length,0);
if(faceCount!==expectedFaces)throw Error(`小程序卡图数量异常：${faceCount}，预期 ${expectedFaces}`);
if(main>2_000_000||packageSizes.some(n=>n>2_000_000)||total>20_000_000)throw Error(`小程序包体超限：主包 ${main} B，最大分包 ${Math.max(...packageSizes)} B，总包 ${total} B`);
console.log(`Mini build: ${faceCount} faces; main ${main} B, largest subpackage ${Math.max(...packageSizes)} B, total ${total} B; import miniprogram/project.config.json in WeChat DevTools`);
