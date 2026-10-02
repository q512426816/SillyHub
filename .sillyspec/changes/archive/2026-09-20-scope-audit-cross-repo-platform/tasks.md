---
author: qinyi
created_at: 2026-09-20T19:49:59
---
# 任务分解（Tasks）— 2026-09-20-scope-audit-cross-repo-platform

> 实现顺序即依赖顺序：Wave1（task-01 ∥ task-02）→ Wave2（task-03）。任务唯一真相在本清单，TaskCard 详卡在 tasks/ 目录。

- [x] task-01: daemon 投影契约 v2（cross_repo + repos[]）
  - `sillyhub-daemon/src/sillyspec-manager.ts`：`SillySpecAuditRow` 增 `cross_repo`；新增 `SillySpecAuditRepoAnchor/SillySpecAuditRepoTotals/SillySpecAuditRepo` 接口；`SillySpecAuditTable` 增 `repos: SillySpecAuditRepo[] | null`；`auditTable()` 行级投影 `raw.crossRepo`→`cross_repo`（asStr），信封 `parsed.repos` 逐条防御投影（key 非空 string 守卫、anchor 四字段 asStr、anchor_label=base 7 位短化〔语义锚→null，D-004@v2〕、totals 六字段 asCount、degraded/degraded_reason；repoPath 白名单排除）。
  - 测试 `sillyhub-daemon/tests/sillyspec-file-diff.test.ts`：v2 信封夹具（三仓 repos + 跨仓行）投影断言 / 无 repos 键 → null / 截断护栏不受影响 / 投影结果不含 repoPath。
  - target_files: sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/tests/sillyspec-file-diff.test.ts
- [x] task-02: backend schema 与透传
  - `backend/app/modules/change/schema.py`：`ScopeAuditRow.cross_repo`；新增 `ScopeAuditRepoAnchor/ScopeAuditRepoTotals/ScopeAuditRepo`；`ScopeAuditResponse.repos: list = []`。
  - `backend/app/modules/change/scope_audit.py`：`get_scope_audit()` rows 循环补 `cross_repo`（isinstance str 守卫）；`result.repos` 防御构造（非法条目跳过，非 list → []）。
  - 测试 `backend/app/modules/change/tests/test_scope_file_diff.py`：scope-audit 端点 repos 透传/回退用例（FakeHub v2 形态）。
  - target_files: backend/app/modules/change/schema.py, backend/app/modules/change/scope_audit.py, backend/app/modules/change/tests/test_scope_file_diff.py
- [x] task-03: gen:types 与前端按仓分组 (depends_on: task-01,02)
  - gen:types 前确认 node_modules 健康（`pnpm exec tsc --version`），跑 `pnpm gen:types`，提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（只提交相关 diff）。
  - `frontend/src/components/changes/scope-audit-command-card.tsx`：分组激活（repos 非空 && full-flow）→ 全表合计行 + 每仓段（仓标识/锚点档 label+短 hash/三态 chips 取 repos[].totals/files+−/degraded 段降级文案）+ note 顶摘要；明细弹窗按 cross_repo 分桶（main 首位，孤儿桶尾随）+ 粘性小节头 + 仓标徽章；无 repos/quick → 现状渲染路径与 testid 原样（回退形态不渲染 note）。
  - 测试：`frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx` 增分组渲染/回退/分桶用例；回归 `frontend/src/components/mobile/mobile-change-detail.test.tsx` 与 `frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx`（import 复用/挂载面，只跑不改为主，桩需调整时才有写面）。
  - target_files: frontend/src/lib/api-types.ts, backend/openapi.json, frontend/src/components/changes/scope-audit-command-card.tsx, frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx（两回归测试只跑不改——allowed_paths 保留写权限，实际零改动故不进 target_files）
