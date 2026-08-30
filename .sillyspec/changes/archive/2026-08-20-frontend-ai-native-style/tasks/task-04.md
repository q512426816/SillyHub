---
id: task-04
title: stores/theme.ts useThemeStore（zustand persist，key sillyhub-theme，非法值兜底）（覆盖：FR-02, D-101@v1, D-102@v1）
title_zh: stores/theme.ts useThemeStore（zustand persist，key sillyhub-theme，非法值兜底）（覆盖：FR-02, D-101@v1, D-102@v1）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-01]
blocks: [task-05, task-07, task-14]
requirement_ids: [FR-02]
decision_ids: [D-101@v1, D-102@v1]
expects_from:
  task-01:
    - contract: DEFAULT_THEME
      needs: [ai-native]
    - contract: themes
      needs: [blue, ai-native]
provides:
  - contract: useThemeStore
    fields: [theme, setTheme]
allowed_paths:
  - frontend/src/stores/theme.ts
goal: >
  新建主题偏好 store useThemeStore（zustand persist，key=sillyhub-theme），
  持久化 ThemeName 并对非法存储值兜底回 DEFAULT_THEME，
  为 task-05 的 antd token 消费与 task-06 的防闪烁脚本提供唯一状态源。
implementation:
  - 新建 frontend/src/stores/theme.ts，create+persist 结构对照 stores/session.ts 先例；从 @/styles/themes 导入 ThemeName 与 DEFAULT_THEME
  - ThemeState 含 theme（初始 DEFAULT_THEME）与 setTheme（D-101@v1 state 驱动半边）
  - persist 配置 name 为 sillyhub-theme（D-102@v1），partialize 仅持久化 theme
  - 非法值兜底：自定义 merge（或 onRehydrateStorage）校验持久化 theme 不在 themes 键集合内时回退 DEFAULT_THEME（design §9，blue/ai-native 之外一律兜底）
  - 文件头 JSDoc 写明数据流边界：localStorage 即真相源，producer=本 store persist 写 sillyhub-theme，consumer=layout inline script（task-06 首帧）与 antd-providers（task-05，React 侧不走 localStorage 直读），格式对照 stores/workspace.ts 头注释先例
acceptance:
  - 初始与兜底一致：useThemeStore 导出且初始 theme 为 ai-native（DEFAULT_THEME），预置非法值（如 dark）后 rehydrate 也回 ai-native 且无运行时错误
  - setTheme 切换后 localStorage 的 sillyhub-theme 键同步更新（persist 生效），且仅改 theme 字段无额外副作用
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不写单测（themes/store 单测统一归 task-14）
  - 不做 antd token 消费与 html data-theme 同步（归 task-05）；不做防闪烁 inline script（归 task-06）
  - localStorage 即真相源边界必须写进 JSDoc 头注释（对照 workspace.ts 先例格式）防后续消费方直读；store 不持有多余状态（label/color 等取值经 themes 查表）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
