---
id: task-06
title: StatusBadge 统一状态语义
change: 2026-06-21-frontend-style-system
priority: P0
status: pending
depends_on: [task-05]
blocks: [task-09]
covers:
  - FR-03
  - D-005@v1
allowed_paths:
  - frontend/src/components/ui/status-badge.tsx
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 现状

状态色双轨制并存，语义不互通：

1. **antd Tag 预设色**（ppm-status-actions.tsx 的 STATUS_COLOR map）
   - `PLAN_DETAIL_STATUS_COLOR`: draft=default / review=processing / approve=warning / done=success / rejected=error / archived=default
   - `PROBLEM_STATUS_COLOR`: 1=default / 2=processing / 3=warning / 4=success / 5=error / 6=blue / 7=gold
   - 这些是 antd 语义色名（default/processing/warning/success/error/blue/gold），不直接对应色值。

2. **shadcn Badge variant**（components/ui/badge.tsx）
   - `success`: `bg-emerald-50 text-emerald-700`（硬编码 emerald）
   - `warning`: `bg-amber-50 text-amber-700`（硬编码 amber）
   - `destructive`: `bg-red-50 text-red-700`（硬编码 red）
   - `default`: `bg-primary/10 text-primary`（走 token）
   - `outline`: `border-border text-muted-foreground`（走 token）

两套色值体系并行：antd Tag 按预设色名渲染，shadcn Badge 按硬编码 Tailwind 色 + 变体名渲染。status 文案到颜色的映射分散在业务组件里，没有统一入口。

### ppm 现有状态文案集（必须兼容，只读不改）

来源 `frontend/src/components/ppm-status-actions.tsx`：

| 模块 | 文案集合 |
|---|---|
| 里程碑明细 `PLAN_DETAIL_STATUS_TEXT` | 草稿 / 审核中 / 审批中 / 已完成 / 已驳回 / 已归档 |
| 问题清单 `PROBLEM_STATUS_TEXT` | 已保存 / 审核中 / 处置中 / 已关闭 / 已作废 / 待验证 / 变更中 |
| 问题变更 `PROBLEM_CHANGE_STATUS_TEXT` | 审核中 / 已完成 / 已作废 |
| 问题节点 `PROBLEM_NODE_TEXT` | 申请 / 开发经理审批 / 项目经理审批 / 部门经理审批 |

去重后需映射的高频文案：草稿、已保存、未开始、审核中、审批中、处置中、变更中、待验证、待审、待验收、已完成、完成、已关闭、已归档、已驳回、已作废、延期、失败。

## 实现要点

### 组件签名

```ts
type StatusKind = "info" | "success" | "warning" | "error" | "neutral";

interface StatusBadgeProps {
  kind: StatusKind;
  children: React.ReactNode;
  icon?: React.ReactNode;
  size?: "sm" | "md"; // 默认 sm，紧凑
}
```

### 语义 token 映射（必须走 tokens，禁止硬编码色值）

| kind | dot 主色 | 文字深色 | 背景 | 来源 |
|---|---|---|---|---|
| info | blue-600 | blue-700 | blue-50 | blue-600/50 |
| success | emerald-600 | emerald-700 | emerald-50 | emerald-600/50 |
| warning | amber-500 | amber-700 | amber-50 | amber-500/50 |
| error | red-600 | red-700 | red-50 | red-600/50 |
| neutral | slate-500 | slate-600 | slate-100 | slate-500/100 |

> 注：色值 token 由 task-05 的 tokens 文件提供（`--status-info-*` 等 CSS 变量 / Tailwind 扩展色）。本任务消费 task-05 的产出。若 task-05 未把 status 色暴露成 Tailwind 可用 class（如 `bg-status-info-50`），则本任务用 Tailwind 原生 `bg-blue-50 text-blue-700` 形式（blue/emerald/amber/red/slate 是 Tailwind 默认调色板，非硬编码任意值），但需在文件头注释指向 D-005 token 定义，保证单一改色入口。判定标准见 AC-02：禁止 `#hex`、`rgb()`、Tailwind 任意值 `bg-[#xxx]`，允许 Tailwind 命名色 `bg-blue-50`。

### 渲染结构

```
<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
  <span class="dot" />        // 圆点，语义主色，size 取决于 size prop
  {icon}                       // 可选，不传则省略
  <span>{children}</span>      // 文字，语义深色
</span>
```

- 圆角 `rounded-full`（区别于 Badge 的 `rounded` 直角，语义不同）
- padding 紧凑（px-2 py-0.5 / sm 可更紧）
- 圆点 + 文字同色系，圆点用主色，文字用深色（对比度足够）

### fromStatus 辅助函数

```ts
export function fromStatus(statusLabel: string): StatusKind
```

**映射规则**（小写归一化匹配，命中即返回；多关键词按优先级 success > error > warning > info > neutral）：

