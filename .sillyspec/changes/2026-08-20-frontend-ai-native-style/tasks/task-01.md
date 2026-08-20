---
id: task-01
title: create-theme-registry-themes-ts
title_zh: 新建 styles/themes.ts 主题注册表，blue 与 ai-native 两套完整 ThemeDef + BrandScale 十一档，DEFAULT_THEME 为 ai-native
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: []
blocks: [task-02, task-04, task-05, task-12, task-14]
requirement_ids: [FR-01]
decision_ids: [D-101@v1, D-003@v2]
allowed_paths:
  - frontend/src/styles/themes.ts
  - frontend/src/styles/index.ts
goal: >
  建立 blue 与 ai-native 两套主题的 TS 取值单一源（接口对齐 design §7），为 task-02 CSS 变量、task-04 store、task-05 antd 动态化提供契约，默认主题切到 ai-native。
implementation:
  - 新建 frontend/src/styles/themes.ts，按 design §7 导出 ThemeName、BrandScale、ThemeColorDef、ThemeDef 类型与 themes、DEFAULT_THEME 常量（值为 ai-native）
  - blue 主题取值从现 tokens.ts 原样平移，ai-native 按评审模板取值（主色 violet-600、悬浮 violet-700、accent 青 0891B2、底色淡紫 FAF5FF、slate 正文沿用）；两套 brand 十一档分别照抄 Tailwind v3 默认 blue 阶与 violet 阶
  - semantic 五档两套齐全，info 档两主题统一取 accent 青（D-003@v2 例外声明，design §9）
  - 文件头注释沿用 tokens.ts 边界惯例（色阶用 Tailwind v3 默认值、新增颜色经 themes.ts 入口）；tokens.ts 的 blue 950 档与 900 重复属历史笔误，按默认值修正不平移
  - 更新 frontend/src/styles/index.ts barrel 追加导出 themes.ts 全部符号，tokens 导出暂保留待 task-08 删除
acceptance:
  - themes 含 blue 与 ai-native 两键，两套 color 键集合一致，brand 均为 50 至 950 十一档
  - blue 主题取值与现 tokens.ts 一致（950 档笔误修正除外），DEFAULT_THEME 为 ai-native
  - 从样式 barrel 可导入 themes 与 DEFAULT_THEME，既有消费方不受影响
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 色阶严格采用 Tailwind v3 默认值，violet 与 blue 阶照抄默认值不自行调色
  - 新增颜色必须经 themes.ts 入口，沿用 tokens.ts 边界注释惯例
  - 不写 cssVars 字符串不改 globals.css（task-02），不删 tokens.ts（task-08），不做 store 与 antd 接线（task-04/05）
provides:
  - contract: ThemeDef
    fields: [name, label, color]
  - contract: BrandScale
    fields: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
  - contract: themes
    fields: [blue, ai-native]
  - contract: DEFAULT_THEME
    fields: [ai-native]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
