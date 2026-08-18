---
schema_version: 1
doc_type: module-card
module_id: lib-use-agent-run-stream
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体运行流 hook（lib-use-agent-run-stream）

## 定位

`AgentRunStreamClient`（lib-agent-stream）的 React 封装 hook：统一收口 agent run
的 SSE 订阅、日志追加、权限审批卡片、pending_input 用户输入控件与 gate 实时态。
替代各页面内联的 `connectBootstrapStream` 逻辑，是 daemon 面板与 agent 页消费
实时运行数据的标准入口。设计依据：
`.sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/design.md` §7.1。

## 契约摘要

- `useAgentRunStream(workspaceId, runId, { isActive, onDone? })`：
  - `runId=null` → 不连接，保留上次 logs（无 enabled 选项，runId 即开关）。
  - `isActive=false` → 只 prefetch 历史（`getAgentRunLogs`），不建 EventSource（D-001）。
  - `isActive=true` → `client.connect(accessToken)`，底层先 prefetch 再建 SSE。
- 返回 `{ logs; status; streaming; loading; error; perms; gateStatus;
  dismissPerm; input; clear }`；`input` 为 `AgentRunInputStream`
  `{ values; submitting; errors; replied; set; submit }`。
- `onDone(status)` 在 done 事件触发，随后 hook 主动 disconnect。

## 关键逻辑

```
effect: runId guard → token guard（缺失 setError 不连）
  → new AgentRunStreamClient → 注册 5 回调
  → FR-07: getAgentRun → agent_session_id → fetchPendingDialogs 恢复未答 dialog
  → isActive ? connect : 仅 getAgentRunLogs
cleanup: cancelled=true + disconnect（cancelled flag 防卸载后写 state）
```

## 注意事项

- **done 事件 status 白名单**（pending/running/completed/failed/killed）过滤后端
  脏值再入库（P3.2）；done 时显式 `setStreaming(false)`，不依赖 disconnect 链路。
- `dismissPerm` 仅本地移除 perms；审批决策 API 由权限卡片自调（D-003），
  `permission_resolved` SSE 事件与卡片 onResolved 双路收敛到同一 dismiss。
- dialog 恢复用的是 `agent_session_id`（AgentSession 表 id），**不是** daemon 内部
  session_id——查错表恢复不出卡片；且无论 isActive 与否都执行（askuser pending 的
  run 可能 isActive=false，走 REST 不依赖 SSE）。
- 实时 log 带子代理归属透传（parent_tool_use_id/subagent_type/depth，历史与主
  agent 为 null），viewer 据此渲染徽标+缩进。
- `input` 用 useMemo 稳定引用，避免 AgentRunPanel 每帧拿新对象失效 memo；
  切 runId 时调用方应手动 `clear()`。
- 消费方：components-daemon（RuntimeSessionDialog 等）+ workspace agent 页；
  单测 `lib/__tests__/use-agent-run-stream.test.ts`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
