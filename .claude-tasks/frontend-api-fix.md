# 前后端 API 对接修复任务

## 背景
后端重构后，组件(components)概念已统一为workspace子项（子workspace=组件）。
前端的 `src/lib/components.ts` 仍调用已删除的旧API端点，导致workspace详情页组件数显示0。

## 修复清单

### P0 — 必须修复（影响当前页面功能）

#### 1. 重写 `src/lib/components.ts`
整个文件标记了 `@deprecated`，需要全面更新：

- **`listComponents(workspaceId)`**: 
  - 旧：`GET /api/workspaces/${workspaceId}/components` → 404
  - 改：调用 `listWorkspaces()` 并在结果中过滤 `parent_id === workspaceId` 的子workspace
  - 或者更好的方案：在 `src/lib/workspaces.ts` 里新增 `listWorkspaceChildren(workspaceId)` 调 `GET /api/workspaces?parent_id={workspaceId}`（如果后端支持的话，检查下）
  - 返回类型需要映射：子workspace → Component 兼容类型

- **`getComponent(workspaceId, componentId)`**:
  - 旧：`GET /api/workspaces/${workspaceId}/components/${componentId}` → 404
  - 改：调 `GET /api/workspaces/${componentId}` 直接获取（因为组件就是workspace）

- **`reparseComponents(workspaceId)`**:
  - 旧：`POST /api/workspaces/${workspaceId}/components/reparse` → 404
  - 改：调 `POST /api/workspaces/${workspaceId}/rescan`
  - 返回的 `ScanResponse` 需要映射为 `ReparseResponse` 类型（或更新类型定义）

- **`getTopology(workspaceId)`**:
  - 旧：`GET /api/workspaces/${workspaceId}/components/topology` → 404
  - 改：调 `GET /api/workspaces/topology`（全局拓扑，后端没有按workspace过滤的拓扑端点）

#### 2. 修复 workspace 详情页 `src/app/(dashboard)/workspaces/[id]/page.tsx`
- 第50行 `const [componentCount, setComponentCount] = useState<number>(0);`
- 当前用 `listComponents` 获取组件数 → 改为调新API
- 统计数显示：找到该workspace的子workspace数量

#### 3. 修复 create-change 页面 `src/app/(dashboard)/workspaces/[id]/create-change/page.tsx`
- 第10行引入 `listComponents` 
- 第28-29行组件选择器
- 改为调新API获取子workspace列表作为"受影响组件"

### P1 — 数据一致性

#### 4. 修复 `src/lib/workspaces.ts` 的 `deleteRelation()`
- 当前：`DELETE /api/workspaces/relations/${relationId}` → 404
- 后端实际：`DELETE /api/workspaces/${workspaceId}/relations/${relationId}`
- 需要加上 workspaceId 参数

## 后端现有API参考

### Workspace 相关端点（全部在 /api/workspaces 下）
```
POST   /api/workspaces/scan                          # 扫描创建workspace
POST   /api/workspaces                                # 创建workspace
GET    /api/workspaces                                # 列出所有workspace
GET    /api/workspaces/topology                       # 全局拓扑
GET    /api/workspaces/{workspace_id}                 # 获取单个workspace
GET    /api/workspaces/{workspace_id}/relations       # 获取关系列表
POST   /api/workspaces/{workspace_id}/relations       # 创建关系
DELETE /api/workspaces/{workspace_id}/relations/{id}  # 删除关系
POST   /api/workspaces/{workspace_id}/rescan          # 重新扫描
DELETE /api/workspaces/{workspace_id}                 # 删除workspace
PATCH  /api/workspaces/{workspace_id}                 # 更新workspace
```

### Workspace 数据模型（WorkspaceRead）
```json
{
  "id": "uuid",
  "name": "string",
  "slug": "string",
  "root_path": "string",
  "status": "active",
  "component_key": "string|null",     // 组件标识
  "type": "string|null",              // 组件类型
  "role": "string|null",              // 组件角色
  "repo_url": "string|null",
  "default_branch": "string",
  "tech_stack": ["string"],
  "build_command": "string|null",
  "test_command": "string|null",
  "source_yaml_path": "string|null",
  "created_at": "datetime",
  "updated_at": "datetime",
  "last_scanned_at": "datetime|null"
}
```

### 关键理解
- 后端没有 `parent_id` 字段在 WorkspaceRead 里返回
- 子workspace（组件）是独立workspace，通过 `component_key` 标识
- 关系通过 `/relations` 端点管理
- `GET /api/workspaces` 返回所有workspace（包括父和子），通过 `component_key` 区分：有值的是组件/子workspace，null的是父workspace

## 实现建议

### 方案A（推荐）：前端适配
1. `listComponents(workspaceId)` → 调 `GET /api/workspaces`，然后过滤 `component_key !== null` 的作为组件列表
2. 如果需要按workspace过滤组件：看 `GET /api/workspaces` 是否支持 query参数。如果不支持，就前端过滤

### 方案B：后端加端点
1. 后端加 `GET /api/workspaces/{workspace_id}/components` 返回子workspace列表
2. 前端直接调

**优先用方案A**，除非过滤逻辑太复杂。

## 验证标准
1. workspace详情页组件数正确显示（应该显示3：backend, frontend, multi-agent-platform）
2. create-change页面的组件选择器能正常列出和选择组件
3. topology页面能正常加载
4. rescan功能正常工作
5. `npm run build` 无类型错误
6. 前端4个测试继续通过
