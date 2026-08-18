---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# Daemon 运行时与租约生命周期流程

## 目标
管理 daemon 实例的注册/心跳在线状态与机器级视图、三类执行通道（批处理 lease / 交互 session / host_fs 文件通道 + 代写队列）的领取-执行-完成闭环，以及 worktree 租约的并发隔离。所有 workspace 恒为 daemon-client 模式，平台经 HostFsDelegate 读写成员宿主文件。

## 参与模块
- daemon：RuntimeService（注册/心跳/离线标记/失联清理/自更新/机器级聚合读 machines）、LeaseService（claim/heartbeat/cancel 两路下发/expire_overdue_leases）、WsHub（runtime→WebSocket 映射 + RPC + 消息下发）、change_write_router（代写队列，见 daemon-change-write 流程）、host_fs/patch（文件通道）、dist_router（daemon 单文件分发）、permission_service、run_sync
- worktree：WorktreeLease acquire / release / extend（GitRunner clone_bare/worktree_add + ExecEnvBuilder gitconfig/askpass）
- agent：lease 创建与派发（placement 选 daemon）
- workspace：member_runtimes 绑定解析（resolve_member_binding / resolve_runtime_for_writeback——写回链路共享解析器，失败抛 DaemonClientNoActiveSession）
- llm_provider：claim payload 供应商注入与默认供应商热切换推送（provider_switch）
- frontend_app / frontend_lib：runtimes 页、lib/use-daemon-machines（机器级列表 + 会话 15s 轮询）

## 流程摘要

```text
=== 注册与在线 ===
(daemon)    sillyhub-daemon start --server <hub>（必带 --server，否则静默连 8000 兜底）
     → detectAgents → register（X-API-Key）
(backend)   RuntimeService 建/更新 daemon_instances（online）
(daemon)    三循环：lease 领取（_leasePollSkippable 节流）/ WS 心跳 / 会话控制
     │      心跳回包 _syncAllowedRoots（JSON 相同短路防风暴）+ policy cache 同步
(backend)   心跳超时 → runtime offline；machines 聚合读（别名/版本/构建号/启动时间/用量）

=== WS 通道 ===
(daemon)    主动拨号 /api/daemon/ws
     │      升级期鉴权：无/坏凭据 close 4001；user 与 DaemonInstance.user_id
     │      归属不匹配 close 4003
(backend)   WsHub 下发：notify_task_available / session_control / permission_response /
     │      self_update / policy_update / LEASE_CANCEL / send_rpc（rpc_id 关联 + 超时取消）
     └      --ws-max-size 100MB（容纳 spec bundle RPC）

=== 批处理 lease 闭环 ===
(backend)   派发方建 daemon_task_lease(pending, claim_token)
(daemon)    领取 → POST claim（原子置 claimed；后续操作 claim_token compare_digest 鉴权）
     → start → TaskRunner 执行（heartbeat 保活）→ messages 上行
     → complete → run_sync 回调（stage 收口 / team 推阶段）
     │
     取消：cancel_lease 写 terminating_at
     → interactive=SESSION_END / batch=LEASE_CANCEL WS 即时推送（best-effort）
     → daemon 回传终态清标记；sweeper 收敛 stuck_terminating；
       expire_overdue_leases 批量回收超时 lease

=== host_fs 文件通道（平台远程读写 daemon 宿主文件）===
(backend)   send_rpc(rpc_id, list_dir/list_roots/read_file/write_file/...)
     → daemon host-fs-handler 执行 → rpc_result(rpc_id) → resolve_rpc
     消费方：runtime 只读器（文件类）/ workspace skills·mcp-config 视图 /
     change 变更文件写 / verify gate / patch 打补丁
     （sqlite 二进制不走 delegate——容器对 spec_root 直读可达，mode=ro 防锁）

=== Worktree 租约（并发隔离）===
(backend)   worktree.acquire：identity 校验 → workspace.repo_url 必填
     → INSERT lease(status=locked) → clone_bare（先 assert_safe_repo_url SSRF 前置）
     → worktree_add → gitconfig + write_askpass（解密 token）
(daemon)    agent 在 lease 工作树内执行
(backend)   release（owner/admin）→ worktree_remove（best-effort）→ shred_askpass
     （覆写+删除 token 脚本）→ cleanup（线程池）→ status=released
     ⚠ 现状无自动 GC：expires_at 与 ix_worktree_expires 索引仍在但无过期回收
       调用方，泄漏只能靠显式 release 兜（daemon.lease 的过期批处理不覆盖本表）
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| daemon 崩溃 | runtime 心跳超时标 offline；lease 超时回收；交互会话走恢复三步（见 interactive-session 流程） |
| claim 并发抢占 | claim_token compare_digest，非持有者操作被拒 |
| lease 卡 terminating | stuck_terminating 告警 + sweeper 收敛 |
| worktree acquire 失败 | rollback + cleanup（rmtree 线程池）后重抛 |
| worktree 泄漏 | 无自动 GC（现状），靠显式 release；未 release 则目录与 askpass 脚本滞留 |
| git URL 非法 | UnsafeRepoUrl 400（clone_bare 前置校验，不触子进程） |
| 写回无可用 runtime | resolve_runtime_for_writeback 抛 DaemonClientNoActiveSession 400 |
| WS 断连 | daemon 自动重拨；outbox 暂存消息恢复后补发（校验 lease/session 有效） |
