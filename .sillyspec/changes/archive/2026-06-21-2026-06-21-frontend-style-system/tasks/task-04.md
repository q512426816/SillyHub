---
id: task-04
title: Tailwind config 映射 + globals.css 重构
status: pending
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05]
covers: [FR-01]
allowed_paths:
  - frontend/tailwind.config.ts
  - frontend/src/app/globals.css
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 现状

- `tailwind.config.ts` 仅映射 shadcn 语义色（hsl var），`colors` 缺少：
  - 基础调色板 blue/cyan/emerald/slate
  - 状态语义 success/warning/error/info（`--success`/`--warning` 已在 globals.css 定义但未映射到 Tailwind，导致 `bg-success` 等工具类不可用）
- `extend` 无 `fontFamily`、无 `boxShadow`、无 `animation`/`keyframes`（tailwindcss-animate 已安装但未被扩展利用）
- `borderRadius` 仅 lg/md/sm 三档，缺 xs 和 tokens 级别映射
- `globals.css`:
  - `:root` 缺少 task-01 的 CSS 变量（cssVars），未与 tokens.ts 对齐
  - 残留原生 `thead th` / `tbody tr` 覆盖（第 84-98 行），对 antd Table DOM 无效（antd 用 `.ant-table-thead`/`.ant-table-row`），徒增歧义
  - 无滚动条样式、无 `::selection`、无 `focus-visible` ring
  - body `font-family` 硬编码中英文 fallback 链，未走 task-02 的 Inter
  - `.dark` 变量结构保留但未明确注释暗色状态

## 实现要点

### tailwind.config.ts

1. `theme.extend.colors`:
   - 基础调色板：`blue`/`cyan`/`emerald`/`slate`（直接 hex，与 tokens.ts palette 对齐；不依赖 CSS 变量，避免运行时切换开销）
   - 状态语义：`success`/`warning`/`error`/`info`，DEFAULT 映射 `hsl(var(--success))` 等，foreground 映射对应 `--success-foreground`
   - 保留全部现有 shadcn 语义色（border/input/ring/background/foreground/card/primary/muted/destructive），不改 key 名
2. `theme.extend.fontFamily`:
   - `sans: ["var(--font-inter)", "PingFang SC", "Microsoft YaHei", "sans-serif"]`
   - 通过 `var(--font-inter)` 接入 task-02 next/font 注入的 Inter
3. `theme.extend.boxShadow`: xs/sm/md/lg 四档（与 tokens.ts elevation 对齐 hex 值）
4. `theme.extend.borderRadius`: 补 xs，其余映射到 `--radius` tokens
5. `theme.extend.animation` + `keyframes`:
   - fade-in / slide-up / scale-in 三组
   - keyframes 命名用 `sh-fade-in` 等前缀，避免与 tailwindcss-animate 内置（fade-in-down/up 等）冲突

### globals.css

1. `:root`：在现有变量基础上注入 task-01 的 cssVars（与 tokens.ts CSS 变量对齐），保留 HSL 数值风格
2. 删除第 79-98 行原生 `table`/`thead th`/`tbody tr`/`tbody td` 覆盖（保留 `table { @apply w-full text-sm }` 这类与组件无关的兜底可酌情保留，但 thead/tbody 选择器全部移除）
3. body `font-family` 改为 `@apply font-sans`，移除硬编码 fallback 链
4. 新增滚动条样式：`::-webkit-scrollbar` + `::-webkit-scrollbar-thumb` + `::-webkit-scrollbar-track`，slate 配色
5. 新增 `::selection`（primary 色底 + foreground 字色）
6. 新增 `:focus-visible` ring（ring-color + offset，适配键盘导航可访问性）
7. `.dark` 变量块保留结构，顶部加注释 `/* 暗色模式变量保留，当前未启用（D-001 非目标），勿在组件中使用 dark: 前缀 */`

## 边界

1. 不破坏现有 Tailwind 工具类：`bg-background`/`text-foreground`/`bg-primary`/`bg-muted`/`border-border`/`rounded-lg` 等必须继续可用（colors 扩展只增不删 key）
2. `--success`/`--warning` 必须映射到 Tailwind，使 `bg-success`/`text-warning`/`bg-success-foreground` 可直接使用
3. `.dark` 变量保留结构但不接入（不加 darkMode 切换逻辑、不在组件中使用 `dark:`），仅作占位
4. 滚动条 / focus-visible 样式不能覆盖 antd 内部控件的关键交互（antd 的 `.ant-input:focus`/`.ant-btn:focus-visible` 等通过自身样式优先，本任务只写元素级 `:focus-visible`，不写 `.ant-*` 选择器）
5. 动画 keyframes 命名加 `sh-` 前缀，不与 tailwindcss-animate 内置 animate-* 冲突
6. 不改 `content` 扫描路径、不改 `darkMode: ["class"]`、不改 `container` 配置

## 非目标

- 不定义 tokens（task-01 负责 tokens.ts）
- 不改 antd ConfigProvider / theme token（task-03 负责）
- 不写组件代码、不动 layout.tsx 的字体接入逻辑（task-02 负责）
- 不接入暗色模式切换

## 验收

| 编号 | 验收项 | 验证方式 |
|------|--------|----------|
| AC-01 | `bg-success` / `text-warning` / `bg-error` / `text-info` 等语义类在 Tailwind 中可用 | grep tailwind.config.ts colors.success/warning/error/info |
| AC-02 | globals.css 无原生 `thead th` / `tbody tr` 覆盖 | grep globals.css 无 `thead`/`tbody` 选择器 |
| AC-03 | fontFamily 映射 Inter（走 `var(--font-inter)`） | grep tailwind.config.ts `fontFamily` + `var(--font-inter)` |
| AC-04 | boxShadow 四档 / borderRadius xs / animation+keyframes 扩展存在 | grep tailwind.config.ts `boxShadow`/`animation`/`keyframes` |
| AC-05 | 滚动条 + `::selection` + `:focus-visible` 样式存在 | grep globals.css `webkit-scrollbar`/`selection`/`focus-visible` |

## 依赖说明

- depends_on task-01：需要 tokens.ts 与 cssVars 定义作为 colors/boxShadow 对齐基准
- depends_on task-02：需要 `--font-inter` CSS 变量由 next/font 注入后才能在 fontFamily 引用
- blocks task-05：组件库改造依赖本任务的语义类、字体类、动画类可用
