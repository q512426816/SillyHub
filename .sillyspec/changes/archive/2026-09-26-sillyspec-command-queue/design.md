---
author: flow-machine-draft
created_at: 2026-09-26T13:50:07.076Z
---
# 设计记录（Design Record）— 2026-09-26-sillyspec-command-queue

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
daemon.ts `_runSillySpecCommand` 的两臂忙拒（`_sillyspecCommandInFlight` 标志 + `executor.isUpgradeInFlight()`）改为单一 FIFO 串行队列：布尔标志换 `_sillyspecCommandQueueTail` promise 链尾，每条命令 `.then(run, run)` 排尾——前一条完成（含防御 reject 出口）后下一条自动执行；npm 升级臂从「立即记 failed」改为出队执行前轮询等待（`SILLYSPEC_COMMAND_UPGRADE_POLL_MS`=1s，定时器 unref 对齐 manager deferred 重查惯例——npm 正在替换 CLI bin，与其并发 spawn 有半安装件风险，必须等）。选排队而非忙拒+前端自动重试：命令幂等且秒级（resolve/ghost_cleanup 实测 0.2-0.7s + 秒级），FIFO 最简且保序；原 D-001 拒排队裁决依据「单管理员低频场景」被生产实证推翻（2026-09-25 sillyspec 工作区两条裁决与升级链/彼此并发双双被拒，用户判「忙拒绝没必要」）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
仅 daemon 内部私有成员变化：`_runSillySpecCommand` 签名不变（返回 promise 现在该条命令执行完成才 settle，调用方 `void` fire-and-forget 不受影响）；删除模块内常量 `SILLYSPEC_COMMAND_BUSY_ERROR`（未 export，仅本文件与测试字符串引用）；私有方法 `_nudgeHeartbeatAfterCommandResult(action, phase)` 收敛为单参（busy 相位随忙拒路径消亡）。WS 消息（SILLYSPEC_RESOLVE/SILLYSPEC_GHOST_CLEANUP）、执行器接口 SillySpecCommandExecutor 四方法、心跳 sillyspec_command_result 载荷形状、backend 与前端契约零变化——对外行为唯一差异：忙时不再记 failed busy 红字，改排队执行。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：FIFO 链尾天然保序——后到者永远在前一条 settle（含 reject 出口）后才执行；升级等待在每条命令出队时自判自轮询，不依赖到达序与全局状态。
2. 并发写：队列单消费者（promise 链串行），`_lastCommandResult` 结果槽仍单写者依序写，latest-wins 语义不变；每条落槽即 nudge 心跳即时捎出（_sendHeartbeatOnce 全量上报最新槽），同窗多条结果先落先发不互相吞没（命令本体秒级，间隔远大于本机心跳 HTTP 往返）。
3. 切换/生命周期：队列是内存态，daemon 重启即丢——与现状一致（fire-and-forget 无持久队列，D-001 不建队列表边界保持）；升级等待定时器 1s 级且 unref，不阻进程退出。
4. 作用域：队列是 daemon 进程级单例，延续「本机 sillyspec CLI 单写者」语义——resolve 自带 workspaceId 定位 cwd 不串台；多 daemon 实例本就被 runtime lock 单实例锁互斥。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：排在长升级链（npm 安装分钟级）后的命令可能撞前端 150s 回显恢复窗（ECHO_TIMEOUT_MS）——前端恢复按钮可重试，重复排队条目执行幂等裁决（重复 resolve 同一 change 无害，冲突已消解则 no-op），且冲突计数 ≤75s 采集刷新自愈；不设队列深度上限（单管理员洪水不存在，设上限反而重新发明忙拒）。试过放弃的方案：①保留忙拒+前端自动重试——复杂度推给两端且用户仍见失败红字，与本次反馈直接冲突；②升级完成事件化（await 一次性 promise）——升级链状态机（_update running/deferred→终态+10min 展示窗）无单点完成信号，deferred 复查本身已是 1s 轮询实现，事件化需动 manager 状态机超出薄改范围；出队时 1s 轮询与其等价且零侵入。
