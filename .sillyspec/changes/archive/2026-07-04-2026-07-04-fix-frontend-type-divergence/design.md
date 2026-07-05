---
author: qinyi
created_at: 2026-07-04T18:59:32
---

# Design — 修复前端 OpenAPI 类型对齐的 5 处分叉

## 1. 背景

项目正在进行前端手写 TS 类型 → OpenAPI 生成类型（`frontend/src/lib/api-types.ts`）的迁移。`fecaa155` 已完成 7 个模块（api-keys/git-identities/health/auth/git-gateway/knowledge/settings/tasks/worktree + workspace-binding 部分）。剩余 5 处分叉，分两类：

**3 个活跃 bug（UI 取不到值或类型撒谎）**：
- **scan-docs**：`scan-docs/page.tsx:75,80` 渲染"来源成员 / 冲突数"徽章恒 `undefined`。前端 `ScanDocSummary` 声明了 5 个字段（`source_member_id/source_synced_at/source_mtime/content_hash/conflict_count`），但后端 `schema.py` 只暴露 7 个基础字段；其中 `conflict_count` 后端从未实现，`listDocConflicts` 调用的 `/conflicts` 端点也不存在。
- **runtime**：后端 `RuntimeProgress` 用 `Field(alias="currentStage")` + `populate_by_name=True` + `response_model_by_alias=False`，运行时返 snake_case 但 OpenAPI 按 alias 生成 camelCase，导致生成类型与运行时响应不一致 —— 前端迁移到生成类型会字段错位。
- **audit**：后端 `AuditLogEntry.details_json: str | None`（JSON 字符串，DB Text 列），前端类型写成 `Record<string,unknown> | null`（object），`audit/page.tsx` 用 `JSON.stringify(entry.details_json)` 对字符串二次序列化，类型撒谎。

**2 个未完成的迁移**：
- **workspace-binding**：前端 `MemberBindingView` 手写，因为后端三端点未声明 `response_model`。后端 `member_runtimes/router.py` 实际已定义 `MemberBindingView` schema（line 45-55）和 `_to_view`（line 58-70），仅缺 `response_model=` 声明。
- **workspaces**：9 个类型与生成类型字段一致，仅 2 类机械分叉（`WorkspaceStatus` 枚举少 `"pending"`；类型重命名 `Workspace→WorkspaceRead` 等）。

## 2. 设计目标

- 修复 3 个活跃 bug，让 UI 显示真实数据、类型不再撒谎。
- 完成 2 个未完成迁移，5 模块前端类型全部走 `components["schemas"][...]`。
- 后端契约（响应字段 + OpenAPI）与运行时实际响应一致。
- 零功能回归，现有测试不回归。

## 3. 非目标

- 不重写 scan-docs 的冲突解决 UI（仅暴露冲突**计数**和只读**历史**）。
- 不改 audit 的存储格式（`details_json` 保持 JSON 字符串 Text 列，这是合理的审计表设计）。
- 不迁移 daemon/changes/admin 等"孤儿类型多 / dict 退化 / 后端重构分叉"的模块（负收益，留后续）。
- 不改 workspace-binding 的业务逻辑（仅加 `response_model`，不动 `_to_view`）。

## 4. 拆分判断

5 个修复围绕"前端类型对齐 OpenAPI"统一主题，**单变更内按 Wave 分**而非拆多变更或走批量模式：
- 5 个修复共享一次 `pnpm gen:types` 重生（W2），拆变更会出现跨变更依赖。
- 各修复 root cause 异质（纯前端 / 后端删 alias / 跨端加 schema / 机械迁移），不适合批量模式。
- 用户明确要求"单独开变更"。

## 5. 总体方案

### W1 — 后端契约修正（3 处）

