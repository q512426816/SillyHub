---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-10
title: change-file-tree.tsx 文件树 + 编辑器 + 保存状态机 + 排队徽标 + last_synced_at
priority: P0
depends_on: [task-09]
wave: W5
requirement_ids: [FR-09]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/change-file-tree.tsx
---

# task-10 — 文件树 + 编辑器 + 保存状态机

## 目标
新建 `"use client"` 组件 `change-file-tree.tsx`：双栏（左树 280px + 右编辑器），复用 scan-docs `TreeView` 范式（FolderIcon/FileIcon/展开 `expanded: Set`/`depth*16` 缩进）；右栏文本文件可编辑 textarea + 保存/放弃，二进制（`is_text=false`）只读提示；保存五态状态机 + 排队徽标 + 顶部 last_synced_at 与离线警告条（D-003）。

## 依据
- design.md §5 Phase4、§7 接口定义、§10 R-06（轮询 2s + visibilitychange）、§11 D-003@v1（离线警告不硬阻）。
- plan.md Wave5 task-10 行 + 覆盖矩阵 D-003@v1。
- 范式：scan-docs/page.tsx:39-92（TreeView 结构 + 按钮 paddingLeft + truncate）、原型 prototype-change-file-tree-editor.html（布局/状态机 dot·saving/done/pending/failed + warn-bar）。
- 原子：`ui/button.tsx`（variants default/outline/ghost, size sm）、`ui/badge.tsx`（variant success/warning/outline）。
- task-09 契约（`lib/change-files.ts`）：`listChangeFiles` / `getChangeFileContent` / `saveChangeFileContent` / `listPendingChangeFiles` + `buildChangeFileTree`（树节点结构以 task-09 实现为准）。

## 实现要点
- props：`{ workspaceId, changeId, lastSyncedAt?: string|null, daemonOnline: boolean }`。
- 左树：`listChangeFiles` → `buildChangeFileTree` 渲染；选中文件 `getChangeFileContent` 拉内容填 textarea。pending 文件（`listPendingChangeFiles` 2s 轮询）挂 `Badge variant="warning"`「排队中」。
- 状态机：`useState<status: 'idle'|'saving'|'done'|'pending'|'failed'>`；保存按钮调 `saveChangeFileContent` → `saving` → 返 `done` 直接收；返 `pending` 启 `useEffect`+`setInterval(2000)` 轮询 `listPendingChangeFiles` 直到该 path 消失→`done`，超 5min 停止并提示「仍在排队，可离开」；`saveChangeFileContent` throw → `failed`。轮询在 `document.hidden`（visibilitychange）时暂停（R-06）。
- 顶部：`lastSyncedAt` 展示 + `daemonOnline===false` 时显示离线警告条（warn-bar 样式），**不 disable 保存按钮**（D-003：保存入队不硬阻）。
- 右栏：二进制 `is_text=false` → 只读提示「该文件为二进制，不支持在线编辑」。
- 样式参考 frontend-style-system 语义色；遵守 `"use client"`。

## 验收标准
- `cd frontend && pnpm exec vitest run change-file-tree`：渲染（树节点/路径）、状态机（idle→saving→done/pending/failed）、排队徽标（pending path 出现徽标）。
- jsdom 下 textarea 同步渲染可直测；若引入 MarkdownPreview 预览须 `vi.mock`（[[frontend-markdown-text-jsdom-null]]）。
- `cd frontend && pnpm exec tsc --noEmit`。

## 约束
- D-003@v1：离线警告条仅提示，不禁用编辑/保存（保存走 outbox 续传）。
- 复用 scan-docs TreeView 范式不重复造轮子；Badge/Button 用现有 ui 原子。
- 样式遵循 frontend-style-system（archive/2026-06-21-frontend-style-system）。

## 风险
- task-09 `buildChangeFileTree` 返回节点结构与本组件渲染假设不一致 → 实现时以 task-09 实际类型为准适配（类型从 `lib/change-files.ts` 导入，勿内联重定义）。
- 轮询泄漏：组件卸载/选中文件切换时必须 `clearInterval` 清理。
