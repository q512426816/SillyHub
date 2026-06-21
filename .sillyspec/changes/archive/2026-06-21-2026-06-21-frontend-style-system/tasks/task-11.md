---
id: task-11
title: 动效 + 收尾(transition token / hover / focus / reduced-motion / 清理)
status: pending
priority: P1
depends_on: [task-09, task-10]
blocks: [task-12]
covers: [FR-02]
allowed_paths:
  - frontend/src/app/globals.css
  - frontend/src/components/**
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 目标

为样式系统补齐统一动效层与收尾清理,覆盖 FR-02。建立 transition token、Card/Button 交互反馈、统一 focus-visible ring、滚动条样式、prefers-reduced-motion 降级,并清理 globals.css 在前序任务后遗留的冗余。

## 前置状态(task-04 后)

`frontend/src/app/globals.css` 当前结构:
- `@layer base :root` 已定义颜色 token(background/foreground/card/primary/muted/destructive/border/input/ring/radius/success/warning)。
- `.dark` 已覆盖暗色 token。
- base 层已有 `* { @apply border-border }`、body 字体、h1/h2/h3、原生 table/thead/tbody 样式。
- tailwind.config(task-04)已定义 animation keyframes(skeleton pulse 等),本任务消费。
- **尚未定义**:transition token、Card hover lift、Button press、focus-visible 统一 ring、滚动条统一、prefers-reduced-motion 降级。

## 实现要点

### 1. Transition token(globals.css `:root` + `.dark`)

```css
:root {
  --transition-base: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-fast: 100ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

> 统一时长区间 150–200ms,不引入超长动画。

### 2. Card hover lift

在 globals.css base/components 层为目标 Card 容器(如 `.sh-card` 或复用现有 Card 包裹类,见 task-09 产出)加:

```css
.sh-card {
  transition: box-shadow var(--transition-base),
              transform var(--transition-base);
}
.sh-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.08); /* shadow-md 量级 */
  transform: translateY(-1px);
}
```

若 task-09 未定义 `.sh-card` 类,则在 components 层声明该类并在 `frontend/src/components/**` 内 Card 容器引用;否则仅补过渡规则。

### 3. Button press

```css
.sh-btn-press {
  transition: transform var(--transition-fast);
}
.sh-btn-press:active {
  transform: scale(0.98);
}
```

通过 utility class 挂载到自定义按钮组件,**不覆盖 antd Button 原生 active 态**(边界 5)。

### 4. focus-visible 统一 ring

```css
:where(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid hsl(var(--ring)); /* blue-500 量级 */
  outline-offset: 2px;
}
```

> 仅 focus-visible(不影响鼠标点击的 focus),不覆盖 antd 关键交互态(边界 5)。

### 5. 滚动条统一(若 task-04 未覆盖)

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.4);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.6);
}
::-webkit-scrollbar-track { background: transparent; }
```

先 grep tailwind.config 确认 task-04 是否已定义滚动条,若已定义则跳过。

### 6. Loading skeleton

复用 task-04 定义的 animation,提供统一灰阶 utility:

```css
.sh-skeleton {
  @apply animate-pulse bg-muted;
  border-radius: var(--radius);
}
```

### 7. prefers-reduced-motion 降级(边界 2)

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* 保留透明度过渡,仅关闭 transform/位移类动效 */
  .sh-card:hover { transform: none; }
  .sh-btn-press:active { transform: none; }
}
```

### 8. 清理 globals.css 冗余(AC-04)

- 检查原生 table 残留:若项目已全面用 antd Table,移除 `thead th` / `tbody td` / `tbody tr` 规则(grep 确认无业务页直接使用原生 `<table>`)。
- 移除 `:root` 中未被 tailwind.config / components 引用的孤立变量。
- 不删除 task-04 已定义且在用的 token。

### 9. 页面切换 fade

默认 CSS 实现(非目标:不做路由动画框架)。若 Next route 需 fade,在 layout 最外层容器加 `@keyframes fade-in` + `animate-[fade-in_200ms]`;若价值低则跳过,留注释说明。

## 边界

1. 动效不得破坏功能/交互(不拦截点击、不遮挡内容)。
2. `prefers-reduced-motion: reduce` 时关闭 transform / animation,**保留**透明度过渡。
3. 不加无业务意义的炫技动效(无弹簧、无视差、无 3D rotate)。
4. 过渡时长统一在 150–200ms 区间(fast=100ms 仅用于 press 这类微反馈)。
5. 滚动条 / focus-visible 不覆盖 antd 关键交互态(antd Modal/Drawer 内部焦点环、antd Table 滚动条保持原生)。

## 非目标

- 不做页面级路由动画框架。
- 不引入 framer-motion(默认 CSS 实现,除非证明 CSS 无法满足)。

## 操作步骤

1. `mkdir -p` 已存在(tasks/ 目录已建)。
2. grep tailwind.config 确认 task-04 animation / scrollbar 覆盖情况。
3. 编辑 `frontend/src/app/globals.css`:加 transition token、Card/Button 过渡、focus-visible、scrollbar、skeleton、reduced-motion、清理冗余。
4. 在 `frontend/src/components/**` 为对应 Card / Button 容器挂载 `.sh-card` / `.sh-btn-press`(若 task-09 未提供类名)。
5. `cd frontend && npx tsc --noEmit` 验证 AC-05。

## 验收表格

| AC | 内容 | 验证方式 |
|----|------|----------|
| AC-01 | Card hover 有 lift 过渡(shadow + translateY(-1px),150ms) | 浏览器 DevTools 查 transition,鼠标 hover 观察 |
| AC-02 | reduced-motion 下动效关闭(transform/animation 归零,透明度保留) | DevTools 切换 `prefers-reduced-motion: reduce` |
| AC-03 | focus-visible 统一 ring(blue-500 量级,outline-offset 2px) | Tab 键盘导航观察焦点环 |
| AC-04 | globals.css 无冗余残留(原生 table / 未用变量已清) | grep `<table` 确认无业务页使用 + 人工 review |
| AC-05 | tsc 通过 | `npx tsc --noEmit` 退出码 0 |
