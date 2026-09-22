import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { root, makeCatalog } from './catalog.mjs';
const target=path.join(root,'miniprogram/build');
execFileSync(process.execPath,['tools/miniprogram/catalog.mjs'],{cwd:root,stdio:'inherit'});
fs.rmSync(target,{recursive:true,force:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','miniprogram/tsconfig.json'],{cwd:root,stdio:'inherit'});
function copy(dir,relative='') {for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(relative,e.name),source=path.join(dir,e.name);if(e.isDirectory())copy(source,name);else if(/\.(js|json|wxml|wxss)$/.test(e.name)){const dest=path.join(target,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}}}
copy(path.join(root,'miniprogram/src'));
fs.mkdirSync(path.join(target,'assets'),{recursive:true});
for(const p of makeCatalog().portraits)await sharp(path.join(root,p.file)).resize({width:480,withoutEnlargement:true}).jpeg({quality:72,mozjpeg:true}).toFile(path.join(target,'assets',p.id+'.jpg'));
// Decorative artwork is local and compressed separately from formal card images.
await sharp(path.join(root,'miniprogram/branding/collector-library-v2.png')).resize({width:780}).jpeg({quality:72,mozjpeg:true}).toFile(path.join(target,'assets/collector-library.jpg'));
await sharp(path.join(root,'miniprogram/branding/collector-character-v2.png')).resize({width:620}).png({palette:true,quality:82,effort:10}).toFile(path.join(target,'assets/collector-hero.png'));
fs.mkdirSync(path.join(target,'assets/icons'),{recursive:true});
for(const name of ['home','cards','stack-2','book-2','search']) {
 const svg=fs.readFileSync(path.join(root,'miniprogram/branding/icons',name+'.svg'),'utf8');
 for(const [suffix,color] of [['','#c1b398'],['-selected','#8cd6ca']])await sharp(Buffer.from(svg.replace(/currentColor/g,color))).resize(48,48).png().toFile(path.join(target,'assets/icons',name+suffix+'.png'));
}
const exhibitCatalog=makeCatalog();
const exhibitDeck=exhibitCatalog.decks.find(d=>d.id===exhibitCatalog.presentation.homeExhibit.deckId);
const exhibitFace=exhibitCatalog.cards.find(c=>c.id===exhibitDeck.bodyId).faces[0];
await sharp(path.join(root,'public',exhibitFace.hdImage)).resize({width:720}).jpeg({quality:88,mozjpeg:true}).toFile(path.join(target,'assets/showcase-body.jpg'));
await sharp(path.join(root,'public/cards/backs/character.webp')).resize({width:360}).jpeg({quality:76,mozjpeg:true}).toFile(path.join(target,'assets/showcase-back.jpg'));
let bytes=0;function size(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())size(p);else bytes+=fs.statSync(p).size;}}size(target);
if(bytes>1.5*1024*1024)throw Error('小程序构建产物超过本项目 1.5 MiB 预算');
console.log(`Mini build: ${(bytes/1024).toFixed(1)} KiB; import miniprogram/project.config.json in WeChat DevTools`);
