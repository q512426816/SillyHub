---
id: task-07
title: full-regression-and-smoke
title_zh: 全量回归与双主题五面冒烟
author: qinyi
created_at: 2026-08-22 13:50:00
priority: P0
depends_on: [task-02, task-03, task-04, task-06]
blocks: [task-08]
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
expects_from:
  task-02:
    - contract: dialog-antd-chrome
      needs: [five-spots-antd]
  task-03:
    - contract: badge-antd
      needs: [status-mapping-applied]
  task-04:
    - contract: inputbar-antd
      needs: [send-primary]
provides:
  - contract: regression-green
    fields: [vitest-tsc-lint-zero-fail, theme-switch-ok, five-surface-smoke-ok]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  收口本变更全部代码任务——三件套零失败、双主题换肤与 5 面人工冒烟对照原型一致，allowed_paths 仅登记被验证关键入口非改动授权（plan 全局验收 1-5）。
implementation:
  - 跑全量 vitest 与 tsc --noEmit 与 pnpm lint——迁移三套 56=56 禁删用例与页面 18 用例对账，并三守护 grep 复核（全仓无 dangling import、三目标文件无 shadcn button 与 badge 残件、无新增硬编码 hex）
  - 冒烟——blue 与 ai-native 双主题互切换肤正常；5 个消费面人工对照原型 §①-§⑥（/sessions 页、/runtimes 弹窗、workspace 会话区、change 会话区、runtime chat section），记录（截图或文字）留档于本变更目录
acceptance:
  - vitest 与 tsc 与 lint 三件套零失败，56=56 与 18 页面用例对账通过，三守护 grep 复核通过
  - 双主题切换正常，5 面冒烟与原型一致且冒烟记录留档于变更目录
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 本任务不修产品码——发现缺陷回派对应 task 修复或另开 quick；冒烟用本机 dev server 进行，不改 team-unify 任何文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
