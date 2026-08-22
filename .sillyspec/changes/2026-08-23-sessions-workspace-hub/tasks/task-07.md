---
id: task-07
title: 'change-entry-and-form-retirement'
title_zh: 'change 入口 preContext 与 NewSessionForm 退役'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-106@v1, D-109@v1]
allowed_paths:
  - frontend/src/components/sessions/new-session-form.tsx
  - frontend/src/components/sessions/workspace-session-picker.tsx
  - frontend/src/components/sessions/__tests__/
  - frontend/src/app/(dashboard)/sessions/__tests__/
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx
  - .sillyspec/changes/2026-08-23-sessions-workspace-hub/migration-notes.md
goal: >
  change 入口经 scope 派生 preContext（workspaceId+changeId 显式双传 X-13）；NewSessionForm/
  WorkspaceSessionPicker 三入口全量退役（D-109）；三页面薄壳与页面测试迁移。
implementation:
  - change 入口：/workspaces/[id]/changes/[cid]/sessions 经 scope 派生 preContext（双传）；预会话上下文行加显变更名（D-106）；该页左侧维持 scope 列表现状（design §3）
  - 退役：删 new-session-form.tsx + workspace-session-picker.tsx（真实消费经审查核实仅 sessions-portal.tsx 与表单自身；先全仓 grep 复核）+ 对应测试 + app/(dashboard)/sessions/__tests__/page.test.tsx 迁移（「新建会话→表单态」「NewSessionForm onCreated」等断言改预会话态语义）
  - 迁移清单 migration-notes.md（R-06，唯一落点）：new-session-form.test 既有断言语义落新家（默认机器回退→task-06 解析单测；锁定绑定→change 入口用例；提交参数→task-03 首句创建用例），逐条注明落点或有意删除
  - 三页面薄壳随门户 props 微调（change 页传 preContext 初始值；全局/工作区页零 props 变化则只动 import 清理）
  - 全仓 grep 守护：NewSessionForm/WorkspaceSessionPicker/NEW_SESSION_MACHINE_LS_KEY/resolveDefaultMachineId 旧导入零残留（函数与 LS_KEY 已 task-06 迁入 sessions-portal.tsx，本卡只删源与旧 import）
acceptance:
  - change 入口预会话上下文行显示 变更名+工作区+机器+智能体；创建请求 change_id+workspace_id 双传
  - 退役文件删除后 tsc 零错、全仓 grep 零引用
  - migration-notes.md 落盘，旧断言语义 100% 有落点
verify:
  - pnpm typecheck && pnpm exec vitest run（sessions 页面与组件测试）
  - 全仓 grep 四标识零残留
constraints:
  - D-005 LS_KEY 语义保留（回退链在用）
---

# task-07 补充说明
无。
