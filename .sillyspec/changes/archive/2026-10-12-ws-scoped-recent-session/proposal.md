---
author: flow-machine-draft
created_at: 2026-10-12T07:27:53.013Z
---
# 提案书（Proposal）— 2026-10-12-ws-scoped-recent-session

## 动机

任务原话转写：工作区会话页空门户「继续最近会话」跨工作区串档：recentSession 派生自全局最近 100 条会话未按页面 scope 过滤，A 工作区页显示并继续 B 工作区最近会话，selectedWorkspaceId 快照与文件树跟随串档。

成功标准：
- workspace/change/quicklog 三种 scope 入口的「继续最近会话」只取本工作区（workspace_id 过滤后 last_active_at 优先）的最近会话
- 全局 /sessions（无 scope）行为不变，仍取全局最近会话
- 本工作区无会话（或未进全局前 100）时按钮不渲染，沿用 null 不渲染契约
- resolveDefaultMachineId 默认机器解析仍用全局 sessions，语义不变
- 测试覆盖：scope 入口最近会话属其他工作区时取本工作区会话或隐藏按钮；全局门户不受影响

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. workspace/change/quicklog 三种 scope 入口的「继续最近会话」只取本工作区（workspace_id 过滤后 last_active_at 优先）的最近会话
2. 全局 /sessions（无 scope）行为不变，仍取全局最近会话
3. 本工作区无会话（或未进全局前 100）时按钮不渲染，沿用 null 不渲染契约
4. resolveDefaultMachineId 默认机器解析仍用全局 sessions，语义不变
5. 测试覆盖：scope 入口最近会话属其他工作区时取本工作区会话或隐藏按钮；全局门户不受影响

## 成功标准（可验证）

1. workspace/change/quicklog 三种 scope 入口的「继续最近会话」只取本工作区（workspace_id 过滤后 last_active_at 优先）的最近会话
2. 全局 /sessions（无 scope）行为不变，仍取全局最近会话
3. 本工作区无会话（或未进全局前 100）时按钮不渲染，沿用 null 不渲染契约
4. resolveDefaultMachineId 默认机器解析仍用全局 sessions，语义不变
5. 测试覆盖：scope 入口最近会话属其他工作区时取本工作区会话或隐藏按钮；全局门户不受影响
