---
schema_version: 1
doc_type: module-card
module_id: styles
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# styles

## 定位
前端全局样式与设计令牌（design tokens）的单一来源。通过 `src/app/globals.css` 定义 shadcn 语义色 HSL 变量、状态语义色、完整调色板（blue/cyan/emerald/slate）的 hex 变量、radius/shadow/font/spacing 变量，并承接 antd 与自定义滚动条/组件层样式。配合 `tailwind.config.ts` 把变量映射成 Tailwind 工具类，供全站消费；antd token 在运行时通过 `styles/tokens.ts` 派生的 cssVars 注入。

## 契约摘要
`globals.css` 结构（`@layer base` + `@layer components`）：

- `@tailwind base/components/utilities` 三件套引入。
- `:root` 语义变量（HSL 数值，供 `hsl(var(--xxx))` 消费）：
  - shadcn 基础：`--background/--foreground/--card/--primary/--muted/--destructive/--border/--input/--ring/--radius`。
  - 状态语义（对齐 tokens.semantic）：`--success`(#10b981) / `--warning`(#f59e0b) / `--error`(#ef4444) / `--info`(#2563eb) 及对应 `-foreground`。
  - 调色板 hex 变量（直供 antd token 等需 hex 的消费方）：`--color-primary` / `--color-blue-50..950` / `--color-slate-50..900` / `--color-cyan` / `--color-emerald` / `--color-bg` / `--color-card` / `--color-border` 等。
- 滚动条：`::-webkit-scrollbar` 系列自定义样式。
- `@layer components`：自定义 utility（显式引用处生效，不覆盖 antd 原生交互态——antd Card/Button 自身样式优先级更高）。

## 关键逻辑
变量与 Tailwind 联动（tailwind.config.ts 映射）：
```
// Tailwind colors 经 hsl(var(--xxx)) 取值
colors.border = "hsl(var(--border))"
colors.primary.DEFAULT = "hsl(var(--primary))"
colors.success.DEFAULT = "hsl(var(--success))"   // 对应 --success HSL
// 调色板直接 hex（不走变量，避免运行时开销）
colors.blue.600 = "#2563eb"
// radius 经 --radius 计算
borderRadius.md = "var(--radius)"
```

## 注意事项
- **shadcn 变量 HSL、调色板变量 hex 两套并存**：语义色（primary/success 等）走 HSL 变量支持未来主题切换；调色板直接 hex 供 antd token 等需 hex 的消费方，改动需同步 `styles/tokens.ts` 派生源。
- antd 样式优先级高于自定义 utility：覆盖 antd 组件外观需提高选择器特异性或用 antd ConfigProvider token，而非纯 CSS utility。
- `.dark` 暗色模式开关在 tailwind.config（`darkMode: ["class"]`），但 globals.css 目前主要定义亮色，暗色变量待补。
- 改语义色数值会影响全站外观，需对照 tokens.semantic 校验；半径/阴影同理。
- 滚动条样式仅 webkit 内核生效，Firefox 需 `scrollbar-color` 等（未覆盖）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
