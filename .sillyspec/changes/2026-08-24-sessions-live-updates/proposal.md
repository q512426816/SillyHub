---
author: qinyi
created_at: 2026-08-24 07:24:36
change: 2026-08-24-sessions-live-updates
---

# 会话列表实时更新（SSE 变更信号 + 轮询兜底）

## 背景与问题

会话页左侧树（三入口共用 SessionsPortal + SessionListPanel）目前靠**条件轮询**刷新
（ql-20260824-004：进行中会话在场 10s / 全静默 30s）。用户实测反馈「轮询响应也不及时」：
新上报的本地 Agent 会话、远端结束/失败的会话，最坏要等一个轮询周期才出现/变化；
轮询本质是「定时问」，事件发生后到下一次询问之间永远有空窗，缩短间隔只是治标且
空转浪费（静默期也在拉全量列表）。

## 目标

会话列表变化（新会话创建 / 会话状态迁移 / 会话删除）在**秒级**反映到打开的会话页，
不再依赖轮询空窗；轮询降级为兜底而非主通道。

## 方案概要（lazy refresh 模式）

- **后端**：agent_sessions 的关键写入点向新 Redis 频道 `agent_sessions:changed` 发布
  轻量变更信号（事件类型 + session_id + user_id，**不含行数据**）；新 SSE 端点
  `GET /api/daemon/sessions/events` 订阅该频道、按当前用户过滤后下发（复用既有
  `stream_session_logs` 的 Redis pub/sub + keepalive SSE 骨架）。
- **前端**：会话门户挂一条 SSE 订阅（复用 `fetchSse`——fetch 版 SSE 支持 Bearer 头
  与重连退避），收到信号即 `invalidateQueries(["agentSessions"])` 前缀失效触发重拉；
  断线重连成功后补一次失效。**推送只做信号，数据仍由既有列表端点拉**（漏发可容忍，
  轮询兜底收敛）。
- **事件范围收敛**：只推用户可感知的三类低频事件（created / status_changed /
  deleted）；turn_count / last_active_at 增量**不推**（聊天中的会话已有
  onTurnCompleted 即时刷新，ql-20260824-004）。

## 不在范围内（Non-Goals）

- 不推机器在线状态（`use-daemon-machines` 15s 轮询维持现状，独立话题）。
- 不做行级 payload 推送 / 前端本地补丁合并（lazy refresh 已满足及时性，复杂度不值）。
- 不做断线事件回放（Last-Event-ID 游标补历史）——轮询兜底 + 重连补失效已覆盖。
- 不联动降档轮询间隔（10s/30s 维持为兜底；SSE 在场时降档留作后续可选优化）。
- 不覆盖移动端（m/ 不消费 SessionListPanel）。
- 不改 daemon ↔ backend 上报协议（写入点全在 backend 侧，daemon 无感知）。

## 备选方案与否决理由

- **纯缩短轮询（5s）**：仍是定时问，延迟减半但空转翻倍；治标。
- **WebSocket 双向通道**：仓库浏览器侧推送先例全是 SSE（5 处 StreamingResponse），
  单向信号场景 SSE 更贴合且自动重连语义成熟。
- **行级推送（payload 带会话快照，前端本地合并）**：省一次 GET 但引入前端合并
  状态机（排序/分页/过滤交互复杂化），漏发/乱序风险高于收益。
- **PostgreSQL LISTEN/NOTIFY**：写入点已在 service 层，Redis pub/sub 是既有基建
  （`agent_session:{id}` 频道同款），无需新增依赖。
