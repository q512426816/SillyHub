---
id: task-11
title: 清扫 Wave C——components/lib/stores 杂项域（含 agent-profile-form/lib-file-utils hex 直引 + 本域 message 裸调迁移）+ **同步更新 components 域 `__tests__` 中断言 blue 类名的 5 个用例文件**（change-step-badge / change-step-timeline / machine-card / session-list-layout / turn-segment-views），断言随 brand-* 类名同步改写（覆盖：FR-04, D-003@v2）
title_zh: 清扫 Wave C——components/lib/stores 杂项域（含 agent-profile-form/lib-file-utils hex 直引 + 本域 message 裸调迁移）+ **同步更新 components 域 `__tests__` 中断言 blue 类名的 5 个用例文件**（change-step-badge / change-step-timeline / machine-card / session-list-layout / turn-segment-views），断言随 brand-* 类名同步改写（覆盖：FR-04, D-003@v2）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-09, task-10]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/components/
  - frontend/src/lib/
  - frontend/src/stores/
  - frontend/src/components/changes/__tests__/change-step-badge.test.tsx
  - frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  - frontend/src/components/daemon/__tests__/machine-card.test.tsx
  - frontend/src/components/daemon/__tests__/session-list-layout.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
related_tests:
  - frontend/src/components/changes/__tests__/change-step-badge.test.tsx（断言 bg-blue-600 等类名需随 brand-* 改写）
  - frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx（断言 blue 类名需随 brand-* 改写）
  - frontend/src/components/daemon/__tests__/machine-card.test.tsx（断言 blue 类名需随 brand-* 改写）
  - frontend/src/components/daemon/__tests__/session-list-layout.test.tsx（断言 blue 类名需随 brand-* 改写）
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（断言 blue 类名需随 brand-* 改写）
goal: >
  清扫 components/lib/stores 杂项域品牌蓝——blue-* 类名与 hex 直引迁 brand-* 语义阶/主题变量、域内 message 裸调迁 useNotify，并同步改写 5 个断言 blue 类名的测试用例。
implementation:
  - C 域 grep 定界 36 文件（antd-providers.tsx 除外归 task-05）品牌用途 blue-*（含全部浅档）逐处改 brand-* 语义阶；其中 agent-profile-form.tsx 与 lib/file/utils.tsx 的 hex 直引（#2563eb/#3b82f6）改 themes/brand 阶或 CSS 变量引用
  - 本域 message 裸调迁 useNotify——ppm-user-select.tsx、sessions/session-config-bar.tsx、stores/kanban.ts
  - 5 个 __tests__ 用例断言的 blue 类名随组件 brand-* 改写同步更新
acceptance:
  - 域内 grep -rlE bg-blue|text-blue|border-blue|#2563eb|#3b82f6 仅剩真信息蓝且逐一判断注明理由
  - 域内无 antd message 裸调残留；5 个测试断言与组件类名一致且 pnpm test 全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 清扫原则 D-003@v2——品牌用途（含全部浅档）→ brand-* 语义阶；真信息蓝逐一判断保留 blue 阶；不许盲目全局替换，替换后同文件 grep 自检；useNotify 仅迁 import antd message 的裸调（App.useApp 语境内的不算）
  - antd-providers.tsx 的 antd token 引用归 task-05 本卡不碰；top-bar.tsx 仅清扫 blue 类名不动 ThemeToggle 接入
  - 测试仅同步断言类名不改测试逻辑；不碰 app/ 域文件（归 task-09/10/12）；不改业务逻辑/数据流/SSE 协议
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
