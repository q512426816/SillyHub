---
id: task-10
title: 三端集成验收 + 既有行为零回归（AC-1~8 + 性能上限）
title_zh: 端到端集成验收
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-04, task-09]
blocks: []
allowed_paths:
  - backend/app/modules/agent/service.py
  - frontend/src/components/permissions/session-permission-panel.tsx
provides:
  fields: [integration_acceptance]
expects_from:
  task-04:
    needs: [test_workspace_dialogs]
  task-09:
    needs: [frontend_tests]
---

# task-10 · 三端集成验收 + 既有行为零回归

> Wave 3 收口任务：聚合 task-01~09 的全部产出，按 design §7 AC-1~8 + 全局验收标准做端到端验收，确保 AskUserQuestion 进 `/approvals` 审批中心真闭环，同时既有 runtime 弹窗 / 工具网关审批 / daemon PERMISSION_REQUEST 链路零回归。

## 目标

- **端到端验收 AC-1~8**：AskUserQuestion 在 scan/stage + 普通对话两类会话触发后，`/approvals` 审批中心可见（AC-1/2）、带来源上下文条 + 跳转（AC-3）、刷新不丢（AC-4）、SSE 实时 + 来源字段回填（AC-5）、普通审批仍 allow/deny（AC-6）、backend 端点权限/JOIN/上下文正确（AC-7）。
- **既有行为零回归（AC-8 / D-001）**：runtime 会话弹窗（interactive-session-panel）AskUserDialogCard 分流不变、workspace 工具网关审批（listPendingApprovals）不变、daemon PERMISSION_REQUEST 持久化链路零改动。
- **性能上限落地（NFR-1 / R-1 / C10）**：聚合 scan+chat 后 workspace 下 active session 各开 SSE 的风险受控——`list_workspace_active_sessions` 加 `limit`（top 50 by 最近活跃）+ 前端 SSE 连接数硬上限（超出不订阅，靠 `GET /workspaces/{id}/dialogs` 兜底）。

## 实现要点

本任务**不写新功能代码**，只做集成验收 + 必要的性能收口补丁：

1. **端到端手动验收（docker compose 部署）**：
   - 触发 scan run 内 AskUserQuestion → `/approvals` 见问答卡（AC-1）
   - 触发普通对话 AskUserQuestion → 同样见问答卡（AC-2）
   - 卡片含来源上下文条（工作区/场景 badge/会话/运行/时间/run_summary 一句话），会话链接跳 `/runtimes?session=<id>`，运行链接可跳（AC-3）
   - 刷新 `/approvals`，未回答卡片仍在，≤10s 内来源字段从占位回填（AC-4）
   - 新触发实时弹（SSE <2s），SSE 路来源占位「加载中」→ 查询回填（AC-5）
   - 无 `dialog_kind` 的普通审批仍渲染 PermissionApprovalCard allow/deny（AC-6）

2. **既有行为零回归核对**：
   - runtime 会话弹窗（interactive-session-panel）仍按 dialog_kind 分流 AskUserDialogCard，不受本变更影响
   - workspace 工具网关审批（listPendingApprovals / PermissionApprovalCard）链路无侵入
   - daemon PERMISSION_REQUEST 持久化链路零改动（D-001，本变更无 daemon task）

3. **性能上限落地（NFR-1 / R-1）**：
   - `list_workspace_active_sessions`（agent/service.py:798-806）加 `limit` 参数（top 50 by 最近活跃），避免大 workspace 全量 session JOIN
   - 前端 SSE 连接数硬上限：超出上限的 session 不开 SSE，仅靠 `GET /workspaces/{id}/dialogs` refetchInterval 兜底（R-1 对策 / C10）

## 验收标准

- [ ] AC-1~8 全过（手动 + 自动化）
- [ ] backend pytest 全绿（含 task-04 端点测试 `test_workspace_dialogs`）
- [ ] frontend vitest 全绿（含 task-09 `frontend_tests`）
- [ ] 既有行为零回归：runtime 弹窗 / 工具网关审批 / daemon 链路不受影响
- [ ] 性能上限落地：`list_workspace_active_sessions` limit + 前端 SSE 连接数硬上限

## 验证命令

```bash
# backend 单测 + 覆盖率门槛 60%
cd backend && uv run pytest -q --cov=app --cov-fail-under=60

# frontend 单测 + 类型 + lint
cd frontend && pnpm test && pnpm typecheck && pnpm lint

# 端到端手动（docker compose 部署后触发 AskUserQuestion 两场景）
docker compose up -d --build backend frontend daemon
# → scan run + 普通对话分别触发 AskUserQuestion，逐条核对 AC-1~6
```

## 约束

- **D-001（零回归）**：daemon 不改，PERMISSION_REQUEST 链路不动；本任务性能补丁仅限 backend `list_workspace_active_sessions` limit + 前端 SSE 连接数硬上限，不触碰既有审批/弹窗行为。
- **NFR-1（性能上限）**：limit top 50 + SSE 连接数硬上限是 R-1/C10 的兜底对策；workspace 级聚合 SSE channel 列为后续 YAGNI，本期不做。
- **三端兼容（Windows/Linux/macOS）**：端到端验证命令与路径在三端一致（docker compose 抹平台差异）。
- **端到端运行时验证**：单测全绿不等于链路通，必须 docker compose 部署后真触发 AskUserQuestion 两场景（关联 MEMORY「scan/stage 走 interactive」+「单测全绿生产 500」教训）。
