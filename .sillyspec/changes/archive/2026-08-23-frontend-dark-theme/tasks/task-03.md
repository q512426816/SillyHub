---
id: task-03
title: convert-tailwind-slate-scale-to-css-variable-mapping
title_zh: tailwind.config.ts slate 阶变量化（照 brand 函数映射模式）
author: qinyi
created_at: 2026-08-23 23:17:51
priority: P0
depends_on: []
blocks: [task-08, task-10]
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/tailwind.config.ts
goal: >
  将 tailwind.config.ts 基础调色板段写死 hex 的 slate 阶改为与 brand 阶相同的
  var(--color-slate-N) 函数映射（opacityValue 三分支 + color-mix 透明度语义），
  让 dark 主题能在 CSS 变量层翻转 slate 取值，浅色取值与现状逐值相等。
implementation:
  - slate 十档（50..900）改为函数映射——opacityValue 为 undefined 时返回纯 var(--color-slate-N)；数字入参转百分比；var 字符串入参 calc 包裹后走 color-mix(in srgb, ..., transparent)
  - 映射结构照抄现有 brand 段（Object.fromEntries + 步档数组 + opacityValue 回调），注释标注 D-005@v1 与浅色逐值相等承诺
  - globals.css 的 :root 已声明 --color-slate-50..900（Tailwind 默认 hex），无需另补，仅切换消费侧映射
  - 删除基础调色板段写死 hex 的 slate 对象；blue/cyan/emerald 等真实信息色保持 hex 直写不动
acceptance:
  - bg-slate-100、text-slate-500 等类生成的 CSS 指向 var(--color-slate-*)；带透明度修饰符的类（如 bg-slate-100/60）经 color-mix 正常生成
  - 浅色（ai-native 与 blue）下 slate 各档解析值与现状 Tailwind 默认 hex 逐值相等，观感零变化
  - dark 主题叠加 task-02 的翻转 --color-slate-* 后 slate 类名自动取翻转值（本卡只交付映射管道）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm build 后抽查产物 CSS 中 slate 类为 var() 形式且浅色取值与 hex 逐值相等
constraints:
  - 只修改 frontend/tailwind.config.ts 单文件；brand 阶映射与 shadcn 语义色段零改动
  - slate 浅色取值必须与现状 hex 逐值相等（D-005@v1），禁止借机调整任何档位
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
