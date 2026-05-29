---
author: qinyi
created_at: 2026-05-29T22:20:00+08:00
id: task-10
title: 前端迁移 — workspaces API client + components 页面 + topology 页面
priority: P0
estimated_hours: 3
depends_on: [task-02, task-09]
blocks: [task-08]
allowed_paths:
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/components.ts
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx
  - frontend/src/components/workspace-card.tsx
  - frontend/src/components/component-detail-drawer.tsx
---

# task-10: 前端迁移 — workspaces API client + components 页面 + topology 页面

## 背景

后端已删除 `component/` 模块和旧 API 端点：
- `GET /api/workspaces/:id/components` → 已删除
- `GET /api/workspaces/:id/components/:componentId` → 已删除
- `POST /api/workspaces/:id/components/reparse` → 已删除
- `GET /api/workspaces/:id/components/topology` → 已删除

新后端 API：
- `GET /api/workspaces/{workspace_id}/relations` → 查询入边和出边
- `POST /api/workspaces/{workspace_id}/relations` → 创建关系
- `DELETE /api/workspaces/relations/{relation_id}` → 删除关系
- `GET /api/workspaces/topology` → 全局拓扑图
- `POST /api/workspaces/{workspace_id}/rescan` → reparse

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend/src/lib/workspaces.ts` | 修改 | 更新 Workspace 类型（去掉 sillyspec_path，加元数据字段），新增 relations/topology API 函数 |
| `frontend/src/lib/components.ts` | 删除 | 旧 API 客户端不再需要，功能合并到 workspaces.ts |
| `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx` | 修改 | 从旧 components API 迁移到 workspace relations API |
| `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx` | 修改 | 从旧 topology API 迁移到全局 topology API |
| `frontend/src/components/workspace-card.tsx` | 修改 | 更新链接和显示字段 |
| `frontend/src/components/component-detail-drawer.tsx` | 修改 | 适配 Workspace 模型（替代旧 Component 类型） |

## 实现要求

### 1. workspaces.ts 更新

```typescript
// Workspace 类型更新
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  status: "active" | "archived" | "deleted";
  // 新增元数据字段
  component_key: string | null;
  type: string | null;
  role: string | null;
  repo_url: string | null;
  default_branch: string | null;
  tech_stack: string[];
  build_command: string | null;
  test_command: string | null;
  source_yaml_path: string | null;
  // 保留原有字段
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_scanned_at: string | null;
  deleted_at: string | null;
}

// 新增类型
export interface WorkspaceRelation {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
  created_at: string;
}

export interface TopologyNode {
  id: string;
  name: string;
  slug: string;
  component_key: string | null;
  type: string | null;
}

export interface TopologyEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  description: string | null;
}

export interface TopologyResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// 新增 API 函数
export async function getWorkspaceRelations(workspaceId: string): Promise<{ outgoing: WorkspaceRelation[]; incoming: WorkspaceRelation[] }>
export async function createRelation(workspaceId: string, data: { target_id: string; relation_type: string; description?: string }): Promise<WorkspaceRelation>
export async function deleteRelation(relationId: string): Promise<void>
export async function getTopology(): Promise<TopologyResponse>
```

### 2. components/page.tsx 迁移

- 将 `import { getComponents, ... } from '@/lib/components'` 改为 `import { getWorkspaceRelations, ... } from '@/lib/workspaces'`
- 组件列表改为关系列表（outgoing + incoming）
- reparse 改为调用 `rescanWorkspace(id)`
- 保持表格/卡片切换、搜索、detail drawer 的交互不变
- 数据展示从 "Component" 语义改为 "Workspace Relation" 语义

### 3. topology/page.tsx 迁移

- 将 `import { getTopology } from '@/lib/components'` 改为 `import { getTopology } from '@/lib/workspaces'`
- 全局拓扑 API 不需要 workspace_id 参数
- 更新节点颜色映射（使用 Workspace.type 字段）
- 保持 React Flow 渲染和交互不变

### 4. workspace-card.tsx 更新

- 链接从 `/workspaces/${workspace.id}/components` 改为 `/workspaces/${workspace.id}`（或保留但改语义为"关系"）
- 显示 tech_stack 标签（如果非空）

### 5. component-detail-drawer.tsx 更新

- 类型从旧 `Component` 改为 `Workspace`
- 字段映射更新

### 6. components.ts 处理

- 删除文件，所有功能已合并到 workspaces.ts
- 更新所有 import 引用

## 边界处理

- Workspace 接口中 sillyspec_path 字段移除后，确保没有代码引用它
- topology API 现在是全局的（不带 workspace_id），页面布局可能需要调整
- 旧 components.ts 删除后，确保没有其他文件 import 它
- rescan 的返回格式与旧 reparse 不同（ScanResponse vs component list），需要适配

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | workspaces.ts Workspace 类型包含元数据字段 | TypeScript 编译通过 |
| AC-02 | workspaces.ts 新增 relations/topology API 函数 | 函数签名正确 |
| AC-03 | components/page.tsx 不再 import components.ts | grep 确认无旧 import |
| AC-04 | components/page.tsx 正确调用 relations API | 页面可渲染关系列表 |
| AC-05 | topology/page.tsx 调用全局 topology API | 页面可渲染拓扑图 |
| AC-06 | workspace-card.tsx 无 sillyspec_path 引用 | grep 确认 |
| AC-07 | components.ts 已删除 | 文件不存在 |
| AC-08 | 无 dangling import（旧 components.ts） | 全局 grep 确认 |
| AC-09 | TypeScript 编译通过 | `npx tsc --noEmit` 无错误 |
