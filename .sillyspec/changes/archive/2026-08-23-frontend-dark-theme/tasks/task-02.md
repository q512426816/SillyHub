---
id: task-02
title: add-dark-variable-block-and-fix-hardcoded-colors-in-globals-css
title_zh: globals.css 新增 dark 变量块并修正硬编码与清理遗留死块
author: qinyi
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: []
blocks: [task-08, task-10]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/globals.css
goal: >
  在 globals.css 新增 '[data-theme="dark"]' 第三套 CSS 变量块（HSL 语义变量 +
  --color-* 翻转取值 + 黑基调阴影），并把斑马纹、spinner、--muted-fg 三处硬编码
  色改为主题变量、清理未启用的遗留 .dark 死块；浅色两主题渲染结果逐值零变化。
implementation:
  - 新增 '[data-theme="dark"]' 全套变量块——HSL 语义（--background/--card/--primary/--muted/--border 等）、--color-primary/primary-hover/accent、--color-brand-50..950 翻转阶、--color-slate-50..900 翻转阶、--color-bg/card/border 与语义五色、阴影黑基调（--shadow-primary 取 rgba(139,92,246,0.28)）
  - 新变量 --color-loading-track 三套块各定义——浅色两主题保持 rgba(0,0,0,0.08) 原值、dark 取 rgba(255,255,255,0.12)；.silly-route-loading__spinner 边框改 var(--color-loading-track)
  - DataTable 斑马纹 color-mix 第三参 '#ffffff' 改 var(--color-card)（浅色两主题 --color-card 均为纯白，等值零回归）
  - '--muted-fg 在三套块各定义真值（.silly-route-loading 处 var(--muted-fg, #8c8c8c) 兜底随之失效可保留）'
  - 删除 176-196 行未启用的遗留 .dark 类块（蓝灰调旧取值，与本次 dark 无关，避免误导后续开发）
acceptance:
  - html data-theme 为 dark 时全部主题变量来自 '[data-theme="dark"]' 块，取值与 task-01 的 themes.ts dark 定义人工同步一致
  - 斑马纹与 spinner 边框不再有主题不感知的硬编码色；--muted-fg 三套块均有定义
  - 浅色两主题渲染结果逐值零变化——--color-card 仍为纯白、--color-loading-track 等于 rgba(0,0,0,0.08)、斑马纹混色等值
  - 遗留 .dark 类块已删除，文件内无残留
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm build 通过，产物 CSS 中 dark 块完整且无 .dark 类选择器残留
constraints:
  - 浅色两主题渲染结果逐值零变化，既有取值只允许以等值形式变量化迁移
  - 只修改 frontend/src/app/globals.css 单文件；dark 取值必须与 task-01 定义逐项一致，禁止自行调色
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
