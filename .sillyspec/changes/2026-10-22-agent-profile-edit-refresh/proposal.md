---
author: flow-machine-draft
created_at: 2026-10-22T02:35:37.287Z
---
# 提案书（Proposal）— 2026-10-22-agent-profile-edit-refresh

## 动机

任务原话转写：档案编辑后全局页列表自动刷新修复

动机与背景：用户实测 /agent-profiles（全局卡片墙）编辑档案保存后列表不刷新。根因：全局页数据在 mineList 桶（agentProfileQueryKeys.mineList），而表单使用的 useCreateAgentProfile/useUpdateAgentProfile 成功后只 invalidate workspaceList(wid) 桶——复制/删除当年已在页面层用裸 fetch+手动失效绕过（page.tsx 头注释明载），新建/编辑漏掉。既有缺口，非弹窗重构引入。

成功标准：
- useCreateAgentProfile/useUpdateAgentProfile 成功后必须同时 invalidate workspaceList(wid) 与 mineList 两桶（全局页编辑/新建保存后卡片墙立即刷新）
- 工作区内页（workspaceList 桶）刷新行为不回归
- lib 层新增 hook 失效行为单测（断言两桶 key 均被失效）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. useCreateAgentProfile/useUpdateAgentProfile 成功后必须同时 invalidate workspaceList(wid) 与 mineList 两桶（全局页编辑/新建保存后卡片墙立即刷新）
2. 工作区内页（workspaceList 桶）刷新行为不回归
3. lib 层新增 hook 失效行为单测（断言两桶 key 均被失效）

## 成功标准（可验证）

1. useCreateAgentProfile/useUpdateAgentProfile 成功后必须同时 invalidate workspaceList(wid) 与 mineList 两桶（全局页编辑/新建保存后卡片墙立即刷新）
2. 工作区内页（workspaceList 桶）刷新行为不回归
3. lib 层新增 hook 失效行为单测（断言两桶 key 均被失效）
