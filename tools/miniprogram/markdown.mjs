// Native text blocks only: no HTML execution or remote content.
export function inline(text) {
 const parts=[];const pattern=/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|\*([^*]+)\*/g;
 let start=0;for(const m of text.matchAll(pattern)){if(m.index>start)parts.push({text:text.slice(start,m.index),strong:false});parts.push({text:m[1]||m[2]||m[3]||m[4]||m[5],strong:!!(m[1]||m[2])});start=m.index+m[0].length;}if(start<text.length)parts.push({text:text.slice(start),strong:false});return parts;
}
// Each list item carries a stable `key` so WXML wx:key never resolves to a duplicate value.
const keyed=(list,prefix)=>list.map((item,index)=>({...item,key:prefix+index}));
export function blocks(source) {
 const result=[];let paragraph=[];const flush=()=>{if(paragraph.length)result.push({type:'paragraph',runs:keyed(inline(paragraph.join('\n')),'r')});paragraph=[];};
 for(const line of source.split('\n')) {
  if(!line.trim()){flush();continue;}
  // Table cells stay JSON-safe: {key,runs} instead of a bare array with an extra property.
  if(/^\s*\|/.test(line)){flush();if(/^\s*\|[\s:|\-]+\|\s*$/.test(line))continue;result.push({type:'table',cells:keyed(line.trim().replace(/^\||\|$/g,'').split('|').map(c=>({runs:keyed(inline(c.trim()),'c')})),'t')});continue;}
  const li=/^\s*(?:[-*+] |(\d+)\. )(.+)$/.exec(line);if(li){flush();result.push({type:'list',marker:li[1]?li[1]+'.':'•',runs:keyed(inline(li[2]),'r')});continue;}
  if(/^>\s?/.test(line)){flush();result.push({type:'quote',runs:keyed(inline(line.replace(/^>\s?/,'')),'r')});continue;}
  if(/^\s*---+\s*$/.test(line)){flush();continue;}
  paragraph.push(line);
 }flush();return keyed(result,'b');
}
