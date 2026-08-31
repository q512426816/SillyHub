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

