---
generated_at: 2026-09-21T06:16:51.861Z
sources_reconcile: 命中（ran_at=2026-09-20T11:12:36.581Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-20-workspace-member-visibility

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/auth/rbac.py、backend/app/modules/auth/tests/test_rbac_workspace_scope.py、backend/app/modules/workspace/router.py、backend/app/modules/workspace/tests/test_platform_grant_list.py、backend/app/modules/auth/tests/__init__.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/workspace/tests/test_archived_write_guard.py、backend/app/modules/workspace/tests/test_workspace_admin_management.py

### 声明域并集（decisions.md 模块域）

auth、workspace、NEW:notification（新模块）、frontend_components

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/auth/rbac.py | —（未匹配） |
| backend/app/modules/auth/tests/test_rbac_workspace_scope.py | —（未匹配） |
| backend/app/modules/workspace/router.py | —（未匹配） |
| backend/app/modules/workspace/tests/test_platform_grant_list.py | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，4 项）：backend/app/modules/auth/tests/__init__.py（疑似归因 task-05）；backend/app/modules/knowledge/tests/test_router.py（疑似归因 task-06）；backend/app/modules/workspace/tests/test_archived_write_guard.py（疑似归因 task-06）；backend/app/modules/workspace/tests/test_workspace_admin_management.py（疑似归因 task-06）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | auth、workspace |
| D-002@v1 | auth |
| D-003@v1 | auth、workspace、NEW:notification |
| D-004@v1 | frontend_components |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-20T11:00:39.287Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=6 / hasTest=6
- probe5：backendEndpoints=3469 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=7 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| modules/auth.md | 权限模型段落补记平台级权限收紧语义（见下方说明） | done |
| 模块索引（map） | skipped——无结构变更（无新路径/依赖/入口；notification 模块卡缺是历史扫描基线缺口，留待下次 scan 补录，decisions.md 已按 NEW:notification 声明） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/auth/rbac.py、backend/app/modules/auth/tests/test_rbac_workspace_scope.py、backend/app/modules/workspace/router.py、backend/app/modules/workspace/tests/test_platform_grant_list.py、backend/app/modules/auth/tests/__init__.py、backend/app/modules/knowledge/tests/test_router.py、backend/app/modules/workspace/tests/test_archived_write_guard.py、backend/app/modules/workspace/tests/test_workspace_admin_management.py

### 端点基线提示

- 无基线（变更未拍 baseline）：F:\WorkNew\SillyHub\.sillyspec\.runtime\endpoint-baselines\2026-09-20-workspace-member-visibility.json 不存在或不可解析——端点增删不可比（backendEndpoints=3469（>0））
