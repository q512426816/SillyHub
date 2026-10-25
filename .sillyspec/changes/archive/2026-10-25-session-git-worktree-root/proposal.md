---
author: flow-machine-draft
created_at: 2026-10-25T11:42:55.549Z
---
# 提案书（Proposal）— 2026-10-25-session-git-worktree-root

## 动机

任务原话转写：会话 git 分支指示项感知 sillyspec 工作树

动机与背景：用户实证——会话内 agent 已切换到 sillyspec 工作树干活，但会话组件 git 分支指示项仍显示主仓 main 与主仓目录。根因：端点 root 决策链只认 AgentSession.cwd（创建时快照，恒为主仓）与绑定根，对 sillyspec worktree（固定布局 <工作区根>/.sillyspec/.runtime/worktrees/<change_key>/）完全无感知；平台侧 cwd/agent_cwd 均为快照信号、worktree_leases 表不经 sillyspec CLI 登记。可用的结构化信号链：session.current_change_id（inject 打锚的当前变更）→ changes.change_key（sillyspec change 名）→ 标准路径探测（daemon stat <候选>/.git）。

成功标准：
- 会话当前变更存在 sillyspec 工作树时（标准目录布局且未清理），指示项显示该工作树的分支与目录（经 stat 探测命中，root 取工作树路径）
- 无工作树/已清理/探测失败的会话行为与现状一致（落回 cwd→绑定根链，空态照旧）
- 探测为尽力而为层：stat RPC 异常不阻断，静默落回现有链
- 响应新增 root_source 字段标识根来源（worktree/cwd/workspace_root/none），前端在工作树形态给出可见标识

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 会话当前变更存在 sillyspec 工作树时（标准目录布局且未清理），指示项显示该工作树的分支与目录（经 stat 探测命中，root 取工作树路径）
2. 无工作树/已清理/探测失败的会话行为与现状一致（落回 cwd→绑定根链，空态照旧）
3. 探测为尽力而为层：stat RPC 异常不阻断，静默落回现有链
4. 响应新增 root_source 字段标识根来源（worktree/cwd/workspace_root/none），前端在工作树形态给出可见标识

## 成功标准（可验证）

1. 会话当前变更存在 sillyspec 工作树时（标准目录布局且未清理），指示项显示该工作树的分支与目录（经 stat 探测命中，root 取工作树路径）
2. 无工作树/已清理/探测失败的会话行为与现状一致（落回 cwd→绑定根链，空态照旧）
3. 探测为尽力而为层：stat RPC 异常不阻断，静默落回现有链
4. 响应新增 root_source 字段标识根来源（worktree/cwd/workspace_root/none），前端在工作树形态给出可见标识
