---
author: qinyi
created_at: 2026-07-09T18:06:00+08:00
---

# 提案书（Proposal）

## 动机

平台已有「会话/对话」能力（runtimes 页面的 `RuntimeSessionDialog` + `InteractiveSessionPanel`），但会话是 runtime 级的——`AgentSession` 表只关联 `runtime_id`，不知道自己围绕哪个变更、哪个工作空间，也没有工作目录/变更文档上下文。

用户在「变更详情页」推进一个变更时，常想就这个变更提问、排查、讨论，但当前只能跑去 runtimes 页另开会话，且会话不知道当前变更是什么，每次都要手动把变更标题、文档路径、改了哪些文件贴一遍。

本变更让会话「认识」变更：在变更详情页内嵌会话区块，打开即自动给定上下文（工作目录 + 变更信息），且只看到与此变更关联的会话。

## 关键问题

1. **会话与变更脱节**：`AgentSession` 无 `change_id`/`workspace_id`，无法表达"这条会话属于哪个变更"，也无法按变更过滤。
2. **上下文全靠手贴**：会话不知道当前变更的标题/阶段/文档/已改文件，用户每次重复粘贴。
3. **入口错位**：要聊一个变更得离开变更详情页，去 runtimes 页另开会话，认知割裂。

## 变更范围

- **后端**：`AgentSession` 加 `change_id`+`workspace_id` 列 + 迁移；`SessionCreateRequest`/`create_session`/`AgentSessionRead` 扩展；按 change 拼装变更上下文前导并注入；新增变更级会话列表端点；dispatch 透传 workspace_id 让 cwd 解析生效。
- **前端**：变更详情页内嵌会话区块（左历史列表 + 右复用 `InteractiveSessionPanel`）；扩展组件 props 透传 `changeId`/`workspaceId`；lib 层 createSession 加字段 + 新增 listChangeSessions。

## 不在范围内（显式清单）

- 不改会话权限语义（`manual_approval`/`ask_user_only` 沿用）。
- 不替换/合并 Agent 执行日志（`AgentRunPanel` 保留并存）。
- 不做会话与 SillySpec 阶段的自动联动（会话不自动触发 brainstorm/plan/execute）。
- 不做会话改名/置顶/搜索。
- 不做跨工作空间的会话聚合视图。
- 不做 daemon 侧改动（上下文注入纯后端方案）。

## 成功标准（可验证）

- 进入某变更详情页，能看到「会话」区块，列出该变更的全部会话（跨成员，含作者/状态/时间）。
- 「新建会话」后输入提问，agent 收到的首轮消息包含【变更上下文】前导（标题/阶段/工作目录/文档路径/已变更文件）；用户输入仍是干净的用户消息。
- 只能看到与当前变更关联的会话；切换到另一变更，会话列表随之变化。
- runtimes 页面既有会话零回归（不传 change_id 时行为完全不变）。
- 迁移可逆（down 删列），backend 启动正常。
