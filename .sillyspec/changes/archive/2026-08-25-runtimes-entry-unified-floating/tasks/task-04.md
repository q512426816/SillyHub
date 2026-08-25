---
id: task-04
title: 'rewire runtimes page session button to floating store'
title_zh: 'runtimes 页会话按钮接线改为唤起悬浮助手'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P0
depends_on: ['task-01']
blocks: [task-05, task-06]
requirement_ids: [FR-01, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
expects_from:
  task-01:
    - contract: FloatingSessionState
      needs: [openRuntimeSession]
goal: >
  runtimes 页「会话」按钮不再打开旧 RuntimeSessionDialog，改为调用悬浮 store
  openRuntimeSession 唤起全局抽屉并锁定该 runtime；URL ?session= 恢复改为 store.selectSession
  打开抽屉选中会话（FR-01/FR-05）。
implementation:
  - handleOpenSession 改为 useFloatingSessionStore openRuntimeSession（传 runtime.id 与机器名/智能体名）
  - 删除 dialogRuntime 与 initialSessionId 两个 state 及 RuntimeSessionDialog 渲染
  - 删除 handleCloseDialog 与 clearSessionParam 中弹窗专属逻辑
  - URL ?session= 恢复编排改为 openDrawer 加 selectSession（runtime 匹配校验不匹配的按全局态打开并清锁定）
  - page.test.tsx 断言改为点按钮调 store（不再断言 Radix dialog 渲染）
acceptance:
  - 点 runtime 卡「会话」按钮后 useFloatingSessionStore 的 lockedRuntime 被置且 open 为 true
  - 页面不再渲染 RuntimeSessionDialog（DOM 无 role 为 dialog 的旧弹窗）
  - ?session= 有效时抽屉打开且选中该会话
  - pnpm exec vitest run runtimes 全绿
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/runtimes"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本 task 只删 page.tsx 内的弹窗状态与渲染，组件文件删除归 task-05
  - 用量统计/别名编辑/可写目录等其它卡片功能零改动
related_tests:
  - path: frontend/src/app/(dashboard)/runtimes/page.test.tsx
    reason: 点按钮断言由渲染 RuntimeSessionDialog 改为调 store，旧断言失效需同步更新
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
