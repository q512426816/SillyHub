---
id: task-03
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P0
title: session-manager 综合改造（任务表 + task_* 拦截 + 回执兜底 + [TASK_*] 行 + 节流）
title_zh: session-manager 综合改造（任务表 + task_* 拦截 + 回执兜底 + [TASK_*] 行 + 节流）
depends_on: [task-01, task-02]
blocks: [task-04, task-11]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
provides:
  - contract: task_log_line_format
    fields: ["[TASK_STARTED] {task_id,tool_use_id,task_name,subagent_type,async}", "[TASK_PROGRESS] {task_id,elapsed_ms,total_tokens,tool_uses,last_tool_name,summary}（≥2000ms 节流合并）", "[TASK_NOTIFICATION] {task_id,status,elapsed_ms,summary}（不节流）"]
expects_from:
  - task: task-02
    contract: sse_payload_contract
    fields: [status 四值, tool_use_id, summary, last_tool_name, elapsed_ms, total_tokens, tool_uses, async]
goal: |
  daemon 核心：消费 SDK task_* 生命周期消息并双写（SSE 事件 + [TASK_*] 持久日志行），异步启动回执解析兜底，消灭假完成（FR-01/02/03）。
implementation: |
  1. SessionState 加 backgroundTasks: Map<task_id, {toolUseId?, taskName, subagentType?, async, startedAt, lastProgressAt}>（快照持久化对齐现有 snapshotPersistable 惯例，重启恢复可选）。
  2. _onMessage 新增 system 拦截分支（thinking_tokens 路由 :4251-4257 旁，在其 return 之前）：subtype=task_started → 注册 + _emitSessionEvent(agent_task_status running) + 落 [TASK_STARTED] 行；task_progress → 更新 + emit（含 last_tool_name/summary/elapsed_ms/total_tokens/tool_uses）+ 节流落 [TASK_PROGRESS] 行；task_notification → emit 终态 + 落 [TASK_NOTIFICATION] 行 + 注销；task_updated → 仅 status/is_backgrounded 变化 emit 轻量事件不落行。
  3. user tool_result 分支（bash 追踪 :4295 旁）：result 文本含 "Async agent launched successfully" 时正则 /agentId:\s*([0-9a-f]+)/ 提取 → 以 tool_use_id 注册（task_id=agentId, async=true）→ emit running(async=true) + 落 [TASK_STARTED] 行。
  4. [TASK_*] 行经 onTurnMessage 落库（flat {event_type:'text', content:'[TASK_*] {json}'} 带 parent_tool_use_id=tool_use_id，对齐 _flushPartial 先例），[TASK_PROGRESS] 同 task 节流 ≥2000ms（参数以 task-01 spike 结论为准）。
  5. system/task_* 消息拦截后不走路由尾部默认 onTurnMessage 透传（避免 backend _extract_sdk_messages 静默丢弃造成无痕迹）。
acceptance: |
  后台 Agent 会话：派发时 emit running(async) + [TASK_STARTED]；task_progress 到达时 emit 进度 + 节流行；终态到达时 emit completed/failed/stopped + [TASK_NOTIFICATION] + 任务表注销；CLI 不发 task_* 时回执兜底路径注册成功且前端不再收到"仅一次 running 后永远沉默"外的假信号。
verify: |
  单测在 task-04；本任务跑 pnpm exec tsc --noEmit + 本地手测一轮后台 Agent 会话看 daemon 控制台事件序列。
constraints: |
  spike（task-01）结论为"不发 task_*"时回执兜底为 primary，[TASK_PROGRESS]/终态行为退化为会话 end 收敛（design §9 R-01 降级口径）；不动 partial/bash 既有分支结构（R-02）；行 JSON 键名 task_name 统一（不用 name）。
---
