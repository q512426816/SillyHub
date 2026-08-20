---
id: task-10
title: 清扫 Wave B——`app/` 下非 ppm 域、非 login（归 task-12）的全部页面（workspaces/sessions/admin/settings/account/agent-profiles/runtimes/m/* 等；sessions/page 的 message 迁移并入）（覆盖：FR-04, D-003@v2）
title_zh: 清扫 Wave B——`app/` 下非 ppm 域、非 login（归 task-12）的全部页面（workspaces/sessions/admin/settings/account/agent-profiles/runtimes/m/* 等；sessions/page 的 message 迁移并入）（覆盖：FR-04, D-003@v2）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-09]
blocks: [task-11]
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/
  - frontend/src/app/(dashboard)/projects/
  - frontend/src/app/(dashboard)/runtimes/
  - frontend/src/app/(dashboard)/settings/
  - frontend/src/app/(dashboard)/account/
  - frontend/src/app/(dashboard)/admin/
  - frontend/src/app/(dashboard)/agent-profiles/
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/app/m/workspaces/page.tsx
goal: >
  清扫 app/ 下非 ppm 域、非 login 的全部页面品牌蓝——11 个 blue-* 文件迁 brand-* 语义阶，sessions/page 的 message 裸调迁 useNotify 并入，使两套主题下这些页面观感一致。
implementation:
  - 品牌用途 blue-*（含全部浅档）逐处改 brand-*：workspaces/[id] 4 页（approvals、changes/[cid]/tasks、explorer、mcp-tokens）、settings 3 页（api-keys、git-identities、skills）、account、runtimes、projects/[id]/missions、m/workspaces
  - sessions/page.tsx 的 antd message 裸调迁 useNotify()
  - 每文件替换后 grep 自检品牌蓝清零
acceptance:
  - 域内 grep（frontend/src/app 排除 ppm 与 login）仅剩真信息蓝且逐一判断注明理由
  - sessions/page.tsx 无 message 裸调残留
  - blue 主题下 B 域页面对照重构前观感一致（design §9 口径，info 档除外）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 清扫原则 D-003@v2——品牌用途（按钮/选中态/强调，含全部浅档）→ brand-* 语义阶；真信息蓝（信息提示语义）保留 blue 阶逐一判断，不许一刀切
  - 逐处判断不许盲目全局替换；替换后同文件 grep 自检
  - 不碰 ppm 域与 m/ppm（归 task-09）、不碰 login（归 task-12）、不碰 kanban/page.tsx（已由 task-09 处理）
  - useNotify 迁移仅限 import antd message 的裸调（lib/errors.ts 封装）；App.useApp 语境内的不算
  - 不改业务逻辑/数据流/API/SSE 协议
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
