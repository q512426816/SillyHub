---
id: task-12
title: agent 页单次 provider 覆盖 workspace.default_agent
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P2
depends_on: [task-08]
blocks: [task-15]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/__tests__/
covers: [D-005]
---

## goal
> agent 页发起 agent run 时支持单次 provider 覆盖，透传给 dispatch，绕开 workspace.default_agent 但不持久化。

## implementation
- agent/page.tsx 发起 run 表单增 provider 选择控件：默认回填 workspace.default_agent，可下拉切换为该 daemon 已启用 provider 列表（task-11 暴露的 online runtimes）。
- 发起 dispatch 请求时把所选 provider 作为单次覆盖参数透传（agent run 发起端点已由 task-08 在后端支持覆盖参数，前端只补字段）。
- 不写回 workspace.default_agent（D-005 单次语义，仅本次生效）。
- daemon 未启用所选 provider 时禁用发起按钮 + 提示「该守护进程未启用 <provider>」。
- 新增 agent/__tests__/ 用例：默认 provider、单次覆盖、daemon 未启用 provider 三态。

## acceptance
- 单次覆盖 provider 正确落到 dispatch 请求 payload。
- 覆盖不持久化：刷新或下次发起仍回填 workspace.default_agent。
- daemon 未启用该 provider 时 UI 阻断发起并给出可读提示。
- agent/__tests__/ 三态用例通过。

## verify
- `cd frontend && pnpm test -- workspaces/\[id\]/agent`
- `cd frontend && pnpm tsc --noEmit`
- `cd frontend && pnpm test`

## constraints
- 仅覆盖本次发起，不污染 workspace.default_agent（D-005）。
- provider 候选集依赖 daemon 在线 runtimes（与 task-11 同源），daemon 离线时禁用发起。
- 与后端 task-08 的覆盖参数契约对齐（字段名一致），不一致时后端按 default_agent 兜底并 warn。
- 中文 UI 文案（CLAUDE.md 规则11）。
