---
generated_at: 2026-09-12T13:26:47.670Z
sources_reconcile: 命中（ran_at=2026-09-12T12:49:53.101Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-10-group-agent-direct-chat

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/main.py、backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/daemon/group/service/__init__.py、backend/app/modules/daemon/group/service/consensus.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/group/service/messages.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/tests/test_group_consensus.py、backend/migrations/versions/20260910130000_group_consensus.py、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/group-chat-panel.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/lib/api-types.ts、backend/openapi.json、deploy/backend-only.tar.gz、docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md、frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/mobile/mobile-session-list.test.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/lib/agent.ts、frontend/src/lib/daemon/group-shadow-stream.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 0 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/main.py | —（未匹配） |
| backend/app/modules/agent/model.py | —（未匹配） |
| backend/app/modules/agent/schema.py | —（未匹配） |
| backend/app/modules/daemon/group/service/__init__.py | —（未匹配） |
| backend/app/modules/daemon/group/service/consensus.py | —（未匹配） |
| backend/app/modules/daemon/group/service/crud.py | —（未匹配） |
| backend/app/modules/daemon/group/service/helpers.py | —（未匹配） |
| backend/app/modules/daemon/group/service/mentions.py | —（未匹配） |
| backend/app/modules/daemon/group/service/messages.py | —（未匹配） |
| backend/app/modules/daemon/group/service/shadow.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/group_bridge.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/submit_steps.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_group_consensus.py | —（未匹配） |
| backend/migrations/versions/20260910130000_group_consensus.py | —（未匹配） |
| frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | —（未匹配） |
| frontend/src/components/group-chat/__tests__/member-panel.test.tsx | —（未匹配） |
| frontend/src/components/group-chat/create-group-wizard.tsx | —（未匹配） |
| frontend/src/components/group-chat/group-chat-panel.tsx | —（未匹配） |
| frontend/src/components/group-chat/member-panel.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，10 项）：backend/openapi.json（疑似归因 task-13）；deploy/backend-only.tar.gz；docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md；frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx；frontend/src/components/mobile/mobile-session-list.test.tsx；frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx；frontend/src/components/sessions/__tests__/session-list-panel.test.tsx；frontend/src/components/sessions/__tests__/sessions-portal.test.tsx；frontend/src/lib/agent.ts（疑似归因 task-14）；frontend/src/lib/daemon/group-shadow-stream.ts

### 决策清单（id × 模块域）

（decisions.md 无当前版本 D 条目——决策清单为空）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-11T23:31:32.910Z
- probe1：matches=0 / skippedFiles=3 / worktreeHits=0 / globEntries=0
- probe3：tasks=10 / hasTest=7
- probe5：backendEndpoints=594 / frontendCalls=5
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | <!--判定：模块索引无需 rebuild——未匹配项均为既有域内文件（module-map paths 粒度未细到 group/service 子目录与 migrations），归属判定已逐行标注；无游离新模块--> | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/main.py、backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/daemon/group/service/__init__.py、backend/app/modules/daemon/group/service/consensus.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/group/service/messages.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/tests/test_group_consensus.py、backend/migrations/versions/20260910130000_group_consensus.py、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/group-chat-panel.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/lib/api-types.ts、backend/openapi.json、deploy/backend-only.tar.gz、docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md、frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/mobile/mobile-session-list.test.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/lib/agent.ts、frontend/src/lib/daemon/group-shadow-stream.ts

### 端点基线提示

- 端点 diff：基线 595 端点 × 现算 598 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /workspaces/{workspace_id}/skills/adoptable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/skills/adopt | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/mcp/import-from-registry | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
