---
generated_at: 2026-10-08T11:47:12.246Z
sources_reconcile: 命中（ran_at=2026-10-08T11:43:33.279Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-08-platform-knowledge-graph

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/knowledge/graph.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/tests/test_graph.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx、frontend/src/components/knowledge/__tests__/graph-canvas.test.ts、frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx、frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx、frontend/src/components/knowledge/graph-canvas.tsx、frontend/src/components/knowledge/ops-dashboard.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、frontend/src/lib/query-keys.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/runtime-handler.ts、sillyhub-daemon/tests/knowledge-governance-handler.test.ts、sillyhub-daemon/tests/runtime-handler.test.ts

### 声明域并集（decisions.md 模块域）

backend、sillyhub-daemon、frontend

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
| frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | —（未匹配） |
| frontend/src/components/knowledge/graph-canvas.tsx | —（未匹配） |
| frontend/src/components/knowledge/ops-dashboard.tsx | —（未匹配） |
| frontend/src/components/workspace-tabs.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/knowledge.ts | —（未匹配） |
| frontend/src/lib/query-keys.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/runtime-handler.ts | —（未匹配） |
| sillyhub-daemon/tests/knowledge-governance-handler.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，1 项）：sillyhub-daemon/tests/runtime-handler.test.ts（疑似归因 task-04）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v2 | backend、sillyhub-daemon |
| D-002@v1 | frontend |
| D-003@v1 | frontend |
| D-004@v1 | frontend |
| D-005@v1 | backend、sillyhub-daemon |
| D-006@v1 | frontend |
| D-008@v2 | backend、frontend |
| D-007@v1 | backend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-08T11:37:52.312Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=5 / globEntries=1
- probe3：tasks=10 / hasTest=8
- probe5：backendEndpoints=1691 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=11 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-shared.md` | 追加 2026-10-08 增量段（TABS 页签+权限复用） | done |
| `modules/daemon.md` | 追加 2026-10-08 增量段（knowledge.graph 注册+root 双收） | done |
| `modules/lib-api.md` | 追加 2026-10-08 增量段（gen:types 生成物规模） | done |
| `modules/lib-knowledge.md` | 追加 2026-10-08 增量段（三函数+类型导出+消费方） | done |
| `modules/lib-react-query.md` | 追加 2026-10-08 增量段（三 key 工厂+组失效） | done |
| `modules/runtime-handler.md` | skipped：该模块无独立文档卡（sillyhub-daemon map 中 runtime-handler 条目 notes 直挂）；graph 方法行为由 knowledge-governance-handler.test.ts 11 用例钉死，daemon.md 增量段已注记转发关系 | done |
| `_module-map.yaml` | skipped：12 个"未匹配文件"实为子项目 map 粒度覆盖（backend/app/modules/knowledge/** 归 backend knowledge 卡、前端新页面/组件归 frontend 各卡——均已更新增量段）；模块索引无需增改，graph.py 等落既有模块 paths 内 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/knowledge/graph.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/tests/test_graph.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx、frontend/src/components/knowledge/__tests__/graph-canvas.test.ts、frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx、frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx、frontend/src/components/knowledge/graph-canvas.tsx、frontend/src/components/knowledge/ops-dashboard.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、frontend/src/lib/query-keys.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/runtime-handler.ts、sillyhub-daemon/tests/knowledge-governance-handler.test.ts、sillyhub-daemon/tests/runtime-handler.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-08-platform-knowledge-graph.json 不存在或不可解析——端点增删不可比（backendEndpoints=1691（>0））
