---
author: qinyi
created_at: 2026-07-04T20:30:00
stage: verify
verdict: PASS
---

# Verify Result — 2026-07-04-fix-frontend-type-divergence

## 验收结论：✅ PASS（本变更范围全部完成，零回归；3 个 backend 失败经核实为 daemon-entity-binding 遗留测试债，与本变更无关）

## FR 覆盖验收

| FR | 验收证据 | 状态 |
|---|---|---|
| FR-001 scan-docs 补字段 | `scan_docs/schema.py` ScanDocSummary/Read 加 source_*/content_hash/conflict_count；`service.list_` group by 算 conflict_count；test_service.py `TestListConflictCounts` 0/1/多场景通过 | ✅ |
| FR-002 conflicts 端点 | `scan_docs/router.py` `GET /scan-docs/{doc_id}/conflicts` response_model=list[ScanDocConflictRead]；test_router.py 3 测试（返历史/doc-404/ws-404）通过；openapi.json 含端点 | ✅ |
| FR-003 runtime snake_case | `runtime/schema.py` 删 alias+populate_by_name；`router.py` 删 response_model_by_alias=False；`service.py:178-185` 构造参数 alias→snake；openapi.json RuntimeProgress 字段 snake（api-types.ts:10598 验证）；7 runtime 测试通过 | ✅ |
| FR-004 audit details_json string | `audit.ts` details_json 改 string（对齐生成类型）；`audit/page.tsx` parseDetails helper try-catch 兜底；parse-details.test.ts 5 单测（合法/null/空串/非法/含 error）通过 | ✅ |
| FR-005 workspace-binding response_model | `member_runtimes/router.py` 三端点加 response_model（MemberBindingView \| None / MemberBindingView / list[MemberBindingView]）；删 try/except，daemon_not_owned 走全局处理器 errors.py:344（403 body `{code,message,request_id,details}`）；前端 ApiError 已用全局格式，零影响；5+11 测试通过 | ✅ |
| FR-006 workspaces 迁移 | `workspaces.ts` 9 类型改为 `Schemas[...]` 别名（零调用方改动）；WorkspaceStatus 派生 `Schemas["WorkspaceRead"]["status"]` 含 pending；workspace-scan-dialog.tsx warnings 可选防御 | ✅ |
| FR-007 scan-docs 前端迁移 | `scan-docs.ts` 7 类型迁移 components["schemas"][...]；page.tsx 徽章保留（source_member_id/conflict_count 现真实数据）；scan-docs-tree.test.ts mock 补 workspace_id | ✅ |

## 测试与质量扫描

| 项 | 结果 |
|---|---|
| backend pytest 全量 | 2217 passed / 3 failed / 10 skipped / 5 xfailed |
| backend mypy app | Success: no issues found in 409 source files |
| backend ruff format+check | 全过（commit hook 验证） |
| frontend typecheck (tsc --noEmit) | 全过 |
| frontend vitest 全量 | 59 files / 623 passed / 1 skipped，零回归 |
| frontend lint (next lint) | 仅 Warning（预存在 no-unused-vars，无 Error） |
| frontend gen:types:check | pnpm gen:types 通过（292 paths/334 schemas） |

## 3 个 backend 失败 — 根因分析（与本变更无关，daemon-entity-binding 遗留）

1. `tests/modules/auth/test_api_key_lifecycle.py::test_api_key_end_to_end_lifecycle` / `::test_daemon_still_works_with_bearer_token`
   - 根因：`/api/daemon/register` 要求 `daemon_local_id/server_url/hostname/providers`（daemon-entity-binding D-004 新字段），测试仍用旧 payload `{name, provider}` → 422 missing
   - 证据：`AssertionError: 422 == 201`，details.errors 列出新字段
2. `tests/e2e/test_three_member_collaboration.py::test_e2e_three_member_collaboration`
   - 根因：`upsert_my_binding()` service 签名改 `daemon_id`（daemon-entity-binding），测试仍传 `runtime_id=` → TypeError
   - 证据：`TypeError: upsert_my_binding() got an unexpected keyword argument 'runtime_id'` (test_three_member_collaboration.py:210)

本变更未触碰 daemon register 端点或 upsert_my_binding service 签名 → 这 3 个失败是 daemon-entity-binding（2026-07-03, commit 52101447）merge 时未更新的测试债。

## 顺手修复

- `backend/app/modules/daemon/service.py:197` `list_runtimes_page` 返回注解从 `tuple[..., DaemonRuntime, User | None], int]` 改为 `tuple[..., DaemonRuntime, User | None, DaemonInstance | None], int]`（daemon-entity-binding 把返回改 3 元组但注解漏更新，拦 commit hook mypy）。已纳入本次 commit 127cc018。

## 遗留与风险

- **3 个 backend 测试失败（daemon-entity-binding 债）**：不在本变更范围，建议后续单独修（更新 test_api_key_lifecycle payload + test_three_member_collaboration 改 daemon_id）。
- **可选性差异防御**：OpenAPI 生成类型把 nullable 字段标可选 `?:`（手写是必填 nullable），消费点需 `?? null` / `?.` 防御。本次 4 处（runtime page stages/steps、workspace-binding 2 处 daemon_id、workspace-scan-dialog warnings）。后续类型迁移的通用模式。
- **workspaces 请求类型保留手写**：CreateWorkspaceInput/UpdateWorkspaceInput/WorkspaceListParams（生成类型字段必填性/枚举宽度与手写输入语义不一致，迁移会收紧契约或丢失枚举安全，保留手写合理）。

## 结论

本变更（修复前端 OpenAPI 类型对齐 5 处分叉）实现完整、测试充分、与 design 一致。3 个 backend 失败明确归属其他变更遗留，不构成本变更的回归。验收通过。
