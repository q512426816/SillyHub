---
author: sillyspec-fr-index
created_at: 2026-10-12T11:08:58.569Z
---

# FR 索引 — components-agent-log

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/components-agent-log.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-components-agent-log-001 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径（等待回答豁免）；边界（已回答不豁免）；边界（pending_input 通道同享豁免）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-01
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_answer_skipped」 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_pending_input_channel_skipped」 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_user_answered_after_ask_still_killed」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-002 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-02
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-003 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径；边界（部分键仍解析）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-03
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-03
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts「buildErrorLogItem 无模型错误键的系统字典 → null（回落 buildSystemFailureItem）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-004 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-04
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-04
  tests: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「SERVICE_RESTART_INTERRUPTED → 「服务重启中断」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-005 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径；边界（成功路径零回归）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-05
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-05
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts「normalizeLogs errorCode + failureSummary → 末尾追加系统失败项（中文 message）」 | frontend/src/components/agent-log/__tests__/normalize.test.ts「normalizeLogs errorDetail 为系统字典（无模型错误键）→ 回落系统失败映射」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-006 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-06
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-06
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-007 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-07
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-07
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-008 回放（logsToTurns）与实时 SSE 两路径：[后台任务通知] 开头的 user_input 不再生成 preamble 段，进度视图无对应「上下文注入」卡
变更：2026-10-13-session-taskwakeup-hide
状态：active
摘要：回放路径；实时路径
全文：.sillyspec/changes/archive/2026-10-13-session-taskwakeup-hide/requirements.md#FR-01
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-taskwakeup-hide:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知注入不产出 preamble 段（进度视图无上下文注入卡）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-taskwakeup-hide
  status: active

## FR-components-agent-log-009 开轮占位槽语义不变：系统通知开轮的轮 prompt 保持空、中途真实消息仍转 user_msg 段按 ts 插入
变更：2026-10-13-session-taskwakeup-hide
状态：active
摘要：回归守卫
全文：.sillyspec/changes/archive/2026-10-13-session-taskwakeup-hide/requirements.md#FR-02
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-taskwakeup-hide:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知开轮 + 中途消息：prompt 保持空，消息转 user_msg 段按 ts 插入输出之间」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-taskwakeup-hide
  status: active

## FR-components-agent-log-010 消息队列条 TASK_WAKEUP 条目 chip 摘要与展开正文均不再显示「[后台任务通知]」前缀，仅显示通知正文
变更：2026-10-13-session-taskwakeup-hide
状态：active
摘要：chip 摘要与展开态
全文：.sillyspec/changes/archive/2026-10-13-session-taskwakeup-hide/requirements.md#FR-03
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-taskwakeup-hide:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「TASK_WAKEUP 条目 chip 摘要与展开正文不显示 [后台任务通知] 前缀」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-taskwakeup-hide
  status: active

## FR-components-agent-log-011 【变更上下文】等真实上下文前导的 preamble 卡与既有队列条行为不变
变更：2026-10-13-session-taskwakeup-hide
状态：active
摘要：真实前导不误伤
全文：.sillyspec/changes/archive/2026-10-13-session-taskwakeup-hide/requirements.md#FR-04
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-taskwakeup-hide:flow:测试绑定FR-04
  tests: test/frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「前导条 + 干净条双写（常规形态）→ 剩余正文与干净条同主体归并，prompt 不双显」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-taskwakeup-hide
  status: active

## FR-components-agent-log-012 相关单测更新/新增并跑通
变更：2026-10-13-session-taskwakeup-hide
状态：active
摘要：验收
全文：.sillyspec/changes/archive/2026-10-13-session-taskwakeup-hide/requirements.md#FR-05
最近确认：d3682fe53d3cdc5ef0cd710e03f3ecdb07461356

## FR-components-agent-log-013 normalize 数据链把 tool_result 行/事件的 edit_patch 配对写入对应 tool_call entry
变更：2026-10-13-agentlog-write-diff
状态：active
摘要：旧轨行列拾取；v2 轨事件字段拾取
场景正文：
- 场景：旧轨行列拾取 — Given tool_call JSON 行（带 tool_use_id）+ 后续 stdout [TOOL_RESULT] 行携带 edit_patch 列；When normalizeLogs 归一化；Then 结果行按 parent_tool_use_id（或邻近退化）合并进卡片，卡片 editPatch 等于该 JSON 串
- 场景：v2 轨事件字段拾取 — Given AgentEvent v2 的 tool_result 事件带 edit_patch 字段（行 edit_patch 列缺省）；When fromAgentEvent 按 call_id 配对工具卡；Then 卡片 editPatch 取事件字段值，mergedToolResult 照常回填
全文：.sillyspec/changes/archive/2026-10-13-agentlog-write-diff/requirements.md#FR-01
最近确认：e6cbde3e612c38d298b7c60ea5bcd22ff6b4a821

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agentlog-write-diff:flow:测试绑定FR-01
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts「2026-10-13-agentlog-write-diff: edit_patch 配对到工具卡」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agentlog-write-diff
  status: active

