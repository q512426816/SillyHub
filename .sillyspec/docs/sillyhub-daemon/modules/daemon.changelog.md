---
author: qinyi
created_at: 2026-08-28 08:28:18
---

# daemon 变更索引

> 自动生成。正文历史已迁出，详见 daemon.md。

- ql-20260828-004-5798 | WS SELF_UPDATE 处理器改自拉起重启：runDaemonSelfUpdate 未替换（已最新/防降级/失败）→ self_update_noop 保持运行不再裸退出；已替换 → await stop()（释放 runtime lock / 标 offline / flush 会话快照）→ respawnDaemonAndExit 拉起新 bundle 后退出（stop 先于拉起，避免新进程抢锁失败）。

## 2026-08-30 — 剩余中置信缺陷修复批（quick ql-20260830-002-f0d2）
- R1 stop() 可重入等待（_stopPromise，在途二次调用等待完成不空转）+ SELF_UPDATE 30s 复查定时器回调 _running 守卫——修「外部 SIGTERM stop 进行中 + _tryUpdate 交接 stop 空转 → respawn 抢锁失败 daemon 全灭」竞态。
- R2 writePendingUpdate 去 unconditional unlink：直接 rename 原子覆盖（Node Windows MoveFileExW(REPLACE_EXISTING)），失败才退回 unlink+rename——消 unlink↔rename 窗口心跳 ENOENT 致 backend 清 pending/since 重置。
- R4 outbox drain stale-token 422 有界保留重试（TOKEN_422_KEEP_RETRIES=5，pending_token 刷新失败窗口丢报修复；非 pending entry 维持 R-10 立即丢弃）。

## 2026-08-31 — 机器 sillyspec 版本显示与远程升级（2026-08-31-machine-sillyspec-version）
- task-05 接线：第四循环 `_sillyspecLoop`（间隔 config.sillyspec_update_interval_sec 默认 3600s，0/非法=关）每拍 manager.checkAndUpgrade('auto')；注册前 manager probeLocal/probeLatest 一次使 register 即带 sillyspec 版本；心跳每拍透传 getSnapshot（version/latest 非 null 才带、update 非 null 才带，三键全无不占位保持旧 4 参形态）；WS SILLYSPEC_UPDATE case void 调 manager.requestUpgrade('server_command')（fire-and-forget）；DaemonOptions.sillyspecManager 注入口（缺省真实实例，isBusy 接 _isBusyForUpdate）。


## 2026-09-08 — 只读审查风险修复批 R1/R2/R6/R8/R9/R10（quick ql-20260908-006-4ff6）
- R1 liveness tailer 生产路径失效修复——tickAsync 装配异步 readRangeFn 后走同步 tick，readRangeSync 恒抛「async fs in sync tick」且 offset 不前进，任何非空日志永久 unknown（L1 推导全链路失效，测试只覆盖注入同步 fs 故漏网）。改：DefaultFs 增 rangeCache，tickAsync 先逐条 await 预读本轮待读字节（预算/轮转口径与 deriveOne 逐字对齐），再走同步 runPass 从缓存命中；runPass 以路径快照驱动（防 refresh 协程并发 add 的 stat-not-prefetched 假 unknown 闪断）。
- R2 ended 路径不被 add 重加——registry-sync 每 60s 无条件重加刚 ended 的死文件，unknown↔ended 永久震荡且挤占 16 个 watch 槽挤出活会话。tailer 增 endedPaths 登记（上限 4096 淘汰最早 1024），add() 命中即拒。
- R6 liveness 推送 root/workspace 归属修复——harness 日志都在 home 下、claude 项目目录名经 munge 抹掉分隔符，旧「logPath.includes(root)」恒 miss 全落首个有 token 的 root（多 root 跨 workspace 串写）。改：WatchTarget 增 agentCwd（discovery 各 locate* 透传 + fetchRegisteredAgentLogs 解析 agent_cwd），daemon 按 isPathUnderAnyRoot(cwd, root) 归属；无 cwd 命中仅单 token root 才兜底，多 root 无命中跳过并 warn（宁缺勿串写）。
- R8 discovery readHead fd 泄漏修复——openSync 返回值内联传 readSync 后即弃（每候选每 60s 泄 1 fd，长跑 EMFILE + Windows 上 rollout 文件无法删除）。改 fd try/finally closeSync。
- R9 内存 Map 有界——DefaultFs stat/range 缓存与 daemon _livenessMetaByPath 在 ended/淘汰/显式移除时 forget/delete + 超限丢最早一批（4096/1024）。
- R10 CursorDriver shell 兜底补 DA-1 注入守卫——Windows .cmd/.bat shim 解析失败回退 shell:true 时不转义参数，用户 prompt 作位置参数即注入面（批量层 sillyhub-daemon/src/task-runner/spawn-stream.ts:174-189 同款守卫此前未随交互驱动落地）。命中元字符（& | < > ^ % " 空白）硬失败按轮次 error 收敛，不 spawn。
