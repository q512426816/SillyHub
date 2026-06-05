---
author: WhaleFall
created_at: 2026-06-04T16:30:00
---

# Design: Agent 控制台日志回显宽度

## 问题

长日志行（工具调用路径、JSON、命令）在 Agent 控制台被 `break-all` / `whitespace-pre-wrap` 强制折行，可读性差。

## 方案

采用 HTML 原型 `prototype-log-width.html` 的 **After** 行为：

| 区域 | 当前 | 目标 |
|------|------|------|
| 活跃运行日志（行内 `span`） | `break-all` | `whitespace-pre` + 容器 `overflow-x-auto` |
| 已完成运行日志（`pre`） | `whitespace-pre-wrap` | `whitespace-pre` + `overflow-x-auto` |

垂直滚动仍由外层 `max-h-[300px] overflow-auto` 承担；单行过长时水平滚动查看全文。

## 文件变更

1. `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`
   - 活跃日志内容：`break-all` → `min-w-0 flex-1 whitespace-pre font-mono text-[11px]`
   - 已完成日志 `pre`：`whitespace-pre-wrap` → `whitespace-pre`
2. `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（变更详情 Agent 日志，同类问题）
   - 日志内容：`whitespace-pre-wrap break-all` → `whitespace-pre`

## 页面级宽度约束

Agent 页面容器使用 `max-w-6xl`（1152px），加上 `px-6`（24px×2）padding，实际内容宽度约 1104px。
移除此限制让日志区域撑满 sidebar 之外的可用宽度：

```
当前: <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
目标: <div className="mx-auto flex flex-col gap-5 px-6 py-6">
```

这一变更让日志区域在宽屏上获得更多水平空间，配合行级 `whitespace-pre` + `overflow-x-auto`，
长路径和长 JSON 有更大的默认可见宽度，减少水平滚动频率。

## 不在范围内

- 全局 CSS、其他页面的 `pre-wrap`（知识库、扫描文档等保持原样）
- 后端 SSE / 日志存储
- 日志容器高度（保持 300px）
- sidebar 宽度调整

## 风险

- 极低：仅 Tailwind class 调整，无 API 变更，无数据变更。
- 移除 max-w-6xl 后，页面顶部统计卡片在超宽屏上会自然拉伸，但 Agent 页面以日志查看为主，实用性 > 布局美观。

## 自检

- 打开 Agent 控制台与变更详情日志，长路径/JSON 单行可横向滚动，不再逐字符折行。
- 确认页面在 1920px 宽度下日志区域充分利用空间。
