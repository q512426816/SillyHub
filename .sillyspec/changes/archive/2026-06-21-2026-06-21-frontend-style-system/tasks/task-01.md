---
id: task-01
title: 建立 Design Token 单一源
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-03, task-04]
requirement_ids: [FR-01]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/styles/tokens.ts
  - frontend/src/styles/index.ts
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 修改文件

| 文件 | 动作 | 说明 |
|------|------|------|
| `frontend/src/styles/tokens.ts` | 新建 | TS 常量 + CSS 变量字符串，唯一真实源 |
| `frontend/src/styles/index.ts` | 新建 | barrel 导出 `tokens` / `cssVars` |

## 覆盖来源

| ID | 内容 |
|----|------|
| FR-01 | 建立 Design Token 单一源（色板/半径/阴影/字体/间距） |
| D-005@v1 | 采用 Tailwind v3 默认色阶，零调色成本 |
| D-006@v1 | TS 常量 + CSS 变量双形态，同时供 antd（hex）与 Tailwind（var）消费 |

## 实现要求

### 色板（hex）

| 类别 | 值 |
|------|----|
| primary | `#2563EB` |
| blue 50-950 | `#eff6ff` `#dbeafe` `#bfdbfe` `#93c5fd` `#60a5fa` `#3b82f6` `#2563eb` `#1d4ed8` `#1e40af` `#1e3a8a` |
| cyan | `#06b6d4` |
| emerald | `#10b981` |
| slate 50-900 | `#f8fafc` `#f1f5f9` `#e2e8f0` `#cbd5e1` `#94a3b8` `#64748b` `#475569` `#334155` `#1e293b` `#0f172a` |

### 状态语义（5 种 kind）

| kind | color | 来源 |
|------|-------|------|
| success | `#10b981` | emerald |
| warning | `#f59e0b` | amber |
| error | `#ef4444` | red |
| info | `#2563eb` | blue / primary |
| neutral | `#64748b` | slate-500 |

### 其他 Token

| 类别 | 值 |
|------|----|
| radius | sm=6 / md=8 / lg=12 / xl=16（px，消费方按需转 rem） |
| shadow | sm / md / lg 三档柔和阴影（rgba 低透明） |
| font.sans | `Inter, ...` + 中文降级链（PingFang SC / Microsoft YaHei 等） |
| spacing | 基于 4px 的基础单位（`spacing[1]=4` 起） |

## 接口定义

```ts
// tokens.ts
export const tokens = {
  color: {
    primary: '#2563EB',
    blue: { 50: '#eff6ff', /* ... */ 950: '#1e3a8a' },
    cyan: '#06b6d4',
    emerald: '#10b981',
    slate: { 50: '#f8fafc', /* ... */ 900: '#0f172a' },
    semantic: {
      success: { kind: 'success', color: '#10b981' },
      warning: { kind: 'warning', color: '#f59e0b' },
      error:   { kind: 'error',   color: '#ef4444' },
      info:    { kind: 'info',    color: '#2563eb' },
      neutral: { kind: 'neutral', color: '#64748b' },
    },
  },
  radius: { sm: 6, md: 8, lg: 12, xl: 16 },
  shadow: { sm: '...', md: '...', lg: '...' },
  font: { sans: 'Inter, ...' },
  spacing: { /* 4px base */ },
} as const;

// 供 globals.css 注入（:root 内联）
export const cssVars: string;
```

```ts
// index.ts
export { tokens, cssVars } from './tokens';
```

### 与现有 globals.css 的关系

现有 `globals.css` 使用 shadcn 风格 HSL 变量（`--primary: 215 55% 28%` 等）。本任务**不修改** globals.css，仅导出独立的 `--color-*` 命名空间 CSS 变量字符串。新旧变量的统一迁移由 task-03（antd ConfigProvider）/ task-04（tailwind.config）负责。

## 边界处理

| # | 边界 |
|---|------|
| 1 | 暗色变量结构预留：token 用语义键名（`color.semantic.*`）便于 D-001 后续扩展，但本任务不输出 `.dark` 变量 |
| 2 | 组件不得硬编码色值，必须 `import { tokens } from '@/styles'` |
| 3 | 双消费：antd 侧拿 `tokens.color.*`（hex），Tailwind 侧拿 CSS 变量 `var(--color-*)` |
| 4 | 色阶严格采用 Tailwind v3 默认值，禁止自行调色 |
| 5 | 新增颜色不经 `tokens.ts` 不许引入项目（review 检查点） |

## 非目标

- 不写 antd ConfigProvider（task-03）
- 不改 `tailwind.config.ts`（task-04）
- 不写任何组件
- 不迁移现有 globals.css 的 HSL 变量

## TDD 步骤

| 步骤 | 动作 |
|------|------|
| 1 | 新建 `tokens.test.ts`（或内联 type test），断言 `tokens.color.primary === '#2563EB'` |
| 2 | 断言 `Object.keys(tokens.color.blue).length === 10` 且含 `50` 与 `950` |
| 3 | 断言 `tokens.color.semantic` 含 5 种 kind，且 `info.color === tokens.color.primary.toLowerCase()` |
| 4 | 断言 `cssVars` 为非空字符串且包含 `--color-primary: #2563EB` |
| 5 | 运行 `npx tsc --noEmit -p frontend` 无类型错误 |

## 验收标准

| AC | 条件 | 通过 |
|----|------|------|
| AC-01 | `tokens.ts` 导出 color / radius / shadow / font 完整 | ☐ |
| AC-02 | `primary === '#2563EB'` 且 blue 含 10 阶（50-950） | ☐ |
| AC-03 | 状态语义 5 种 kind 映射正确（success/warning/error/info/neutral） | ☐ |
| AC-04 | `cssVars` 字符串可注入 globals.css（含 `--color-*` 命名） | ☐ |
| AC-05 | `tsc --noEmit` 无类型错误 | ☐ |
