---
generated_at: 2026-10-03T03:38:23.199Z
sources_reconcile: 命中（ran_at=2026-10-02T16:45:58.969Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-02-change-center-token-usage

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/change/schema.py、backend/app/modules/change/tests/test_usage_stats.py、backend/app/modules/change/usage_service.py、backend/app/modules/platform_sync/model.py、backend/app/modules/platform_sync/router.py、backend/app/modules/platform_sync/schema.py、backend/app/modules/platform_sync/tests/test_usage_ingest.py、backend/app/modules/platform_sync/usage_ingest.py、backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py、backend/openapi.json、frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx、frontend/src/components/changes/detail/change-usage-card.tsx、frontend/src/lib/api-types.ts、.sillyspec/docs/backend/modules/change.md、.sillyspec/docs/backend/modules/platform_sync.md、docs/sillyspec/finished/fr-domain-suggest-typo-and-no-split-migration.md、docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md

### 声明域并集（decisions.md 模块域）

backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/change/schema.py | —（未匹配） |
| backend/app/modules/change/tests/test_usage_stats.py | —（未匹配） |
| backend/app/modules/change/usage_service.py | —（未匹配） |
| backend/app/modules/platform_sync/model.py | —（未匹配） |
| backend/app/modules/platform_sync/router.py | —（未匹配） |
| backend/app/modules/platform_sync/schema.py | —（未匹配） |
| backend/app/modules/platform_sync/tests/test_usage_ingest.py | —（未匹配） |
| backend/app/modules/platform_sync/usage_ingest.py | —（未匹配） |
| backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-usage-card.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，4 项）：.sillyspec/docs/backend/modules/change.md（疑似归因 task-12、task-18）；.sillyspec/docs/backend/modules/platform_sync.md（疑似归因 task-05、task-13）；docs/sillyspec/finished/fr-domain-suggest-typo-and-no-split-migration.md；docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | backend、frontend |
| D-002@v1 | backend、frontend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-02T16:33:54.803Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=0 / globEntries=0
- probe3：tasks=4 / hasTest=4
- probe5：backendEndpoints=2313 / frontendCalls=0
- probe6：deletions=1 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=5 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/platform_sync.md` | agent 会话日志上报节补用量快照摄取条目（usage_ingest 链路/候选/节流/降级/快照五列） | done |
| `.sillyspec/docs/backend/modules/change.md` | ChangeUsageQueryService 条目补本地段口径（三处入口/二选一防双计/守恒/诚实值） | done |
| `_module-map.yaml` | usage_ingest.py 归 platform_sync 既有目录，无需新映射条目；待 scan 刷新 | skipped |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/change/schema.py、backend/app/modules/change/tests/test_usage_stats.py、backend/app/modules/change/usage_service.py、backend/app/modules/platform_sync/model.py、backend/app/modules/platform_sync/router.py、backend/app/modules/platform_sync/schema.py、backend/app/modules/platform_sync/tests/test_usage_ingest.py、backend/app/modules/platform_sync/usage_ingest.py、backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py、backend/openapi.json、frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx、frontend/src/components/changes/detail/change-usage-card.tsx、frontend/src/lib/api-types.ts、.sillyspec/docs/backend/modules/change.md、.sillyspec/docs/backend/modules/platform_sync.md、docs/sillyspec/finished/fr-domain-suggest-typo-and-no-split-migration.md、docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md

### 端点基线提示

- 端点增删：无增删（基线 631 端点 × 现算 631 端点，method+归一 path 全一致）
