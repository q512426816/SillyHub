---
generated_at: 2026-10-08T18:11:17.803Z
sources_reconcile: 命中（ran_at=2026-10-08T18:07:31.762Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-09-knowledge-graph-fullmap

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/knowledge/graph.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/tests/test_graph.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx、frontend/src/components/knowledge/__tests__/graph-canvas.test.ts、frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx、frontend/src/components/knowledge/graph-canvas.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、frontend/src/lib/query-keys.ts、sillyhub-daemon/src/runtime-handler.ts、sillyhub-daemon/tests/knowledge-governance-handler.test.ts、.codex/skills/sillyhub-docker-deploy/SKILL.md、.sillyspec/docs/frontend/modules/lib-knowledge.md、backend/app/modules/agent/service.py、backend/tests/modules/agent/test_stale_run_recheck.py、deploy/scripts/onlyoffice-restore-fonts.sh、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/components/files/previewers/index.ts、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/entry-card-list.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/daemon.ts

### 声明域并集（decisions.md 模块域）

frontend、backend、sillyhub-daemon、sillyspec

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/knowledge/graph.py | —（未匹配） |
| backend/app/modules/knowledge/router.py | —（未匹配） |
| backend/app/modules/knowledge/schema.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_graph.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx | —（未匹配） |
| frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | —（未匹配） |
| frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | —（未匹配） |
| frontend/src/components/knowledge/graph-canvas.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/knowledge.ts | —（未匹配） |
| frontend/src/lib/query-keys.ts | —（未匹配） |
| sillyhub-daemon/src/runtime-handler.ts | —（未匹配） |
| sillyhub-daemon/tests/knowledge-governance-handler.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，15 项）：.codex/skills/sillyhub-docker-deploy/SKILL.md；.sillyspec/docs/frontend/modules/lib-knowledge.md；backend/app/modules/agent/service.py（疑似归因 task-01、task-07、task-08、task-05、task-06、task-10、task-11、task-09）；backend/tests/modules/agent/test_stale_run_recheck.py；deploy/scripts/onlyoffice-restore-fonts.sh；frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx；frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx；frontend/src/components/files/previewers/index.ts；frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx；frontend/src/components/knowledge/entry-card-list.tsx；frontend/src/components/workspace-tabs.tsx（疑似归因 task-08、task-04）；frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts；frontend/src/lib/provider-caps.ts；sillyhub-daemon/src/api-types.ts（疑似归因 task-13、task-09、task-07、task-04）；sillyhub-daemon/src/daemon.ts（疑似归因 task-09、task-16、task-03、task-02、task-08、task-04、task-06、task-05、task-07）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | frontend |
| D-002@v1 | backend、sillyhub-daemon、frontend |
| D-003@v1 | sillyspec |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-08T17:45:18.928Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=0 / globEntries=1
- probe3：tasks=6 / hasTest=5
- probe5：backendEndpoints=631 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=7 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/lib-api.md` | 追加 2026-10-09 增量段（dump 端点生成物） | done |
| `modules/lib-knowledge.md` | 追加 2026-10-09 增量段（dump 函数+类型+消费方） | done |
| `modules/lib-react-query.md` | 追加 2026-10-09 增量段（dump key+失效入口） | done |
| `modules/runtime-handler.md` | skipped：无独立文档卡（map notes 直挂）；dump 白名单行为由 knowledge-governance-handler.test.ts 钉死，daemon.md 增量段注记接线 | done |
| `_module-map.yaml` | skipped：未匹配文件均落既有模块粒度（六卡已增量），索引无需增改 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/knowledge/graph.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/tests/test_graph.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx、frontend/src/components/knowledge/__tests__/graph-canvas.test.ts、frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx、frontend/src/components/knowledge/graph-canvas.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、frontend/src/lib/query-keys.ts、sillyhub-daemon/src/runtime-handler.ts、sillyhub-daemon/tests/knowledge-governance-handler.test.ts、.codex/skills/sillyhub-docker-deploy/SKILL.md、.sillyspec/docs/frontend/modules/lib-knowledge.md、backend/app/modules/agent/service.py、backend/tests/modules/agent/test_stale_run_recheck.py、deploy/scripts/onlyoffice-restore-fonts.sh、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/components/files/previewers/index.ts、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/entry-card-list.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/daemon.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-09-knowledge-graph-fullmap.json 不存在或不可解析——端点增删不可比（backendEndpoints=631（>0））
