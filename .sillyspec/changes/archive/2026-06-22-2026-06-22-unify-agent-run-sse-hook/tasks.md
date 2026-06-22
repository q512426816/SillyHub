---
author: qinyi
created_at: 2026-06-22T11:16:01+08:00
---

# Tasks — 统一 Agent Run SSE 客户端

变更：`2026-06-22-unify-agent-run-sse-hook`

> 任务细节（步骤/实现要点）在 plan 阶段展开为 Wave。本表只列任务名、文件路径、覆盖的 FR/D/风险。

## Wave 1 — hook 引擎（独立可测，不改调用点）

| ID | 任务 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-01 | 新增 useAgentRunStream hook | `frontend/src/lib/use-agent-run-stream.ts` | FR-02, FR-06, FR-07, D-001@v1, D-003@v1 |
| task-02 | hook 单测 | `frontend/src/lib/__tests__/use-agent-run-stream.test.ts` | FR-02, FR-04, FR-06 |

## Wave 2 — 面板组件（端到端覆盖 bug）

| ID | 任务 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-03 | 新增 AgentRunPanel 组件 | `frontend/src/components/agent-run-panel.tsx` | FR-03, FR-05, D-002@v1 |
| task-04 | panel 集成测试 | `frontend/src/components/agent-run-panel.test.tsx` | FR-04 |

## Wave 3 — 4 调用点迁移（每处独立提交 + 验证）

| ID | 任务 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-05 | 根 page.tsx Bootstrap run 迁移 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | FR-01（删 connectBootstrapStream/bootstrapLogs/bootstrapPerms/bsInput*） |
| task-06 | agent/page.tsx 活跃 run 迁移 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | FR-01, FR-04（活跃 run 改 AgentRunPanel；历史展开保持直接 AgentLogViewer） |
| task-07 | changes/[cid] 两触发点合并 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | FR-01, FR-04, R-06（:523+:599 合一，删 eventSourceRef/dispatchOwnsSseRef/loadHistoryLogs/connectLogStream） |

## Wave 4 — 清理 + 全量验证

| ID | 任务 | 文件路径 | 覆盖 |
|---|---|---|---|
| task-08 | 删 streamAgentRunLogs + 清理 import | `frontend/src/lib/agent.ts`（+ 3 处调用方 import 已在 W3 清理） | FR-01 |
| task-09 | 全量验证（lint/typecheck/test + grep 确认） | `frontend/` | 全部 FR + 成功标准 |

## 依赖

- task-02 依赖 task-01；task-04 依赖 task-03；task-03 依赖 task-01。
- task-05/06/07 依赖 task-03（AgentRunPanel 就绪）。
- task-08 依赖 task-05/06/07（调用点全部迁移后才删）。
- task-09 依赖 task-08。

## 备注

- 历史 run 展开（`agent/page.tsx` expandedLogs + 下载按钮）**不在** task-06 改动范围（保持直接 `AgentLogViewer`，design §3 非目标）。
- task-07 需处理 R-06（dispatch 后 activeRunId 异步间隙），execute 时用 localRunId 兜底或 activeRunId 计算兼容。
