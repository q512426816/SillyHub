---
author: qinyi
created_at: 2026-09-15 17:20:00
---

# 提案书（Proposal）— 会话子代理三分栏展示

## 背景

会话面板中子代理展示存在三个问题：
1. 默认「对话」视图把子代理段整体过滤（frontend/src/components/daemon/turn-timeline.tsx:1183-1188），用户看不到子代理产出——"内容不完整"主因；
2. 「进度」视图中 SubagentBlockView 是内嵌窄卡，完成即折叠，无独立空间展示完整内容；
3. 无独立展示空间，子代理文本/工具细节与主会话体验割裂。

## 方案对比

### 方案 A：右栏单槽位复用文件预览三栏（用户原始需求指定）

核心思路：`sessions-portal.tsx` 右栏从「仅文件预览」升级为单槽位右栏：`rightPanel: {kind:"file", workspaceId, path} | {kind:"subagent", segmentId}`，后写覆盖。点击中栏子代理紧凑卡片 → 右栏展示该子代理完整 children 时间线（复用 SegmentView 递归渲染，无输入框）。中栏子代理统一精简为「名称+状态点+运行时长」紧凑卡片（对话/进度两视图一致）。复用 `usePanelWidth`/`PanelResizer`，预览列宽度 localStorage 键沿用 `sillyhub.sessions.filePreviewWidth`（或新增 subagent 键，见 tasks）。

- 优势：与用户已熟悉的工作区文件预览交互完全一致；右栏机制（条件挂载/宽度记忆/把手）零新造；中栏精简后时间线更清爽。
- 劣势：文件预览与子代理共享宽度记忆，若未来想分开记忆需补一个 localStorage 键（低成本）。

### 方案 B：子代理独立抽屉（Drawer）从右侧滑出

核心思路：不动三栏，antd Drawer 承载子代理完整时间线。

- 优势：实现最快，不动 sessions-portal 布局。
- 劣势：与工作区文件预览交互不一致（用户明确要求"一个样"）；Drawer 遮罩中栏，无法边看中栏边浏览子代理。

### 方案 C：中栏内嵌展开（点击子代理在卡片下方就地展开完整内容）

- 优势：无布局改动。
- 劣势：长内容把中栏时间线撑爆，且"按最后触发的覆盖文件预览"无法满足；与用户要求冲突。

## 推荐：方案 A

用户原始需求已明确指定「和工作区文件预览一个样，按最后触发的覆盖」，即方案 A。B/C 仅作对比记录。

## 非目标（Non-Goals）

- 子代理不支持继续对话（无输入区，本次不开放）。
- 不动后端/daemon/schema/API；无需 `pnpm gen:types`。
- dialog 弹窗/悬浮宿主不加右栏（无三栏空间）。
- 不改动 `session-log-assembler` 装配逻辑。
- 移动端窄屏不做右栏。
- 嵌套子代理面包屑/返回栈不做（MVP）。

## 影响范围

纯前端：sessions-portal.tsx（右栏槽位化）、session-panel-page.tsx / turn-timeline.tsx / turn-segment-views.tsx（中栏紧凑卡片 + 点击回调）、新增右栏子代理面板壳组件。不动后端 schema/API，无需 `pnpm gen:types`。
