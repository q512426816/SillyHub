---
author: flow-machine-draft
created_at: 2026-10-26T05:54:46.929Z
---
# 设计记录（Design Record）— 2026-10-26-turn-phase-prod-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三件事：(1) 可观测性先行——daemon 侧 turn_phase 上报链路（session-manager 两处发出点 + daemon.ts 拦截分支与五步 helper）加分级观测：失败首警 warn（session+phase 去重）、成功默认静默、SILLYHUB_TURN_PHASE_TRACE=1 时成功记 info。部署后生产一轮消息即产出定位证据（观测点之间哪一环没打点即断点），修复据证据落码。(2) 据证据修复断链（候选集中于 session-manager 侧 inject 路径的上报执行；静态五项已排除，见 requirements FR-02）。(3) backend network_context.py 文案分支：「拼地址信息不可用」仅挂在 interfaces 为空分支，NAT 形态低置信标注与地址候选并存。不采用「盲改可疑点」——静态证据全部排除后盲改命中率低且不可证伪；观测先行多一次部署轮但把定位从猜测变为读日志。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- daemon 无新端点/协议变更；新增内部观测 helper（warn-once 有界集合 + trace 开关），消费点：src/interactive/session-manager/turn-control.ts（inject_received 发出点）、src/interactive/session-manager/events.ts（first_event 发出点）、src/daemon.ts（reportTurnPhase helper 与拦截分支）
- 环境变量 SILLYHUB_TURN_PHASE_TRACE（缺省关；逐次读取对齐 turnStartWatchdogMs 惯例，测试可覆写）
- backend 无接口变更；network_context.py _machine_line 文案分支调整（FR-04）

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | inject_received 发出点接观测（到达记点 + 调用异常 warn） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/events.ts | first_event 发出点同款观测 |
| 修改 | sillyhub-daemon/src/daemon.ts | reportTurnPhase 失败首警 warn + TRACE 成功 info；拦截分支到达记点 |
| 新增 | NEW:sillyhub-daemon/src/turn-phase-observability.ts | 观测 helper（warn-once 有界 Set + traceEnabled() 纯函数） |
| 新增 | NEW:sillyhub-daemon/tests/turn-phase-observability.test.ts | 三态单测 |
| 修改 | backend/app/modules/daemon/session/network_context.py | _machine_line 拆「无网卡数据」与「无掩码 NAT」两态文案 |
| 修改 | backend/tests/modules/daemon/test_network_context.py | NAT 与无网卡两态回归用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
成立——上报发出点在 push/首事件边界之后 fire-and-forget，观测记点只读不拦截、不改变发出时序；迟到事件不影响观测语义。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
无竞态——warn-once 去重集合是 daemon 进程级可变 Set（对齐既有 first_event 防重 Set 惯例，上限 512 逐出最旧防膨胀），JS 单线程事件循环内访问。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
安全——观测 helper 无会话态；daemon 重启集合清零（首警重新可达，符合预期）；TRACE 逐次读 env 运行期即生效；会话中断不影响已发出的记点。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
不会——记点键=session_id+phase（run_id 仅作日志字段不进键），跨会话天然隔离；backend FR-04 为纯函数渲染无作用域面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：观测部署后证据指向的根因超出 daemon 仓（如 backend SSE 某条件下丢弃）——静态证据已基本排除该向（delivered 可显示证明同信封类型可通），若仍发生则范围扩至 backend 转发链，任务面相应扩。放弃的方案：①盲改可疑点（静态五项排除后命中率低且不可证伪）；②前端超时兜底假阶段（掩盖问题，违反 FR-02 禁绕过）；③上报改同步阻塞换可见性（违反不阻塞主链路语义）。
