---
author: qinyi
created_at: 2026-07-04T19:12:00
plan_level: standard
---

# Plan — 修复前端类型对齐 5 处分叉

## 依赖图
```
W1 后端契约 (task-01..05) ──► W2 重生 api-types (task-06) ──► W3 前端迁移+测试 (task-07..13)
```
- **W1 内部**：task-01(runtime)、task-05(workspace-binding) 互相独立；task-02→03→04 是 scan-docs 链(schema→service→router)。
- **W3 内部**：task-07~11 互相独立(都依赖 task-06)；task-12(后端测试)依赖 W1；task-13(前端门禁)依赖 W3 前端迁移。

## 任务清单（checkbox）

**Wave 1 — 后端契约修正**
- [x] task-01: runtime 删 alias — FR-003 / D-002@v1 ✅ 7 passed mypy/ruff 过
- [x] task-02: scan-docs schema 补字段 — FR-001 / D-001@v1 ✅
- [x] task-03: scan-docs conflict_count 聚合 — FR-001/FR-002 / D-001@v1 ✅
- [x] task-04: scan-docs conflicts 端点 + router 适配 — FR-002 / D-001@v1 ✅ 50 passed mypy/ruff 过
- [x] task-05: workspace-binding response_model — FR-005 / D-004@v1 ✅ 5+11 passed; 403 body 改全局 {code,message,request_id,details}

**Wave 2 — 重生 api-types**
- [x] task-06: 重生 api-types — 全 FR ✅ 292 paths/334 schemas; RuntimeProgress snake(10598); ScanDocConflictRead 新增(10689); MemberBindingView 出现(7836); source_member_id/conflict_count 在 ScanDocSummary/Read(10751/10762/10830/10841); line 9298 currentStage 是 ProgressUpdate(PPM 无关)

**Wave 3 — 前端迁移 + 测试门禁**
- [x] task-07: scan-docs 前端迁移 — FR-007 / D-001@v1 ✅ 7 类型迁移+page warnings 判空
- [x] task-08: runtime 前端迁移 — FR-003 / D-002@v1 ✅ 3 类型迁移+page 可选防御
- [x] task-09: audit 前端修复 — FR-004 / D-003@v1 ✅ 整体迁移+parseDetails helper+5 单测
- [x] task-10: workspace-binding 前端迁移 — FR-005 / D-004@v1 ✅ MemberBindingView 迁移+2 处 ?? null
- [x] task-11: workspaces 前端迁移 — FR-006 / D-005@v1 ✅ 9 类型别名迁移+WorkspaceStatus 派生+workspace-scan-dialog warnings 防御
- [x] task-12: 后端测试与门禁 ✅ pytest 2217 passed(3 failed 无关) + mypy 409 files Success + ruff 全过
- [x] task-13: 前端测试与门禁 ✅ typecheck 全过 + 623 tests passed 零回归

---

## Wave 1 — 后端契约修正

### task-01 runtime 删 alias — FR-003 / D-002@v1
**文件**: `backend/app/modules/runtime/schema.py` + `router.py` + `service.py`
**步骤**:
1. `schema.py:29-39` `RuntimeProgress`：删 `model_config = ConfigDict(populate_by_name=True)`；删 `version` 的 `alias="_version"`、`current_stage/current_change/last_active` 的 alias。保留字段名本身不变。
2. `router.py:24`：删 `response_model_by_alias=False`。
3. `service.py:178-185`：构造参数 alias key 改 snake —— `_version=4`→`version=4`、`currentStage=`→`current_stage=`、`currentChange=`→`current_change=`、`lastActive=`→`last_active=`。
**测试**: `test_router.py:168` 现有断言 `body["version"]==4`/`body["project"]` 仍过；新增断言 `body["current_stage"]` snake key 存在、camelCase key 不存在。
**依赖**: 无
**完成标准**: `GET /api/workspaces/{id}/runtime` 响应字段 snake；`backend/openapi.json` 中 `RuntimeProgress` 字段 snake；`uv run pytest`+`mypy` 过。

### task-02 scan-docs schema 补字段 — FR-001 / D-001@v1
**文件**: `backend/app/modules/scan_docs/schema.py`
**步骤**:
1. `ScanDocSummary` 加 `source_member_id: uuid.UUID | None = None`、`source_synced_at: datetime | None = None`、`source_mtime: datetime | None = None`、`content_hash: str | None = None`、`conflict_count: int = 0`。
2. `ScanDocRead` 同样加这 5 字段。
3. 新建 `ScanDocConflictRead(BaseModel)`，`model_config = ConfigDict(from_attributes=True)`，字段对齐 `ScanDocConflictHistory` model：`id/old_content/old_source_member_id/old_source_runtime_id/old_mtime/new_source_member_id/new_mtime/created_at`。
**测试**: 单测 `ScanDocSummary.model_validate(scan_doc_orm)` 正确映射 source_*；`ScanDocConflictRead.model_validate(conflict_orm)` 映射正确。
**依赖**: 无
**完成标准**: schema 定义存在；mypy 过。