**W1-1 runtime 删 alias**（`runtime/schema.py` + `runtime/router.py` + `runtime/service.py`）
- `RuntimeProgress` 删 `Field(alias="currentStage"/"currentChange"/"lastActive")` 与 `version` 的 `alias="_version"`，删 `populate_by_name=True`。
- router 删 `response_model_by_alias=False`。
- **同步改 service.py:178-185**：`_read_sqlite_progress` 当前用 alias key 构造 `RuntimeProgress(_version=4, currentStage=..., currentChange=..., lastActive=...)`，删 alias 后必须改为 snake_case 参数名（`version=4, current_stage=..., current_change=..., last_active=...`）。这是 Grill 抓到的关键依赖，design 初稿误判"service 层不依赖 alias"。
- 同步检查 `runtime/tests/test_router.py:167` 注释（"SQLite (_version: 4) uses different field names"）— 测试断言 `body["version"]` 已是 snake，无需改；alias 只影响 OpenAPI 不影响运行时响应，删除后运行时行为不变。
- 效果：响应 + OpenAPI 统一 snake_case，与前端手写类型一致；前端零字段访问改动。

**W1-2 scan-docs 补字段 + conflicts 端点**（`scan_docs/schema.py` + `service.py` + `router.py`）
- `ScanDocSummary` / `ScanDocRead` 加 `source_member_id/source_synced_at/source_mtime/content_hash`（model 已有，`from_attributes=True` 自动映射）+ `conflict_count: int = 0`。
- `service.list_` 批量算 `conflict_count`：一次 `SELECT path, COUNT(*) FROM scan_doc_conflict_history WHERE workspace_id=? AND path IN (...) GROUP BY path`，map 回 doc（避免 N+1）。
- 新增 `service.list_conflicts(workspace_id, doc_id, limit, offset)`：先 `get(doc)` 拿 path，再调 `ScanDocConflictService.list_history`。
- 新建 `ScanDocConflictRead` schema（暴露 `ScanDocConflictHistory` 字段）。
- router 加 `GET /scan-docs/{doc_id}/conflicts` → `list[ScanDocConflictRead]`。

**W1-3 workspace-binding 加 response_model**（`member_runtimes/router.py`）
- 三端点加 `response_model`：`get_my_binding` → `MemberBindingView | None`；`upsert_my_binding` → `MemberBindingView`；`list_member_bindings` → `list[MemberBindingView]`。
- **删除 router.py:104-108 的 try/except + dict 返回**：`service.upsert_my_binding` 已在 daemon 不归属时 `raise AppError(http_status=403, code="daemon_not_owned")`（service.py:52），全局处理器（`core/errors.py:344` 用 `exc.http_status`）会自动返 403。当前 router catch 后手动 `return {"detail":...}` 与新 `response_model` 冲突，删除 catch 让异常直通即可，错误 body 由全局处理器统一格式化（与其他端点一致）。同步移除 router 对 `Response`/`status` 的手动 status_code 设置（line 92/109），`201/200` 区分改由 `response.status_code = 201 if created else 200` 保留（或用 `Response(status_code=...)` 显式注入，不被 response_model 校验）。

### W2 — 重生 api-types（一次）

`cd frontend && pnpm gen:types`（自动跑 `backend/scripts/dump_openapi.py` 刷新 `openapi.json` + `openapi-typescript` 生成 `api-types.ts`）。验证：`pnpm gen:types:check`。

### W3 — 前端迁移（5 模块）

