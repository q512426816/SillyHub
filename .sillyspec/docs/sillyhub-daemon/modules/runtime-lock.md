---
schema_version: 1
doc_type: module-card
module_id: runtime-lock
author: qinyi
created_at: 2026-08-18 01:45:00
---

# daemon 单实例锁（runtime-lock）

## 定位
daemon 启动单实例锁（`src/runtime-lock.ts`）。强制不变量：一 host + 一 user + 一
provider = 一个 daemon 进程。背景：backend runtime_id 按 (user_id, provider,
hostname) upsert，同机同 provider 双开两个 daemon 会命中同一 runtime 记录共享
runtime_id → recoverSession ownership guard 双双通过（双接管）+ WS ws_hub
replaced(close 4000) 重连风暴；本模块在本地启动阶段堵住 upsert key 碰撞。

## 契约摘要
- `LockIdentity = { provider, hostname, serverOrigin }`——serverOrigin（=
  config.server_url）代理 user 维度，避免把 api key 写进 lock。
- `computeLockKey(identity)`：`sha256(provider \0 hostname \0 serverOrigin)` 前 16
  hex（NUL 分隔防段拼接碰撞；不含敏感信息）。
- lock 文件：`~/.sillyhub/daemon/locks/runtime-<key>.lock`（LOCKS_DIR，测试可注入
  dir）；内容 JSON 白名单 `LockFileData`（pid/hostname/provider/server_hash/
  started_at/updated_at/version），无 claim token / api key。
- `acquireLock(identity, opts: AcquireOptions)`：opts 含 pid / version / force? /
  dir? / now?（测试注入）。冲突时抛 `LockHeldError(holder, lockPath,
  reason: 'active' | 'corrupt')`。
- `releaseLockByKey(key, dir?)`：删文件 best-effort 幂等。
- `isPidAlive(pid)`：`process.kill(pid, 0)`——ESRCH 不存在 false / EPERM 存在无
  权限 true（保守判活防误回收他人 lock）。
- `RuntimeLockManager(opts)`：daemon 启动期对每个 provider `acquire(provider)`，
  stop 时 `releaseAll()`（幂等）；`acquiredCount` 诊断用。被 cli 使用。

## 关键逻辑
```
acquireLock: open(path, 'wx') O_EXCL 原子创建
  EEXIST → readLock(holder):
    holder 损坏/不可读 → 非 force 抛 corrupt；force 覆盖回收
    isPidAlive(holder.pid) = false（stale 孤儿）→ 自动回收覆盖（force 与否）
    pid 活跃 → 抛 active（force 也不强杀活跃进程，提示先停旧 daemon）
异常退出（SIGKILL/断电）不 release → 下次启动靠 pid 存活检测回收 stale
```

## 注意事项
- v1 保守锁 known limitation：真实 backend upsert key 含 user_id，本 key 未含
  （用 serverOrigin 代理）——会额外阻止「同 host + 同 server + 同 provider +
  不同用户」的多 daemon；未来支持同机多账号需把 user_id / auth identity hash 纳入 key。
- force 语义有限：只回收「损坏/stale」lock，**不强杀活跃进程**（需求取舍：不建议
  默认强杀）。
- daemon.start 检测到 availableAgents 后逐 provider acquire；任一失败由 daemon
  回滚已持有 lock（releaseAll）后上抛，阻止三循环启动。
- 回收覆盖路径 writeLockFile 是非原子覆盖写（lock 归属已由本决策确认，可接受）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