## FR-components-agent-log-014 agent-log 视图 Write 工具卡有 editPatch 时渲染红删绿增 DiffView，无 patch 保持现有全文预览
变更：2026-10-13-agentlog-write-diff
状态：active
摘要：覆盖写红删绿增；无 patch 零回归
场景正文：
- 场景：覆盖写红删绿增 — Given Write 工具卡配对了 structuredPatch JSON；When 渲染该卡片；Then 删除行红底、新增行绿底（真实文件行号），diff 区提供复制完整新文件内容按钮
- 场景：无 patch 零回归 — Given 无 editPatch（或非法 JSON）的 Write 工具卡；When 渲染该卡片；Then 保持既有「内容预览 (N 行)」全文 pre + 复制按钮，不出现变更对比区
全文：.sillyspec/changes/archive/2026-10-13-agentlog-write-diff/requirements.md#FR-02
最近确认：e6cbde3e612c38d298b7c60ea5bcd22ff6b4a821

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agentlog-write-diff:flow:测试绑定FR-02
  tests: frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx「WriteToolPreview diff 渲染（2026-10-13-agentlog-write-diff）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agentlog-write-diff
  status: active

## FR-components-agent-log-015 相关前端测试通过，不改动 Edit 预览与会话面板现有行为
变更：2026-10-13-agentlog-write-diff
状态：active
摘要：既有行为回归
场景正文：
- 场景：既有行为回归 — Given normalize / normalize-dual-path / tool-args-detail / turn-segment-views 既有套件；When 跑全部用例；Then 全绿——Edit 预览与会话面板用例零改动通过，`pnpm typecheck` 零错误
全文：.sillyspec/changes/archive/2026-10-13-agentlog-write-diff/requirements.md#FR-03
最近确认：e6cbde3e612c38d298b7c60ea5bcd22ff6b4a821

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agentlog-write-diff:flow:测试绑定FR-03
  tests: frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agentlog-write-diff
  status: active

## FR-components-agent-log-016 TaskOutput（block=true）运行中时，时间线该工具行显示人话摘要「等待后台任务：<任务名>」+ 每秒跳动的已等时长（mm:ss），任务名/最后活跃时间经任务快照（agent_session_task）对账获得，查不到时优雅回退不崩
变更：2026-10-13-turn-live-visibility
状态：active
摘要：快照命中显示任务名；快照未命中优雅回退；终态回归普通行
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-01
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-live-visibility:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「TaskOutput 等待行：任务名人话摘要与走秒/快照未命中回退/终态回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-live-visibility
  status: active

## FR-components-agent-log-017 后台任务派发段（含子代理容器段）的 running 任务元数据在任务快照为终态时收敛为终态徽标，治理 [TASK_*] 终态事件丢失导致的永久「后台运行中」残留
变更：2026-10-13-turn-live-visibility
状态：active
摘要：徽标与计数收敛；终态不回退
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-02
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-live-visibility:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts「subagentHeaderOf 单向收敛与终态不回退（徽标）」 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「deriveTurnActivity 快照终态收敛（计数/兜底/零回归/终态不回退）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-live-visibility
  status: active

## FR-components-agent-log-018 任务面板清单在轮完成对账点（schedulePostTurnReconcile）同步重拉任务快照，终态残留卡片收敛
变更：2026-10-13-turn-live-visibility
状态：active
摘要：轮边界卡片收敛
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-03
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

## FR-components-agent-log-019 daemon usage_update 估算推送从「累计 ≥20 token」改为「≥20 token 或距上次推送 ≥500ms」双门限，低速生成时 token 数字约每 0.5 秒一跳；真 usage 到达后 API call 进行中估算继续推送（仍被 message_delta 真值覆盖校正）
变更：2026-10-13-turn-live-visibility
状态：active
摘要：低速生成定时跳；真值覆盖校正
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-04
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-live-visibility:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/stream-json.test.ts「usage_update 双门限节流：时间门限兜底/零增量不推/真值覆盖后基线同步与超调回落校正」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-live-visibility
  status: active

## FR-components-agent-log-020 既有工具行/子代理块/任务卡片其余渲染与既有测试不回归
变更：2026-10-13-turn-live-visibility
状态：active
摘要：零回归守卫
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-05
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-live-visibility:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-live-visibility
  status: active

## FR-components-agent-log-021 相关单测新增/更新并跑通
变更：2026-10-13-turn-live-visibility
状态：active
摘要：新增用例绿
全文：.sillyspec/changes/archive/2026-10-13-turn-live-visibility/requirements.md#FR-06
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128
