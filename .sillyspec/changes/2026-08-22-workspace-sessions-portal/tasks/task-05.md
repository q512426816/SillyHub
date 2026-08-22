---
id: task-05
title: add-bind-lock-to-new-session-form
title_zh: 新建会话表单锁定绑定
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: []
blocks: [task-01]
requirement_ids: [FR-02, FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/new-session-form.tsx
provides: [{contract: form-bind-lock, fields: [bind-workspace-id, bind-change-id-dual]}]
goal: >
  给 NewSessionForm 增加可选 bindWorkspaceId 与 bindChangeId 锁定绑定入参，锁定时隐藏 WorkspaceSessionPicker 且 createSession 直传绑定值（change 级隐含 workspace 双传），缺省零变化，供 task-01 门户按 scope 锁定创建归属
implementation:
  - props 增加可选 bindWorkspaceId 与 bindChangeId；锁定时 workspaceId 有效值直接取绑定值，用户不可改（不走 handleWsChange 用户选择链路）
  - bindWorkspaceId 锁定时第⓪区不渲染 WorkspaceSessionPicker（可换锁定提示条展示绑定工作区），createSession 的 workspace_id 恒传绑定值
  - bindChangeId 锁定时 createSession 同时带 change_id 与 workspace_id 双传（先例为 daemon/session-panel.tsx 2347 行 change_id 与 workspace_id 同体展开）
  - 缺省（两参均不传）表单行为零变化，四选择器联动与默认机器三级回退现状保留
acceptance:
  - bindWorkspaceId 锁定时 WorkspaceSessionPicker 不渲染且 createSession 参数含绑定 workspace_id
  - bindChangeId 锁定时 createSession 参数含 change_id 且 workspace_id 双传
  - 缺省路径 new-session-form.test.tsx 现有用例全绿
  - pnpm exec tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/new-session-form.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改四选择器联动逻辑与默认机器三级回退
  - change 绑定隐含 workspace 双传，不允许只传 change_id
  - 不新增/改动测试文件（锁定绑定用例归 task-08）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
