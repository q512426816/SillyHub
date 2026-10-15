---
generated_at: 2026-10-15T19:40:10.384Z
sources_reconcile: 命中（ran_at=2026-10-15T14:18:52.046Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-15-knowledge-search-pgvector

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| backend | active | 1 |
| deploy | active | 1 |
| docs | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/search.py、backend/app/modules/knowledge/tests/test_knowledge_search.py、backend/migrations/versions/20261015200000_knowledge_search_pgvector.py、backend/uv.lock、deploy/docker-compose.dev.yml、backend/tests/test_align_platform_change_events_migration.py、docs/sillyspec/active-pitfalls.md、docs/sillyspec/worktree-apply-rollback-ghost-bindings-manifest.md

### 声明域并集（decisions.md 模块域）

backend、deploy

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/knowledge/router.py | —（未匹配） |
| backend/app/modules/knowledge/search.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_knowledge_search.py | —（未匹配） |
| backend/migrations/versions/20261015200000_knowledge_search_pgvector.py | —（未匹配） |
| backend/pyproject.toml | build |
| backend/uv.lock | —（未匹配） |
| deploy/docker-compose.dev.yml | —（未匹配） |
| deploy/docker-compose.yml | build |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，3 项）：backend/tests/test_align_platform_change_events_migration.py；docs/sillyspec/active-pitfalls.md；docs/sillyspec/worktree-apply-rollback-ghost-bindings-manifest.md

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | backend |
| D-002@v1 | backend |
| D-003@v1 | backend |
| D-004@v1 | backend |
| D-005@v2 | backend |
| D-006@v1 | backend |
| D-007@v1 | backend |
| D-008@v1 | backend、deploy |
| D-009@v1 | backend |
| D-010@v1 | backend |
| D-011@v1 | backend |
| D-012@v1 | backend |
| D-013@v1 | backend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-15T13:42:54.704Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=1 / globEntries=0
- probe3：tasks=5 / hasTest=4
- probe5：backendEndpoints=2406 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=6 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 加「平台知识搜索·pgvector 持久化」特性行（含部署实证） | done |
| `modules/deploy.md` | postgres 镜像/backend 模型挂载与 mem_limit/注意事项/变更索引 | done |
| `_module-map.yaml: backend` | 无变化（无增删模块与路径；main_symbols 循 platform-knowledge-search 先例不加） | skipped |
| `_module-map.yaml: deploy` | 无变化（同上） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：backend、deploy、docs（共 3 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/search.py、backend/app/modules/knowledge/tests/test_knowledge_search.py、backend/migrations/versions/20261015200000_knowledge_search_pgvector.py、backend/uv.lock、deploy/docker-compose.dev.yml、backend/tests/test_align_platform_change_events_migration.py、docs/sillyspec/active-pitfalls.md、docs/sillyspec/worktree-apply-rollback-ghost-bindings-manifest.md

### 端点基线提示

- 端点增删：无增删（基线 658 端点 × 现算 658 端点，method+归一 path 全一致）
