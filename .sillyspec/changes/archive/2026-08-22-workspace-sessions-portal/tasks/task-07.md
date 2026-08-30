---
id: task-07
title: retire-legacy-section-components
title_zh: 退役旧会话区组件
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: [task-02, task-03, task-06]
blocks: [task-08]
requirement_ids: [FR-06]
decision_ids: [D-005@v1]
expects_from:
  task-02:
    - contract: entries-wired
      needs: [workspace-entry-wired]
  task-01:
    - contract: sessions-portal
      needs: [session-deeplink]
provides:
  - contract: legacy-retired
    fields: [sections-removed, no-dangling-imports]
allowed_paths:
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/components/changes/change-session-section.tsx
  - frontend/src/components/__tests__/workspace-session-section.test.tsx
  - frontend/src/components/changes/__tests__/change-session-section.test.tsx
goal: >
  三入口全接线后退役两个旧会话区组件及其测试（design §4.E）——git rm 四文件加全仓 grep 守护，零 dangling import 收口。
implementation:
  - 'git rm 四文件——workspace-session-section.tsx 与 change-session-section.tsx 两组件及其两测试文件（退役即删测试，4 用例语义迁移落点清单归 task-08 门户新用例，不留守卫红）'
  - '全仓 grep 守护——frontend/src 下两组件名零 import 引用残留（唯一消费方已分别在 task-02/task-06 切走，design 自审实测各仅 1 消费方）'
acceptance:
  - '四文件在工作区不存在；grep 两组件名于 frontend/src 零 import 残留；pnpm exec tsc --noEmit 零 error；pnpm exec vitest run 全绿（退役即删测试不留守卫红）'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run'
  - 'grep -rn "workspace-session-section\|change-session-section" frontend/src 应零 import 命中（注释历史提及人工核对放行）'
constraints:
  - '先确认 W3 三入口全接线才删——本卡依赖 task-02/task-03/task-06 即此保证，执行时再核 git 状态与三路由渲染点'
  - '注释中历史提及可保留（规则 18 顺手校正仅限本任务四文件内注释，四文件整体删除故不涉及）；ended 会话恢复改 page 模式手动重开为有意交互变更，由 page 模式既有 reopen 断言承接'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
