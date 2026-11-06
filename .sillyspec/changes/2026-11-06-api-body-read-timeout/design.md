---
author: flow-machine-draft
created_at: 2026-11-06T15:59:23.306Z
---
# 设计记录（Design Record）— 2026-11-06-api-body-read-timeout

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

frontend/src/lib/api.ts 的 apiFetch：把超时计时器清理与外部 signal 监听移除从「fetch resolve（响应头到达）即执行」挪到「响应体读取完成后执行」，并为 `await resp.text()` 补异常归因（timedOut → code=timeout 走熔断计数；否则 network_error）。fetch 的 init.signal（timeoutController）按 fetch 规范对 body 流同样生效（abort 中断读取），因此无需为读体新建控制器——仅调整既有清理时点 + 读体异常按既有错误语义归因。调试期实证发现并同步修复一个连带缺陷：原 finally 在 fetch 后即移除外部 signal 监听，外部 abort 在读体阶段不再传导（streamSession resync 等调用方契约要求可中断）——监听器移除一并挪到读体完成后。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

### 文件变更清单（提交面自声明）

- `frontend/src/lib/api.ts` — apiFetch：fetch catch 路径补清计时器/外部监听；新增读体 try/catch/finally 段（归因 + 清理）
- `frontend/src/lib/__tests__/api.test.ts` — 新增两用例（读体超时 → timeout；读体阶段外部 abort → network_error）+ 挂起流 mock（手动桥接 signal→stream.error 复现真 fetch abort 语义）

签名零变化；行为变化：头已到但体在超时窗内未完成的请求由「永久 pending」变为按超时失败；无 timeoutMs 的请求（写请求缺省）读体阶段外部 abort 由「不中断」恢复为「可中断」（后者是修复回归到既有契约）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

1. **乱序/迟到到达**：timedOut 布尔只由计时器回调置位、读体 catch 读取——单线程事件序内无竞态；abort 事件多次触发幂等（AbortController 语义）。
2. **并发写**：每次 apiFetch 调用自持 controller/timer/listener，无共享状态；清理路径（fetch 失败 / 读体完成 / 读体失败）互斥覆盖全部分支。
3. **切换/生命周期**：请求失败/完成后所有资源（timer/listener）在对应 catch/finally 清理，无泄漏窗口；timer 在 fetch 失败路径显式清理（挪离 finally 后的补偿点）。
4. **作用域**：纯前端单请求局部行为，无跨请求/跨模块状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：超时窗语义从「fetch 完成窗」变为「请求全程窗（含读体）」——极慢体的合法请求会被 30s 缺省超时切掉。可接受性：GET 缺省 30s 本就是全程预算的合理量级（ql-20260831-006 语义「读请求缺省 30s 超时」），且写请求不传 timeoutMs 无默认超时的既有豁免不变；需要更长窗的调用方显式传 timeoutMs（既有参数面）。放弃的方案：a) 为读体单独再起一个计时器——两窗叠加语义复杂（头快体慢两形态），单窗全程预算更简单且与「锁等待计入总预算」先例（2026-11-05-embed-query-lock-timeout）同构；b) resp.body 手动 Reader 逐块读 + Promise.race——重复造 undici 已有的 abort 传导，弃；c) react-query 层面加 queryFn signal/超时——治标（其它消费方仍裸挂），弃。
