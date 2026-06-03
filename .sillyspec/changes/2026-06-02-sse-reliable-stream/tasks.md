---
author: qinyi
created_at: 2026-06-02T16:00:00
---

# Tasks

- [ ] 后端：`backend/app/modules/agent/service.py` — `stream_run_logs` 增加 `after` 参数过滤 DB replay
- [ ] 后端：`backend/app/modules/agent/router.py` — `/stream` 端点接收 `after` 查询参数并透传
- [ ] 后端：SSE 事件序列化增加 `log_id` 字段
- [ ] 前端：新增 `frontend/src/lib/agent-stream.ts` — `AgentRunStreamClient` 类
- [ ] 前端：更新 `frontend/src/lib/agent.ts` — `StreamLogEvent` 类型增加 `log_id`
- [ ] 前端：更新 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` — 替换手动 EventSource 为 `AgentRunStreamClient`
- [ ] 测试：后端 `after` 参数过滤和 `log_id` 字段单测
- [ ] 测试：前端 `AgentRunStreamClient` 重连/去重/状态单元测试
- [ ] 文档：同步 `.sillyspec/docs/backend/modules/agent.md`
- [ ] 文档：同步 `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`
