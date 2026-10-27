---
author: flow-machine-draft
created_at: 2026-10-27T04:32:48.841Z
---
# 提案书（Proposal）— 2026-10-27-sessions-panes-gap-remove

## 动机

任务原话转写：用户追点：会话页双栏容器 sessions-portal-panes 的 gap-3（栏间横向空隙，列表栏/把手/聊天栏之间 12px）未随上轮留白收紧去掉。该 gap 属用户点名的七类样式之一（gap-3），上轮因不在输入区链未动，本轮按用户指明元素补删。拖拽把手 PanelResizer 自身 w-1.5 宽度独立，删 gap 后拖拽功能与可视把手不受影响。

成功标准：
- sessions-portal-panes 容器 className 删除 gap-3（其余类 flex min-h-0 flex-1 overflow-hidden 保持）
- 左把手/右把手（PanelResizer）渲染与拖拽功能零回归（自身 w-1.5 在场）
- sessions-portal 相关测试与 lint 通过

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sessions-portal-panes 容器 className 删除 gap-3（其余类 flex min-h-0 flex-1 overflow-hidden 保持）
2. 左把手/右把手（PanelResizer）渲染与拖拽功能零回归（自身 w-1.5 在场）
3. sessions-portal 相关测试与 lint 通过

## 成功标准（可验证）

1. sessions-portal-panes 容器 className 删除 gap-3（其余类 flex min-h-0 flex-1 overflow-hidden 保持）
2. 左把手/右把手（PanelResizer）渲染与拖拽功能零回归（自身 w-1.5 在场）
3. sessions-portal 相关测试与 lint 通过
