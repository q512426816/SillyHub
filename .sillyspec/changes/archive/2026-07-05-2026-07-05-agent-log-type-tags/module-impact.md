---
author: qinyi
created_at: 2026-07-05 11:50:00
change: 2026-07-05-agent-log-type-tags
---

# 模块影响分析 · Agent 执行日志类型细分

## 三重交叉验证

| 维度 | 来源 | 文件数 |
|---|---|---|
| 声明范围 | design.md §6 文件变更清单 | 13（+测试 2） |
| 任务范围 | plan.md + tasks/task-01~09.md allowed_paths | 15 |
| 真实变更 | git diff（主仓库 working tree）| 17（本次相关） |

三者一致（git diff 含测试文件，与 design 文件清单 + task allowed_paths 对齐）。以 git diff 为准。

## 模块影响矩阵

_module-map.yaml 不存在（daemon-client specDir scan 未跑），按目录结构推断模块。

| 模块 | 文件 | 影响类型 | needs_review |
|---|---|---|---|
| backend/agent | backend/app/modules/agent/model.py | 数据结构变更（AgentRunLog 加 tool_kind 列） | false |
| backend/agent | backend/app/modules/agent/schema.py | 接口变更（AgentRunLogEntry 加 tool_kind 字段） | false |
| backend/agent | backend/app/modules/agent/router.py | 接口变更（GET /logs 加 ?tool_kind= query） | false |
| backend/agent | backend/app/modules/agent/service.py | 接口变更（get_run_logs 加 tool_kind 参数） | false |
| backend/agent | backend/app/modules/agent/tool_kind.py | 新增（classify_tool_kind 纯函数） | false |
| backend/daemon/run_sync | backend/app/modules/daemon/run_sync/service.py | 逻辑变更（_extract_sdk_messages + submit_messages 落库填 tool_kind + 两处 publish payload 加字段） | false |
| backend/migrations | backend/migrations/versions/20260705_add_agent_run_log_tool_kind.py | 新增（alembic 迁移 add column + index） | false |
| sillyhub-daemon | sillyhub-daemon/src/task-runner.ts | 逻辑变更（tool_use 分支打 tool_kind 顶层字段） | false |
| sillyhub-daemon | sillyhub-daemon/src/tool-kind.ts | 新增（classifyToolKind TS） | false |
| frontend/agent-log | frontend/src/components/agent-log-viewer.tsx | 逻辑变更（第二层筛选按钮组 + 工具徽标渲染） | false |
| frontend/agent-log | frontend/src/components/agent-log/tool-kind-meta.ts | 新增（toolKindMeta 徽标映射 14 枚举） | false |
| frontend/lib | frontend/src/lib/agent.ts | 接口变更（AgentRunLogEntry + StreamLogEvent 加 tool_kind 字段） | false |

## 测试文件（新增）

| 文件 | 覆盖 |
|---|---|
| backend/tests/modules/agent/test_tool_kind.py | classify_tool_kind Python 51 用例 |
| backend/tests/modules/agent/test_agent_run_log_tool_kind.py | 集成测试 15 用例（迁移+落库+publish+API） |
| sillyhub-daemon/tests/tool-kind.test.ts | classifyToolKind TS 40 用例 |
| frontend/src/components/agent-log/__tests__/tool-kind-meta.test.ts | toolKindMeta 7 用例 |
| frontend/src/components/__tests__/agent-log-viewer-tool-kind.test.tsx | 第二层筛选+徽标 12 用例 |

## 跨模块契约

- **classify_tool_kind 契约**：backend Python（tool_kind.py）+ daemon TS（tool-kind.ts）同逻辑，共享单测用例表（R-05 防漂移）。
- **tool_kind 字段契约**：AgentRunLog 列（model.py）→ AgentRunLogEntry schema → publish payload（published_logs + session_payload）→ daemon message 顶层 → frontend AgentRunLogEntry 类型 → toolKindMeta 渲染。链路完整（task-09 集成测试验证）。

## 未匹配文件

无（所有本次文件都映射到模块）。

## 风险评估

- **低风险**：本次为"加展示维度"（不改 agent_run/session/lease 生命周期，design §7.5），仅加列 + 落库填值 + 渲染。
- **需注意**：alembic 迁移 down_revision 接真实 head（R-01，alembic heads 验证唯一）；publish 两处 payload 都加字段（R-08，task-09 验证）；双路径打标（R-02，task-09 验证）。
- **遗留无关**：test_member_runtimes.py（daemon-entity-binding 遗留）、scan_docs/、workspace-config-card、page.tsx 等是 baseline overlay 的 untracked/modified 文件，非本次产出。
