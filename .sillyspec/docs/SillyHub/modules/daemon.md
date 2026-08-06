---
schema_version: 1
doc_type: module-card
module_id: daemon
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# daemon

## 定位
跨组件「本地执行交互」功能域，由 backend daemon 模块（注册/心跳/租约/会话/WebSocket Hub）与 sillyhub-daemon（Node ESM 进程，承载 claude-agent-sdk 实际执行）共同构成。backend 是调度与状态权威，daemon 进程是执行体，两者经 WebSocket + REST 双向通信，支持批处理 lease 与交互式会话两种执行模式。

## 契约摘要
- backend API（prefix=/daemon）：runtime 注册 `POST /daemon/runtimes`、心跳 `/heartbeat`、租约 lifecycle（claim/start/complete/messages）、交互式 session 端点（`/sessions`、`/sessions/{id}/inject|interrupt|end|reopen|recover|confirm-reconnected|mark-recovery-failed`、`/sessions/{id}/permissions/{rid}/response`、`/sessions/{id}/dialogs`、`/sessions/{id}/stream` SSE、`/sessions/{id}/logs`）。
- backend service：`DaemonService`（runtime/lease 生命周期、`submit_messages`、`close_interactive_run`、`sync_agent_run_status`、`cleanup_stale_runtimes`）；`DaemonLeaseService`（claim_task/heartbeat_lease/expire_overdue_leases/cancel_lease，claim_token 鉴权）；`SessionService`（交互式会话 create_session/inject_session/interrupt_session/end_session/recover_session_after_daemon_restart）。
- `DaemonWsHub`：维护 runtime→WebSocket 映射，提供 `notify_task_available`、`send_session_control`、`send_permission_response`、`send_rpc`（带 rpc_id 关联的 RPC，如 list_dir、list_roots）、`broadcast`。
- 协议（`protocol.py` 双端对应）：`daemon:task_available / heartbeat / heartbeat_ack / lease_claim / lease_start / lease_complete / lease_messages / rpc / rpc_result / session_inject / session_interrupt / session_end / session_resume / permission_request / permission_response`。Node 端 `MSG`/`LEASE_STATE`/`WS_PATH='/api/daemon/ws'`/`REST_PREFIX='/api/daemon'` 与之对齐。
- Node daemon 进程：`cli.ts`（start/stop/status/logs，PID 文件管理，信号由 Daemon 内部 handler 处理）；`Daemon` 类（detectAgents→register→三循环：lease 领取、ws 心跳、会话控制）；`TaskRunner`（批处理 lease 执行，renderAgentEvent/resolveTimeout/resolveMaxRetries/isSpawnLevelFailure）；`interactive/`（claude-sdk-driver、session-manager、input-queue、permission-resolver、session-store-persistence、write-guard）；`HubClient`（REST）、`WsClient`（WS + RPC）、`RecoveryCoordinator`（重启后会话收敛）。

## 关键逻辑
```
# 批处理 lease 生命周期（claim_token 鉴权）
DaemonService.create_lease → daemon 领取 → DaemonLeaseService.claim_task(claim_token)
→ TaskRunner 执行 agent → lease_complete → _trigger_stage_completion_callback(agent_run)
# 交互式会话（codex/claude）
SessionService.create_session → DaemonWsHub.send_session_control
→ Node interactive/session-manager 调 claude-agent-sdk → inject/interrupt/end 上行
→ recover_session_after_daemon_restart 在 daemon 重启后收敛 crashed run
# WebSocket RPC（如目录列表）
backend send_rpc(rpc_id) → daemon 执行 → rpc_result(rpc_id) → resolve_rpc
```

