## FR-task-runner-001 daemon tool_use 不再双写 stdout [TOOL_USE]
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon batch 路径处理一个 `tool_use` AgentEvent（metadata 含 tool_name + tool_input + to；When `_eventToMessages(ev)` 转换 前端 normalize 处理历史日志；Then 返回的 messages 数组**只有 1 条** tool_call JSON（channel='tool_call'，带 tool_kind + tool_
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-01
最近确认：af41fac1d

## FR-task-runner-002 daemon tool_result 补 tool_use_id
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 处理一个 `tool_result` AgentEvent，metadata 含 call_id（sillyhub-daemon/src/adapters/stream-json.ts...:815 存的单字段；When `_eventToMessages(ev)` 转换 转换；Then message 带 `tool_use_id` 字段（从 metadata.tool_use_id/id/call_id 取，与 tool_use 分支同源解析
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-02
最近确认：af41fac1d

## FR-task-runner-003 前端 tool_result 按 parent_tool_use_id 精确配对进卡片（全新逻辑）
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 日志含一条 channel='stdout'、content 以 `[TOOL_RESULT]` 开头、`parent_tool_use_id` 非空的行，且存；When normalize 处理该 result 行 normalize 处理 normalize 处理；Then result body 合并进对应 tool_call 卡片（mergeToolResult），该 result 行 hidden=true 不独立渲染 退化到
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-03
最近确认：af41fac1d

## FR-task-runner-004 前端工具卡片合并折叠渲染
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一条 tool_call 卡片（含配对的 result body）；When agent-log-viewer 渲染 用户点击折叠区；Then 显示：工具徽标 + tool_kind 中文标签（toolKindMeta）+ 调用参数 + "▸执行结果"折叠区（默认收起） 展开显示 result body
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-04
最近确认：af41fac1d

## FR-task-runner-005 SYSTEM/thinking 日志默认折叠可展开（改两处）
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 日志含 `[SYSTEM:thinking_tokens]` 行 日志含 `[SYSTEM:init]`/`[SYSTEM:status]`/`[SYSTEM:；When normalize 处理（NOISE_PREFIXES filter 已改为折叠标记，不再 filter 删） normalize 处理（isThinkingC
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-05
最近确认：af41fac1d

## FR-task-runner-006 交互式会话面板补 token 缓存两维
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given SessionStreamEnvelope 的 `tokens`/`turn_completed` 事件含 cache_read_tokens + cache_；When interactive-session-panel 的 onTokens/onTurnCompleted 回调处理；Then SessionTurnView 读入并显示四维（输入/输出/缓存读/缓存写），不再只取 input/output 丢弃 cache
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-06
最近确认：af41fac1d

## FR-task-runner-007 cache_creation 恒 0 实证 + 三分支修复
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When execute 阶段实证 task 跑该 run 并 dump 按分支 A1 修复 按分支 A2 修复 按分支 B 修复
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-07
最近确认：af41fac1d

## FR-task-runner-008 killed/failed run token 占位
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given run.status 为 killed 或 failed，且 total_cost_usd/num_turns/duration_ms 为 NULL run.s；When token 面板渲染（agent-run-panel + runtime-session-dialog） token 面板渲染；Then 对应维度显示"已中断"/"未汇总"占位文案，非空白或 0 正常显示数值（行为不变）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-08
最近确认：af41fac1d

## FR-task-runner-009 历史回看补 token 四维
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开 runtime-session-dialog 历史回看某 run；When SessionHistoryView 渲染；Then 显示 token 四维（输入/输出/缓存读/缓存写），与主面板口径一致（之前无任何 token 显示）
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-09
最近确认：af41fac1d

## FR-task-runner-010 classifyLog 补 [TOOL_USE] stdout 历史降级分支
变更：2026-07-09-2026-07-09-agent-log-display-fix
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 历史日志含 channel='stdout'、content 以 `[TOOL_USE]` 开头的行（旧 daemon 双写遗留）；When classifyLog 处理；Then 归类为 `tool_call` 语义类（参与工具配对/筛选），不再 fallthrough 到 `log` 灰徽标
全文：.sillyspec/changes/archive/2026-07-09-2026-07-09-agent-log-display-fix/requirements.md#FR-10
最近确认：af41fac1d
