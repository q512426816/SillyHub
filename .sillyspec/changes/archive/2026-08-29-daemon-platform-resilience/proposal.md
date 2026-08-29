---
author: qinyi
created_at: 2026-08-29 02:52:40
---
# 提案书（Proposal）

## 动机

daemon 与平台的对接链路（WebSocket 控制面 + HTTP 数据面）在网络波动、服务器重新部署（进程重启、DB 保留）、客户端切换网络、daemon 关闭一段时间后重启这四类常见中断场景下，会出现控制指令丢失、任务/轮次永久卡「运行中」、会话被错误终结无法继续、前端断线不可见等问题。本变更系统性补齐三层（daemon / backend / frontend）的断线恢复能力，保证这些场景下客户端回显正确、会话能正常进行。

## 关键问题

1. **控制指令单通道易失**：会话发消息/打断/结束/恢复、权限审批结果等下发给 daemon 的指令全部走 WS 单向推送，断线窗口内丢失且重连后不补拉——用户「发消息没反应」；且权限请求在断线时被直接按拒绝处理。
2. **状态收敛缺口**：lease 过期回收代码在生产无任何调用方（心跳停了的租约永不过期）；WS 断开不写数据库（最长 45s 仍显示在线，期间派发即卡死）；backend 重启只清 running 不重唤醒 pending；daemon 优雅停止超 600s 后会话被巡检标 failed，重启后恢复链路放弃——违反「重启后自动恢复可继续对话」的口径。
3. **上行终态易丢与前端无兜底**：轮次终态上报 3 次轻试用尽即丢（run 永挂）；daemon 启动时恢复调用遇网络失败会删本地会话记录；前端 SSE 断线无任何提示、运行中轮次无本地看门狗、run 级流重试预算耗尽即永久断连、审批面板推送断线不重连。

## 变更范围

- **daemon 侧**：WS 指数退避重连 + register 周期重试 + 重连后统一对账；控制指令补拉消费（control-dispatcher + LRU 去重）；outbox 扩展（终态入箱、claimToken 空窗暂存）；权限请求 HTTP 上行通道；优雅停止主动挂起会话；恢复链路网络失败保留记录退避重试。
- **backend 侧**：新表 daemon_control_commands（落库待发→WS 推送→补拉→ACK→GC）；lease 过期 GC 常驻协程接线；WS 断开延迟 10s 降级 + 派发前查实连接；lifespan 重启恢复扩展；AgentSession 新增 suspended 挂起语义（suspend-batch 端点、offline sweep 改挂起、24h 超龄 GC、recover 闭环）；result/session-end 端点幂等化。
- **frontend 侧**：streamSession 连接状态回调与横幅；运行轮 90s 看门狗对账；run 流重试预算重置；审批面板 SSE 自动重连；suspended 会话展示（列表/详情/浮窗、输入禁用）。
- **配套**：三端 api-types 再生成（backend openapi → daemon/frontend gen:types）。

## 不在范围内（显式清单）

- 不做 DB 清空/换库场景（daemon 凭证全失效后的重新绑定流程）——D-002
- 不做 daemon 长时崩溃中断轮的输出续传（resume 不 push prompt，中断轮收敛 failed 是既定语义）
- 不做 SSE 协议层改造（Last-Event-ID/单调序号/服务端回放）——现有 resync 机制满足回显正确性
- 不做会话消息分页、多标签页状态同步、消息组件内存态重构
- 不做 SELF_UPDATE / CLEANUP 控制消息的可靠化（低频运维指令维持 best-effort）
- 不做 batch pending lease 派发侧 TTL 新列（由 lease GC + 重唤醒覆盖）

## 成功标准（可验证）

- 断线窗口内下发的会话指令（发消息/打断/结束/审批结果），daemon 重连对账后全部到达并执行，零重复执行（inject 不会双发 prompt）
- 模拟 backend 重启（进程重启 DB 保留）：daemon 在一个重连周期内自动恢复，pending 任务被重唤醒，claimed 但心跳停止的 lease 过期重派或标失败，无任务永挂
- daemon 停止任意时长（>24h 除外）后重启：原会话经 suspended→reconnecting→active 恢复，历史消息完整，可直接继续对话；中断轮标 failed
- 前端在 SSE 断连期间显示「重连中」横幅，恢复后自动同步且横幅消失；运行中轮次 90s 无输出触发对账，不无限挂起；审批面板断线后自动重连
- WS 心跳停止的 claimed batch lease 在 60s 级周期内被过期回收（现状：永不回收）
- 三端相关测试全绿、tsc/mypy/ruff 无新增错误；api-types 与后端 schema 同步提交
