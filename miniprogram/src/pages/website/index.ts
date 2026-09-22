import {OFFICIAL_WEBSITE_URL,OFFICIAL_WEBSITE_EMBED_ENABLED} from '../../config';
Page({
 data:{url:OFFICIAL_WEBSITE_URL,opening:OFFICIAL_WEBSITE_EMBED_ENABLED,failed:false},
 error(){this.setData({opening:false,failed:true});},
 copy(){wx.setClipboardData({data:OFFICIAL_WEBSITE_URL,success:()=>wx.showToast({title:'网址已复制，请在浏览器打开',icon:'none'}),fail:()=>wx.showToast({title:'复制失败，可长按下方网址复制',icon:'none'})});}
});
