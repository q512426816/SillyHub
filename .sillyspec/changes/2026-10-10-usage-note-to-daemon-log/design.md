---
author: flow-machine-draft
created_at: 2026-10-10T02:08:40.013Z
---
# 设计记录（Design Record）— 2026-10-10-usage-note-to-daemon-log

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`sillyhub-daemon/src/daemon.ts` 的 `onTurnResult` 中删除 [USAGE_NOTE] 消息流发射块，改为在 cost 快照差分组装完成后（`payload.total_cost_usd` 就绪处）输出一条 daemon 结构化 info 日志（事件 `run_cost_may_include_bg_tasks`，字段 session_id / run_id / cost_delta_usd）。

选"不报 + 日志降级"而非用户备选的"阈值版只在明显异常时报"：SDK 只给会话级累计快照，不存在"本轮真实成本"的真值基准，任何"明显异常"阈值都无法校准——误报会把同样的噪音重新带回会话流，漏报让功能形同虚设。日志带具体差分数字（比原消息流行信息量更大），且不进用户可见的会话流；原 2026-09-15 FR-04 的排障意图（标识"本轮用量可能含后台任务消耗"）完整保留。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

对外可见行为变化仅一项：交互会话消息流不再出现 `[USAGE_NOTE]` 行（该行走 task_output/stdout 通道，删除后 backend / 前端零改动，只是不再收到）。新增 daemon 日志事件 `run_cost_may_include_bg_tasks`（info 级）。无 REST / WS 协议、文件格式、导出函数签名变化；`SessionManager.hasLiveBackgroundTasks` 门面保留（permission.ts 侧语义未动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。日志位于 `onTurnResult` 同步路径内、`flushInteractiveBatches` 之后与终态上报同段，与原发射点时序等价；迟到 result（state 不存在）在方法更早分支已 return，不触达本逻辑。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无共享写。只读 `payload.total_cost_usd`（方法局部变量）与 `hasLiveBackgroundTasks`（只读门面）；console 输出天然串行，无交错风险。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。终态重试（retryTerminal 闭包）只捕获 payload，日志不在闭包内、重发不会重复输出；run 中断 / session 结束路径不经过本段，残留基线行为与本变更无关。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。日志字段显式携带 session_id / run_id，无跨会话串台面；纯 daemon 本地行为，无跨仓 / 多实例影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：排障入口从"用户可见的会话行"变为"daemon 日志事件"，运维需知道去日志找 `run_cost_may_include_bg_tasks`——通过模块文档 `daemon.md` 同步与本记录留痕缓解。试过放弃的方案：a) 阈值版"只在用量差分明显异常时报"——无真值基准，阈值任意、误报/漏报两头错（见做法概述）；b) 彻底删除不留任何痕迹——丢失原始 FR-04 排障意图（$24.10 归属误导类问题将无现场线索）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| 修改 | sillyhub-daemon/src/daemon.ts | onTurnResult 删 [USAGE_NOTE] 发射块；cost 差分组装后加 info 日志 run_cost_may_include_bg_tasks（cost_delta_usd 缺省 null） |
| 修改 | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | 改写两态断言（无消息流行 + console info 日志断言），补 total_cost_usd 缺失用例 |
| 修改 | .sillyspec/docs/SillyHub/modules/daemon.md | FR-04 表述同步（会话消息流标注行 → daemon 日志事件） |
