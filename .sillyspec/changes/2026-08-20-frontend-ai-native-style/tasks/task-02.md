---
id: task-02
title: globals.css 双套 CSS 变量（:root=ai-native + --color-brand-* 紫阶；[data-theme="blue"]=旧蓝 + brand 蓝阶）+ ::selection/:focus-visible/滚动条/spinner 硬编码蓝改 var（覆盖：FR-01, D-003@v2）
title_zh: globals.css 双套 CSS 变量（:root=ai-native + --color-brand-* 紫阶；[data-theme="blue"]=旧蓝 + brand 蓝阶）+ ::selection/:focus-visible/滚动条/spinner 硬编码蓝改 var（覆盖：FR-01, D-003@v2）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: [task-01]
blocks: [task-06, task-13]
requirement_ids: [FR-01]
decision_ids: [D-101@v1, D-003@v2]
expects_from:
  task-01:
    - contract: themes
      needs: [blue, ai-native]
allowed_paths:
  - frontend/src/app/globals.css
goal: >
  globals.css 落地双套主题 CSS 变量（:root=ai-native 紫为默认，[data-theme="blue"] 覆盖回旧蓝），
  并把 ::selection/:focus-visible/滚动条/路由 spinner 的硬编码品牌蓝改为 var 引用，
  使 CSS 变量侧随 html data-theme 切换即时生效（D-101@v1 双驱动机制的 CSS 半边）。
implementation:
  - :root 块整体改写为 ai-native 取值（--color-primary/accent/bg/card/border、slate 阶、语义五档、HSL 语义变量 --primary/--ring 等同步换紫系），值从 themes.ts 与原型 token 表派生，禁止自行调色
  - 紧随 :root 新增 [data-theme="blue"] 覆盖块，键集合与 :root 完全一致，取值为现版旧蓝原样平移（含 --color-* 与 HSL 语义变量）
  - brand 十一档双套：--color-brand-50..950 在 :root=violet 紫阶、blue 块=现有 blue 阶值（D-003@v2，供 tailwind brand.* 类经 var 消费）
  - ::selection 与 :focus-visible 的 #3b82f6 改为 hsl(var(--primary)) 系引用（选区底色与 focus ring 随主题）
  - 滚动条紫调化：thumb 改 var(--color-brand-200)、hover 改 var(--color-brand-400)（blue 主题下经覆盖块自动还原蓝调观感）
  - 路由 spinner 的 border-top-color rgba(22,119,255,.7) 改 var(--color-primary)（R-01 grep 验收目标清零）
acceptance:
  - 无 data-theme 属性时默认渲染 ai-native（:root 即默认，§9 新用户默认紫）
  - html 设 data-theme=blue 后全部 --color-* 与 HSL 语义变量切换为旧蓝取值，键集合与 :root 一一对应无遗漏
  - --color-brand-50..950 双套齐全且 blue 块取值与现 blue 阶逐一相等
  - globals.css 内不再出现 #3b82f6 与 rgba(22,119,255（品牌蓝硬编码清零）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -nE 3b82f6 src/app/globals.css 无输出
constraints:
  - .dark 块与既有动效 token/utility/reduced-motion 降级规则保留不动（暗色为非目标，沿用 D-001@v1）
  - 不新增会话页 caret/typing/ctx-chip utility（归 task-13），不改 tailwind.config.ts 的 brand 映射（归 task-03）
  - 色值只从 themes.ts（task-01）与原型取，禁止自行调色（沿用色阶纪律）
  - 不做第三套主题与主题自定义器（§3 非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
