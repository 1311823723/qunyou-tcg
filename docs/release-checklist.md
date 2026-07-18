# 发布检查清单

## 发布前

- [ ] 确认 `package.json` 版本与 README 版本一致。
- [ ] 审阅当前分支变更，确认不包含临时原画、对局令牌或未确认资产。
- [ ] 如有卡牌或规则变更，确认数据、规则文档和 `playtest/changelog.md` 已同步。
- [ ] 如有原画变更，确认源图已归档且 `npm run art:audit` 通过。

## 本地验证

- [ ] `npm ci`
- [ ] `npm run validate`
- [ ] `npm run art:audit`
- [ ] `npm run typecheck`
- [ ] `npm run test:battle`
- [ ] `npm run test:playtest`
- [ ] `npm run playtest:report`
- [ ] `npm run build:battle`
- [ ] `npm run build:web`
- [ ] 对战或 UI 变更后运行 `npm run test:battle:e2e`。
- [ ] Worker 行为变更后启动本地 Worker，运行 `npm run test:battle:live`。
- [ ] 卡面变更后运行 `npm run build:cards` 并抽查本体、角色、手牌和 JOKER。

## 发布与回滚

- [ ] 确认 GitHub Actions CI 全部通过。
- [ ] 确认 Worker 自动部署和 `/lobby` 健康检查通过。
- [ ] 确认 Cloudflare Pages 已构建目标 `main` 提交。
- [ ] 在 Pages 抽查首页、卡牌页、规则页和对战大厅。
- [ ] 创建一个真实等待房，确认加入、开局、重连和观战。
- [ ] 记录本次发布的提交 SHA；需要回滚时使用新提交回退，不重写 `main` 历史。
