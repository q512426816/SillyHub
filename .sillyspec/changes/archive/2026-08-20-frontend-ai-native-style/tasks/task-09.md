---
id: task-09
title: 清扫 Wave A——ppm 域 + kanban 集群（品牌用途含浅档 blue-*→brand-*；kanban PALETTE 阶引用迁 themes/brand；本域 message 裸调文件 kanban×4 + work-hour-statistics 的 useNotify 迁移并入）（覆盖：FR-04, D-003@v2）
title_zh: 清扫 Wave A——ppm 域 + kanban 集群（品牌用途含浅档 blue-*→brand-*；kanban PALETTE 阶引用迁 themes/brand；本域 message 裸调文件 kanban×4 + work-hour-statistics 的 useNotify 迁移并入）（覆盖：FR-04, D-003@v2）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-08]
blocks: [task-10, task-11]
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/
  - frontend/src/app/m/ppm/
  - frontend/src/app/(dashboard)/ppm/kanban/page.tsx
  - frontend/src/app/(dashboard)/ppm/work-hour-statistics/page.tsx
goal: >
  清扫 ppm 域（含移动端 m/ppm）与 kanban 集群的品牌蓝——blue-* 类名迁 brand-* 语义阶、kanban PALETTE 阶引用迁 themes/brand、域内 message 裸调迁 useNotify，使 PPM 在两套主题下观感一致。
implementation:
  - ppm/workbench/page.tsx + workbench/_components 4 文件（personal-metric-strip/quick-entry-grid/todo-list-panel/work-calendar-panel）与 m/ppm 5 文件的品牌用途 blue-*（含全部浅档 bg-blue-50/border-blue-200 等）逐处改 brand-* 语义阶
  - kanban/page.tsx + kanban/_components 3 文件（kanban-task-detail-drawer/kanban-work-hour-chart/kanban-workload-grid）的 PALETTE 阶引用由 tokens 阶常量改 themes/brand 阶
  - 本域 message 裸调迁 useNotify——kanban×4 + work-hour-statistics/page.tsx
  - 每文件替换后 grep 自检品牌蓝清零
acceptance:
  - 域内 grep -rlE bg-blue|text-blue|border-blue 仅剩真信息蓝且逐一判断注明理由
  - 域内 grep antd message import 无裸调残留（useNotify 全覆盖）
  - blue 主题下 PPM/kanban 页对照重构前观感一致（design §9 口径，info 档除外）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 清扫原则 D-003@v2——品牌用途（按钮/选中态/强调，含全部浅档）→ brand-* 语义阶；真信息蓝（信息提示语义）保留 blue 阶逐一判断，不许一刀切
  - 逐处判断不许盲目全局替换；替换后同文件 grep 自检
  - kanban/page.tsx 为 PALETTE+message 双改文件，归本卡处理，task-10/11 不得再碰
  - useNotify 迁移仅限 import antd message 的裸调（lib/errors.ts 封装）；App.useApp 语境内的不算
  - 不改业务逻辑/数据流/API/SSE 协议；Wave 内先于 task-10/11 执行
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
