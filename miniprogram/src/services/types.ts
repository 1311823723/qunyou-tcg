export interface Run { text:string; strong:boolean; key?:string }
export interface Cell { key?:string; runs:Run[] }
export interface Block { type:string; key?:string; runs?:Run[]; marker?:string; cells?:Cell[] }
export interface Section { title:string; text:string; anchor?:string; blocks?:Block[] }
export interface Face { label:string; image:string; hdImage:string; sections?:Section[] }
export interface Card { id:string; name:string; kind:string; role:string; tags:string[]; faces:Face[]; sections:Section[] }
export interface Deck { id:string; name:string; archetype:string; bodyId:string; characterIds:string[]; notes:string; summary:string; core:string; portrait:string; bodyName:string }
export interface Article { id:string; title:string; sections:Section[] }
export interface Step { title:string; text:string; cardId:string; ruleHeadings:string[] }
export interface Catalog { schemaVersion:number; contentVersion:string; cards:Card[]; decks:Deck[]; articles:Article[]; presentation:{homeExhibit:{deckId:string;characterArt:string};featuredDeckIds:string[]; quickStart:Step[]} }
