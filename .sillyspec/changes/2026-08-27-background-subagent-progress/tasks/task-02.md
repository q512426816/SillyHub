---
id: task-02
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P0
title: daemon 事件载荷契约（types/hub-client/cli 扩展）
title_zh: daemon 事件载荷契约（types/hub-client/cli 扩展）
depends_on: []
blocks: [task-03]
allowed_paths:
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/cli.ts
provides:
  - contract: sse_payload_contract
    fields: [status(running|completed|failed|stopped), task_id, task_name, tool_use_id, summary, last_tool_name, elapsed_ms, total_tokens, tool_uses, async]
expects_from: []
goal: |
  扩展 daemon 侧 agent_task_status 事件载荷类型与上报通道，为 task-03 的拦截实现冻结契约（FR-01/04 前半）。
implementation: |
  1. types.ts：SessionEventForBackend 的 agent_task_status 分支（:104 起）扩展字段——status 四值、tool_use_id、summary、last_tool_name、elapsed_ms、total_tokens、tool_uses、async（可选，缺省语义=前台）；保持既有 task_id/task_name 兼容。
  2. hub-client.ts：NotifyAgentTaskStatusBody（:141）同步扩展同名字段（snake_case 对齐 backend DTO）；notifyAgentTaskStatus（:1018）透传。
  3. cli.ts：:718 case 'agent_task_status' 分支把新字段并入上报 body。
  4. tsc 通过（sillyhub-daemon pnpm exec tsc --noEmit）。
acceptance: |
  三个文件扩展后 tsc 零错误；旧字段（task_id/task_name/status=running）不受影响；新字段全部 optional（向后兼容旧 daemon 行为由 backend 侧兜底）。
verify: |
  cd sillyhub-daemon && pnpm exec tsc --noEmit；grep 确认三处字段集合一致（types.ts / NotifyAgentTaskStatusBody / cli.ts case）。
constraints: |
  ESM import 带 .js 后缀（knowledge：daemon ESM 铁律）；async 是合法 TS 字段名不需 alias（alias 仅 backend Python 侧问题）；不实现拦截逻辑（那是 task-03）。
---
