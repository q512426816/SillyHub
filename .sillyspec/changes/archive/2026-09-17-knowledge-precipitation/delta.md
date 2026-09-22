---
generated_at: 2026-09-22T17:25:19.201Z
sources_reconcile: 未命中（apply-pathspec 兜底，3 项）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-17-knowledge-precipitation

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/knowledge/distill.py、backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_router.py

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 10 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

（无 reconcile 产物（变更先于 P3a 或 verify 未落盘），清单取 apply-pathspec——文件级，无 missing/undeclared 差集）

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/knowledge/distill.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_distill.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_router.py | —（未匹配） |

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v1 | （未填写） |
| D-005@v1 | （未填写） |
| D-006@v1 | （未填写） |
| D-007@v1 | （未填写） |
| D-008@v2 | （未填写） |
| D-009@v1 | （未填写） |
| D-010@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-17T11:32:41.693Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=2
- probe3：tasks=10 / hasTest=10
- probe5：backendEndpoints=5892 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / feKeys=0 / backendFields=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/knowledge.md` | 增量节已写（定位改「读侧+平台写侧」；契约摘要补 7 新端点/409 契约/两段式 merge/zone 递归；注意事项补 decisions 只读与 INDEX 路由行 R-03 同源） | done |
| `.sillyspec/docs/backend/modules/auth.md` | 增量节已写（契约摘要补 KNOWLEDGE_WRITE：knowledge:write、WORKSPACE 组、migration 20260917104400 播种 platform_admin/workspace_owner） | done |
| `.sillyspec/docs/SillyHub/modules/spec_workspace.md` | 增量节已写（注意事项补 knowledge writer 为 apply_ops 新服务端调用方，D-011 单写者语义不变） | done |
| `.sillyspec/docs/SillyHub/modules/frontend_components.md` | 增量节已写（契约摘要补知识域 4 组件：precipitate-dialog/entry-editor/merge-dialog/distill-task-bar） | done |
| `_module-map.yaml` | 无需增改：本变更新增文件均落在既有 backend/frontend 模块 paths 内；未匹配文件属并行会话非索引过期 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/knowledge/distill.py、backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_router.py

### 端点基线提示

- 端点 diff：基线 603 端点 × 现算 617 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /menu-overrides | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | PUT | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | DELETE | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/propose | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | PATCH | /workspaces/{workspace_id}/knowledge/entries/{filename:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/preview-merge | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/merge | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/reject | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/distill | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/distill/tasks | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/distill/quick-entries | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/hits/batch | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/{filename:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/scan-docs/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\scan_docs\router.py |
| - 删除 | GET | /workspaces/{workspace_id}/knowledge/{filename} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
