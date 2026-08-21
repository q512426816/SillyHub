---
id: task-11
title: 'lint + type check'
title_zh: 'lint + 类型检查'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-10]
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/**
goal: >
  lint + 类型检查零 error
implementation:
  - 运行 pnpm lint 检查代码风格
  - 运行 pnpm exec tsc --noEmit 检查类型安全
  - 如有 lint error，修复代码使其通过
  - 如有类型错误，修复类型使其通过
  - 确保 frontend/ 下零 error
acceptance:
  - pnpm lint 零 error
  - pnpm exec tsc --noEmit 零 error
  - 不引入新的 warning（已有的不处理）
verify:
  - cd frontend && pnpm lint && pnpm exec tsc --noEmit
constraints:
  - 仅修复本次变更引入的问题
  - 不修改已有代码的 lint 问题（预存债）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
