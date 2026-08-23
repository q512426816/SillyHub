---
id: task-01
title: add-dark-theme-values-to-themes-registry
title_zh: themes.ts 新增 dark 主题取值（翻转色阶 + 语义提亮 + 注册表）
author: qinyi
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: []
blocks: [task-04, task-05, task-06, task-07, task-08, task-09, task-10]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-004@v1]
provides:
  - contract: ThemeName
    fields: [dark]
  - contract: themes
    fields: [dark]
allowed_paths:
  - frontend/src/styles/themes.ts
goal: >
  在主题取值单一源 themes.ts 中新增第三套 dark 主题取值——ThemeName 联合类型扩
  'dark'，slate/brand 色阶对称翻转、主色与语义提亮一档并注册 label 暗夜，为
  globals.css 变量块与 store/layout/antd-providers/theme-toggle/图表接线提供取值契约。
implementation:
  - ThemeName 联合类型扩为 'blue' | 'ai-native' | 'dark'
  - 新增 darkTheme（ThemeDef）——slate 阶对称翻转（50↔900、100↔800、200↔700、300↔600、400↔500），brand 阶对称翻转（50↔950、100↔900、200↔800、300↔700、400↔600、500 自映）
  - 关键取值 primary '#8b5cf6'（violet-500）、primaryHover '#a78bfa'（violet-400）、accent '#22d3ee'（cyan-400）、bg '#0f172a'、card '#1e293b'、border '#334155'（slate-900/800/700）
  - 语义提亮档 success '#10b981'、warning '#f59e0b'、error '#ef4444'、info '#22d3ee'、neutral '#94a3b8'（slate-400）；label '暗夜'，themes 注册表新增 dark 项
acceptance:
  - themes 注册表含 dark 键且 name/label/color 完整，label 为 暗夜，DEFAULT_THEME 仍为 ai-native 不变
  - 翻转对称性可断言——dark.slate 十档与浅色 slate 阶镜像（dark.slate.50 等于 slate.900 等），dark.brand 十一档与 ai-native violet 阶镜像（500 自映）
  - 全部取值逐项来自 Tailwind v3 默认值（design §5.1 取值表），无任何自调色
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 色阶取值禁止自行调整，严格按 Tailwind v3 默认值与 D-004@v1 对称翻转规则；blue 与 ai-native 两套既有取值零改动
  - 只修改 frontend/src/styles/themes.ts 单文件（globals.css 变量块归 task-02，取值断言测试归 task-10）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
