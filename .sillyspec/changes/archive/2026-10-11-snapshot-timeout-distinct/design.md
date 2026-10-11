---
author: flow-machine-draft
created_at: 2026-10-11T05:04:48.021Z
---
# 设计记录（Design Record）— 2026-10-11-snapshot-timeout-distinct

## 做法概述

<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->
router 的 get_local_snapshot 把 except-All 拆为三类精确捕获：DaemonRuntimeOffline→daemon_offline（无 WS 连接）、DaemonRpcTimeout→**daemon_timeout**（新态：连接在但 15s 无响应，生产实证根因=daemon 自更新换文件进程未重启跑旧代码，旧 dispatch 对未知 method 静默）、其余→offline 兜底+log.exception 可观测性。前端 timeout 占位文案引导重启进程。schema 枚举/前端类型/gen:types 同步五态。

## 接口契约

<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->
LocalSnapshotResponse.status 枚举加 "daemon_timeout"（additive——旧前端遇新枚举走默认分支，无破坏）；端点路径/权限/其余字段零变化。daemon 侧零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->
1. 乱序/迟到：不适用——单次 RPC 请求响应，无事件流。2. 并发写：不适用——只读快照。3. 切换/生命周期：超时判定在 hub.send_rpc 的 15s 预算内完成，进程重启窗口内请求按 offline/timeout 归类即弃，无残留态。4. 作用域：状态字段是响应内标量，按请求独立返回，无跨工作区串台面。

## 风险与死路

<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->
最大风险：timeout 语义不止「进程未重启」一种（daemon 忙碌/网络劣化也超时）——文案用「若刚更新过请重启」条件句而非断言根因。放弃的方案：①daemon 自更新后自动重启进程——会中断活跃会话，留独立变更评估；②超时归入 unsupported——语义错误（unsupported=版本不支持，timeout=无响应），会把「忙」误报成「需升级」。
