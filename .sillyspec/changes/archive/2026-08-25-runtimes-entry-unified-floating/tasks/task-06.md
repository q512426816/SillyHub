---
id: task-06
title: 'regression check frontend type and affected tests'
title_zh: '回归前端 tsc 与 floating/sessions/runtimes 三组测试'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P0
depends_on: ['task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src
goal: >
  全量回归验证：pnpm exec tsc 零错误，floating/sessions/runtimes 三组受影响目录既有测试全绿，
  确认五 task 合并后无跨任务断裂（FR-01~05 收口）。
implementation:
  - 跑 pnpm exec tsc --noEmit 确认类型零错误
  - 跑 floating-session-host 与 floating-session store 测试
  - 跑 sessions 目录测试（session-list-panel 与 sessions-portal）
  - 跑 runtimes 目录测试
  - 任一失败回查对应 task 修复后重跑
acceptance:
  - pnpm exec tsc --noEmit 退出码 0
  - floating/sessions/runtimes 三组测试全部通过
  - 无因本变更引入的新失败（预存失败以 main 基线对账排除）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/floating src/components/sessions "src/app/(dashboard)/runtimes" src/stores
constraints:
  - 预存测试债（main 基线已红）不算本变更失败，但须在汇报中如实列出
  - 不改测试逻辑通过红线（规则 11：非测试逻辑有误修逻辑）
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
