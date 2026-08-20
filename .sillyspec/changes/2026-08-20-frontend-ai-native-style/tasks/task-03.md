---
id: task-03
title: add-brand-color-scale-to-tailwind-config
title_zh: tailwind.config.ts 增 brand 语义色阶（50-950 走 CSS 变量名映射，主题感知）
author: qinyi
created_at: 2026-08-20 10:14:48
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/tailwind.config.ts
goal: >
  在 tailwind.config.ts extend.colors 新增 brand 语义色阶，各档值纯映射 CSS 变量 var(--color-brand-*)，使 bg-brand-50 等类随 html data-theme 切换自动换肤，与 themes.ts 无编译依赖可并行。
implementation:
  - 在 extend.colors 新增 brand 对象，50 至 950 十一档，每档值为对应档位的 var(--color-brand-*) 变量字符串
  - 与现有 shadcn hsl 语义色并列放置并加注释说明 brand 阶是主题感知变量映射，blue 阶保留为真实信息色与非 brand 场景用途
  - 不 import themes.ts（纯变量名映射，双套取值由 task-02 的 globals.css 变量块提供）
acceptance:
  - brand 阶 50 至 950 十一档齐全，值均为 var(--color-brand-*) 形式，无任何硬编码 hex
  - 现有 colors 键只增不删，blue 阶原样保留
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不依赖 themes.ts（无编译依赖，Wave 1 内与 task-01 可并行）
  - 只增不删现有颜色键，不改 globals.css（CSS 变量双套由 task-02 提供）
  - 本卡无 TS 契约输出，不写 provides/expects_from
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
