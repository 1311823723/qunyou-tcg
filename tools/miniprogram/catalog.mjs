import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { blocks } from './markdown.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const json = file => JSON.parse(read(file));
const section = (title,text) => ({title,text:String(text || '')});
function cost(value) {return value?.text || (value?.amount !== undefined ? `${value.type} ${value.amount}` : value?.type || '');}
function faces(paths) {return paths.map(([label,p])=>({label,image:fs.existsSync(path.join(root,'public/cards',p))?`/cards/${p}`:'',hdImage:fs.existsSync(path.join(root,'public/cards-hd',p))?`/cards-hd/${p}`:''}));}
function article(id,title,source) {
 const sections=[];let heading=title,lines=[];
 const flush=()=>{if(lines.join('\n').trim())sections.push({...section(heading,lines.join('\n').trim()),anchor:'section-'+sections.length,blocks:blocks(lines.join('\n').trim())});};
 for(const line of source.split('\n')) {const match=/^#{1,6}\s+(.+)$/.exec(line);if(match){flush();heading=match[1];lines=[];}else lines.push(line);}
 flush();return{id,title,sections};
}
export function makeCatalog() {
 const cards=[];
 const presentation=json('miniprogram/content/presentation.json');
 const art=json('data/card-art.json');
 for(const c of json('data/cards/bodies.json')) {
  const extra=c.extraForm;const suffix={mega:'mega','z-move':'z_move',dynamax:'dynamax',terastal:'terastal'}[extra?.type];
  cards.push({id:c.id,name:c.name,kind:'本体',role:'',tags:c.affinityTags||[],faces:faces([['正面',`bodies/${c.id}_front.webp`],...(extra?[['额外形态',`bodies/${c.id}_${suffix}_back.webp`]]:[])]),sections:[section('流派',c.archetype),section('体力',c.hp),section(c.skillName,c.effectText),...(extra?[section('额外形态 · '+extra.name,extra.condition),section(extra.skillName,extra.effectText)]:[])]});
 }
 for(const c of json('data/cards/characters.json')) cards.push({id:c.id,name:c.name,kind:'角色',role:c.mainRole,tags:c.tags||[],faces:faces([['卡面',`characters/${c.id}.webp`]]),sections:[section('费用',cost(c.cost)),section('发动时机',c.timing),section(c.skillName,c.effectText)]});
 for(const c of json('data/cards/bodies.json')) {
  const card=cards.find(x=>x.id===c.id);const extra=c.extraForm;
  card.faces[0].sections=card.sections.slice(0,3).concat(extra?[section('额外形态条件',extra.condition)]:[]);
  if(extra)card.faces[1].sections=[...card.sections.slice(0,2),...(extra.type==='z-move'?[section(c.skillName,c.effectText)]:[]),section('额外形态 · '+extra.name,extra.condition),section(extra.skillName,extra.effectText)];
 }
 const handFiles=fs.readdirSync(path.join(root,'public/cards/hand_cards')).sort();
 for(const c of json('data/cards/hand_cards.json')) cards.push({id:c.id,name:c.name,kind:c.handType+'牌',role:'',tags:c.tags||[],faces:faces(handFiles.filter(f=>f.startsWith(c.id+'_')).map((f,i)=>[f.slice(c.id.length+1,-5).replace(/spade[s]?/,'黑桃').replace(/heart[s]?/,'红桃').replace(/diamond[s]?/,'方块').replace(/club[s]?/,'梅花').replace(/small_joker/,'小王').replace(/big_joker/,'大王').replace(/_/g,' ').toUpperCase(),`hand_cards/${f}`])),sections:[section('发动时机',c.timing),section('效果',c.effectText),section('花色与点数',c.cards.map(e=>e.joker==='small'?'小王':e.joker==='big'?'大王':e.suit+e.rank).join('、'))]});
 for(const c of json('data/cards/rider_cards.json')) cards.push({id:c.id,name:c.name,kind:'骑士卡',role:c.mainRole,tags:[c.tag].filter(Boolean),faces:[],sections:['normal','final'].flatMap(key=>{const mode=c[key],pay=mode.cost;return[section(key==='normal'?'普通模式':'FINAL模式',mode.timing),section(key==='normal'?'普通费用':'FINAL费用',`${pay.consumeSelf?'消耗此骑士卡；':''}退场 ${pay.retireSameRole} 张同定位角色；消耗 ${pay.dynamaxEnergy} 点极巨能量`),section(key==='normal'?'普通效果':'FINAL效果',mode.effectText)];})});
 const decks=fs.readdirSync(path.join(root,'data/decks')).filter(f=>f.endsWith('.deck.json')).sort().map(f=>json('data/decks/'+f));
 for(const d of decks){const intro=presentation.deckIntros[d.id];if(!intro)throw Error('Missing deck introduction: '+d.id);Object.assign(d,intro,{portrait:'/assets/'+d.bodyId+'.jpg',bodyName:cards.find(c=>c.id===d.bodyId)?.name});}
 const articles=[article('rules','规则摘要',read('docs/rules.md')),article('keywords','关键词',read('docs/keywords.md'))];
 const ids=new Set(cards.map(c=>c.id));if(ids.size!==cards.length)throw Error('Duplicate card ID');
 for(const d of decks)for(const id of [d.bodyId,...d.characterIds])if(!ids.has(id))throw Error(`Missing reference: ${d.id}/${id}`);
 if(!decks.some(d=>d.id===presentation.homeExhibit?.deckId))throw Error('Invalid home exhibit deck');
 for(const id of presentation.featuredDeckIds)if(!decks.some(d=>d.id===id))throw Error('Invalid featured deck '+id);
 for(const id of Object.keys(presentation.deckIntros))if(!decks.some(d=>d.id===id))throw Error('Invalid editorial deck '+id);
 for(const step of presentation.quickStart){if(!ids.has(step.cardId))throw Error('Invalid tutorial card '+step.cardId);for(const heading of step.ruleHeadings)if(!articles[0].sections.some(s=>s.title===heading))throw Error('Invalid tutorial rule '+heading);}
 const portraits=decks.map(d=>{const file='src/assets/card-art-web/'+art.bodies[d.bodyId].front+'.webp';return{id:d.bodyId,file,hash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')};});
 const contentVersion=crypto.createHash('sha256').update(JSON.stringify({cards,decks,articles,presentation,portraits})).digest('hex').slice(0,12);
 return{schemaVersion:2,contentVersion,cards,decks,articles,presentation,portraits};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 // Minified on purpose: this file ships inside the mini program package.
 // MUST stay a .js CommonJS module: WeChat DevTools resolves require() by appending ".js",
 // so requiring a ".json" file fails at runtime with "module 'x.json.js' is not defined".
 const output=path.join(root,'miniprogram/src/generated/catalog.js');const next='module.exports='+JSON.stringify(makeCatalog())+';\n';
 if(process.argv.includes('--check')){if(!fs.existsSync(output)||read('miniprogram/src/generated/catalog.js')!==next)throw Error('图鉴数据过期：运行 npm run mini:data');}
 else {fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,next);}
 console.log('Mini catalog ready');
}
