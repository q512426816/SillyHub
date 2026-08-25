---
id: task-05
title: 'delete legacy runtime session dialog dead code'
title_zh: '删除旧 RuntimeSessionDialog 弹窗及测试死代码'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P1
depends_on: ['task-04']
blocks: [task-06]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
  - frontend/src/components/daemon/runtime-session-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-dialog-reconnect.test.tsx
goal: >
  task-04 清零 page.tsx 引用后，删除旧 RuntimeSessionDialog 组件与其两个测试文件，
  消除双弹窗形态分叉死代码（FR-01 收口）。
implementation:
  - 全局 grep 确认 RuntimeSessionDialog 仅余组件自身与测试引用（page.tsx 已由 task-04 摘除）
  - 删除 runtime-session-dialog.tsx 组件文件
  - 删除 runtime-session-dialog.test.tsx 与 runtime-session-dialog-reconnect.test.tsx 两个测试文件
acceptance:
  - 三个文件不再存在于工作区
  - 全局 grep RuntimeSessionDialog 零命中
  - pnpm exec tsc --noEmit 无引用错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -r RuntimeSessionDialog frontend/src 无残留引用
constraints:
  - 必须在 task-04 完成引用清零后执行，防删后编译断
  - 不删 session-list-layout.tsx（ChangeSessionSection 仍在用，非本变更范围）
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
