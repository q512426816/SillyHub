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

## 不在范围内

- 全局 CSS、其他页面的 `pre-wrap`（知识库、扫描文档等保持原样）
- 后端 SSE / 日志存储

## 风险

- 极低：仅 Tailwind 类名调整，无 API 变更。

## 自检

- 打开 Agent 控制台与变更详情日志，长路径/JSON 单行可横向滚动，不再逐字符折行。
