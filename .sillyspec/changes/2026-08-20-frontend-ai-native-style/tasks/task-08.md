---
id: task-08
title: 删除 `tokens.ts` + 其余 8 处消费方迁移（work-hour-statistics / topology / kanban×4 / aggregations.ts / styles/index.ts barrel）+ tsc 断链复核（覆盖：FR-04, D-003@v2）
title_zh: 删除 `tokens.ts` + 其余 8 处消费方迁移（work-hour-statistics / topology / kanban×4 / aggregations.ts / styles/index.ts barrel）+ tsc 断链复核（覆盖：FR-04, D-003@v2）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-05]
blocks: [task-09, task-10, task-11, task-14]
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/styles/tokens.ts
  - frontend/src/styles/index.ts
  - frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/page.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-actual-gantt.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-gantt.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-workload-grid.tsx
  - frontend/src/lib/ppm/aggregations.ts
expects_from:
  task-01:
    - contract: themes
      needs: [blue, ai-native]
goal: >
  彻底删除已被 themes.ts 取代的 tokens.ts，迁移其余 8 处消费方到主题注册表与 brand
  语义阶取值，tsc 断链复核清零，完成样式单一源切换（design §6 删除行）。
implementation:
  - 删除 frontend/src/styles/tokens.ts 整个文件，不留 re-export 壳
  - styles/index.ts barrel 移除 tokens 与 cssVars 重导出，barrel 无剩余导出则连文件一并删除
  - work-hour-statistics 与 topology 两页面取色由 tokens 常量改 themes 注册表取值
  - kanban 四文件（page.tsx 与 _components 的 kanban-actual-gantt、kanban-gantt、kanban-workload-grid）PALETTE 色板由 tokens 阶常量改 themes 的 brand 阶引用
  - lib/ppm/aggregations.ts 的 tokens 引用同步迁移后，grep 复核全 src 无残留
acceptance:
  - frontend/src/styles/tokens.ts 不复存在，全 src grep 无任何指向 tokens 或 cssVars 的 import（含经 @/styles barrel 的命名导出）
  - 各消费方两主题下渲染正确，blue 主题观感与旧版一致（brand 阶原样平移）
  - cd frontend && pnpm exec tsc --noEmit 零报错（断链复核）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep 全量扫描 frontend/src 确认无 styles/tokens 路径引用与 @/styles barrel 的 tokens 命名导出残留
constraints:
  - antd-providers.tsx 已在 task-05 迁移，本卡不得触碰 frontend/src/components/antd-providers.tsx
  - tokens.ts 彻底删除，不留 re-export 壳或过渡别名
  - 迁移只换取值来源，不改各页面业务逻辑与图表数据处理
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
