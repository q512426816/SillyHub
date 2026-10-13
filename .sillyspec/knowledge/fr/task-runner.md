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

## FR-task-runner-011 codex/pi 会话内供应商切换确定性生效
变更：2026-09-11-session-provider-switch-codex-pi
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given codex 或 pi 引擎的 active 会话（已绑定平台供应商 A 或宿主起步均可）；When 用户在配置条选供应商 B（codex/pi kind 与引擎匹配）并确认；Then backend SESSION_SWITCH_CONFIG → daemon turn 边界 reload：重写 per-session 配置目录（CODEX_
全文：.sillyspec/changes/archive/2026-09-11-session-provider-switch-codex-pi/requirements.md#FR-01
最近确认：225dd771d

## FR-task-runner-012 codex/pi 切回「不指定（本机默认）」不丢历史
变更：2026-09-11-session-provider-switch-codex-pi
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given codex 会话当前在平台供应商上（env 带 CODEX_HOME） pi 会话当前在平台供应商上（env 带 PI_CODING_AGENT_DIR）；When 用户选「不指定（本机默认）」 用户选「不指定（本机默认）」；Then reload 后 CODEX_HOME 保持原 per-session 目录（thread 历史不丢），宿主 ~/.codex 的 auth.json/conf
全文：.sillyspec/changes/archive/2026-09-11-session-provider-switch-codex-pi/requirements.md#FR-02
最近确认：225dd771d

## FR-task-runner-013 供应商下拉按引擎过滤 + 门禁白名单化
变更：2026-09-11-session-provider-switch-codex-pi
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话引擎为 E（claude/codex/pi） 会话引擎为 cursor 或未知引擎 会话 provider 为空/未知（session.provider 缺；When 打开配置条供应商下拉；Then 候选=「不指定（本机默认）」+ agent_kind === E 的供应商（全引擎保留默认项；选错 kind 撞 422 的现状坑随之消除） 配置条供应商控件锁
全文：.sillyspec/changes/archive/2026-09-11-session-provider-switch-codex-pi/requirements.md#FR-03
最近确认：225dd771d

## FR-task-runner-014 默认供应商热切换（PROVIDER_CONFIG_CHANGED）对 codex/pi 确定性生效
变更：2026-09-11-session-provider-switch-codex-pi
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given codex/pi 引擎 active 会话；When 用户在 /settings 改默认供应商（backend 推 PROVIDER_CONFIG_CHANGED）；Then daemon markPendingSwitch → reloadWithProvider 不再因非 claude 抛错 → 与 FR-01 同一 reload
全文：.sillyspec/changes/archive/2026-09-11-session-provider-switch-codex-pi/requirements.md#FR-04
最近确认：225dd771d

## FR-task-runner-015 codex 宿主起步会话首切供应商时迁移 thread 历史
变更：2026-09-11-session-provider-switch-codex-pi
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given codex 会话以宿主凭证起步（env 无 CODEX_HOME）且已有 thread（agentSessionId 非空）；When 用户首次切到平台供应商
全文：.sillyspec/changes/archive/2026-09-11-session-provider-switch-codex-pi/requirements.md#FR-05
最近确认：225dd771d

<!-- 2026-10-13-daemon-module-map：以下五条目自伪域 fr/auto-sillyhub-daemon.md（原 FR-auto-sillyhub-daemon-034~038）
     整体迁入，字段逐字保持、仅段头 id 换域接续编号；源变更 2026-10-13-spawn-flush-e2e-test。 -->

## FR-task-runner-016 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列
变更：2026-10-13-spawn-flush-e2e-test
状态：active
摘要：执行级驱动
全文：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/requirements.md#FR-01
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-spawn-flush-e2e-test:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「直调 spawnAndStream 驱动真实收尾序列（文件级 mock spawn + FakeChild）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-spawn-flush-e2e-test
  status: active

## FR-task-runner-017 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled
变更：2026-10-13-spawn-flush-e2e-test
状态：active
摘要：取消 break 残留冲刷
全文：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/requirements.md#FR-02
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-spawn-flush-e2e-test:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「取消（AbortSignal）break → 残留缓冲收尾冲刷转发 + status=cancelled」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-spawn-flush-e2e-test
  status: active

## FR-task-runner-018 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout
变更：2026-10-13-spawn-flush-e2e-test
状态：active
摘要：看门狗超时残留冲刷
全文：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/requirements.md#FR-03
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-spawn-flush-e2e-test:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「超时（看门狗）break → 残留缓冲收尾冲刷转发 + status=timeout」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-spawn-flush-e2e-test
  status: active

## FR-task-runner-019 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed
变更：2026-10-13-spawn-flush-e2e-test
状态：active
摘要：正常关闭残留冲刷
全文：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/requirements.md#FR-04
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-spawn-flush-e2e-test:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts「正常流关闭 → 残留缓冲收尾冲刷转发 + status=completed」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-spawn-flush-e2e-test
  status: active

## FR-task-runner-020 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量
变更：2026-10-13-spawn-flush-e2e-test
状态：active
摘要：定向验收
全文：.sillyspec/changes/archive/2026-10-13-spawn-flush-e2e-test/requirements.md#FR-05
最近确认：771c8ad8e9e4a1dcbc16ce27c64700ae0865c4b5
