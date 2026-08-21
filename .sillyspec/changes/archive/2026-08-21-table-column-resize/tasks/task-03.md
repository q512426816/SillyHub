---
id: task-03
title: '5 单测 + 全量验证 + Docker 实测 PPM 列表'
title_zh: '5 单测 + 全量验证 + Docker 实测 PPM 列表'
author: 'qinyi'
created_at: 2026-08-21 02:49:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/layout/use-resizable-columns.test.tsx
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - 用例1 number width 列手柄渲染+用例2 string/无 width 无手柄
  - 用例3 fireEvent mouseDown/mouseMove(document)/mouseUp 模拟拖拽 width 增大且回调收 dataIndex 键
  - 用例4 排序列手柄交互不触发 onChange sorter
  - 用例5 3px 内微动不触发回调
  - 全量 pnpm test+tsc+eslint，Docker rebuild 实测 PPM 项目列表拖拽
acceptance:
  - 5 用例全绿
  - 全量测试 0 失败
  - Docker 实测拖拽流畅无排序误触
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
