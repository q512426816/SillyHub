---
author: qinyi
created_at: 2026-07-04T19:05:30
---

# Requirements — 修复前端类型对齐 5 处分叉

## 角色
| 角色 | 描述 |
|---|---|
| 前端用户 | 访问 scan-docs / runtime / audit / workspaces 页面，期望看到真实数据 |
| 前端开发者 | 期望 TS 类型与后端契约一致，5 模块走 OpenAPI 生成类型 |
| 后端 API | 响应字段与 OpenAPI schema 一致，response_model 显式声明 |

## 功能需求

### FR-001 scan-docs 补字段（覆盖 D-001@v1）
**Given** workspace 有扫描文档，部分 path 存在冲突历史
**When** `GET /api/workspaces/{id}/scan-docs`
**Then** 响应 items 每项含 `source_member_id/source_synced_at/source_mtime/content_hash/conflict_count`；`conflict_count` = 该 path 在 `scan_doc_conflict_history` 的记录数；列表查询不 N+1（一次 group by）

### FR-002 scan-docs conflicts 端点（覆盖 D-001@v1）
**Given** 某文档存在冲突历史
**When** `GET /api/workspaces/{id}/scan-docs/{doc_id}/conflicts`
**Then** 返回 `list[ScanDocConflictRead]`（按 `created_at` desc），含 `id/old_content/old_source_member_id/old_source_runtime_id/old_mtime/new_source_member_id/new_mtime/created_at`；权限 `SCAN_DOCS_READ`

### FR-003 runtime OpenAPI 与运行时一致（覆盖 D-002@v1）
**Given** workspace 有 sillyspec.db runtime progress
**When** `GET /api/workspaces/{id}/runtime`
**Then** 响应字段为 snake_case（`current_stage/current_change/last_active/version`）；OpenAPI schema 同名字段；`service._read_sqlite_progress` 构造参数同步改 snake_case

### FR-004 audit details_json 类型对齐（覆盖 D-003@v1）
**Given** audit 端点返回 `details_json`（JSON 字符串）
**When** 前端 audit page 展示/搜索
**Then** 前端类型为 `string | null`；page.tsx 先 `JSON.parse` 再判断（兼容 null / 非法 JSON 兜底，不抛错）

### FR-005 workspace-binding response_model（覆盖 D-004@v1）
**Given** 三端点 my-binding GET/PUT、members/bindings
**When** 任一端点调用
**Then** OpenAPI schema 含 `MemberBindingView`；`daemon_not_owned` 时返 403（全局处理器统一 body 格式）；router 删除 try/except + dict 返回

### FR-006 workspaces 类型迁移（覆盖 D-005@v1）
**Given** workspaces.ts 9 个手写类型
**When** 迁移到 `components["schemas"][...]`
**Then** `WorkspaceStatus` 含 `"pending"`；类型名对齐（`Workspace→WorkspaceRead`、`WorkspaceStructure→WorkspaceStructureDTO`、`ScanResult→ScanResponse`、`OwnerRead→app__modules__workspace__schema__OwnerRead`）；字段访问零改动

### FR-007 scan-docs 前端迁移（覆盖 D-001@v1）
**Given** scan-docs.ts 手写类型 + page.tsx 徽章
**When** 迁移到生成类型
**Then** 徽章显示真实数据（来源成员/冲突数）；`listDocConflicts` 调用真实 `/conflicts` 端点

## 非功能需求
- **NFR-001 性能**：scan-docs list 的 conflict_count 用一次 group by，禁止 N+1。
- **NFR-002 兼容**：runtime 删 alias 后运行时响应不变（本就 snake）；前端字段访问零改动。
- **NFR-003 回归**：现有 backend pytest + frontend vitest 全绿，无回归。
- **NFR-004 门禁**：`pnpm gen:types:check`、`pnpm typecheck`、`uv run mypy app`、`uv run ruff check` 全过。

## D-xxx@vN 覆盖关系
| 决策 | 覆盖 FR |
|---|---|
| D-001@v1 scan-docs 后端补字段+conflicts 端点 | FR-001 / FR-002 / FR-007 |
| D-002@v1 runtime 删 alias 改 snake_case | FR-003 |
| D-003@v1 audit details_json 前端改 string | FR-004 |
| D-004@v1 workspace-binding 三端点加 response_model | FR-005 |
| D-005@v1 workspaces 机械迁移+枚举补 pending | FR-006 |
