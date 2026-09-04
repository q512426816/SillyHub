
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

## ql-20260904-013-6fd8 | 2026-09-04 08:58:40 | 会话页失败卡两缺口修复——错误原文不进回复气泡+影子直聊 prompt 提取
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-assembler.ts（classifySessionLog 增错误特征行丢弃）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 前导条剥前导后收 prompt）
- frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（新增丢弃 describe 5 用例）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增前导 prompt 3 用例）
需求：会话页失败卡两缺口修复——错误原文不进回复气泡+影子直聊 prompt 提取
根因：会话 2f08b5da 实证：CLI 把远端 401 误报的 Not logged in 行在会话页装配器被当 agent 回复渲染成气泡（09-03 修复只盖 normalize 日志管线）；影子直聊仅一条带前导 user_input 被 logsToTurns 整条跳过，prompt 收空致无用户气泡且失败卡无重发按钮
方案：①session-log-assembler classifySessionLog 增丢弃规则：[ASSISTANT] 前缀 + isAssistantApiErrorText 特征（Not logged in / Please run /login / API Error / Request rejected）返回 null，展示归 RunErrorItem；②logsToTurns 前导条不再 continue，stripPreambleText 剥前导后剩余正文（trim）进既有二阶段归并（常规双写同主体不双显，纯系统注入仍跳过）
结果：assembler 72（新增 5 用例）+ sanitize 42 + helpers 25（新增 3 用例）= 146 绿 + normalize 59 绿 + tsc 0；page.test 仅 2 个已知预存触顶失败（stash 实证与本改动无关）；frontend.md/frontend.changelog.md 已同步
审计：📝 文档欠账（D-8）：4 个源码文件改动未同步任何模块文档（涉及模块：frontend）

## ql-20260904-015-a399 | 2026-09-04 09:47:58 | 修复 backend/frontend/daemon 三处 CI 失败（mypy 5 错误 + 加载更早两断言 + session-plan-bash-even…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/tests/test_session_provider_caps.py（删 2 处失效 type: ignore）
- backend/app/modules/daemon/tests/test_run_sync_golden_parity.py（_canon_stdout_contents 标注 set[str|None]）
- backend/app/modules/daemon/tests/test_group_p2.py（mention preview 局部变量窄化）
- backend/app/modules/daemon/tests/test_group_chat_management.py（删 1 处失效 type: ignore）
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（两断言补 signal expect.any(AbortSignal)）
- sillyhub-daemon/tests/session-plan-bash-events.test.ts（harness 接真实归一化器 + user 消息标准形状）
需求：修复 backend/frontend/daemon 三处 CI 失败（mypy 5 错误 + 加载更早两断言 + session-plan-bash-events 14 用例）
根因：backend 是类型债（2 处 type: ignore 已失效未删、1 处 set 标注未含 None、1 处 Optional 下标未窄化）；frontend 是 19d845c91 给加载更早请求加 AbortController 后漏改两处旧断言；daemon 是 13205757f AgentEvent v2 把 onTurnMessage 契约改为 envelope 且归一化下沉 driver，老测试仍喂 raw SDK 消息
方案：backend 纯类型修复不动逻辑；frontend 断言补 signal: expect.any(AbortSignal)；daemon 测试 harness 包真实 ClaudeEventNormalizer 保持喂 raw 消息的端到端口径，6 处 user 消息改标准 SDK 形状 message.content
结果：backend mypy 834 文件 0 错 + 4 文件 pytest 74 过 + ruff/format 0；frontend page.test.tsx 29/29 绿 + tsc 0；daemon session-plan-bash-events 31/31 绿 + tsc 0
审计：📝 文档欠账（D-8）：6 个源码文件改动未同步任何模块文档（涉及模块：frontend）
