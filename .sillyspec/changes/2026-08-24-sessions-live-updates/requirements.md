---
author: qinyi
created_at: 2026-08-24 07:24:36
change: 2026-08-24-sessions-live-updates
---

# 需求（Requirements）

## FR-01 会话变更信号发布（后端）

agent_sessions 的关键写入完成后，后端向 Redis 频道 `agent_sessions:changed` 发布
轻量信号，覆盖三类用户可感知事件：

- FR-01a `created`：新会话插入（用户创建、agent 扫描派发、团队 placement、
  platform_sync tool_report find-or-create 的插入分支）。
- FR-01b `status_changed`：会话状态迁移（创建激活、派发失败收敛、run 终态回写
  ended/failed、end/reopen/recover/confirm-reconnected/mark-recovery-failed、
  cancel_lease、sweeper 双档超时/离线收敛、tool_report 懒激活）。
- FR-01c `deleted`：软删（deleted_at 置位）。

信号字段：`event`、`session_id`、`user_id`（会话属主）、`at`（ISO 时间）。
发布失败静默记日志不阻断业务写（对齐既有 `_publish_session_event` 容错语义）。
turn_count / last_active_at 增量更新**不发布**（见 Non-Goals）。

## FR-02 会话事件 SSE 端点（后端）

`GET /api/daemon/sessions/events`：

- 鉴权与现有 daemon 域端点一致（登录用户）。
- 订阅 `agent_sessions:changed`，**只下发 user_id 等于当前用户的信号**（多用户隔离）。
- 连接建立即发 `: connected` 注释；静默约 30s 发 `: keepalive` 注释（防代理超时，
  对齐 stream_session_logs 先例）。
- 客户端断开即清理订阅；Redis 异常时连接报错退出（前端负责重连）。
- SSE 帧：`data: {"event":…,"session_id":…,"at":…}`（user_id 供前端调试，非必需）。

## FR-03 前端订阅与失效（前端）

- 会话门户（SessionsPortal，三入口共用）挂载一条 SSE 订阅，复用 `fetchSse`
  传输层（Bearer 头）；断线退避重连在本订阅内自实现（对齐 streamSession
  先例——fetchSse 本身不含自动重连/Last-Event-ID 重放）。
- 收到任一信号 → `invalidateQueries({ queryKey: ["agentSessions"] })`（前缀命中
  三入口列表查询）。
- 重连成功 → 立即补一次失效（覆盖断线窗口漏发）。
- 组件卸载关闭连接；页面多标签各自独立连接与失效（react-query 实例隔离天然成立）。

## FR-04 轮询兜底保留

ql-20260824-004 的条件轮询（10s/30s）原样保留为兜底：SSE 断线、信号漏发、Redis
故障时，列表最坏一个轮询周期内收敛。不因 SSE 在场而联动调整轮询间隔。

## 验收基线

- 后端：关键写入点单测断言频道收到对应事件（mock redis publish）；SSE 端点测试
  覆盖用户过滤、keepalive、断开清理。
- 前端：信号到达 → 列表查询失效重拉；重连 → 补失效；卸载 → 连接关闭。
- 全量回归绿（backend pytest + frontend vitest + tsc）。
