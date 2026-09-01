---
author: qinyi
created_at: 2026-09-02 00:07:28
change: 2026-09-01-session-group-chat
---

# 提案：会话群聊——多用户多 Agent 同会话协作（openclaw 同构）

## 背景与动机

平台现有会话为单归属人制（`AgentSession.user_id` 单主）：一个用户与一个 agent 配置的 1:1 对话。实际协作需要**群聊**：多个用户和多个 agent 成员进入同一会话——例如对项目下多个工作区做分析与开发时，配置不同人格/工具权限/工作区/机器的 agent 各司其职（人格即角色），用户通过 @提及 驱动对应 agent，agent 之间通过群上下文互相看到进展并可控协作。

参考 openclaw 最新版群聊机制（2026-09-01 HEAD 源码调研）：mention 门控 + 每 agent 独立会话记忆 + 群上下文共享缓冲 + broadcast 扇出 + typing 指示器。

## 方案概要

**影子会话桥接**（详见 design.md）：

- 群 = 新类型 AgentSession（`session_kind='group'`）承载统一时间线，复用现有 SSE/日志/恢复管线
- 每个 agent 成员 = 幂后影子会话（`kind='group_member'`，独立记忆/独立机器/独立工作区），懒创建长驻复用，成员表持反向指针（不挂 parent，规避 5 处 worker 判定链路）
- agent 成员六要素配置：昵称（@提及词，群内全局唯一）/ 机器 / 工作区 / 引擎 / 模型 / 智能体方案（AgentProfile），群聊中随时热切换（下轮边界生效）
- @昵称路由 + @全体广播；未被 @ 的消息仅进群背景摘要；agent 互@协作（群级开关默认开，Redis 防环护栏：同轮去重/深度上限/频率限制/不自我触发）
- 桥接投影：agent 回复事务内双写投影行（新 PK + metadata 身份）到群时间线 + 群频道实时事件，刷新/回放顺序一致（平铺时间线全局 timestamp 排序）
- 无固定角色系统：平等成员 + 人格即角色（AgentProfile 承载职责/工具边界），不内置角色模板与派活工具

## 收益

- 平台获得多用户多 agent 常驻协作形态（现有 /team 是单聊内临时任务团队，群聊与其互补）
- 复用率最大化：interactive lease/daemon driver/resume/排队/SSE/热切换全复用，改动集中在新表、桥接投影与权限分支
- 单聊会话（kind='chat'）零行为改动，向后兼容

## 成本与影响面

- backend：新迁移（session_kind + agent_run_logs.metadata + 两新表）、群聊子模块（group router/service）、@解析/触发管线、桥接投影（run_sync 两处）、权限分支（约 15 处校验点集中改造 4 处）、typing/presence
- daemon：几乎零改动（stage 标识透传）
- frontend：新建 group-chat-panel + 建群向导 + @补全扩展 + typing/成员面板
- 详见 design.md §3-§7

## 非目标（Non-Goals / 不在范围内）

- agent 主动插话（无人 @ 时自主发言）
- 外部 IM 渠道接入（WhatsApp/Telegram 等渠道桥）
- 群消息编辑/撤回、已读回执
- agent 间私信（A2A sessions_send 式，协作统一走群内互@）
- 群审批转投、群级分成员计量（列为后续增强）
- typing 的"有观众才广播"优化（需订阅者追踪设施）

## 实现路径

scale=large → `sillyspec run plan --change 2026-09-01-session-group-chat`
