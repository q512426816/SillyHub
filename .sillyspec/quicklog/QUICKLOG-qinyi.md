
## ql-20260729-004-5845 | 2026-07-29 14:31:35 | (quick 任务)
状态：已完成
关联变更：（无）
文件：frontend/src/components/agent-log/__tests__/normalize.test.ts

结果：需求：补 normalize.test.ts 的 task-08 模型错误可见性测试覆盖(model-error-visibility 归档遗留测试债)。根因：归档 verify 探针发现 normalize.test.ts(原 ~50 测)零覆盖 task-08 新增逻辑(buildErrorLogItem/isAssistantApiErrorText/classifyLog :352 修正/normalizeLogs 结构化错误项/brownfield 兜底/R-02/零回归)。方案：normalize.test.ts 追加 1 个 describe 块,含 buildErrorLogItem 8 类 type 参数化+type非法→unknown+message缺失→运行失败+retryable严格===true+code/hint/raw缺失→null+null非对象→null,isAssistantApiErrorText 识别/不误判,classifyLog [ASSISTANT]+API Error→error,normalizeLogs errorDetail 追加结构化 error 项+[ASSISTANT] API Error 行 hasStructuredError 时 hidden,brownfield 兜底,成功路径零回归。结果：normalize.test.ts 60 tests 全过(含 8 类参数化);node_modules 半坏 vitest shim 丢失 pnpm install --force 修复;frontend.md 变更索引追加 ql-ID。已 git add(normalize.test.ts+frontend.md)未 commit。
## ql-20260729-005-6122 | 2026-07-29 22:18:14 | /runtimes 会话弹窗对话/过程分流（对话·全部二态切换）+ 气泡视觉升级
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-log-sanitize.ts（新增 classifySessionLog 分类纯函数：reply/thinking/tool/stderr，丢弃规则与原 sanitize 一致；原 sanitizeSessionLogContent 改为薄包装保持旧行为兼容）
- frontend/src/components/daemon/interactive-session-panel.tsx（SessionTurnView 加 details 过程项；SSE onLog 改 classify 分流，output 只装答复正文；头部加「对话/全部」二态 tab；新增 TurnDetailsList：思考折叠块复用 CollapsibleSection + 工具蓝行 + stderr 琥珀行；气泡大圆角 + 助手 Bot 图标 + text-sm leading-6 + 运行中「正在思考…」三点动效占位；删除旧 renderLogContent）
- frontend/src/components/daemon/runtime-session-helpers.tsx（logsToTurns 改走 classifySessionLog：reply→output、thinking/tool/stderr→details 按到达顺序，去重键改 kind:text）
- frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（新增：logsToTurns 分流 4 例）
- frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts（追加 classifySessionLog 8 例）
- frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（追加对话/全部切换 3 例：默认隐藏过程项/切全部展示/运行中思考占位/attach 历史 details）

需求：/runtimes 会话弹窗默认只展示对话（用户消息 + agent 答复正文），thinking/工具调用等其他信息经一个简洁切换再展示（类似运行日志但按钮更少），并优化会话展示视觉效果（原观感太简陋）。
根因：面板把 thinking/tool_call/stderr 全部拼接进 turn.output 同一答复气泡——thinking 仅剥 [THINKING] 前缀正文照显、tool_call 加 🔧、stderr 加 ⚠️，无对话/过程分流机制；展示层只有朴素 rounded-md 小气泡 + text-xs，观感简陋。
方案：① classifySessionLog 分类纯函数把日志分 reply/thinking/tool/stderr 四类（丢弃规则不变）；② SessionTurnView 加 details 过程项，实时 SSE onLog 与历史 logsToTurns 两条链路都走 classify 分流，output 只装答复正文；③ 面板头部加「对话/全部」二态切换（参考 agent-log-viewer 的对话/全部 tab，但无二级筛选按钮组），全部视图过程项渲染在答复气泡前：思考=默认折叠灰块（复用运行日志 CollapsibleSection）、工具=蓝色 Wrench 单行、stderr=琥珀 ⚠ 行；④ 气泡视觉升级：rounded-2xl 大圆角、agent 侧 Bot 图标头像、text-sm leading-6、运行中无答复时三点动效「正在思考…」占位。

补漏（2026-07-29 第二轮）：实测发现对话里仍显示 tool 信息——daemon task-runner 把每次工具调用**双发**两条日志（channel=stdout 的 `[TOOL_USE] Name: {…}` 文本行 + channel=tool_call 的 JSON），原分类只拦 channel=tool_call 的 JSON，stdout 的 `[TOOL_USE]`/`[TOOL_RESULT]` 文本行漏判成 reply 混进对话。修复：classifySessionLog 增加按内容前缀识别 `[TOOL_USE]`/`[TOOL_RESULT]`（含无 channel=null 情况）归 tool 过程项并剥前缀；`[TOOL_RESULT] User answered` 丢弃规则保持在先判。实时 SSE 与历史 logsToTurns 两链路同源生效。
结果：新增 classify 11 例（含 [TOOL_USE]/[TOOL_RESULT] 3 例补漏）+ logsToTurns 分流 4 例 + 面板切换 3 例，受影响 4 个测试文件 78 测试全绿（首轮 6 文件 83 全绿）；tsc --noEmit 通过、eslint 0 error（warning 均为预存）；frontend 模块文档变更索引已同步；未部署，视觉效果建议浏览器实测确认。