---
author: qinyi
created_at: 2026-08-28 08:28:18
---

# daemon 变更索引

> 自动生成。正文历史已迁出，详见 daemon.md。

- ql-20260828-004-5798 | WS SELF_UPDATE 处理器改自拉起重启：runDaemonSelfUpdate 未替换（已最新/防降级/失败）→ self_update_noop 保持运行不再裸退出；已替换 → await stop()（释放 runtime lock / 标 offline / flush 会话快照）→ respawnDaemonAndExit 拉起新 bundle 后退出（stop 先于拉起，避免新进程抢锁失败）。
