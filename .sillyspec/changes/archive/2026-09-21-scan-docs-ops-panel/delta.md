---
generated_at: 2026-10-02T00:57:45.932Z
sources_reconcile: 命中（ran_at=2026-09-21T05:39:21.037Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-21-scan-docs-ops-panel

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：.sillyspec/docs/backend/modules/scan_docs.md、.sillyspec/docs/frontend/modules/app-workspace-pages.md、.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md、backend/app/modules/scan_docs/router.py、backend/app/modules/scan_docs/schema.py、backend/app/modules/scan_docs/service.py、backend/app/modules/scan_docs/tests/test_stats.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx、frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx、frontend/src/components/scan-docs-stats-panel.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/scan-docs.ts、.sillyspec/docs/SillyHub/modules/daemon.md、backend/app/modules/daemon/attachment_pipeline.py、backend/app/modules/daemon/session/service/attachments.py、backend/app/modules/daemon/tests/test_attachment_pipeline.py、backend/app/modules/daemon/tests/test_session_provider_caps.py、backend/app/modules/knowledge/distill.py、docs/sillyspec/quick-done-长静默与快照行尾假阳性.md、frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 3 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| .sillyspec/docs/backend/modules/scan_docs.md | —（未匹配） |
| .sillyspec/docs/frontend/modules/app-workspace-pages.md | —（未匹配） |
| .sillyspec/docs/frontend/modules/scan-docs-stats-panel.md | —（未匹配） |
| backend/app/modules/scan_docs/router.py | —（未匹配） |
| backend/app/modules/scan_docs/schema.py | —（未匹配） |
| backend/app/modules/scan_docs/service.py | —（未匹配） |
| backend/app/modules/scan_docs/tests/test_stats.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx | —（未匹配） |
| frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx | —（未匹配） |
| frontend/src/components/scan-docs-stats-panel.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/scan-docs.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，9 项）：.sillyspec/docs/SillyHub/modules/daemon.md（疑似归因 task-13）；backend/app/modules/daemon/attachment_pipeline.py；backend/app/modules/daemon/session/service/attachments.py；backend/app/modules/daemon/tests/test_attachment_pipeline.py；backend/app/modules/daemon/tests/test_session_provider_caps.py；backend/app/modules/knowledge/distill.py；docs/sillyspec/quick-done-长静默与快照行尾假阳性.md；frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx；frontend/src/components/daemon/session-panel/session-panel-dialog.tsx

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-21T03:09:56.444Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=4 / globEntries=2
- probe3：tasks=5 / hasTest=4
- probe5：backendEndpoints=2259 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=6 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不需 rebuild：未匹配文件均属 backend/frontend 项目的模块域（scan_docs/lib-scan-docs/app-workspace-pages/新组件），本项目（multi-agent-platform）map 只覆盖 .sillyspec/**·docs/**·.github/** 属预期；对应模块卡已逐份人工同步（backend/scan_docs、app-workspace-pages、NEW scan-docs-stats-panel） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：.sillyspec/docs/backend/modules/scan_docs.md、.sillyspec/docs/frontend/modules/app-workspace-pages.md、.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md、backend/app/modules/scan_docs/router.py、backend/app/modules/scan_docs/schema.py、backend/app/modules/scan_docs/service.py、backend/app/modules/scan_docs/tests/test_stats.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx、frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx、frontend/src/components/scan-docs-stats-panel.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/scan-docs.ts、.sillyspec/docs/SillyHub/modules/daemon.md、backend/app/modules/daemon/attachment_pipeline.py、backend/app/modules/daemon/session/service/attachments.py、backend/app/modules/daemon/tests/test_attachment_pipeline.py、backend/app/modules/daemon/tests/test_session_provider_caps.py、backend/app/modules/knowledge/distill.py、docs/sillyspec/quick-done-长静默与快照行尾假阳性.md、frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-09-21-scan-docs-ops-panel.json 不存在或不可解析——端点增删不可比（backendEndpoints=2259（>0））
