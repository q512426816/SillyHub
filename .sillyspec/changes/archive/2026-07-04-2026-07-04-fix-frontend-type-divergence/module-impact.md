---
author: qinyi
created_at: 2026-07-04T20:35:00
analyzer: impact-analyzer
---

# Module Impact — 2026-07-04-fix-frontend-type-divergence

> 以 `git diff --name-only HEAD~1`（commit 127cc018）为准，真实改动 26 文件。

## 模块影响矩阵

| 模块 | 影响类型 | 改动文件 | 说明 |
|---|---|---|---|
| backend/runtime | 接口变更 | `app/modules/runtime/{schema,router,service}.py` | 删 pydantic `Field(alias=camelCase)` + `populate_by_name` + router `response_model_by_alias=False`；service `_read_sqlite_progress` 构造参数 alias key 改 snake_case。OpenAPI 与运行时统一 snake_case（D-002@v1） |
| backend/scan_docs | 接口变更 + 数据结构 + 新增端点 | `app/modules/scan_docs/{schema,service,router}.py` + `tests/test_{service,router}.py` + `conftest.py` | ScanDocSummary/Read 补 source_*/content_hash/conflict_count；新建 ScanDocConflictRead schema；service group by 算 conflict_count（避 N+1）+ count_conflicts + list_conflicts；router 加 `GET /scan-docs/{doc_id}/conflicts`；conftest 注册 conflict_model（D-001@v1） |
| backend/workspace/member_runtimes | 接口变更 | `app/modules/workspace/member_runtimes/router.py` | 三端点（my-binding GET/PUT、members/bindings）加 `response_model=MemberBindingView`；删 try/except，daemon_not_owned 走全局处理器（D-004@v1） |
| backend/daemon | 数据结构（顺手修，非本变更范围） | `app/modules/daemon/service.py:197` | `list_runtimes_page` 返回注解补 `DaemonInstance \| None`（daemon-entity-binding 遗留 mypy 错误，拦 commit hook，顺手修） |
| backend/openapi（生成产物） | 接口变更 | `backend/openapi.json` | schema 重生（292 paths/334 schemas），RuntimeProgress snake + ScanDocConflictRead + MemberBindingView |
| frontend/scan-docs | 调用关系变更 | `lib/scan-docs.ts` + `app/.../scan-docs/page.tsx` + `lib/__tests__/scan-docs-tree.test.ts` | 7 手写类型迁移到 `components["schemas"][...]`；page 徽章保留（数据现真实）；测试 mock 补 workspace_id（D-001@v1） |
| frontend/runtime | 调用关系变更 | `lib/runtime.ts` + `app/.../runtime/page.tsx` | RuntimeProgress/StageProgress/StageStep 改生成类型；page stages/steps 可选防御（D-002@v1） |
| frontend/audit | 逻辑变更 + 调用关系 | `lib/audit.ts` + `app/.../audit/page.tsx` + `parse-details.test.ts`（新） | AuditLogEntry 整体迁移生成类型（details_json→string）；page `JSON.stringify`→`parseDetails`（JSON.parse try-catch 兜底）；搜索语义保持（D-003@v1） |
| frontend/workspace-binding | 调用关系变更 | `lib/workspace-binding.ts` + `components/workspace-binding-guard.tsx` + `app/.../workspaces/page.tsx` | MemberBindingView 手写改生成类型；2 处消费点 `daemon_id ?? null` 收敛可选性（D-004@v1） |
| frontend/workspaces | 调用关系变更 | `lib/workspaces.ts` + `components/workspace-scan-dialog.tsx` | 9 手写类型改生成类型别名（零调用方改动）；WorkspaceStatus 派生含 pending；workspace-scan-dialog warnings 可选防御（D-005@v1） |
| frontend/api-types（生成产物） | 数据结构 | `lib/api-types.ts` | `pnpm gen:types` 重生 |

## 未匹配文件

无。26 个改动文件全部映射到上表模块。`backend/conftest.py` 归入 scan_docs 模块改动（为 conflict_model 测试建表）。

## 需 review 的不确定影响

- **backend/daemon service.py**：本变更范围外（顺手修 mypy 注解），不触发 daemon 模块逻辑变更，但模块文档若有 list_runtimes_page 签名描述应顺带核对。
- **frontend/api-types.ts**：生成产物，下游所有 import 方都依赖，但本次仅 5 模块迁移消费新字段，其他模块 import 不受影响（typecheck 全过验证）。
