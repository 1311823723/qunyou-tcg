// 手写声明，不用手改 catalog.js（生成物，见 tools/miniprogram/catalog.mjs）。
// catalog.js 是 CommonJS 模块（module.exports = {...}），微信 require 只认 .js，
// 所以这里用 default export 声明类型，配合 tsconfig 的 esModuleInterop 供 src/services/catalog.ts 使用。
import type { Catalog } from "../services/types";

declare const catalog: Catalog;
export default catalog;
