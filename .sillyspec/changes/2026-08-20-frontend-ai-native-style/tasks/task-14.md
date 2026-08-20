---
id: task-14
title: vitest 单测——themes 两套结构一致性（color 键集合/brand 十一档/五档语义）/ store 切换与持久化 / antd token 跟随当前主题（覆盖：FR-01, FR-02, FR-03）
title_zh: vitest 单测——themes 两套结构一致性（color 键集合/brand 十一档/五档语义）/ store 切换与持久化 / antd token 跟随当前主题（覆盖：FR-01, FR-02, FR-03）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: [task-15]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-101@v1, D-102@v1, D-003@v2]
expects_from:
  task-01:
    - contract: themes
      needs: [blue, ai-native]
    - contract: ThemeDef
      needs: [name, label, color]
  task-04:
    - contract: useThemeStore
      needs: [theme, setTheme]
allowed_paths:
  - frontend/src/styles/themes.test.ts
  - frontend/src/stores/theme.test.ts
goal: >
  为主题机制补 vitest 单测——锁定两套主题结构一致性、store 切换与持久化、antd token 跟随，
  给 task-15 总验收提供自动化证据。
implementation:
  - 新增 frontend/src/styles/themes.test.ts（与源码同目录 colocate，写法参照 stores/workspace.test.ts 的头注+describe 惯例）——断言 blue 与 ai-native 两套 color 键集合深度相等（Object.keys 排序后 toEqual）
  - 同文件断言每套 brand 十一档（50-950）键集合齐全、semantic 五档（success/warning/error/info/neutral）键集合齐全
  - 同文件断言 DEFAULT_THEME 为 ai-native 且 themes 恰含 blue 与 ai-native 两键
  - 新增 frontend/src/stores/theme.test.ts——初始 theme 等于 DEFAULT_THEME；setTheme 在 blue 与 ai-native 间切换后 getState 读取正确
  - persist 断言——setTheme 后 jsdom 的 window.localStorage 中 sillyhub-theme 键写入当前 theme（JSON 解析对照）
  - 非法持久化值兜底——向 localStorage 预写非法值后重建 store（vi.resetModules+动态 import），theme 兜底回 DEFAULT_THEME
  - antd token 跟随断言（写入 theme.test.ts）——切主题后 provider 侧 token 取值与 themes[theme].color 对照一致（经 task-01 ThemeDef 契约）
acceptance:
  - themes.test.ts 全绿——两套 color 键集合深度相等、brand 十一档与 semantic 五档齐全、DEFAULT_THEME=ai-native
  - theme.test.ts 全绿——setTheme 切换、persist 写 sillyhub-theme、非法持久化值兜底、antd token 经 themes[theme].color 对照跟随
  - 两个测试文件均与源码同目录 colocate，不新增 __tests__ 目录、不引新测试依赖
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只新增两个测试文件不改业务源码——发现上游缺陷回报并在对应任务修复
  - 不新增第三主题、不改 DEFAULT_THEME 取值
  - persist 测试用 jsdom 原生 localStorage，不引 mock 新依赖
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
