---
author: unknown
created_at: 2026-06-05 06:54:41
---

# Proposal: Agent 控制台日志回显宽度修复

## 动机

Agent 控制台和变更详情页中，日志内容使用 `whitespace-pre` 保留空白不换行。当日志行过长（如 Claude Code 输出的工具调用参数、长路径等），flex 子元素默认 `min-width: auto` 不会收缩，导致日志内容撑开容器 → 撑开页面 → 出现页面级 X 轴滚动条，影响用户浏览体验。

## 关键问题

1. **页面级 X 轴滚动条**：用户查看 Agent 运行日志时，整个页面出现水平滚动条，破坏了 Dashboard 布局的一致性
2. **日志内容不可控滚动**：用户期望在日志块内水平滚动查看长行，但实际滚动条出现在页面层级，交互不符合预期
3. **3 处独立实现不一致**：Agent 控制台活跃运行、Agent 控制台已完成运行、变更详情页日志查看器三处代码独立实现，溢出处理方式不统一

## 变更范围

- 在 3 处日志显示 UI 的容器/内容元素上添加 `min-w-0` 和 `overflow-x-auto` CSS 类
- 确保长日志内容在日志块内水平滚动，不影响页面布局
- 修改文件：
  - `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`（2 处）
  - `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（1 处）

## 不在范围内（显式清单）

- 不提取共享 LogViewer 组件（YAGNI，本次仅做 CSS 修复）
- 不修改后端 API 或数据结构
- 不修改日志内容渲染逻辑或着色规则
- 不改变日志流的 SSE 传输机制
- 不调整日志容器的垂直高度（`max-h-[300px]` / `max-h-80` 保持不变）

## 成功标准（可验证）

1. 日志内容超宽时，日志块内出现水平滚动条
2. 页面本身不出现 X 轴滚动条
3. 日志内容完整显示，不丢失字符
4. 现有日志着色、channel 标签、自动滚动等功能不受影响
