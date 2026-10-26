---
author: flow-machine-draft
created_at: 2026-10-26T14:58:48.944Z
---
# 设计记录（Design Record）— 2026-10-26-ws-evict-close

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：只改 backend `ws_hub.py` 的 `_evict_stale`——身份校验通过并从路由表 pop 之后，在锁外对被逐出的旧 ws 主动 `await ws.close(code=4000, reason="evicted")`（best-effort，吞一切异常）。`send_to_runtime` 的超时与异常两条失败路径都汇经 `_evict_stale`，一处修复全覆盖两条路径。故障的机制核心是「backend 单侧失联、daemon 无感知」——daemon 侧 ws-client 对服务端 close 帧有既有处理（close 事件 → 指数退避重连 1-30s），补上 close 这一环路由表即秒级自愈，daemon 零改动；`connect()` 替换旧连接时的 `existing.close(code=4000, reason="replaced")` 是同文件既有先例，语义同源。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `DaemonWsHub._evict_stale` 内部行为变化：逐出成功后新增一次 `await ws.close(code=4000, reason="evicted")`（异常吞掉）。函数签名、返回 bool 语义、`ws_daemon_disconnected` 日志事件、`_schedule_offline_downgrade` 挂载均不变。
- 对外 WS 协议：daemon 在被逐出时会收到 websocket close 帧（code=4000, reason="evicted"）——此前收不到任何帧。daemon 端协议无变化（对 4000 的处理与 "replaced" 同路径：close 事件 → 重连）。
- 无 REST API / DB schema / 文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。close 帧与 daemon 并发重连的新 connect 竞态时，close 作用于被 pop 的旧 ws 对象引用本身（不查路由表），新连接已注册也不受影响；ASGI 层对已断 transport 的 close 抛错由 try/except 吞掉。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：路由表操作（身份校验 + pop）在 `self._lock` 内完成（既有结构不变）；`close` 在锁外执行，不阻塞其它 daemon 的连接管理；与 `connect()` 替换并发时以对象身份判定，只有被 pop 的那个对象被 close。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。daemon 快速重连场景下旧 handler 收尾误删新连接的坑已有 D-004@v1（disconnect ws 身份校验）与 R4（_evict_stale 对象身份 check-and-remove）先例，本变更沿用同一身份判定结构，仅在其成功分支追加 close；`_schedule_offline_downgrade` 既有挂载点不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。单 backend 实例内存路由表，无跨工作区/跨仓数据面；close 只触达被逐出的单条连接，不广播、不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是 `close` 的 await 在 socket 极端僵死时理论上可悬挂——但 Starlette 的 close 仅向 ASGI 协议层投递 close 消息（不走网络层关闭握手），uvicorn 侧对死 transport 的投递立即返回或抛错，与同文件 `connect()` 替换路径 `await existing.close(code=4000, ...)` 的既有先例风险面完全一致（该先例运行至今无事故），故不加超时、保持同款写法。已试放弃的方案：daemon 侧「HTTP 心跳正常但 WS 长期无下行 → 主动重连」看门狗——协议改动大、需 daemon 发版铺开才生效，且 backend 单侧修复到位后该缺陷类不再产生，留作后续纵深防御候选（另立变更）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/ws_hub.py | `_evict_stale` pop 成功后锁外 best-effort close(4000, "evicted") |
| 修改 | backend/app/modules/daemon/tests/test_ws_hub.py | 新增逐出 close 断言（超时/异常/close 失败/身份校验四用例） |
