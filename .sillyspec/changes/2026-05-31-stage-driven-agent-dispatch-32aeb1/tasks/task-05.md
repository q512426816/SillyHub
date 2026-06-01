---
author: hermes
created_at: "2026-05-31T16:40:00Z"
---

# Task 05: 前端 — Agent 运行状态展示

## 目标

在 Change 详情页展示 Agent 运行状态和实时日志。

## 实现细节

### 5.1 Agent 状态 Badge

在 Change 详情页的阶段标签区域下方，添加 Agent 运行状态:
```
阶段: [clarifying]    Agent: 🟢 Running (启动于 2分钟前)
```

状态映射:
- idle — 不显示
- dispatched — 🟡 Dispatched
- running — 🟢 Running
- completed — ✅ Completed
- failed — ❌ Failed（显示重试按钮）

### 5.2 后端 API: 获取 Agent 状态

新增 endpoint（或在现有 change detail API 中嵌入）:
```python
@router.get("/changes/{change_id}/agent-status")
async def get_agent_status(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: CurrentUser,
) -> dict:
```

返回:
```json
{
  "has_agent": true,
  "status": "running",
  "agent_run_id": "uuid",
  "started_at": "2026-...",
  "stage": "clarifying"
}
```

### 5.3 前端 lib 更新

在 `frontend/src/lib/changes.ts` 中新增:
```typescript
export function getAgentStatus(workspaceId: string, changeId: string) {
  return apiFetch<AgentStatusResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/agent-status`
  );
}

export function manualDispatch(
  workspaceId: string,
  changeId: string,
  stage?: string,
) {
  return apiFetch<{ agent_run_id: string }>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/dispatch`,
    { method: "POST", json: { stage } },
  );
}
```

### 5.4 详情页集成

修改 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`:
- transition 成功后轮询 agent-status（3秒间隔）
- 显示 Agent 运行状态 badge
- Agent 完成后停止轮询，刷新 change 详情
- 失败时显示"重新派发"按钮

### 5.5 复用 EventSource（可选，P2）

已有 `frontend/src/lib/agent.ts` 的 `subscribeAgentRun()` 可以复用。当 agent_run_id 可用时，用 EventSource 订阅实时日志。可以做成可折叠的日志面板。

## 验证

- 点击 transition 后，前端显示 Agent 状态
- Agent 状态实时更新（轮询或 SSE）
- 失败时显示重试按钮
- 点击重试可重新派发 Agent
