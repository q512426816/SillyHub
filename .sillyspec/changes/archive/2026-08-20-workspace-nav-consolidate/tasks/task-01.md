---
id: task-01
title: '概览删宫格+quick-entry-grid.tsx 删除+page.test 宫格断言删'
title_zh: '概览删宫格+quick-entry-grid.tsx 删除+page.test 宫格断言删'
author: 'qinyi'
created_at: 2026-08-20 20:28:05
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/workspace/quick-entry-grid.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - page.tsx 删 QuickEntryGrid import 与渲染段（约 :470 与段③注释）
  - git rm quick-entry-grid.tsx（全仓引用仅 page.tsx，删除后 grep 清零）
  - page.test.tsx 删宫格 href 断言用例（约 :259 起）
acceptance:
  - 概览页无宫格渲染
  - QuickEntryGrid 全仓引用清零
  - page.test 全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 边界约束 1（如：不加测试）
  - 边界约束 2（如：不修改传入参数）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
