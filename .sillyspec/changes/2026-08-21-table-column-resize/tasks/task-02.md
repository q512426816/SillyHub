---
id: task-02
title: 'DataTable 接入（onColumnsResize 回调 key=dataIndex）+ PpmResourceTable 默认宽兜底'
title_zh: 'DataTable 接入（onColumnsResize 回调 key=dataIndex）+ PpmResourceTable 默认宽兜底'
author: 'qinyi'
created_at: 2026-08-21 02:49:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/layout/data-table.tsx
  - frontend/src/components/ppm-resource-table.tsx
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - DataTable props 加 onColumnsResize 可选；columns 经 hook 包装+components.header.cell 透传 Table（与用户 components 合并）
  - PpmResourceTable 无 width 业务列按类型映射默认宽（文本 160/日期 130/数字 110/枚举 120）
  - 类型映射常量集中定义带注释
acceptance:
  - DataTable 消费页零改动获得拖拽
  - PPM 三页业务列全部可拖
  - onColumnsResize 回调 key=dataIndex
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