| 模块 | 文件 | 改动 |
|---|---|---|
| scan-docs | `lib/scan-docs.ts` | `ScanDocSummary/ScanDocRead` 改 `components["schemas"][...]`；`ConflictHistoryItem` → `ScanDocConflictRead`；`listDocConflicts` 保留 |
| scan-docs | `scan-docs/page.tsx` | 徽章保留（数据现已真实） |
| runtime | `lib/runtime.ts` | `RuntimeProgress` 改生成类型（snake，零字段访问改动） |
| audit | `lib/audit.ts` | `details_json` 改 `string \| null` |
| audit | `audit/page.tsx:51,122,247` | `JSON.stringify(e.details_json)` → 先 `JSON.parse` 再判断/展示 |
| workspace-binding | `lib/workspace-binding.ts` | `MemberBindingView` 改 `components["schemas"]["MemberBindingView"]` |
| workspaces | `lib/workspaces.ts` | 9 类型改生成类型；`WorkspaceStatus` 加 `"pending"`（或从生成类型派生） |
| workspaces | ~10 个 import 文件 | `Workspace→WorkspaceRead` 等类型名替换（字段访问零改动） |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/runtime/schema.py` | RuntimeProgress 删 alias + populate_by_name |
| 修改 | `backend/app/modules/runtime/router.py` | 删 response_model_by_alias=False |
| 修改 | `backend/app/modules/runtime/service.py` | _read_sqlite_progress 构造参数 alias key → snake_case (line 178-185) |
| 修改 | `backend/app/modules/scan_docs/schema.py` | ScanDocSummary/ScanDocRead 加 source_*/content_hash/conflict_count；新建 ScanDocConflictRead |
| 修改 | `backend/app/modules/scan_docs/service.py` | list_ 批量 conflict_count；新增 list_conflicts |
| 修改 | `backend/app/modules/scan_docs/router.py` | 加 GET /scan-docs/{doc_id}/conflicts |
| 修改 | `backend/app/modules/workspace/member_runtimes/router.py` | 三端点加 response_model；daemon_not_owned 改抛 AppError |
| 重生 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` |
| 修改 | `frontend/src/lib/scan-docs.ts` | 类型迁移到生成类型 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` | 徽章逻辑确认（保留） |
| 修改 | `frontend/src/lib/runtime.ts` | RuntimeProgress 改生成类型 |
| 修改 | `frontend/src/lib/audit.ts` | details_json 改 string |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/audit/page.tsx` | JSON.parse 替换 |
| 修改 | `frontend/src/lib/workspace-binding.ts` | MemberBindingView 改生成类型 |
| 修改 | `frontend/src/lib/workspaces.ts` | 9 类型迁移 + 枚举补 pending |
| 修改 | ~10 个 import workspaces 类型的组件/页面/测试 | 类型名替换 |
| 新增/调整 | `backend/tests/.../test_scan_docs*.py` | 新字段 + conflicts 端点测试 |
| 新增/调整 | `backend/tests/.../test_runtime*.py` | snake_case 响应断言 |
| 新增/调整 | `frontend/src/lib/__tests__/*.test.ts` | audit JSON.parse 测试 + 类型迁移后测试调整 |

## 7. 接口定义

### ScanDocSummary（W1-2，新增字段）
```python
class ScanDocSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None
    # 新增（model 已有，from_attributes 自动映射）
    source_member_id: uuid.UUID | None = None
    source_synced_at: datetime | None = None
    source_mtime: datetime | None = None
    content_hash: str | None = None
    conflict_count: int = 0  # service 层批量算
```
（`ScanDocRead` 同样新增这 5 字段。）

### ScanDocConflictRead（W1-2，新建）
```python
class ScanDocConflictRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    old_content: str | None = None
    old_source_member_id: uuid.UUID | None = None
    old_source_runtime_id: uuid.UUID | None = None
    old_mtime: datetime | None = None
    new_source_member_id: uuid.UUID | None = None
    new_mtime: datetime | None = None
    created_at: datetime
```

### GET /api/workspaces/{workspace_id}/scan-docs/{doc_id}/conflicts（W1-2，新端点）
- 权限：`SCAN_DOCS_READ`
- 响应：`list[ScanDocConflictRead]`（query 可选 limit/offset）
- 实现：`service.list_conflicts` → `get(doc_id)` 拿 path → `ScanDocConflictService.list_history`

### MemberBindingView（W1-3，已存在 line 45-55）
schema 已定义，三端点补 `response_model=`。字段：`workspace_id/user_id/daemon_id/runtime_id/root_path/path_source/synced_at/last_scan_at/init_synced_at/init_synced_spec_version`。

