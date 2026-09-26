---
author: flow-machine-draft
created_at: 2026-09-26T23:16:33.960Z
---
# 设计记录（Design Record）— 2026-09-27-daemon-queue-stop-gaps

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
两处独立小修，均落在 sillyhub-daemon/src/daemon.ts：①`_runSillySpecCommand` 的升级等待 `while (isUpgradeInFlight())` 轮询加总预算常量 `SILLYSPEC_COMMAND_UPGRADE_WAIT_MAX_MS = 300_000`（5 分钟）——超预算后当前命令经 `executor.recordCommandResult` 记 failed 结果槽（错误文案含「请待升级完成后重试」），随后 return 放行链尾，队列后续命令各带独立预算继续；等待段整体移入 try，超时/同步异常统一走既有 catch/finally（`_nudgeHeartbeatAfterCommandResult` 两路径共用）。②`_stopInternal` 在兄弟定时器清理段补 `this._hitsPeriodic?.stop()` 并置空。选此方案而非「排除 deferred 态出等待」：deferred 可在任意时刻翻 running（复查定时器触发即起 npm），排除等待会在 npm 半安装窗口并发 spawn CLI——违背原变更的安全动机；有界超时是唯一既保安全又保活性的形态。预算取 5 分钟依据：running 态升级链正常量级为 npm 树杀上限 120s + 前后探测，5 分钟覆盖且远超前端 150s 回显窗，再长即病态滞留，显式 failed 优于静默无限等待。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外可见行为变化仅一处：排队命令等待升级链超过 5 分钟时，`sillyspec_command_result` 心跳键携带 `state: 'failed'` + `error`（含重试提示，经 manager `recordCommandResult` 规范化截断 ≤200 字符）而非永不回终态——平台/前端从「无终态悬挂」变为「显式失败可重试」，与既有 failed 终态消费路径同构，无新协议字段。新增模块内常量 `SILLYSPEC_COMMAND_UPGRADE_WAIT_MAX_MS`（未导出，同 `SILLYSPEC_COMMAND_UPGRADE_POLL_MS` 口径）。`_stopInternal` 清 `_hitsPeriodic` 为纯内部生命周期收口，对外无签名变化。manager 执行器接口（`SillySpecCommandExecutor`）未动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：命令仍按 FIFO 到达序出队（链尾推进语义未动）；超预算 failed 只作用于当前队首命令，迟到命令各带独立预算，不相互影响。
2. 并发写：结果槽 latest-wins 单写者语义未变（超时路径写槽与 executor 终判写槽都经同一 `recordCommandResult` 规范化点）；`_hitsPeriodic` 停机清理由 `_stopInternal` 串行收尾链执行，与 `start()` 的无条件重建不并发（stop→start 之间有 await 边界）。
3. 切换/生命周期：停机时在途排队命令的 1s 轮询定时器已 unref（不阻进程退出）；`_stopInternal` 幂等（实例已 null 时 `?.` 短路，测试钉住二次直调不炸）。
4. 作用域：命令队列与结果槽均为单 daemon 进程内存态（机器级），无跨工作区串面；hits 周期器实例为 daemon 单例字段，清空后 start 重建，无双实例残留。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-daemon-queue-stop-gaps 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：预算 5 分钟是经验值——合法但极慢的升级链（网络差时 npm 拉包+校验）超 5 分钟会让本可成功的命令记 failed；代价有限（失败终态可重试、命令幂等、前端恢复按钮在），优于无界楔死。其次：超时后升级仍在跑，后续命令继续排队各等 5 分钟逐条 failed——「逐条显式失败」仍是活性态（链尾持续推进），非楔死。试过放弃的方案：①「排除 deferred 态出等待」——deferred 任意时刻可翻 running，会在 npm 半安装窗口并发 spawn CLI，违背安全动机，放弃；②「等待超时后照常 exec」——同半安装风险，放弃；③「给 deferred 复查本身加上限」——改 manager 状态机越界本变更范围（deferred 无限推迟对升级链自身是合理语义），放弃。
