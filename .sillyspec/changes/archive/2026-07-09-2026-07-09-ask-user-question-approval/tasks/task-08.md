---
id: task-08
title: 新组件 DialogContextBar + 集成（来源上下文条 + 跳转）
title_zh: 审批卡来源上下文条与跳转
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-05]
blocks: [task-09]
allowed_paths:
  - frontend/src/components/permissions/dialog-context-bar.tsx
  - frontend/src/components/permissions/session-permission-panel.tsx
provides:
  fields: [DialogContextBar]
expects_from:
  task-05:
    needs: ["SessionPermissionRequest(workspace_name,session_type,run_summary,session_id,run_id)"]
---

# task-08 · DialogContextBar + 来源上下文条集成

## 目标

新建 `DialogContextBar` 组件作为 `AskUserDialogCard` / `PermissionApprovalCard` 的**兄弟包裹层**，渲染 D-002 来源上下文条（工作区/场景/会话/运行/时间/上下文一句话）+ 跳转入口。父组件 `SessionPermissionPanel` 负责包裹，**不侵入**卡组件内部（design §4.4 / C5），保持 `AskUserDialogCard` 契约 `{request, onResolved?}` 零改动。

## 依据

- design §4.4 来源上下文条 + 跳转（兄弟包裹层 + 内容清单 + 跳转目标）
- design D-002（审批卡必须带来源上下文 + 跳转）
- design C5（兄弟包裹不侵入卡组件）/ C8（会话链接跳 `/runtimes?session=<id>`）
- CLAUDE.md 规则 16 前端样式参考 prototype-ask-user-question-approval.html
- 现状：`ask-user-dialog-card.tsx` props 仅 `{request, onResolved?}`（:130-134）；`session-permission-panel.tsx:110-120` 现渲染裸卡
- 跳转目标：`runtimes/page.tsx:812` `searchParams.get("session")` 已解析 `?session=` query，弹窗可恢复

## 实现

### 1. 新建 `frontend/src/components/permissions/dialog-context-bar.tsx`

- props：`{ request: SessionPermissionRequest; children: ReactNode }`（包裹任意审批卡）
- 渲染卡头顶条（参考 prototype 视觉，indigo/zinc 配色与 AskUserDialogCard header 对齐）：
  - 工作区名（`request.workspace_name`，缺省占位「工作区」）
  - 场景 badge：`scan` / `对话` / `stage`（取 `request.session_type`，按 D-003 三态映射；缺省占位「加载中」）
  - 会话链接：`<Link href={`/runtimes?session=${request.session_id}`}>`，显示截断 session_id（C8）
  - 运行链接：按 `request.run_id`（如有）链接到 agent run 面板
  - 时间：`request.created_at` 相对/本地化显示
  - run_summary 一句话（`request.run_summary`，为空占位「会话进行中」，对齐 design §4.1）
- 卡头右侧「查看会话 →」按钮（与 会话链接同 target，主跳转入口，design §4.4）
- 包裹 `children`（实际审批卡）于下方，整体一个 `rounded-md border` 容器

### 2. 集成到 `session-permission-panel.tsx`

- `cards.map` 渲染时改用 `<DialogContextBar request={req}>{卡组件}</DialogContextBar>` 包裹：
  - `req.dialog_kind` → 内层 `<AskUserDialogCard/>`（结构化问答，复用）
  - 否则 → `<PermissionApprovalCard/>`（allow/deny，design §4.2 分流）
- `onResolved` 回调仍透传给内层卡，行为不变
- 来源字段（workspace_name/session_type/run_summary）由 task-05 的 `SessionPermissionRequest` 扩展提供；本任务只消费

## 验收标准

- 来源上下文条正确渲染（工作区名 · 场景 badge · 会话链接 · 运行链接 · 时间 · run_summary/占位）
- 会话链接跳转 `/runtimes?session=<session_id>` 且 runtimes 页能恢复弹窗（page.tsx:812）
- `run_summary` 为空时显示「会话进行中」占位
- `AskUserDialogCard` 零改动（props 契约不破坏）
- AC-3 达成（design §7 来源上下文条 + 跳转）

## 验证

```bash
cd frontend && pnpm typecheck && pnpm test
```

（重点：DialogContextBar 渲染快照、session_type 映射、空 run_summary 占位、跳转 href 正确）

## 约束

- D-002 来源上下文 + 跳转；C5 兄弟包裹（不改 AskUserDialogCard）；C8 跳 `/runtimes?session=`
- CLAUDE.md 规则 16 样式参考 prototype；规则 11 中文 UI（badge 文案「扫描/对话/stage」等中文，session_id/run_id 技术标识不译）
- 仅写 `allowed_paths` 两个文件；来源字段消费依赖 task-05 完成
