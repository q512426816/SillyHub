---
schema_version: 1
doc_type: module-card
module_id: styles
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 全局样式与设计令牌（styles）

## 定位
全局样式与设计令牌的单一来源，4 文件共约 454 行：
- `src/app/globals.css`（252 行）— CSS 变量总纲 + 基础层样式 + 动效 utility + 无障碍降级 + 路由加载骨架。
- `src/styles/tokens.ts`（148 行）— TS 常量 `tokens` 与 CSS 变量注入串 `cssVars`（design token 单一源，前端样式系统 change task-01 / FR-01 / D-005@V1 / D-006@V1）。
- `src/styles/index.ts`（7 行）— barrel：`export { tokens, cssVars } from './tokens'`，组件统一 `import { tokens, cssVars } from '@/styles'`。
- `src/styles/fonts.ts`（47 行）— Inter 自托管字体（task-02 / D-004@V2）。

经 tailwind.config.ts 把变量映射成工具类；antd token 在运行时经 cssVars 直供 hex；`inter` 由根布局（app-layouts）挂载。

## 契约摘要
tokens.ts（TS 常量，运行时供 antd 等以 hex 取色）：
- `tokens.color`：`primary`(#2563EB)、`blue.50..950` 与 `slate.50..900` 色阶、`cyan`、`emerald`、背景层 `bg/card/border`、`semantic` 5 语义色（success #10b981 / warning #f59e0b / error #ef4444 / info #2563eb / neutral #64748b，带 kind 标记）。
- `tokens.radius`（sm6/md8/lg12/xl16，px 数值）、`tokens.shadow`（sm/md/lg 柔和阴影）、`tokens.font.sans`（Inter + 中文字体栈）、`tokens.spacing`（4px 基准，1=4 起）、`tokens.breakpoint.mobile = 768`（逻辑阈值，仅手机 ≤768 走移动端，>768 一律桌面）。
- `cssVars`：`--color-*`（primary/色阶/bg/card/border/语义 5 色）、`--radius-sm..xl`、`--shadow-sm..lg`、`--font-sans`、`--spacing-base: 4px` 的字符串，供 globals.css 注入 `:root`。

globals.css 分层结构：
- `@tailwind base/components/utilities` 三件套。
- `@layer base` → `:root`：
  - shadcn HSL 语义变量：`--background/--foreground/--card/--primary/--muted/--destructive/--border/--input/--ring/--radius` 及各 `-foreground`。
  - 状态语义 HSL（对齐 tokens.semantic 换算）：`--success/--warning/--error/--info` + `-foreground`。
  - tokens 注入 hex 变量：`--color-*` 全量、`--radius-*`、`--shadow-*`、`--font-sans`、`--spacing-base`。
  - 动效 token：`--transition-fast: 100ms` / `--transition-base: 150ms` / `--transition-slow: 200ms`，均 `cubic-bezier(0.4,0,0.2,1)`。
- `.dark` 块：暗色变量保留但**当前未启用**（D-001 非目标）。
- 基础样式：`*` border-border；body bg/text/antialiased/font-sans + font-size 14px；h1/h2/h3 层级样式；table 渲染兜底（antd Table 走自身 .ant-table-*）；`::selection`；`:focus-visible` 键盘导航 ring（blue-500，仅元素级不碰 .ant-*）；`::-webkit-scrollbar` slate 配色 8px。
- `@media (prefers-reduced-motion: reduce)` 全局降级（0.01ms + animation-iteration-count:1，保留透明度）。
- `@layer components`：`.sh-hover-lift`（shadow 抬升 + translateY(-1px)，base 时长）、`.sh-btn-press`（active 缩 0.98，fast 时长）、`.sh-skeleton`（animate-pulse + bg-muted）。
- 组件层外补充：reduce 时显式关 hover-lift/press 位移（双保险）；`.silly-route-loading` 路由段加载骨架（spinner 动画，reduce 时关）。

fonts.ts：`inter` = `next/font/local` 自托管 `@fontsource/inter` woff2（400/500/600/700 四字重），暴露 `--font-inter`，`display: swap` + `preload: true`，fallback 栈 PingFang SC / Source Han Sans CN / Microsoft YaHei / system-ui / sans-serif。

## 关键逻辑
```
tokens.ts (TS 常量, hex 直供 antd token / 运行时取色)
  └→ cssVars 字符串 → globals.css :root 注入 (--color-*/--radius-*/--shadow-*)
       └→ tailwind.config.ts 映射工具类; shadcn 语义色走 hsl(var(--primary)) 等 HSL 变量
antd 样式优先级 > .sh-* utility: utility 仅显式引用处生效, 不覆盖 antd 原生交互态
breakpoint.mobile=768 是逻辑判定常量(matchMedia 用), 刻意不注入 cssVars
```

## 注意事项
- **双变量体系并存**：shadcn 语义色走 HSL 变量（支持未来主题切换），调色板与状态色走 tokens 注入的 hex 变量（antd 等需 hex 的消费方）；改语义色需同步 `tokens.semantic` 与 globals.css HSL 换算两处。
- **色阶严格采用 Tailwind v3 默认值，禁止自行调色；新增颜色必须经 tokens.ts 入口**（边界约束）。tokens.blue.950 与 900 同值（#1e3a8a）是源文件现状，非笔误。
- `.dark` 是占位，**勿在组件中使用 `dark:` 前缀**（无变量可解析）。
- 动效规范：时长统一 150–200ms，fast=100ms 仅微反馈；新增动效走 `--transition-*` token；reduced-motion 降级已有全局兜底（utility 层再双保险），自定义动画也须照顾 reduce 场景。
- 字体禁用 Google Fonts 在线加载（Docker 构建代理不可达外网），一律本地 woff2；新增字重需在 fonts.ts 补 src 条目。
- antd 组件外观覆盖需提高选择器特异性或用 ConfigProvider token，纯 CSS utility 压不过 antd 原生样式。
- 滚动条样式仅 webkit 内核生效，Firefox 未覆盖（已知限制，`scrollbar-color` 待补）。
- 改 radius/shadow/spacing 数值影响全站，须对照 tokens 校验并与 tailwind.config.ts 映射核对。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
