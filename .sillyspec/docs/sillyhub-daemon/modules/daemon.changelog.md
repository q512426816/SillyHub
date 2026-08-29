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
