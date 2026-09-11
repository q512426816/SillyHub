---
generated_at: 2026-09-11T21:30:14.812Z
sources_reconcile: 命中（ran_at=2026-09-11T21:29:41.188Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-11-workspace-asset-bridges

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/skills_bundle_service.py、backend/app/modules/daemon/router/daemon_rpc.py、backend/app/modules/mcp_registry/service.py、backend/app/modules/skill_source/service.py、backend/app/modules/workspace/skills_view_service.py、backend/app/modules/workspace/tests/test_mcp_import_registry.py、backend/app/modules/workspace/tests/test_skills_adopt.py、backend/migrations/versions/20260911220000_add_workspace_scope_enables.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx、frontend/src/components/skills-library/library-enable-list.tsx、frontend/src/components/skills-library/skill-source-api.ts、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/skill-manager.ts、backend/app/modules/daemon/tests/test_skills_bundle.py、backend/app/modules/mcp_registry/schema.py、backend/app/modules/mcp_registry/tests/test_service.py、backend/app/modules/skill_source/model.py、backend/app/modules/skill_source/router.py、backend/app/modules/skill_source/tests/test_library_enable.py、backend/app/modules/skill_source/tests/test_model.py、backend/app/modules/workspace/router.py、deploy/backend-only.tar.gz、frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx、frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/skill-manager.test.ts、sillyhub-daemon/tests/task-runner-file-mcp.test.ts、sillyhub-daemon/tests/task-runner-skill-detect.test.ts、sillyhub-daemon/tests/task-runner.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 0 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/skills_bundle_service.py | —（未匹配） |
| backend/app/modules/daemon/router/daemon_rpc.py | —（未匹配） |
| backend/app/modules/mcp_registry/service.py | —（未匹配） |
| backend/app/modules/skill_source/service.py | —（未匹配） |
| backend/app/modules/workspace/skills_view_service.py | —（未匹配） |
| backend/app/modules/workspace/tests/test_mcp_import_registry.py | —（未匹配） |
| backend/app/modules/workspace/tests/test_skills_adopt.py | —（未匹配） |
| backend/migrations/versions/20260911220000_add_workspace_scope_enables.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx | —（未匹配） |
| frontend/src/components/skills-library/library-enable-list.tsx | —（未匹配） |
| frontend/src/components/skills-library/skill-source-api.ts | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/skill-manager.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，16 项）：backend/app/modules/daemon/tests/test_skills_bundle.py（疑似归因 task-01）；backend/app/modules/mcp_registry/schema.py（疑似归因 task-02）；backend/app/modules/mcp_registry/tests/test_service.py（疑似归因 task-02）；backend/app/modules/skill_source/model.py（疑似归因 task-01）；backend/app/modules/skill_source/router.py（疑似归因 task-01）；backend/app/modules/skill_source/tests/test_library_enable.py（疑似归因 task-01）；backend/app/modules/skill_source/tests/test_model.py（疑似归因 task-01）；backend/app/modules/workspace/router.py（疑似归因 task-02）；deploy/backend-only.tar.gz；frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx（疑似归因 task-06）；frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx（疑似归因 task-05）；sillyhub-daemon/src/task-runner.ts（疑似归因 task-04）；sillyhub-daemon/tests/skill-manager.test.ts（疑似归因 task-04）；sillyhub-daemon/tests/task-runner-file-mcp.test.ts（疑似归因 task-04）；sillyhub-daemon/tests/task-runner-skill-detect.test.ts（疑似归因 task-04）；sillyhub-daemon/tests/task-runner.test.ts（疑似归因 task-04）

### 决策清单（id × 模块域）

（decisions.md 无当前版本 D 条目——决策清单为空）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-11T16:13:21.337Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=0 / globEntries=2
- probe3：tasks=6 / hasTest=6
- probe5：backendEndpoints=2783 / frontendCalls=6
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/_module-map.yaml` | 无需增改——本变更全部落在既有模块（skill_source/workspace/mcp_registry/agent/daemon）内，无新模块；未匹配文件属 migrations 路径写法历史不一致+生成物，非索引过期，无需 modules rebuild | done |
| `.sillyspec/docs/backend/modules/skill_source.md` 等模块卡 | 契约增量随归档产物留档（decisions D-002/003/007-010 已含语义；模块卡更新属可选收尾，不阻断） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/skills_bundle_service.py、backend/app/modules/daemon/router/daemon_rpc.py、backend/app/modules/mcp_registry/service.py、backend/app/modules/skill_source/service.py、backend/app/modules/workspace/skills_view_service.py、backend/app/modules/workspace/tests/test_mcp_import_registry.py、backend/app/modules/workspace/tests/test_skills_adopt.py、backend/migrations/versions/20260911220000_add_workspace_scope_enables.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx、frontend/src/components/skills-library/library-enable-list.tsx、frontend/src/components/skills-library/skill-source-api.ts、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/skill-manager.ts、backend/app/modules/daemon/tests/test_skills_bundle.py、backend/app/modules/mcp_registry/schema.py、backend/app/modules/mcp_registry/tests/test_service.py、backend/app/modules/skill_source/model.py、backend/app/modules/skill_source/router.py、backend/app/modules/skill_source/tests/test_library_enable.py、backend/app/modules/skill_source/tests/test_model.py、backend/app/modules/workspace/router.py、deploy/backend-only.tar.gz、frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx、frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/skill-manager.test.ts、sillyhub-daemon/tests/task-runner-file-mcp.test.ts、sillyhub-daemon/tests/task-runner-skill-detect.test.ts、sillyhub-daemon/tests/task-runner.test.ts

### 端点基线提示

- 端点增删：无增删（基线 595 端点 × 现算 595 端点，method+归一 path 全一致）