| StatusKind | 触发关键词（中文 / 英文，包含匹配） |
|---|---|
| success | 完成 / 已完成 / 已关闭 / 已归档 / done / completed / closed / success |
| error | 失败 / 已作废 / 已驳回 / 延期 / 过期 / error / failed / rejected / overdue / void |
| warning | 待验收 / 待审 / 待验证 / 审批中 / 变更中 / warning / pending / review |
| info | 进行中 / 处置中 / 审核中 / info / processing / in-progress |
| neutral | 未开始 / 草稿 / 已保存 / default / draft / neutral |

**fallback**: 未知状态（以上关键词都不命中）→ `neutral`，不抛错（AC-04）。

**兼容性**: 必须覆盖 ppm-status-actions.tsx 现有全部状态文案（见现状表格去重后清单），映射结果需与原 `*_STATUS_COLOR` 的 antd 语义色对齐（default→neutral, processing→info, warning→warning, success→success, error→error, blue→info, gold→warning）。

### 与现有 Badge 的关系

- D-005 统一入口：antd Tag 场景（ppm 业务组件）和 shadcn Badge 场景（通用 UI）都应能用 StatusBadge 渲染状态语义。
- 可消费 task-05 的 Badge（若 Badge 扩展了语义 variant），也可独立实现（推荐独立实现，因为圆点 + 圆角 full 的形态与 Badge 直角不同）。无论哪种，**色值必须走 tokens**，不允许从 badge.tsx 继承硬编码 emerald/amber/red。

## 边界

1. **绝不硬编码色值**：禁止 `#hex` / `rgb()` / Tailwind 任意值 `bg-[#xxx]`；全部走语义 token 或 Tailwind 命名色（blue/emerald/amber/red/slate），并在文件头注释指向 D-005 token 定义。
2. **fromStatus 对未知状态默认 neutral 不报错**：空串 / 未定义文案 / 拼写错误一律返回 `neutral`，不得抛异常。
3. **兼容 ppm-status-actions.tsx 现有状态文案集**：草稿 / 审核中 / 审批中 / 已完成 / 已驳回 / 已归档 / 已保存 / 处置中 / 已关闭 / 已作废 / 待验证 / 变更中 全部命中正确 kind。
4. **icon 可选**：不传则只显圆点 + 文字；传入时圆点在前、icon 次之、文字最后。
5. **同时供 antd Tag 场景和 shadcn Badge 场景使用**：作为 D-005 统一入口，不绑定任一组件库；调用方拿 kind 即可决定色，不再各自维护 color map。

## 非目标

- **不改 ppm-status-actions.tsx 的状态文案定义**：`PLAN_DETAIL_STATUS_TEXT` / `PROBLEM_STATUS_TEXT` / `*_COLOR` 等 map 保持原样，本任务只读它们做映射验证，不替换、不删除。
- **不替换 antd 业务组件**：ppm 列表页里的 antd Tag 不在本任务迁移范围内（那是 task-09 消费方的事）。
- 不实现 size 的复杂尺寸体系（sm/md 两种够用）。
- 不处理图标库选型（icon 由调用方传入，本组件只负责排版）。

## 验收标准

| AC | 条件 | 验证方式 |
|---|---|---|
| AC-01 | 5 种 kind（info/success/warning/error/neutral）渲染对应语义色，圆点 + 文字配色正确 | 渲染 5 个 StatusBadge 肉眼 / 单测快照 |
| AC-02 | 文件内无硬编码 emerald/amber/red 色值（Tailwind 命名色允许，hex/rgb/任意值禁止） | `grep -E '#[0-9a-f]{3,6}\|rgb\(\|bg-\[' status-badge.tsx` 无命中 |
| AC-03 | fromStatus 映射 5+ 状态文案（已完成→success、审核中→info、待验证→warning、已作废→error、草稿→neutral 等） | 单测覆盖上表关键词 |
| AC-04 | fromStatus 对未知状态（如 "xyz" / ""）返回 neutral，不抛错 | 单测 `fromStatus("xyz") === "neutral"` |
| AC-05 | `npx tsc --noEmit` 通过，无类型错误 | tsc 命令 |

## 操作步骤

1. `mkdir -p tasks/`（已完成，本文件所在目录）
2. 读 `frontend/src/components/ui/badge.tsx` + `frontend/src/components/ppm-status-actions.tsx` 确认现有状态集（已完成，见现状章节）
3. 实现 `frontend/src/components/ui/status-badge.tsx`：
   - 定义 `StatusKind` 类型 + `StatusBadgeProps` 接口
   - 实现 `StatusBadge` 组件（圆点 + 可选 icon + 文字，圆角 full）
   - 实现 `fromStatus(statusLabel): StatusKind` 辅助函数
   - 文件头注释指向 D-005 token 定义
4. 写单元测试（可选但推荐）：覆盖 5 种 kind 渲染 + fromStatus 映射 + fallback
5. 跑 `npx tsc --noEmit` 验证 AC-05
6. 跑 grep 验证 AC-02（无硬编码色值）
7. 对照本文件验收表格逐条勾选
