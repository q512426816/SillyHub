---
author: qinyi
created_at: 2026-06-22T12:35:00+08:00
---

# 模块影响分析 — 2026-06-22-unify-agent-run-sse-hook

## 三重交叉验证

- **声明范围**（design §6 文件变更清单）：8 文件（2 新增 lib/component + 2 测试 + 4 修改）
- **任务范围**（plan/tasks task-01..08 allowed_paths）：同上 8 文件
- **真实变更**（git diff --cached）：8 frontend 代码文件（见下表）
- **一致 ✅**（以 git diff 为准）

## 本次变更文件

| 文件 | 操作 | task |
|---|---|---|
| frontend/src/lib/use-agent-run-stream.ts | 新增 | task-01 |
| frontend/src/lib/__tests__/use-agent-run-stream.test.ts | 新增 | task-02 |
| frontend/src/components/agent-run-panel.tsx | 新增 | task-03 |
| frontend/src/components/agent-run-panel.test.tsx | 新增 | task-04 |
| frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 修改 | task-05 |
| frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx | 修改 | task-06 |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 修改 | task-07 |
| frontend/src/lib/agent.ts | 修改（删 streamAgentRunLogs + import 收敛） | task-08 |

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| frontend | 接口变更 + 新增符号 | 8 文件（见上） | 合并两套 SSE 客户端为 `useAgentRunStream` hook + `AgentRunPanel` 面板；4 调用点（根/agent/changes 页）统一为 `<AgentRunPanel>`；删除 `streamAgentRunLogs`（`AgentRunStreamClient` 成唯一底层）；pending_input 三处 UI 统一；修复 AskUserQuestion 审批卡片不弹出（5min 兜底超时根因） | false |

## 未匹配文件

无。8 文件全部匹配 `frontend` 模块（`_module-map.yaml` paths: `frontend/**`）。

## 模块文档同步项（Step 3 处理）

`frontend.md` 需更新：
1. §"Agent 流客户端 (agent-stream.ts)"：删除 `streamAgentRunLogs(...)` 条目（已删）
2. 导出符号清单新增：`useAgentRunStream`（lib/use-agent-run-stream.ts）、`AgentRunPanel`（components/agent-run-panel.tsx）
3. §"SSE 实时流"：补充 hook 封装层（`AgentRunStreamClient` → `useAgentRunStream` → `AgentRunPanel` → `AgentLogViewer`）
4. Change Index 追加本次变更记录

## 备注

git staged 区另有**其他变更**的文件，非本次，模块影响分析排除：
- `frontend/public/logo.png`、`frontend/src/app/favicon.ico`（来自 ql-20260622-002 logo 变更）
- `.sillyspec/changes/2026-06-22-daemon-service-split/**`（另一活跃变更的文档，因 `git add .sillyspec/` 带入）

commit 时应分离本次变更与其他变更（建议按变更分别 commit）。