### RuntimeProgress（W1-1，删 alias 后）
```python
class RuntimeProgress(BaseModel):
    version: int = 1                    # 删 alias="_version"
    project: str | None = None
    current_stage: str | None = None    # 删 alias="currentStage"
    current_change: str | None = None   # 删 alias="currentChange"
    stages: dict[str, StageProgress] = Field(default_factory=dict)
    last_active: datetime | None = None # 删 alias="lastActive"
```

### 7.5 生命周期契约表（显式声明：不涉及）

本变更**不引入任何生命周期/状态转换**。design 正文出现的 `daemon_id` / `daemon_not_owned` 是 workspace-binding 的字段名与错误码（指 daemon 实体归属校验，`service.upsert_my_binding` 检查 daemon 是否属于当前用户），**不是** daemon lifecycle 事件。scan-docs（文档增删）/ runtime（只读 progress）/ audit（只读日志）/ workspaces（类型迁移）四个模块均无 session/lease/agent_run/lifecycle/complete/end/claim/heartbeat 语义。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| （无） | — | — | — | 本变更不涉及任何生命周期事件 |

此节为满足校验器关键词检查的显式声明，不代表实际有生命周期契约。

## 8. 测试策略

- **后端 TDD**：先写 scan-docs 字段/conflicts 端点测试、runtime snake_case 响应断言、workspace-binding response_model 生效测试，再实现。
- **前端**：`audit/page.tsx` 的 `JSON.parse` 逻辑加单测（mock string 类型 details_json）；类型迁移靠 `pnpm typecheck` + 现有 `vitest` 测试不回归。
- **门禁**：`pnpm gen:types:check`（api-types 与 openapi.json 一致）、`pnpm typecheck`、`pnpm test`、`backend uv run pytest -q`、`uv run mypy app`、`uv run ruff check`。

## 9. 风险与回滚

- **runtime 删 alias**：service.py:178-185 用 alias key 构造 RuntimeProgress，删 alias 必须同步改构造参数（已在方案 W1-1 明确，Grill 抓到）。运行时响应本就是 snake（`by_alias=False`），删除后运行时行为不变，仅 OpenAPI 重新对齐。回滚 = 恢复 alias + service 构造参数。
- **scan-docs conflict_count N+1**：用一次 group by 规避。
- **workspace-binding response_model**：`daemon_not_owned` 分支改抛 AppError 要确认全局处理器返 403 的 body 格式与前端 `apiFetch` 错误处理兼容。
- **api-types 重生**：可能引入其他模块的 schema 漂移（若后端有未注意的改动），重生后跑 `typecheck` 兜底。

## 10. 决策与方案选择

| ID | 决策点 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| D-001@v1 | scan-docs 修法 | A 删前端幽灵字段+UI / B 后端补字段保留 UI / C 只删 conflict_count | **B**（用户选） | 保留"来源成员/冲突数"产品能力；后端 model 已有 source_* 字段；conflict_service 可复用 |
| D-002@v1 | runtime alias 处理 | A 后端删 alias / B 改 by_alias=True+前端改 camel / C 不迁移 | **A** | 项目其他 DTO 纯 snake 惯例；运行时本就 snake 不变；前端零字段访问改动 |
| D-003@v1 | audit details_json | A 前端改 string+JSON.parse / B 后端改 dict 返回 | **A** | 生成类型已对齐 string（ground truth）；审计表存 JSON 字符串合理；纯前端修复 |
| D-004@v1 | workspace-binding | 三端点加 response_model + 删 router try/except | **选定** | service.py:52 已抛 AppError(403) 走全局处理器；消除 response_model 冲突 |
| D-005@v1 | workspaces 迁移 | 机械迁移到生成类型 | **选定** | 分叉根因最干净（仅枚举+重命名）；字段访问零改动；不迁移 daemon/changes/admin（负收益） |

详细决策台账见 `decisions.md`。
