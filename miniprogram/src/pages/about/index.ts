import { catalog } from '../../services/catalog';
import { library } from '../../services/storage';
import { OFFICIAL_WEBSITE_URL, ICP_FILING_NUMBER } from '../../config';
// 展示文案集中在本页，便于随时修改；不涉及正式卡牌数据与规则裁定。
// 隐私说明与程序实际行为一一对应：卡图随包携带，记录只存在本机。
const PRIVACY=[
 {title:'无需登录',text:'没有账号体系，也不索取手机号、通讯录、位置或相册权限。'},
 {title:'记录留在本机',text:'收藏与最近浏览只写入本机存储，不上传服务器；清除缓存或卸载后会丢失。'},
 {title:'只写入剪贴板',text:'「复制文字」「复制网址」会把内容写入系统剪贴板；除此之外不读取你的剪贴板。'},
 {title:'卡图随包携带',text:'卡面随小程序提供，高清图按需加载对应图包；查卡不需要外部图源。'},
 {title:'没有统计与广告',text:'未接入第三方统计、广告或分享 SDK，也没有消息推送类的后台行为。'}
];
const SCOPE=[
 {title:'可以做什么',text:'搜索卡牌、阅读完整效果、查看本体双面与额外形态、浏览预组与角色、阅读正式规则与关键词、收藏常查的卡。'},
 {title:'不做什么',text:'不含对战、自动结算、自由组牌或战绩统计。这是一个查询工具，不需要联网同步。'},
 {title:'规则以正式源为准',text:'规则与关键词保留正式原文，界面不自行裁定或改写。'}
];
Page({
 data:{privacy:PRIVACY,scope:SCOPE,filing:ICP_FILING_NUMBER,version:catalog.contentVersion,assetHost:'小程序包内卡图',website:OFFICIAL_WEBSITE_URL,counts:{cards:catalog.cards.length,decks:catalog.decks.length},reduceMotion:false},
 onShow(){this.setData({reduceMotion:library().reduceMotion});},
 openWebsite(){wx.navigateTo({url:'/pages/website/index'});}
});
