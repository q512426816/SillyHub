---
id: task-08
title: 前端详情页增强 — 启动按钮 + Agent 执行状态 + 文档 Tab 增强
priority: P1
estimated_hours: 1.5
depends_on:
  - task-06
blocks:
  - task-09
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/lib/changes.ts
---

# task-08: 前端详情页增强

## 目标

在变更详情页增加以下能力：
1. "启动执行"按钮 — 调用 `executeChange()` 触发后端 Agent 调度
2. Agent 执行状态显示 — 展示当前 AgentRun 的 pending/running/completed/failed 状态
3. 文档 Tab 增强 — 确保 proposal.md / design.md / requirements.md / tasks.md 等文档可正常查看

## 操作步骤

### Step 1 — 增加执行相关 state

文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

在现有 state 声明区域增加：

```tsx
const [executing, setExecuting] = useState(false);
const [agentRunId, setAgentRunId] = useState<string | null>(null);
const [agentStatus, setAgentStatus] = useState<string | null>(null);
```

### Step 2 — 新增 import

确保导入 `executeChange` 和 `getAgentRun`：

```tsx
import { executeChange } from "@/lib/changes";
import { getAgentRun, type AgentRun } from "@/lib/agent";
```

### Step 3 — 实现 handleExecute 函数

在组件内增加启动执行的 handler：

```tsx
const handleExecute = async () => {
  if (!change) return;
  setExecuting(true);
  setPageError(null);
  try {
    const result = await executeChange(workspaceId, change.change_key);
    setAgentRunId(result.run_id);
    setAgentStatus("pending");
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "启动执行失败");
  } finally {
    setExecuting(false);
  }
};
```

### Step 4 — 增加 Agent 状态轮询

当 `agentRunId` 存在时，每 3 秒轮询 AgentRun 状态：

```tsx
useEffect(() => {
  if (!agentRunId) return;
  if (agentStatus === "completed" || agentStatus === "failed" || agentStatus === "killed") return;

  const timer = setInterval(async () => {
    try {
      const run = await getAgentRun(workspaceId, agentRunId);
      setAgentStatus(run.status);
      if (["completed", "failed", "killed"].includes(run.status)) {
        clearInterval(timer);
        // 刷新变更数据以获取最新的 stage
        const updated = await getChange(workspaceId, changeId);
        setChange(updated);
      }
    } catch {
      // 忽略轮询错误
    }
  }, 3000);

  return () => clearInterval(timer);
}, [agentRunId, agentStatus, workspaceId, changeId]);
```

### Step 5 — 在页面中渲染"启动执行"按钮

在现有的按钮区域（约第 334 行 `flex flex-wrap items-center gap-2` 的 div 内），增加：

```tsx
{/* 启动执行按钮 — 仅在 active 状态且有 change_key 时显示 */}
{change.status === "active" && change.current_stage === "created" && !agentRunId && (
  <Button
    size="sm"
    onClick={() => void handleExecute()}
    disabled={executing}
  >
    {executing ? "启动中…" : "🚀 启动执行"}
  </Button>
)}

{/* Agent 执行状态 */}
{agentStatus && (
  <div className="flex items-center gap-2 text-xs">
    <span className="text-muted-foreground">Agent:</span>
    <Badge
      variant={
        agentStatus === "completed" ? "success"
        : agentStatus === "failed" || agentStatus === "killed" ? "destructive"
        : agentStatus === "running" ? "warning"
        : "outline"
      }
    >
      {agentStatus === "pending" && "等待中"}
      {agentStatus === "running" && "执行中…"}
      {agentStatus === "completed" && "已完成 ✓"}
      {agentStatus === "failed" && "失败 ✗"}
      {agentStatus === "killed" && "已终止"}
    </Badge>
  </div>
)}
```

### Step 6 — 文档 Tab 增强

现有页面已实现了文档 Tab 查看（`DOC_TABS` 和 `handleDocSelect`）。确认以下增强：

1. 在 `DOC_TABS` 数组中增加 `"tasks"` 和 `"verification"` 选项（如果尚未包含）
2. 当 Agent 执行完成后，自动刷新文档矩阵以展示新生成的文档：

```tsx
// 在 agentStatus 变为 completed 时刷新文档矩阵
useEffect(() => {
  if (agentStatus === "completed" && agentRunId) {
    void getChangeDocuments(workspaceId, changeId).then(setMatrix).catch(() => {});
  }
}, [agentStatus, agentRunId, workspaceId, changeId]);
```

### Step 7 — 验证构建

```bash
cd /Users/qinyi/SillyHub/frontend
npm run build 2>&1 | tail -20
```

## 完成标准

- [ ] 变更详情页在 `status === "active" && current_stage === "created"` 时显示"启动执行"按钮
- [ ] 点击按钮调用 `executeChange()` API
- [ ] 按钮点击后显示 Agent 执行状态 Badge（等待中 → 执行中 → 已完成/失败）
- [ ] Agent 完成后自动刷新变更数据和文档矩阵
- [ ] 文档 Tab 能正确展示 proposal.md / design.md / requirements.md / tasks.md
- [ ] 不影响已有的状态转移按钮和审批功能
- [ ] `npm run build` 无错误

## 文件清单

| 文件 | 操作 |
|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 修改 — 增加执行按钮 + Agent 状态轮询 + 文档刷新 |
| `frontend/src/lib/changes.ts` | 可能微调 — 确保 executeChange 已在 task-04 中添加 |
