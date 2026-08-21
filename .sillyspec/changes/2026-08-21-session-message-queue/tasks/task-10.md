---
id: task-10
title: 'regression tests'
title_zh: 'sessions + runtimes 页面回归测试'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-06, task-07, task-08, task-09]
blocks: [task-11]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/**
  - frontend/src/app/(dashboard)/runtimes/**
goal: >
  sessions + runtimes 页面回归测试
implementation:
  - 运行全量 vitest 测试套件
  - 检查 sessions 页面相关测试是否全部通过
  - 检查 runtimes 页面相关测试是否全部通过
  - 检查新增的 useMessageQueue 和 MessageQueueBar 测试是否全部通过
  - 如有失败用例，分析是预存债还是本次变更引入，仅修复本次引入的问题
acceptance:
  - vitest run 全量通过（无新增失败）
  - sessions 页面相关测试全部通过
  - runtimes 页面相关测试全部通过
  - 新增测试（task-08, task-09）全部通过
verify:
  - cd frontend && pnpm exec vitest run
constraints:
  - 不修改测试用例来绕过失败（预存债除外）
  - 仅修复本次变更引入的测试问题
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