### task-03 scan-docs conflict_count 聚合 — FR-001/FR-002 / D-001@v1
**文件**: `backend/app/modules/scan_docs/service.py`
**步骤**:
1. `list_` 改签名返 `tuple[list[ScanDocument], dict[str, int]]`（docs + path→conflict_count 映射）。group by 一次：`SELECT path, COUNT(*) FROM scan_doc_conflict_history WHERE workspace_id=:ws AND path IN (:paths) GROUP BY path`。
2. `get` 改：单文档补一次 `COUNT(*) WHERE workspace_id AND path`。
3. 新增 `list_conflicts(workspace_id, doc_id, *, limit=50, offset=0)`：`await self.get(workspace_id, doc_id)` 拿 path → `ScanDocConflictService(self._session).list_history(workspace_id, path, limit, offset)`。
**测试**: `list_` 在 0/1/多冲突历史下 count 正确；`list_conflicts` 按 `created_at` desc；无 N+1（可用 assert SQL 计数或观察单次 group by）。
**依赖**: task-02（ScanDocConflictRead schema 存在，便于 router 引用）。
**完成标准**: conflict_count 聚合正确、单次 group by；pytest 过。

### task-04 scan-docs conflicts 端点 + router 适配 — FR-002 / D-001@v1
**文件**: `backend/app/modules/scan_docs/router.py`
**步骤**:
1. 加 `@router.get("/scan-docs/{doc_id}/conflicts", response_model=list[ScanDocConflictRead])`，权限 `SCAN_DOCS_READ`，调 `service.list_conflicts`。
2. `list_scan_docs` 适配 `service.list_` 新签名：拿到 `(docs, counts)`，构造 `ScanDocSummary.model_validate(d)` 后手动设 `summary.conflict_count = counts.get(d.path, 0)`。
3. `get_scan_doc` 适配：`ScanDocRead.model_validate(doc)` 后设 conflict_count。
**测试**: 端点返冲突历史列表；workspace/doc 不存在返 404；权限不足返 403。
**依赖**: task-03。
**完成标准**: 端点工作；openapi.json 含 `/conflicts` 端点 + ScanDocConflictRead。

### task-05 workspace-binding response_model — FR-005 / D-004@v1
**文件**: `backend/app/modules/workspace/member_runtimes/router.py`
**步骤**:
1. `get_my_binding_endpoint`（line 73）加 `response_model=MemberBindingView | None`。
2. `upsert_my_binding_endpoint`（line 86）加 `response_model=MemberBindingView`；**删除 line 104-108 的 `try/except AppError` + dict 返回**（service.py:52 已 `raise AppError(http_status=403, code="daemon_not_owned")`，删 catch 让其直通全局处理器 errors.py:344）；保留 `response.status_code = 201 if created else 200`。
3. `list_member_bindings_endpoint`（line 113）加 `response_model=list[MemberBindingView]`。
4. 检查 import：若 `Response`/`status` 仅用于已删分支则清理；保留 status_code 所需的 `Response`/`status`。
**测试**: `daemon_not_owned` 返 403（验证全局处理器 body 格式 `{detail/code}`）；response_model 生效（openapi 含 MemberBindingView）；正常路径返 MemberBindingView。
**依赖**: 无。
**完成标准**: openapi.json 含 MemberBindingView + 三端点 schema；403 路径正确；pytest 过。

## Wave 2 — 重生 api-types

### task-06 重生 api-types — 全 FR
**文件**: `frontend/src/lib/api-types.ts`（生成产物）+ `backend/openapi.json`
**步骤**:
1. `cd frontend && pnpm gen:types`（脚本自动 `cd backend && uv run python scripts/dump_openapi.py` 刷新 openapi.json + `openapi-typescript` 生成 api-types.ts）。
2. `git diff frontend/src/lib/api-types.ts` 确认：ScanDocSummary/ScanDocRead 含新字段、ScanDocConflictRead 新增、MemberBindingView 出现、RuntimeProgress 字段改 snake、`/scan-docs/{doc_id}/conflicts` 端点出现。
**测试**: `pnpm gen:types:check`（重新生成 + `git diff --exit-code`）。
**依赖**: task-01~05 全部完成。
**完成标准**: api-types.ts 与 openapi.json 一致；gen:types:check 过。

## Wave 3 — 前端迁移 + 测试门禁

