
## ql-20260904-012-9a2b | 2026-09-04 08:35:20 | token 词元消耗单位统一 K/M 废除万单位
状态：已完成
关联变更：（无）
文件：
- frontend/src/lib/format-token.ts（k→K）
- frontend/src/components/daemon/runtime-card-helpers.tsx（formatTokens k→K）
- frontend/src/components/daemon/session-usage-bar.tsx（formatTokensZh→formatTokensCompact）
- frontend/src/components/changes/detail/change-usage-card.tsx（同款重写）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（同款重写）
- frontend/src/components/changes/quicklog-table.tsx（同款重写）
- 11 个测试文件（断言万→K/M 与 k→K 同步）
需求：token 词元消耗单位统一 K/M 废除万单位
根因：四处用量展示用中文万级缩写（X.X 万），另两处用小写 k——用户要求统一 K/M 且不用万
方案：session-usage-bar / change-usage-card / changes 页 / quicklog-table 的 formatTokensZh 重写为 formatTokensCompact（>=1M→X.XM；>=1K→X.XK；K 以下原值）；runtime-card-helpers formatTokens 与 lib formatTokenCount 小写 k→K；请求次数/轮次/耗时不变
结果：11 个受影响测试文件 137 用例绿（sessions/page.test 2 个触顶分页用例为预存失败，stash 原始版本复现实证与本改动无关）；tsc --noEmit 0 错误；frontend.changelog.md 已同步

## ql-20260904-013-6fd8 | 2026-09-04 08:58:40 | 会话页时间线识别 CLI 鉴权错误行不进回复气泡；影子直聊等仅有前导条的消息剥前导后收 prompt（重试按钮/用户气泡可出）
状态：进行中
关联变更：（无）
文件：（见实际改动）
