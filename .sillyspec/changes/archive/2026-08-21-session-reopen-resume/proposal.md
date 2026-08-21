---
author: qinyi
created_at: 2026-08-21 11:37:05
change: 2026-08-21-session-reopen-resume
---

# 提案（Proposal）— 打通会话重新开启（reopen）链路

## 问题

平台的"重新开启会话"功能（前端按钮已存在）在生产上从未可用，三处断链：

1. `AgentSession.agent_session_id`（SDK resume key）无生产代码写入，reopen 硬依赖它 → 必 409；
2. reopen 后 daemon 恢复成功无人把会话从 `reconnecting` 翻成 `active` → 永久"恢复中"，无法继续对话；
3. 恢复过程异常（WS 丢失/会话冲突）无兜底 → 卡死在 reconnecting，重开与发消息两头 409。

用户期望：像 Claude Code / Codex 客户端一样**随时继续历史会话，不需要保持任何激活状态**（对话历史本质是落盘数据 + 恢复钥匙，不需要常驻进程）。

## 方案（用户已确认方案 B：双端协议确认）

- 数据层：daemon 上报消息时把 SDK 会话 id 回填 `agent_sessions.agent_session_id`（最新值覆盖）+ Alembic 存量迁移（取最后一轮 run 的值）。
- 协议层：daemon 恢复成功调既有 `confirm-reconnected`（后端翻 active）、失败调 `mark-recovery-failed`（置 failed）；两处确认绑定 lease_id 防陈旧确认误翻；daemon 侧显式供给 runtimeId（修复 hub-client 封装静默吞的前置条件）。
- 兜底：reconnecting 超时 180s（基准 `session.last_active_at`）允许手动再次 reopen + 后端 60s 巡检协程自动收敛 failed——同时覆盖旧 daemon 未升级的过渡期。
- 边界：scan 类无 cwd 会话明确 409 拒绝；发版顺序先 backend 后 daemon。

## 预期收益

- 已结束的 claude/codex 会话可真正"重新开启"继续对话（含存量历史会话）；
- 恢复链路任何环节失败都有确定收敛（failed 可重试），不再出现永久卡死；
- 会话恢复能力不再依赖 daemon 本地 sessions.json（钥匙落库）。

## 不在范围内（Non-Goals）

- 跨机器恢复 / transcript 云端备份 / 无状态历史重建（原方案 C，远期）
- 闲置会话自动回收策略调整
- daemon SESSION_RESUME 处理逻辑重写
- 新增 API 端点 / WS 消息类型 / 数据表

## 风险摘要

最大风险为 daemon+backend 需同步发版（旧 daemon 不发确认）——由双保险兜底覆盖过渡期；其余见 design.md 风险登记（8 项，含独立审查发现的 F1 静默吞前置条件、陈旧确认误翻，均已有对策）。