## 注意事项
- lease 与 session 是两套执行模型：lease 为无状态批处理（task_id 关联），session 为有状态长交互（有 current_run、turn 冲突 `DaemonSessionTurnConflict`）。
- claim_token 是 lease/session 操作的鉴权凭证，daemon 持有；token 不匹配抛 `LeaseTokenMismatch`。
- daemon 重启后会话收敛是关键不变量：`recover_session_after_daemon_restart` + Node 端 `RecoveryCoordinator` + `confirm-reconnected`/`mark-recovery-failed` 端点配合，避免会话悬挂。
- `/sessions/{id}/end` 端点的 daemon 身份用 runtime 归属校验（非 lease），曾有 404 修复记录，改动需注意归属判定路径。
- 当前活跃变更 `2026-06-23-codex-interactive-session` 在重构交互式会话生命周期，本卡片描述的 session 端点集合会随之演进。
- allowed_roots 写白名单：interactive 会话经 session-manager 的 canUseTool 包装器注入 write-guard（`isWriteWithinAllowedRoots`），把显式写（Write/Edit/MultiEdit）与 Bash 间接写（重定向 `>`/`>>`、cp/mv/install、tee、mkdir、touch）限制在 daemon config.allowed_roots 内，读自由；batch（lease）模式走 `--settings` permission 注入。`isPathUnderAnyRoot` 做边界敏感前缀比较时，盘符根（`D:\`）与 Unix 根（`/`）经 pathResolve 后已含尾部 sep，前缀不可再补 sep，否则产生双反斜杠/双斜杠前缀误判越界（ql-20260702-007）。
- runtime 端点 daemon_version/daemon_build_id 可见：daemon 在 register/heartbeat 上报（hub-client.ts），backend 存 daemon_instances.version/build_id；6 个 runtime 读端点（list/read/update/disable/enable/offline）经 router `_runtime_read` JOIN daemon_instances 填充（service `list_runtimes` 等返回 (runtime, instance) tuple；2026-08-04-daemon-version 前这 6 端点漏 JOIN 致 DTO 恒 null，仅 machines 端点正常）。
- daemon 进程启动时间 started_at 可见：daemon cli.ts 入口取 processStartTime（Date.now）经 Daemon._startedAt 在 register/heartbeat 上报（hub-client.ts body started_at ISO 8601），backend daemon_instances.started_at（Alembic migration 20260805110000 nullable）经三层透传 router endpoint → facade DaemonService → runtime RuntimeService 写（register new/else 两分支 + heartbeat 幂等覆盖恒定值），machines 端点 DaemonMachineRead.started_at 经 instance JOIN 返回（runtime 级 _runtime_read / DaemonRuntimeRead 不加，YAGNI）；旧 daemon 不上报则 NULL，前端 machine-card 显「—」。
- daemon 构建号 BUILD_ID：由 sillyhub-daemon/scripts/gen-build-id.mjs 每次 build/bundle 注入（`<git short sha>-<yyyymmddhhmmss>`，写 src/build-id.ts **无 `: string` 注解** —— backend 正则 `_compute_daemon_version` `BUILD_ID\s*=\s*["']` 的 `\s*` 不吃冒号，带注解会断 self-update；build-id.ts 移出版控，prebuild+postinstall 自动生成）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260702-007-f1a8 | 修复 isPathUnderAnyRoot 盘符根/Unix 根路径前缀比较（root 已含尾 sep 不再补，消除配 D 盘做 allowed_root 仍误 deny）
- ql-20260703-001-7e3a | session-manager Bash tool 跨 shell 提取遗漏修复（合并 bash+powershell+cmd 三提取取并集，PowerShell Set-Content 经 Bash tool 绕过 PolicyEngine 的真机 bug）
- ql-20260703-002-c2d4 | runtimeIdProvider 用 config.runtime_id（非注册 runtime）致 PolicyCache 永久 miss，配 allowed_roots 后 interactive session 仍 deny（改 daemon.resolveRuntimeId(provider)）
- ql-20260703-003-f9d7 | 审计页免 wid 路由——后端加 GET /daemon/runtimes/{rid}/policy-audit + 前端 usePolicyAuditByRuntime（前端审计页不再要求 ?wid）
- ql-20260706-003-8a3f | runtimes 页可写目录配置不回显修复（daemon-entity-binding 上提 allowed_roots 到 daemon_instances 后，router._runtime_read instance 分支只填 daemon_version/build_id 漏填 allowed_roots + PUT /allowed-roots 端点 model_validate 不传 instance；统一 _runtime_read 填充 instance.allowed_roots + PUT 复用 _runtime_read）
- 2026-07-07-daemon-machine-runtime-hierarchy | /runtimes 页改 Machine→Runtime 两级手风琴（前端 page 重构）；后端新增 GET/PATCH/POST /api/daemon/machines 机器级聚合读 + 别名 + self-update（runtime/service.list_machines/update_machine_alias/_get_owned_instance，N+1 规避 runtimes_by_instance，self-update 复用既有 daemon:self_update WS 消息仅改路由键 instance_id，0 改表 0 破坏既有契约 §14 生命周期豁免）
- 2026-07-09-remote-folder-picker | 远程目录浏览器：daemon 新增 `list_roots` RPC（磁盘根列举 Win 盘符/Unix `/`，src/roots-rpc.ts）+ 删 `browse_folder` handler（PowerShell Shell.BrowseForFolder）；backend 加 `POST /runtimes/{id}/list-roots` 代理 + 删 browse-folder 端点；前端 `RemoteFolderPicker` 自治组件复用（listRoots+listDir 懒加载+手输校验+错误降级）
- 2026-07-30-daemon-heartbeat-dedup-fix | 两 bug：(1) 卡死——`PolicyCache.set` 去 `resolveRealPath` 统一归一口径（runtime-policy.ts）+ `isPathUnderAnyRoot` 判定时 realpath 下沉（path-utils.ts，B1 sandbox 安全）+ `_syncAllowedRoots` 短路（daemon.ts，JSON.stringify 相同 return）+ 全 set/判定点口径统一，消除每心跳 changed=1→set→realpath/stat 风暴致事件循环冻死（>2min online）。(2) 回复重复——daemon `_emitOverrideSignals` 扩 emit `[ASSISTANT_OVERRIDE] <segmentId>`（对齐 thinking，metadata 严禁 thinking:true，B2）+ segmentId 第 3 段用 block type（非 stream index）修复 partial/complete 对齐；backend run_sync `_revoke_committed_partials`（task-14）跨 submit_messages 调用 select+session.delete 已 commit partial（task-08 expunge 只撤单调用 pending 不够，partial 与 override 分两次调用到达）。verify 实跑：会话回复无半截+全文双发（#35 消除）。
- 2026-07-31-offline-session-readonly | /runtimes 离线只读浏览会话：runtime-card `canOpenSession` 去 online 与运算（离线会话按钮仍渲染）；runtime-session-dialog 从实时 `runtimes` 重查派生 runtimeOffline 透传 panel（D-005，非 stale runtime prop，重连生效）；interactive-session-panel 加 `offlineReadOnly` prop + 顶部离线横幅 + 4 操作（新建/发送/打断/结束）disabled + attach 离线不建 SSE 直接 initialTurns 只读（active 保持，重连恢复）。后端 0 改（API DB 查询离线可用）、page.tsx 0 改（URL 恢复已支持离线 matched）、change-session-section prop 隔离（D-003）。
- 2026-08-04-daemon-version | daemon 版本可见（6 runtime 端点 _runtime_read JOIN daemon_instances 填 daemon_version/build_id，service list_runtimes 等返回 (runtime, instance) tuple；facade daemon/service.py + list-leases/instances 调用点同步）+ 构建号每次 build 自动注入（gen-build-id.mjs git-sha+ts 无注解格式兼容 backend 正则，build-id.ts 移出版控 prebuild/postinstall 生成，dev/prod 同源，build-bundle.sh 改调 gen）；不改 daemon 上报/前端/语义版本/生命周期。
- 2026-08-05-daemon-start-time | daemon 进程启动时间字段 started_at（cli.ts 入口取 processStartTime → Daemon._startedAt → hub-client register/heartbeat 上报 ISO → daemon_instances.started_at migration 20260805110000 + 三层透传 router→facade DaemonService→runtime RuntimeService 写 → machines DaemonMachineRead JOIN 返回 → 前端 machine-card 显示相对/绝对/null「—」）；不改 daemon 生命周期/daemon_runtimes 表/DaemonRuntimeRead（YAGNI）；execute 符号影响面检查补 facade service.py（三层透传链 plan 漏标），task-01 同步 daemon.ts ClientLike 鸭子接口（task-02 改 hub-client 签名下游）。
- ql-20260805-002-1ab4 | 修复 interactive run 终态 lost update：run_sync/service.py `submit_messages` 的 pending→running 分支由 ORM 内存读改写改为原子条件 UPDATE（`update().where(AgentRun.status == "pending")`，rowcount=0 即 DB 已被 close 推进到终态则不覆盖），消除迟到的 submit 协程用旧快照冲掉 `close_interactive_run` 写入的 completed（run 卡 running / 前端「等待本轮完成」）；附 `test_submit_messages_no_overwrite_terminal.py` 双 session 竞态测试 + 正常路径回归。
- 2026-08-05-skill-content-viewer | /settings/skills 内容查看器：新增 `GET /api/daemon/skills/{skill_name}/content` 只读端点（白名单 sillyspec-* + 固定 SKILL.md 防穿越，权限 `get_current_principal`，>1MiB 413，缺失 404 区分；声明在 manifest/bundle 之后；`read_skill_md` 在 agent.skills_bundle_service）。不改 daemon lifecycle/session/lease/WS/心跳/状态机。
- 2026-08-06-provider-switch-live-session | 运行中会话热切换供应商：默认供应商变更（set/unset_default）→凭证探测（probe.py）→查 active session（status IN active,reconnecting）按 daemon 分组→WS 推送 `PROVIDER_CONFIG_CHANGED`（ws_hub.send_session_control）→daemon `_routeProviderConfigChanged`→`sessionManager.markPendingSwitch`（空闲立即/生成中等 `_onResult` turn 边界）→`reloadWithProvider`（close 旧 query + 新 env `driver.start resume agentSessionId` 保留对话历史）；停止推 null 回退本机凭证；cli.ts credentialManager 接线（停止读 credentials.json）；0 改表/lease 生命周期（不重 claim，interactive lease 永不过期不变）。
- ql-20260806-002 | reloadWithProvider close 顺序修复：close oldQuery 从 driver.start 前移到替换 state.query 之后（旧实现 close 在 start 前，close 拉动旧 consume 退出致 session 收尾 ended；实测 reload 后会话 ended）。