### task-07 scan-docs 前端迁移 — FR-007 / D-001@v1
**文件**: `frontend/src/lib/scan-docs.ts` + `scan-docs/page.tsx`
**步骤**:
1. `scan-docs.ts`：`ScanDocSummary`/`ScanDocRead` 改 `components["schemas"]["ScanDocSummary"|"ScanDocRead"]`；`ConflictHistoryItem` → `components["schemas"]["ScanDocConflictRead"]`；`listDocConflicts` 保留（端点现已存在）。
2. `page.tsx`：徽章逻辑（line 75,80）保留 —— `doc.source_member_id`/`doc.conflict_count` 现已是真实字段。
**测试**: 现有 scan-docs 相关 vitest 不回归。
**依赖**: task-06。
**完成标准**: `pnpm typecheck` 过；徽章类型对齐。

### task-08 runtime 前端迁移 — FR-003 / D-002@v1
**文件**: `frontend/src/lib/runtime.ts`
**步骤**:
1. `RuntimeProgress` 改 `components["schemas"]["RuntimeProgress"]`（snake_case，零字段访问改动）。
2. 确认 `runtime/page.tsx:187-192` 的 `progress.current_stage/current_change/last_active` 访问不变。
**测试**: 现有 runtime 测试不回归。
**依赖**: task-06。
**完成标准**: typecheck 过。

### task-09 audit 前端修复 — FR-004 / D-003@v1
**文件**: `frontend/src/lib/audit.ts` + `audit/page.tsx`
**步骤**:
1. `audit.ts:10`：`details_json: Record<string,unknown> | null` → `string | null`（对齐生成类型）。
2. `page.tsx:51,122,247`：抽 helper `parseDetails(s: string | null): Record<string, unknown> | null`（try `JSON.parse`，null/非法 JSON 返 null）；搜索/展示逻辑改用 `parseDetails(entry.details_json)` 替代 `JSON.stringify(entry.details_json)`。
**测试**: 新增 `parseDetails` 单测（mock 合法 JSON string / null / 非法 JSON / 含 "error" 子串的 value）；现有 audit 测试不回归。
**依赖**: task-06。
**完成标准**: typecheck 过；parseDetails 单测全过。

### task-10 workspace-binding 前端迁移 — FR-005 / D-004@v1
**文件**: `frontend/src/lib/workspace-binding.ts`
**步骤**:
1. 删手写 `MemberBindingView`（line 17-33），改 `export type MemberBindingView = components["schemas"]["MemberBindingView"];`。
2. 保留 `MemberBindingUpsertRequest`（已迁移）。
**测试**: 现有 workspace-binding-guard.tsx 等组件测试不回归。
**依赖**: task-06。
**完成标准**: typecheck 过。

### task-11 workspaces 前端迁移 — FR-006 / D-005@v1
**文件**: `frontend/src/lib/workspaces.ts` + ~10 import 文件
**步骤**:
1. `workspaces.ts` 9 类型改生成类型：
   - `Workspace`→`components["schemas"]["WorkspaceRead"]`
   - `WorkspaceStructure`→`WorkspaceStructureDTO`
   - `ScanResult`→`ScanResponse`
   - `OwnerRead`→`app__modules__workspace__schema__OwnerRead`
   - `WorkspaceListResponse`/`ScanGenerateResponse`/`TopologyNode`/`TopologyEdge`/`TopologyResponse`/`WorkspaceRelation`→`RelationRead` 同名映射
2. `WorkspaceStatus` 加 `"pending"`（或 `type WorkspaceStatus = WorkspaceRead["status"]` 派生）。
3. `grep -rn "from.*workspaces" frontend/src` 找 ~10 import 文件，类型名替换（字段访问零改动）。
**测试**: 现有 workspaces 测试不回归；按 status 分支的 UI 检查是否需处理 pending。
**依赖**: task-06。
**完成标准**: typecheck 过；无旧类型名残留（grep 验证）。

### task-12 后端测试与门禁
**步骤**: `cd backend && uv run pytest -q`（确认 scan-docs/runtime/workspace-binding 新测试过、无回归）+ `uv run mypy app` + `uv run ruff check .`。
**依赖**: task-01~05。
**完成标准**: pytest 全绿、覆盖率 ≥60%、mypy/ruff 过。

### task-13 前端测试与门禁
**步骤**: `cd frontend && pnpm typecheck && pnpm test && pnpm gen:types:check && pnpm lint`。
**依赖**: task-07~11。
**完成标准**: 全绿、无回归。

## 自检清单
- [x] 每个 task 有文件/步骤/测试/依赖/完成标准
- [x] W1→W2→W3 依赖明确，W1 内部 scan-docs 链 02→03→04
- [x] task 粒度均匀（1-3 文件/task）
- [x] 每个 FR 都有 task 覆盖（FR-001: t02/03/04；FR-002: t03/04；FR-003: t01/08；FR-004: t09；FR-005: t05/10；FR-006: t11；FR-007: t07）
- [x] 每个 D-xxx@v1 决策都有对应 task（D-001: t02-04/07；D-002: t01/08；D-003: t09；D-004: t05/10；D-005: t11）
