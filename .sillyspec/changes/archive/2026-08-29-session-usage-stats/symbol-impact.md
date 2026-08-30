---
author: qinyi
created_at: 2026-08-29 14:05:12
---
# 符号影响面报告（Symbol Impact）— 会话内 Token 用量统计展示

| task | 结论 |
|---|---|
| task-01 | 新增签名（非修改）：`SessionUsageModelItemRead` / `SessionUsageRead`（schema.py 新 DTO）+ `SessionService.get_session_usage(session_id: uuid.UUID, user_id: uuid.UUID) -> SessionUsageRead`（session/service.py 新方法）。无既有调用点受影响；消费方 task-02（在任务范围内）。不改任何既有方法签名。 |
| task-02 | 新增签名（非修改）：router.py 新增端点处理函数 `get_session_usage_endpoint`（GET /sessions/{session_id}/usage，response_model=SessionUsageRead）。后端 router task 按契约附 endpoints.json。无既有路由/签名修改。 |
| task-03 | 新增签名（非修改）：`lib/daemon.ts` 新增 `getSessionUsage(sessionId: string): Promise<SessionUsageRead>` + 手写过渡类型 `SessionUsageRead` / `SessionUsageModelItem`（与 task-01 DTO 同构，注释锚定）；新组件 `SessionUsageBar`（props `{ sessionId: string; refreshSignal?: number }`）。无既有导出修改。 |
| task-04 | 无签名级变更：session-panel.tsx 仅内部接线（新增局部 state usageRefresh + 两处渲染点挂载 + 既有轮次终态处理点内递增），不改组件导出 props/签名。 |
| task-05 | 无签名级变更：三端 gen:types 生成物重生成（api-types.ts / openapi.json / daemon api-types.ts），无源码签名改动。 |
