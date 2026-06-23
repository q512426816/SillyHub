---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# Runtime 会话与租约生命周期流程

## 目标
管理 daemon runtime 的注册/心跳在线状态、任务租约（lease）的领取-执行-完成闭环，以及工作树租约的并发隔离。

## 参与模块
- **backend/daemon.service**：`DaemonService`（runtime 注册/心跳）、`LeaseService`（lease 状态机）、`DaemonSessionService`
- **backend/daemon.router**：`/daemon/{register,heartbeat}`、`/daemon/leases/{id}/{claim,start,heartbeat,messages,complete,sync}`、`/daemon/leases/{id}/runs/{rid}/result`
- **backend/worktree**：`WorktreeLease` acquire/release/extend/GC（`service` + `ExecEnvBuilder`）
- **backend/agent**：lease 创建与派发（coordinator）
- **daemon/daemon.ts**：三循环（heartbeat / poll / ws）+ task_available 分发
- **daemon/hub-client.ts**：`register/heartbeat/claimLease/startLease/completeLease/getPendingLeases`
- **frontend**：daemon 列表/在线状态、lease 监控

## 流程摘要

```text
=== Daemon 注册与在线 ===
(daemon)    启动 → HubClient.register {provider,name,version,...}
     │
(backend)   DaemonService.register 建/更新 runtime 行（status=online）
     ▼
(daemon)    heartbeat 循环 → POST /daemon/heartbeat {runtime_id}
(backend)   刷新 last_seen；超时未心跳 → 标 offline（供 lease 调度用）

=== 任务 Lease 闭环 ===
(backend)   AgentService 派发任务 → 建 daemon_task_lease（pending, claim_token）
     │
(daemon)    poll/WS 收 task_available → getPendingLeases
     │        → POST /daemon/leases/{id}/claim {runtime_id}  ← 抢占
(backend)   LeaseService.claim：原子置 claimed + 返回 claim_token
     ▼
(daemon)    POST /leases/{id}/start {claim_token}（agent 开始跑）
(backend)   置 started；期间 daemon 周期 POST /leases/{id}/heartbeat 保活
     │
(daemon)    执行中流式消息 → POST /leases/{id}/messages
     ▼
(daemon)    完成 → POST /leases/{id}/runs/{run_id}/result + /leases/{id}/complete
(backend)   LeaseService.complete：置 completed，触发 worktree release

=== Worktree 租约（并发隔离）===
(backend)   WorktreeService.acquire：lease_root = ExecEnvBuilder.lease_root
     │        ├─ datetime.now(UTC)+ttl → expires_at
     │        ├─ create_directories + write_gitconfig + write_askpass(token)
     │        └─ 写 WorktreeLease 行
     ▼
(agent)     在 lease_root 内执行 git/工具操作
     ▼
(backend)   release（用户/admin）或 GC（expires_at 过期）→ ExecEnvBuilder.cleanup
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| daemon 崩溃 | lease 停 claimed/started，心跳超时标 runtime offline |
| claim 并发抢占 | claim_token 校验，非持有者操作被拒 |
| worktree acquire 失败 | 清理已建目录（ExecEnvBuilder.cleanup）后抛错 |
| lease 过期未释放 | GC 按 expires_at 自动 release + cleanup |
| git 身份缺失 | acquire 时查 git_identity，无则拒（write_askpass 依赖 token） |
| daemon 重启 | interactive session 走 RecoveryCoordinator（见 interactive-session 流程） |

## 关键术语
- **daemon runtime**：一条在线 daemon 实例记录，含 runtime_id、provider、last_seen
- **daemon_task_lease**：backend→daemon 的任务凭据，claim→start→complete 状态机
- **claim_token**：claim 时下发，后续 start/heartbeat/messages 须回传防越权
- **WorktreeLease**：工作树隔离租约，ExecEnvBuilder 生成 gitconfig/askpass/cleanup
- **lease_root**：租约专属工作目录，spec_root_map 做容器→宿主机路径翻译
