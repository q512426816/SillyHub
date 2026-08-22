---
id: task-08
title: portal-tests-and-adaptations
title_zh: 门户测试与既有测试适配
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: [task-07]
blocks: [task-09]
requirement_ids: [FR-07]
decision_ids: [D-003@v1, D-004@v1]
expects_from:
  task-01:
    - contract: sessions-portal
      needs: [scope-discriminated-union, session-deeplink]
  task-04:
    - contract: list-panel-scope
      needs: [author-self-filter]
  task-07:
    - contract: legacy-retired
      needs: [sections-removed]
provides:
  - contract: portal-tests-green
    fields: [three-scope-cases, deeplink-cases, migration-semantics]
allowed_paths:
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/sessions/__tests__/new-session-form.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
goal: >
  新建 sessions-portal.test 三 scope 门户新测试并同波适配三处既有测试（design §4.F），收口退役语义迁移对账为 task-09 铺路。
implementation:
  - '新建 sessions-portal.test.tsx——三 scope 渲染用例（列表 queryFn 路由到对应 API、NewSessionForm 绑定透传、标题带范围后缀）+ 仅本人过滤（含 change 级从跨成员变仅本人的有意统一断言）+ ?session= 深链有效/无效两分支 + 创建绑定 workspace_id 与 change_id+workspace_id 双传'
  - 'session-list-panel.test.tsx 补 scope 用例（mock listWorkspaceAgentSessions 与 listChangeSessions 两 API）；new-session-form.test.tsx 补锁定用例（bindWorkspaceId 隐藏 picker、bindChangeId 双传 createSession 参数）；sessions 页 page.test.tsx 薄壳化适配——18 用例（现状 5+4+2+2+1+1+3）断言语义保留对账，渲染出口经门户组件间接覆盖'
acceptance:
  - '四个测试文件新增与适配用例全绿'
  - '对账双清单——page.test 18=18 语义保留；退役 4 用例语义在新用例有落点（仅本人过滤/创建绑定/ended 恢复/?session= 深链）'
verify:
  - 'cd frontend && pnpm exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx src/components/sessions/__tests__/session-list-panel.test.tsx src/components/sessions/__tests__/new-session-form.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx"'
constraints:
  - '禁删既有用例且断言语义保留（可改装配细节，不可丢断言点）；card 测试已归 task-06 本卡不重复动'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
