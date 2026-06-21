---
id: task-03
title: antd ConfigProvider 全面定制
status: pending
priority: P0
depends_on: [task-01]
blocks: [task-05]
covers: [FR-01, D-005@v1]
allowed_paths:
  - frontend/src/components/antd-providers.tsx
created_at: 2026-06-22T00:18:09
author: qinyi
---

# task-03: antd ConfigProvider 全面定制

## 目标

对 `frontend/src/components/antd-providers.tsx` 的 `ConfigProvider.theme` 进行全面定制，色值从 `tokens.ts`（task-01 产出）import，使 antd 控件视觉与新设计系统（D-005 语义色 + Inter 字体 + 圆角体系）统一，并彻底消除旧主色 `#1e3a5f`。

## 现状

现有 `ConfigProvider` 仅 3 个全局 token + Table 组件 token：

```ts
token: { colorPrimary: "#1e3a5f", borderRadius: 4, fontSize: 13 }
components.Table: { headerBg: "#f5f5f5", headerColor: "#444", rowHoverBg: "#f9fafb" }
```

## 实现要点

### 1. 全局 token（`theme.token`）

| token | 值 | 来源 |
|---|---|---|
| `colorPrimary` | `#2563EB` | tokens.ts import |
| `colorSuccess` | `#10b981` | tokens.ts import |
| `colorWarning` | `#f59e0b` | tokens.ts import |
| `colorError` | `#ef4444` | tokens.ts import |
| `colorInfo` | `#2563EB` | tokens.ts import |
| `borderRadius` | `8` | — |
| `fontSize` | `14` | — |
| `fontFamily` | Inter 栈（`'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif`） | tokens.ts import |
| `colorBgLayout` | `#f8fafc` | tokens.ts import |
| `colorBgContainer` | `#ffffff` | tokens.ts import |
| `controlHeight` | `32`（保守值） | — |
| `wireframe` | `false` | — |

### 2. 组件 token（`theme.components`）

| 组件 | token | 值 |
|---|---|---|
| Table | `headerBg` | `#f1f5f9` |
| Table | `headerColor` | `#475569` |
| Table | `rowHoverBg` | `#f8fafc` |
| Table | `footerBg` | `#f1f5f9` |
| Table | `borderColor` | `#e2e8f0` |
| Card | `borderRadiusLG` | `12` |
| Modal | `borderRadiusLG` | `12` |
| Tabs | `itemActiveColor` | `#2563eb` |
| Menu | `itemSelectedBg` | `#eff6ff` |
| Menu | `itemSelectedColor` | `#2563eb` |
| Button | `borderRadius` | `8` |
| Button | `controlHeight` | `32` |

### 3. 消除 `#1e3a5f`

全文 grep 确认无 `#1e3a5f` 残留（含大小写、带/不带 `#`）。

## 边界（约束）

1. **圆角分层**：antd 内部控件圆角统一 8；卡片视觉圆角 12 由 shadcn Card / Tailwind 控制（非本任务）。避免对 antd 全局 `borderRadius` 设过大值导致内部控件（Input/Select）圆角溢出。
2. **controlHeight 保守取 32**：不撑破现有 Table 行高与表单布局；若后续 task-05 实测溢出再调整，不在本任务调高。
3. **状态色统一走 D-005 语义**：success/warning/error/info 一律使用上述语义色，禁止散落 hex。
4. **不删 globals.css 原生 table 覆盖**：归 task-04 范畴，本任务不动 globals.css。
5. **保留 zhCN locale**：`locale={zhCN}` 与 `dayjs.locale("zh-cn")` 保持不变，日历中文化行为不回归。

## 非目标

- 不写 `tokens.ts`（task-01 负责，本任务仅 import）。
- 不改 Tailwind / globals.css（task-04 负责）。
- 不替换 antd 业务组件为 shadcn（D-006 范畴）。

## 操作步骤

1. 读 task-01 产出的 `tokens.ts`，确认导出的色值变量名（colorPrimary / colorSuccess / ... / fontFamily / colorBgLayout / colorBgContainer）。
2. 在 `antd-providers.tsx` import 所需 token。
3. 重写 `ConfigProvider.theme.token` 为上表全局 token。
4. 重写 `ConfigProvider.theme.components` 为上表组件 token。
5. 保留 `locale={zhCN}` 与 dayjs locale 逻辑不变。
6. `grep -ri "1e3a5f" frontend/src/components/antd-providers.tsx` 确认无残留。

## 验收标准

| ID | 验收项 | 判据 |
|---|---|---|
| AC-01 | ConfigProvider token 数 > 3 | 全局 token ≥ 12 个 |
| AC-02 | 主色替换 | `colorPrimary=#2563EB`，全文无 `#1e3a5f` |
| AC-03 | Table 表头新风格 | `headerBg=#f1f5f9`、`headerColor=#475569` |
| AC-04 | 状态色 4 语义统一 | success/warning/error/info 四值齐全且走 D-005 语义 |
| AC-05 | fontFamily 含 Inter | `fontFamily` 字符串含 `'Inter'` |

## 依赖与阻塞

- **depends_on**: task-01（tokens.ts 必须先产出可 import 的色值变量）
- **blocks**: task-05（组件视觉回归验证依赖本任务的 ConfigProvider 定制完成）
