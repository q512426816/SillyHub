# 决策知识 — styles

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-007@v1 dark 固定调色板工具类覆盖层
状态：implemented
变更：2026-08-23-frontend-dark-theme
锚点：未记录
最近确认：60167c68
理由：在 globals.css 的 [data-theme="dark"] 块内追加工具类覆盖（.bg-red-50 等选择器特异度 0,2,0 胜过 tailwind 0,1,0），仅 dark 生效浅色零影响；映射规则：bg 50→950/100→900、border 200→900/300→800、text 500→400/600 与 700→300/800→200，全部 Tailwind v3 默认值；覆盖集=grep 实际使用清单，非全阶。
