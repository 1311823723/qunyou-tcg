// ready 表示远程卡面已真正 onLoad。实测在开发者工具/真机上首次加载一张远程卡图要数秒，
// 期间 <image> 只是一个空盒子；没有 ready 就只能看到空白方块，看不出是在加载还是坏了。
// 兜底定时器：万一 bindload 没触发，占位层也要让开，不能永久盖住已经渲染出来的卡面。
type WithTimer = { timer?: ReturnType<typeof setTimeout> };
Component({properties:{card:{type:Object,value:{id:"",image:"",name:"",kind:"",role:""}}},data:{failed:false,ready:false},
lifetimes:{attached(){const self=this as unknown as WithTimer;self.timer=setTimeout(()=>{if(!this.data.ready)this.setData({ready:true});},15000);},detached(){clearTimeout((this as unknown as WithTimer).timer);}},
observers:{'card.image':function(){this.setData({failed:false,ready:false});}},
methods:{open(){this.triggerEvent('open',{id:this.data.card.id});},load(){if(!this.data.ready)this.setData({ready:true});},error(){this.setData({failed:true,ready:true});},retry(){this.setData({failed:false,ready:false});}}});
