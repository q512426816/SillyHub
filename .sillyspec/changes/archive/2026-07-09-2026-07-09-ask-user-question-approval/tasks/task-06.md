---
id: task-06
title: approvals/page.tsx 聚合扩 scan+chat + 查询兜底（刷新不丢）
title_zh: 审批中心聚合范围扩大与数据库兜底
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-05]
blocks: [task-09]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx
provides:
  fields: ["approvals aggregation scan+chat", "refetchInterval fallback"]
expects_from:
  task-05:
    needs: [listWorkspaceDialogs]
---

# task-06 · 审批中心聚合范围扩大与数据库兜底

## 目标

`approvals/page.tsx` 聚合范围从 `scan` 扩到 `scan + chat`（普通对话 session 也订阅 SSE），并新增
`listWorkspaceDialogs(wsId)` 查询作为 pending 兜底，保证刷新后卡片不丢（**FR-5**）。

依据：
- design §4.3（聚合范围扩大 + 数据兜底）+ §3.2 断点①（现仅聚合 scan）
- 现状源码 `approvals/page.tsx:102` `listWorkspaceAgentSessions(wsId, "scan")` filter + `:91`
  `scanSessions` state + `:178` `<SessionPermissionPanel sessionIds={scanSessions} />`

## 实现

1. **聚合范围**：`listWorkspaceAgentSessions(workspaceId, "scan")`（:102）去掉 `"scan"` mode 参数
   → 返回 workspace 下所有 active interactive session（含 chat）。`scanSessions` state 语义随之
   扩为「活跃会话集合」（变量名可留，注释更新；若 task-09 不依赖旧名则重命名 `activeSessionIds`）。
2. **查询兜底（FR-5）**：新增 React Query `useQuery` 调 task-05 提供的 `listWorkspaceDialogs(wsId)`：
   - `refetchInterval` ≈ 10s（周期刷新）+ 初始加载（`enabled` 跟随 workspaceId 就绪）；
   - 查询结果作为 `SessionPermissionPanel` 的 pending 兜底（与 SSE 实时增量合并）。
3. **两路合并去重**：按 `request_id` 合并 SSE 推入与查询结果；查询回填的来源字段
   （workspace_name/session_type/run_summary，task-05 DTO 齐全）覆盖 SSE 占位（SSE 路缺省，
   design §4.4 C4）。去重复用 `session-permission-panel.tsx:57` 现有逻辑。
4. **`SessionPermissionPanel` 接线**：把查询结果（`WorkspaceDialogRead[]` 或其 pending 子集）
   作为新 prop 传入面板（具体 prop 契约由 task-05/panel 实现侧定，本 task 在 page 侧组装数据）。

> 本 task 只改 `approvals/page.tsx`；panel 内部如何消费兜底数据 + 渲染分流属 task-09 范围。

## 验收标准

- scan + chat 两类 session 都被聚合订阅 SSE（AC-2 覆盖普通对话）；
- 刷新 `/approvals` 后未回答的 AskUserQuestion 卡片仍在，且 ≤10s 内来源字段回填（AC-4）；
- 查询兜底与 SSE 实时按 `request_id` 去重，查询回填覆盖 SSE 占位（design §4.4）。

## 验证

```bash
cd frontend && pnpm typecheck && pnpm test
```

## 约束

- **FR-5**：dialog 不超时永久等待（design §5.3），查询兜底是刷新不丢的依据；
- **React Query v5**：`refetchInterval` 谓词抽纯函数便于测试（memory 教训
  `react-query-migration-status`：v5 hook 测试 `refetchInterval` 谓词抽纯函数 + `console.error`
  静默坑）；
- **NFR-1 / R-1（SSE 连接数上限）**：聚合 scan+chat 后 workspace 下所有 active session 各开一个
  SSE，配合 task-10 给 `list_workspace_active_sessions` 加 `limit`（top 50 by 最近活跃）；
  本 task 不实现 limit（后端 task-10 负责），但前端注释标注依赖。
