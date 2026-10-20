---
author: flow-machine-draft
created_at: 2026-10-20T07:02:11.489Z
---
# 设计记录（Design Record）— 2026-10-20-session-status-live-sync

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题机制（已实证）：右侧会话面板是逐会话 SSE 推送，run 状态秒级到达；左侧列表依赖 react-query 条件轮询（有活跃会话 10s / 全静默 30s）+ `agent_sessions:changed` 哑信号（SSE 触发 400ms 去抖失效列表查询）。但后端 `publish_sessions_changed` 只覆盖会话生命周期事件（创建/终态翻转/sweep/lease kill/子会话），run 级状态迁移全部不发布——左侧徽标的第一优先信号源 `current_run_status`（列表端点按最新活跃 run 窗口注入，session_crud.py:264-303）恰来自这些 run 状态，导致右侧已执行/已等审批而左侧最长 10~30s 不动。

方案：不新增任何前端基建，在 5 个 run 状态迁移点补发既有哑信号 `publish_sessions_changed("status_changed", session_id, session_user_id)`（前端 `subscribeAgentSessionsEvents` 的 onmessage 不解析 payload，任何信号都触发列表失效，零改动受益）；另在右侧 `onPermissionRequest` 处理器加一行本地兜底 `onSessionListRefresh?.()`（审批等待是用户可操作状态，即时性最敏感）。信号是哑信号（只触发 refetch，不携带状态数据），多发/迟到/乱序均无害——最终一致以 DB 查询结果为准。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `publish_sessions_changed` 签名与语义零变化（既有 `SessionChangeEvent` Literal 复用 "status_changed" 种类；单聊 user_id 受众）。
- `PublishIntent`（run_sync/service/publish.py dataclass）新增可选标量字段 `list_signal: tuple[uuid.UUID, uuid.UUID | None] | None = None`（session_id + user_id，commit 前提取、不持有 DB session）；`publish_submitted_messages` 消费该字段补发列表信号。构造方（`_submit_finalize`）与既有消费方（router/lease.py:131）签名不变——新字段带默认值，存量构造零改动。
- 对外 HTTP/SSE 端点、事件 payload 格式零变化；前端组件 props 零变化（`onSessionListRefresh` 既有回调复用）。
- 新增信号点 5 处（详见 requirements FR-01）：inject.py commit 后 / submit_commit 激活块经 PublishIntent / coordinator.request_approval commit 后 / coordinator.approve commit 后 / close_run_steps `_close_flip_session` active 分支置 intent。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。信号是哑信号，前端收到只做 invalidate+refetch，不携带状态数据；乱序/重复/迟到到达触发的是同一次列表查询，结果以 DB 当前态为准，无害。前端已有 400ms 去抖合并信号风暴；SSE 无 Last-Event-ID 回放，断线窗口由既有 onConnected/onReconnected 补拉兜底，不新增机制。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   激活点保持既有原子条件 UPDATE（WHERE status='pending'），rowcount=0 不构造信号——并发收口不会发假激活信号；`_close_flip_session` 在同事务内判定 intent（`_apply_session_terminal_status` 幂等守卫：会话已终态返回 None 不置发），commit 后发布，无中间态。审批两点均在成功 commit 后发布，异常路径（token 无效/状态不符）在 commit 前抛出，天然不发。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。发布内部静默容错（Redis 抖动仅 log.warning），信号失败绝不影响已 commit 的业务状态；PublishIntent 标量在 commit 前提取（expire_on_commit 前取标量，同既有 group 字段纪律），publish 阶段不查库不占连接。组件卸载后迟到信号触发的 refetch 由 react-query 既有 cancel 语义兜底。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。全局频道 `agent_sessions:changed` + SSE 端点按 payload.user_id 过滤（audience 机制不变）——新信号 user_id 一律取会话属主（session.user_id，NOT NULL 恒有值），只推给属主的列表连接；群会话 carrier run（group/messages.py）不在本变更范围，群面信号链路（typing_presence audience）不动。多实例部署下 Redis Pub/Sub 全局广播为既有机制，无新风险。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：信号频率放大列表查询负载——每个 run 生命周期新增约 3~5 个信号（创建/激活/审批对/终态），每个信号触发一次列表 refetch（limit=500 窗口函数查询）。评估：10s 轮询本来就执行同款查询，事件驱动只是把「定时查」变「变化时查」，稳态总频率不升反降；且 400ms 去抖把轮内密集信号合并。若极端高频会话（自动化连续注入）仍显负载，后续可加信号侧节流（不在本变更范围）。

试过但放弃的方案：
- 前端 turn_started/全事件扇出 onSessionListRefresh——只覆盖当前打开的会话，其他会话（列表里未打开的）状态变化仍瞎；且每轮多次 invalidate 无谓压力。放弃，改为后端信号根治（覆盖全部会话）+ 仅审批边沿本地兜底。
- 列表轮询间隔调小（10s→2s）——治标：全静默 30s 退化和「变化时查」语义都没解决，纯增加空转查询。放弃。
- 把 current_run_status 塞进 per-session SSE 频道让前端本地合成列表状态——前端需要为未打开会话维持订阅/状态机，复杂度大增；哑信号+refetch 复用既有链路，改动面最小。放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service/inject.py | `_inject_into_session` commit 后补发 status_changed（非纯切换轮） |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_commit.py | 激活块构造 `PublishIntent.list_signal` 标量 |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_steps.py | `_SubmitState` 新增 list_signal 字段（激活块置位、finalize 读取） |
| 修改 | backend/app/modules/daemon/run_sync/service/publish.py | PublishIntent 新增 list_signal 字段；publish_submitted_messages 消费补发 |
| 修改 | backend/app/modules/agent/coordinator.py | request_approval/approve commit 后补发 |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | `_close_flip_session` active 分支也置 sessions_changed_intent（注释同步更新） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | onPermissionRequest 处理器加 onSessionListRefresh 兜底 |
| 新增 | backend/app/modules/daemon/tests/test_session_list_live_signal.py | inject 信号点用例（发布+纯切换轮守卫） |
| 修改 | backend/app/modules/daemon/tests/test_submit_messages_no_overwrite_terminal.py | 激活信号标量用例（发+rowcount=0 不发+publish 消费段） |
| 新增 | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | 审批两点用例（成功发+拒绝不发） |
| 修改 | backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py | 多轮 keep-active 用例扩展 publish 断言 |
| 修改 | backend/app/modules/daemon/tests/test_session_events_cross.py | 信号契约钉子测试随新行为更新（多轮 keep-active 照发） |
| 新增 | frontend/src/components/daemon/__tests__/session-panel-approval-list-refresh.test.tsx | permission_request→列表刷新用例 |
