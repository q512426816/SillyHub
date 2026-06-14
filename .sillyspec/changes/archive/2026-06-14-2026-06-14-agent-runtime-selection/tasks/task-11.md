---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-11
title: task 触发面板 — agent 下拉（默认联动 workspace.default_agent）
priority: P0
estimated_hours: 2
depends_on: [task-05, task-09]
blocks: [task-14]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx
  - frontend/src/lib/agent.ts
---

# task-11: task 触发面板 — agent 下拉（默认联动 workspace.default_agent）

## 上下文
task 触发面板（`tasks/[tid]/page.tsx`）的 `handleCreateAgentRun` 调 `createAgentRun`，已有 `daemonRuntimes` 加载 + `preferredBackend` radio。增一个 provider 下拉，默认值联动 `workspace.default_agent`。依赖 task-05（CreateAgentRunInput 增 provider）+ task-09（AgentProviderSelect）。

## 修改文件（必填）
- `frontend/src/lib/agent.ts` — `CreateAgentRunInput` 增 `provider?: string | null`
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx` — 加下拉 + 透传

## 实现要求
1. **`CreateAgentRunInput`**（agent.ts）：增 `provider?: string | null;`。
2. **页面 state**：
   ```typescript
   const [provider, setProvider] = useState<string | null>(
     workspace.default_agent ?? null,   // 默认联动 workspace.default_agent
   );
   ```
   注：page 已加载 workspace（读 repo_url 等），直接读 `workspace.default_agent`。
3. **JSX**：在现有 preferred_backend radio 附近加：
   ```tsx
   <AgentProviderSelect
     value={provider}
     onChange={setProvider}
     includeDefault   // "使用默认" → null
   />
   ```
4. **`handleCreateAgentRun`**：透传 provider：
   ```typescript
   const run = await createAgentRun({
     taskId: tid,
     leaseId,
     agentType,
     preferredBackend,
     provider,   // 新增
   });
   ```
5. 默认联动逻辑：组件初次加载 provider=workspace.default_agent；用户改下拉后用所选值；选"使用默认"则传 null（后端走 default_agent）。

## 接口定义（代码类任务必填）
```typescript
// agent.ts
export interface CreateAgentRunInput {
  taskId: string;
  leaseId: string;
  agentType: string;
  preferredBackend?: string;
  provider?: string | null;   // 新增
}

// page.tsx
const [provider, setProvider] = useState<string | null>(workspace.default_agent ?? null);
<AgentProviderSelect value={provider} onChange={setProvider} includeDefault />
// handleCreateAgentRun 透传 provider
```

## 边界处理（必填）
- **workspace.default_agent=null**：provider 初始 null，下拉显示"使用默认/未设置"，提交时传 null（后端 ORDER BY last_heartbeat）。
- **workspace.default_agent="claude"**：provider 初始 "claude"，下拉预选 claude。
- **用户改下拉**：用所选值，不再联动（标准受控行为）。
- **选"使用默认"**：provider=null → 提交 null。
- **页面重新加载**：用 workspace.default_agent 重新初始化（key 取决于 workspace 加载时机；若 props 变化需 useEffect 同步）。
- **保留既有 preferredBackend**：provider 下拉与 preferredBackend radio 并存，不互斥。

## 非目标（本任务不做的事）
- 不改后端 create_agent_run（task-05）。
- 不改 preferredBackend 逻辑。
- 不改 AgentProviderSelect（task-09）。

## 参考
- `handleCreateAgentRun`（tasks/[tid]/page.tsx）既有 preferredBackend 流程。
- `createAgentRun` / `CreateAgentRunInput`（agent.ts）。
- `workspace` 对象在页面已加载（读 repo_url）。

## TDD 步骤
1. typecheck：`cd frontend && pnpm typecheck`。
2. 手动验收：workspace.default_agent=claude → 打开 task 面板下拉预选 claude；改成 codex → 提交 → createAgentRun 收到 provider=codex；选"使用默认" → 提交 null。
3. `cd frontend && pnpm build` 通过。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | workspace.default_agent=claude | 下拉预选 claude（对照 FR-08） |
| AC-02 | 改下拉为 codex + 提交 | createAgentRun body 含 provider=codex |
| AC-03 | 选"使用默认" + 提交 | createAgentRun body provider=null |
| AC-04 | workspace.default_agent=null | 下拉默认"使用默认/未设置" |
| AC-05 | pnpm typecheck + build | 通过 |
