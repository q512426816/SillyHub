---
author: flow-machine-draft
created_at: 2026-10-29T23:20:12.378Z
---
# 设计记录（Design Record）— 2026-10-30-task-resume-revive-notify-retry

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两处根因分开治。**根因一（续唤卡「已完成」）**：task-notification 语义是「本轮停止」，主代理续唤（SendMessage 重唤原任务）后子代理重跑，但平台 agent_session_task 行已被终态定格——backend `upsert_agent_task` 语义②吸收一切迟到 running，复活分支只对清扫 stopped 行开放。方案：daemon 侧用任务注册表视角产**显式复活信号**——终态注销时把 task_id 登记进「已终态集合」（与 `_backgroundTasks` 同生命周期），之后同 task_id 再收 running 帧即「注销后重开」铁证，emit 事件带 `resumed: true`（一次性，首帧后移除）；backend 收到 `resumed is True` 的 running 放行复活，前端归约同口径放行。**根因二（上报 502 丢事件）**：cli.ts onSessionEvent 桥对 agent_task_status 上报失败仅 console.error——加有限退避重试（5xx/网络错误、3 次、1s/4s/16s），upsert 幂等保证重放安全。

不选时间启发式复活（终态后 N 秒外的 running 视为续唤）：与 2026-10-11-task-sweep-liveness-guard 被用户指正误判的历史同型（「5 分钟心跳宽限启发式误判」→ 已改确认制），复活信号必须来自 daemon 注册表事实而非时间猜测——与 task-sweep-daemon-truth「daemon 注册表是死活唯一真相源」决策族一致。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `AgentTaskStatusEvent`（backend schema.py；daemon hub-client body；frontend session-sse.ts 手写对齐；双端 api-types.ts 生成物）：增可选 `resumed?: boolean | null`（backend `resumed: bool | None = None`）。缺省 None 不进上报 body（hub-client 守卫写入惯例），旧 daemon/旧 backend 双向兼容。
- daemon `handleTaskNotificationEvent` / `handleAgentTaskStatusEvent`（background-tasks.ts）：内部态增 per-session 已终态集合；emit 的 agent_task_status metadata 条件携带 `resumed: true`。AgentEvent 类型（interactive/types.ts / session-manager types）metadata 宽容 Record，无需改签名——emit 处扩展字段即可（对齐 task-02 扩展字段先例）。
- backend `upsert_agent_task`（agent_task_store.py）：语义②复活守卫从「stopped+清扫标记」扩为「stopped+清扫标记 **或** event.resumed is True」；复活动作统一（status=running、finished_at=None、message=None）。`notify_agent_task_status` 端点与 publish_session_event 按 DTO by_alias 整包转发，resumed 自动进 SSE payload，端点零改动。
- frontend `applyAgentTaskStatusEvent`（agent-task-store.ts）：定格分支加 `event.resumed !== true` 豁免；terminalAt 在 resumed running 时清 null。use-session-tasks 的 mergeAgentTaskEvent 复用该归约函数自动继承。
- cli.ts onSessionEvent 桥：agent_task_status 分支加重试包装（判定函数 + 调度退避），函数级导出供单测。
- DB：零列变更（agent_session_task 不加 resumed 列——瞬态信号，复活后行即 running 态，快照/去重口径不受影响）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。迟到 running 心跳（daemon 重启窗口/SDK 重放已注销任务的历史帧）不带 resumed——首帧打标后即从集合移除，且重启丢集合后任何帧都不带标；无标记 running 被语义②吸收，迟到心跳不复活终态行的防线保持。已知边缘：终态后 SDK 重放 task_started 且子代理实际已死 → 首帧带标复活后无新终态，行卡 running 直到会话终态收口（daemon 注册表重放条目使确认制清扫保活）——相比续唤复活主场景收益记为可接受边界，交付报告列明。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   upsert 单事件单事务 + 既有 FOR UPDATE 行锁；resumed 复活与清扫 UPDATE 的「非终态守卫」兼容——复活先落则行非终态、清扫不再触碰；清扫先落（行=stopped+标记）则 resumed running 走既有复活分支同样翻 running，两者收敛一致。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   已终态集合与任务注册表同生命周期（`_clearBackgroundTasks` 一并清）；daemon 重启集合丢——重启后首帧 running 不打标，回到「吸收」现状行为，无损坏（无损降级）。HTTP 上报重试为进程内异步退避，daemon 退出即丢（与现状同为最终丢事件，只是窗口收窄）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。集合 per-session（Map<sessionId, Set<taskId>>，同 `_backgroundTasks` 结构），无跨会话串台；重试为单事件单飞（不聚合跨会话），无全局队列。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：SDK 续唤时是否可靠重发 task_started 未实证（CLI 转录不记 system 帧、daemon.log 无注册日志；归一化器注释已知「SDK 重放 task_started」形态存在）。若 SDK 对某些续唤路径不重发帧，resumed 信号源缺失，运行期显示失真仍在——本变更保证「SDK 重发时全链路通」，不声称覆盖引擎不发信号的场景（引擎契约限制，如实声明）。
- **试过放弃：时间阈值启发式复活**（终态后 N 秒外 running 视为续唤）——task-sweep-liveness-guard 历史否决同型，时间猜测必误判长任务/跨轮任务，不复活。
- **重试风暴风险**：上限 3 次 + 指数退避 + 仅 5xx/网络错误触发；4xx 即刻放弃。502 实测场景（平台网关故障时段）多事件并发各退避，最坏 4 次请求/事件，可接受。
