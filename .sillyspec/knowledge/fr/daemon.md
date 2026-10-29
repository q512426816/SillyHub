## FR-daemon-001 daemon 上报 session ready（fresh + recover）
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-01
最近确认：287cc9dbd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccbrs:sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
  tests: sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-10-inject-wait-session-ready
  status: active

## FR-daemon-002 backend 接收 ready + 内存管理
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-02
最近确认：287cc9dbd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccc1a:backend/app/modules/daemon/tests/test_session_readiness.py
  tests: backend/app/modules/daemon/tests/test_session_readiness.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-10-inject-wait-session-ready
  status: active

## FR-daemon-003 backend inject 等 ready
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-03
最近确认：287cc9dbd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccccc:backend/app/modules/daemon/tests/test_session_readiness.py
  tests: backend/app/modules/daemon/tests/test_session_readiness.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-10-inject-wait-session-ready
  status: active

## FR-daemon-004 生命周期与边界
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-04
最近确认：287cc9dbd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccim5:backend/app/modules/daemon/tests/test_session_readiness.py
  tests: backend/app/modules/daemon/tests/test_session_readiness.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-10-inject-wait-session-ready
  status: active

## FR-daemon-005 测试
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-05
最近确认：287cc9dbd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcciwn:sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
  tests: backend/app/modules/daemon/tests/test_session_readiness.py | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-10-inject-wait-session-ready
  status: active

## FR-daemon-006 worker/主会话分流挂起
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 停止或掉线，该 daemon 名下有 active 会话 主会话（无 parent）被挂起；When suspend_sessions_for_daemon 或 session_offline_sweep_once 执行 daemon 回来；Then **worker 子会话**（parent_session_id 非空）→ session failed(error_code=daemon_interrupt
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-01
最近确认：023352ce0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccj71:backend/app/modules/daemon/tests/test_session_suspend.py
  tests: backend/app/modules/daemon/tests/test_session_suspend.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-batch-session-inherit
  status: active

## FR-daemon-007 worker 自动重派
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given worker 子会话被分流标 failed 同一 worker attempt>=3 重派 dispatch 失败（无在线 daemon 等）；When 挂起事务提交后 挂起再次触发；Then 异步触发重派：从 AgentSession 行重建 dispatch 上下文（provider/model/workspace_id/worktree_bran
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-02
最近确认：023352ce0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccjhs:backend/app/modules/daemon/tests/test_worker_redispatch.py
  tests: backend/app/modules/daemon/tests/test_worker_redispatch.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-batch-session-inherit
  status: active

## FR-daemon-008 daemon 消费 resume 续会话
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given worker lease 被 claim 且 payload 含 resume_session_id payload 不含 resume_session_id（；When daemon _startInteractiveSession 执行；Then SessionManager.create 传 resume key → SDK --resume 续会话（历史延续；等 inject 才跑新 turn——对齐
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-03
最近确认：023352ce0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccwom:sillyhub-daemon/tests/integration/worker-resume.test.ts
  tests: sillyhub-daemon/tests/integration/worker-resume.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-batch-session-inherit
  status: active

## FR-daemon-009 resume 失败自动降级
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given create 带 resume key 后 SDK 启动报 session 损伤（session not found/no conversation/unabl；When daemon 检测命中；Then 清 resume key 重建 fresh 会话一次 + 事件上报 resume_downgraded（终态 metadata 备查）；再失败→普通 creat
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-04
最近确认：023352ce0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccx0h:sillyhub-daemon/tests/integration/worker-resume.test.ts
  tests: sillyhub-daemon/tests/integration/worker-resume.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-batch-session-inherit
  status: active

## FR-daemon-010 claim 白名单 interactive 补透传
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given lease metadata 含 resume_session_id 且 lease kind=interactive；When build_claim_payload 走 interactive 分支；Then payload 透传 resume_session_id（当前仅 batch 分支透传——Grill C-02 修复点）
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-05
最近确认：023352ce0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulccxbr:backend/app/modules/daemon/tests/test_build_claim_payload.py
  tests: backend/app/modules/daemon/tests/test_build_claim_payload.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-batch-session-inherit
  status: active

## FR-daemon-011 升级空闲屏障
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 收到 SELF_UPDATE 指令或探测到磁盘版本变更 推迟期间触发重发 升级链执行中（下载完成、stop 之前）；When 存在「进行中」工作（在跑 interactive 轮次 status==='running'，或在跑 batch lease _controllers 非空；空；Then 推迟升级：记录 pending（reason+目标+当前版本）+30s 后重探（无限等，每轮从零重跑 tryUpdate），不打断任何进行中工作 仅刷新目标版本
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-01
最近确认：d7003af10

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcd4h0:sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
  tests: sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-daemon-selfupdate-safety
  status: active

## FR-daemon-012 更新所有权与失败恢复
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given tryUpdate 被触发（指令/探测/复查） 一切非「交接排定」路径（noop/下载失败/异常/终检回推迟） respawn 拉起失败；When 已有更新在途；Then 本次忽略并记日志（JS 单线程原子占位） 释放所有权+清 pending 文件；下一条 SELF_UPDATE 指令可再触发 进程已 stop 停摆保活（不退出
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-02
最近确认：d7003af10

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcd4r7:sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
  tests: sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-daemon-selfupdate-safety
  status: active

## FR-daemon-013 磁盘旁路探测
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given bundle 文件被外部替换/降级（BUILD_ID 与内存不同） 探测失败（读文件失败/正则不中/任一侧为空）或 dev 构建；When self_reload_check_interval_sec（默认 600，0=关闭）周期探测（读文件正则提取 BUILD_ID，与 respawn 加载同一文；Then 触发 tryUpdate('disk_change')——走独立直启路径：不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-03
最近确认：d7003af10

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcd51w:sillyhub-daemon/tests/disk-probe-pending.test.ts
  tests: sillyhub-daemon/tests/disk-probe-pending.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-daemon-selfupdate-safety
  status: active

## FR-daemon-014 backend 透传
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 心跳携带 pending_update {reason, current_version, target_version} 心跳无该字段 机器视图；When backend 心跳端点处理；Then upsert daemon_instances.pending_update（JSON nullable）；同内容 upsert 保留原 since，首次盖 n
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-04
最近确认：d7003af10

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcd5cx:backend/app/modules/daemon/tests/test_pending_update_upsert.py
  tests: backend/app/modules/daemon/tests/test_pending_update_upsert.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-daemon-selfupdate-safety
  status: active

## FR-daemon-015 前端展示
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-003@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 机器卡渲染且 pending_update 非空 升级完成（pending_update 清 NULL）；When reason==='server_command' reason==='disk_change'；Then warning 横幅「等待空闲后自动升级（每 30s 复查）」+副行（原因+版本对比）；「升级 daemon」按钮禁用 info 横幅「检测到程序文件已变更，等
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-05
最近确认：d7003af10

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcd5oi:frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx
  tests: frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-08-29-daemon-selfupdate-safety
  status: active

## FR-daemon-016 daemon 活性推导器（tailer + deriver 注册表）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — When tailer 周期（10s）对每路径 offset 差量续读尾部 本轮推导 下一周期 周期执行；Then 经 format→deriver 注册表推导出 5 态之一 + 证据摘要（zcode：completedAt 新鲜/toolCalls 未配对→working；
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-01
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdc8g:sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts
  tests: sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-017 daemon 自发现通道（双源汇聚）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given daemon spawn 记录 / sessions.json 重启恢复 / 15min 窗口重扫兜底（三层数据源） 守卫铁律 R-01；When 定位会话日志（claude/pi 直算路径先行；codex/zcode 窄扫+标记匹配） 无日志正向等待人类证据；Then 与 SillySpec 登记源按 (workspace, log_path) 汇聚去重进 watch list；裸 agent 会话（全程不调 sillyspe
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-02
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdchu:sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts
  tests: sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-018 backend 状态落库与上报端点
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 鉴权通道（与 /api/agent-logs 同分流规则）；When POST /api/agent-logs/states 批量上报 (log_path, state, evidence, derived_at, last_ev；Then platform_agent_logs 行 upsert（state/state_derived_at/state_evidence/last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-03
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdct3:backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
  tests: backend/app/modules/platform_sync/tests/test_agent_log_states_push.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-019 blocked 主动通知（第一方事件汇聚 + E-01 门控）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 会话进入 blocked（主源=第一方 PERMISSION_REQUEST 事件，D-012 优先级；日志推导仅裸 claude CLI 候选） E-01 实；When blocked 持续 ≥120s 未消解 证伪；Then Notification type=agent_blocked（dedupe_key=(session, blocked 段序号) 同段只发一次；站内 + Re
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-04
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdd4q:backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py
  tests: backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-020 前端展示（D-004@v1 两层）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 会话列表 / 工作台首页 / 会话详情 agent 日志面板；When 状态四字段可用（api-types 经 pnpm gen:types 重新生成）；Then ①会话列表每行行尾 ~18px 状态小灯（五态色 + 工作/阻塞呼吸闪烁，不新增列不改布局），悬停弹小卡（状态全名/静默时长=now-last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-05
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdsuy:frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-021 编排知情决策（P1e）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given worker 处于 running 派发模板（sillyspec 仓）决策规则；When 编排 agent 轮询 list_workers worker blocked 超阈值 / working 久无终态；Then 返回值附 liveness{state, evidence, derived_at}（daemon 推导经 mission 状态链路汇入；链路过重时降级为 ba
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-06
最近确认：4e01d1d44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdt5v:backend/app/modules/agent/tests/test_mcp_tools.py
  tests: backend/app/modules/agent/tests/test_mcp_tools.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-agent-liveness-states
  status: active

## FR-daemon-022 历史会话对话化回看（恒读库）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 上报条目 format=zcode-model-io-jsonl，其 rollout 文件已被清理、会话存在于 zcode 本地 SQLite 会话含系统注入消；When 用户打开该会话的对话化视图（messages 端点） 归一化遍历 message 归一化 归一化；Then 完整渲染对话段（user_input/reply/thinking/tool_use/tool_result），不报"文件不存在" 该条 message 整体跳
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-01
最近确认：48240b713

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdtkd:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  tests: sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-10-zcode-session-sqlite-read
  status: active

## FR-daemon-023 原文视图从库合成（不截断）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given zcode 条目（无论文件在否） messages RPC 非 parsed 或抛错（not_found / method_not_found 老 daemon；When 用户打开原文视图（content 端点） content 端点处理；Then 后端先调 messages RPC，status=parsed 时返回九字段伪 jsonl（seq/kind/text/tool_name/tool_use_i
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-02
最近确认：48240b713

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdtxa:backend/app/modules/platform_sync/tests/test_agent_log_content.py
  tests: backend/app/modules/platform_sync/tests/test_agent_log_content.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-10-zcode-session-sqlite-read
  status: active

## FR-daemon-024 库读失败文件兜底
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given format=zcode 且 SQLite 读取失败（node:sqlite 不可用 / 库文件缺失 / 会话不在库 / 查询异常） 请求 path 越出 al；When messages RPC 处理 readAgentLogMessages 处理；Then 回落现有文件路径（lstat + parse-zcode-model-io）：文件在=正常解析成功；文件也缺=按现状 not_found 错误语义 assert
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-03
最近确认：48240b713

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcdzr8:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  tests: sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-10-zcode-session-sqlite-read
  status: active

## FR-daemon-025 零改动面
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given claude / codex 条目 beforeSeq 翻页请求（「加载更早」）；When 任一读取端点处理 zcode 会话对话化视图；Then 分派路径与现状逐字节一致（不走 SQLite 分支） 窗口切片语义与文件 parser 对齐，翻页正常
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-04
最近确认：48240b713

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce026:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  tests: sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-10-zcode-session-sqlite-read
  status: active

## FR-daemon-026 caps 第 12 键 compact
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ProviderCaps 单源加 compact 键（claude/pi/codex=true、cursor=false、未知回退 false）；When gen 脚本三端生成 + 双守护测试同步；Then 新引擎漏声明即 satisfies 编译红 + 守护测试红；前端按钮门控与 backend 端点校验有真数据源
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-01
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce0mc:backend/app/modules/agent/tests/test_provider_caps_alignment.py
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-027 统一端点双分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given POST /api/daemon/sessions/{id}/compact（归属+caps+状态三校验）；When claude → 复用 inject 服务发 "/compact"（建 run；DaemonSessionTurnConflict 捕获映射 error）；Then 响应含 run_id/queued；When pi/codex → ws_hub.send_rpc('session_compact', timeout=15)
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-02
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce0wi:backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  tests: backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-028 claude 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given caps.compact=true 且会话空闲；When 用户点压缩；Then inject 通道下发 /compact 文本，SDK 处理 slash，压缩轮作为正常 turn 收敛并在会话流可见；daemon 零改动
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-03
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce8du:backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  tests: backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-029 pi 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given session_compact RPC 到达 daemon；When session-manager 守卫通过后 PiRpcDriver.compact() 发 {"type":"compact"} 等 response；Then 回执 tokensBefore/estimatedTokensAfter 进 CompactResult → RPC result → 端点响应 → 前端通知带
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-04
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce8op:sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  tests: sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-030 codex 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 同 FR-04；When CodexAppServerDriver.compact() 经新 id→pending 机制发 thread/compact/start {threadId}；Then 受理（空响应）→ ok=true 无数字；超时/错误如实回传
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-05
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce96c:sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
  tests: sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-031 前端按钮
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 环浮层提供 onCompact 且 caps.compact=true；When turn running → 按钮禁用（tooltip 轮运行中）；预会话不渲染；cursor 引擎不渲染 点击 → compactSession() 调端点；Then 三分型成功通知（pi 数字/codex 受理/claude 已发送）或失败通知带 error 原文
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-06
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulce9nk:frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  tests: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-032 结果呈现
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 压缩完成回执在端点响应中；Then 前端通知呈现；claude 流可见性由 /compact 轮承载；环分子在压缩后下一次调用 usage 到达自然回落（零改动链）
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-07
最近确认：1aacbb3d9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcea2r:frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  tests: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-14-session-ctx-compact
  status: active

## FR-daemon-033 真机验证
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机三引擎会话各一轮压缩；Then pi 通知带数字、claude 会话流出现压缩轮、codex 受理通知；三引擎下一轮环回落；R-01/02/03 风险点各有真机结论
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-08
最近确认：1aacbb3d9

## FR-daemon-034 周期上行通道
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-01
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-daemon-hits-periodic-upload:flow:FR-01
  tests: sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-035 mtime/size 短路
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-02
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcefty:sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  tests: sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-036 失败不中断
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-03
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulceg46:sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  tests: sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-037 绑定集守卫
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-04
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulceggh:sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  tests: sillyhub-daemon/tests/knowledge-hits-periodic.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-038 双通道幂等与零回归
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-05
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-daemon-hits-periodic-upload:flow:FR-05
  tests: sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-039 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 已归档变更若为轻量出身；Then 标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-01
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-thin-badge-survives-archive:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-thin-badge-survives-archive
  status: active

## FR-daemon-040 出身判定:current_stage 为 archived 或 location 为 archive
变更：2026-09-26-thin-badge-survives-archive
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 creat；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-02
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcexpq:frontend/src/lib/__tests__/thin-lineage.test.ts
  tests: frontend/src/lib/__tests__/thin-lineage.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-thin-badge-survives-archive
  status: active

## FR-daemon-041 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
变更：2026-09-26-thin-badge-survives-archive
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-03
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcey0f:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-thin-badge-survives-archive
  status: active

## FR-daemon-042 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
变更：2026-09-26-thin-badge-survives-archive
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-04
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulceybl:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-26-thin-badge-survives-archive
  status: active

## FR-daemon-043 frontend tsc 无错误
变更：2026-09-26-thin-badge-survives-archive
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When frontend tsc 无错误；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-05
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

## FR-daemon-044 平台命令并发到达改 FIFO 排队串行执行（不再忙拒）
变更：2026-09-26-sillyspec-command-queue
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 已接线 sillyspec 命令执行器且无升级链在跑；When SILLYSPEC_RESOLVE / SILLYSPEC_GHOST_CLEANUP 消息并发到达（前一条尚未完成）；Then 后到命令不记 failed 不丢执行——排队待前一条完成（含执行失败/防御 reject 出口）后依序执行，结果仍逐条写结果槽
全文：.sillyspec/changes/archive/2026-09-26-sillyspec-command-queue/requirements.md#FR-01
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-sillyspec-command-queue:flow:FR-01
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「guard 排队：并发到达不忙拒，FIFO 依序执行 > 命令 in-flight（前一条挂起）→ 第二条排队不执行不记结果；放行后依序执行（c1 先 c2 后）」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-sillyspec-command-queue
  status: active

## FR-daemon-045 npm 升级链在跑时到达的命令排队等待升级结束再执行
变更：2026-09-26-sillyspec-command-queue
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given executor.isUpgradeInFlight() 为 true（升级链 running/deferred）；When 平台命令到达；Then 不再记 failed busy（原固定文案 SILLYSPEC_COMMAND_BUSY_ERROR 忙拒路径删除）——轮询等待升级链结束后依序执行
全文：.sillyspec/changes/archive/2026-09-26-sillyspec-command-queue/requirements.md#FR-02
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-sillyspec-command-queue:flow:FR-02
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「isUpgradeInFlight()=true（npm 升级链在跑）→ 排队轮询等待：升级结束前不执行不记结果，结束后依序执行」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-sillyspec-command-queue
  status: active

## FR-daemon-046 命令完成落槽后心跳补发语义保持
变更：2026-09-26-sillyspec-command-queue
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 命令经队列执行完成（成功或失败）；When 结果写入 _lastCommandResult 结果槽；Then 仍立即补发一次心跳（ql-20260911-024 回显提速语义不变）；排队本身不产生心跳/结果
全文：.sillyspec/changes/archive/2026-09-26-sillyspec-command-queue/requirements.md#FR-03
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-sillyspec-command-queue:flow:FR-03
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「排队命令逐条完成逐条补发：首条完成先报（携 c1 结果），次条出队执行完再报（携 c2 结果，共两次）」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-sillyspec-command-queue
  status: active

## FR-daemon-047 测试面更新——忙拒断言移除 + 排队/等待升级新用例
变更：2026-09-26-sillyspec-command-queue
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 源码与测试基线；When 忙拒常量与忙拒断言清理完成后；Then sillyspec-platform-command.test.ts 新增「并发排队依序执行」与「升级链等待后执行」两类用例，聚焦套件全绿 + tsc 0（不跑
全文：.sillyspec/changes/archive/2026-09-26-sillyspec-command-queue/requirements.md#FR-04
最近确认：8fa02468648621a9d4bf8a745cca6b1a5a895f3d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-sillyspec-command-queue:flow:FR-04
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-26-sillyspec-command-queue
  status: active

## FR-daemon-048 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的
变更：2026-09-27-daemon-queue-stop-gaps
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/requirements.md#FR-01
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-daemon-queue-stop-gaps:flow:FR-01
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「ghost_cleanup 超预算同口径：记 failed 槽（action=ghost_cleanup、无 change/strategy 键）不 exec」 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts「升级链持续在跑超过等待总预算 → 当前命令记 failed 槽（不 exec）并放行队列后续命令」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-27-daemon-queue-stop-gaps
  status: active

## FR-daemon-049 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
变更：2026-09-27-daemon-queue-stop-gaps
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/requirements.md#FR-02
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-daemon-queue-stop-gaps:flow:FR-02
  tests: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「升级链在总预算内结束 → 行为不变：命令照常执行、无 failed 槽（预算边界回归）」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-27-daemon-queue-stop-gaps
  status: active

## FR-daemon-050 daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
变更：2026-09-27-daemon-queue-stop-gaps
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/requirements.md#FR-03
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-daemon-queue-stop-gaps:flow:FR-03
  tests: sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts「停机调用 _hitsPeriodic.stop() 并置空实例（同进程 stop→start 不残留旧 interval）」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-27-daemon-queue-stop-gaps
  status: active

## FR-daemon-051 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常
变更：2026-09-27-daemon-queue-stop-gaps
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 / 幂等 相关模块就绪；When 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/requirements.md#FR-04
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcf5eq:sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  tests: sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-27-daemon-queue-stop-gaps
  status: active

## FR-daemon-052 既有聚焦测试全绿 + tsc 0 错
变更：2026-09-27-daemon-queue-stop-gaps
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有聚焦测试全绿 + tsc 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-daemon-queue-stop-gaps/requirements.md#FR-05
最近确认：3942b156fd3a9feb541d81daccbc763a2f5cad94

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-daemon-queue-stop-gaps:flow:FR-05
  tests: sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-27-daemon-queue-stop-gaps
  status: active

## FR-daemon-053 KnowledgeGovernanceHandler digest/action 双点过 asser
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When KnowledgeGovernanceHandler digest/action 双点过 assertWithinAllowedRoots（daemon.ts；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-01
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-01
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-054 knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-02
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-02
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-055 不再误拦
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 不再误拦；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-03
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

## FR-daemon-056 mobile variant 下 detailColumnVisible 恒 false，local
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When mobile variant 下 detailColumnVisible 恒 false，localStorage 跨视口不再双挂 TaskExecutionP；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-04
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-057 SessionUsageBar
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When SessionUsageBar；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-05
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-05
  tests: frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-058 mobile-change-detail thin
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When mobile-change-detail thin；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-06
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-06
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-059 quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 change_type=quick 落轻量卡）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-07
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-07
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-060 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.as
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.assign；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-08
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-08
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-061 DaemonRpcRemoteError 重映射改用 exc.code 且 timeout→504
变更：2026-09-28-audit-risk-fixes
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When DaemonRpcRemoteError 重映射改用 exc.code 且 timeout；Then 504 其余
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-09
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-09
  tests: backend/app/modules/knowledge/tests/test_governance.py::test_action_remote_error_code_and_status_mapping（timeout→504
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-062 _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-10
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-audit-risk-fixes:flow:FR-10
  tests: backend/app/modules/change/tests/test_assets.py::test_touched_modules_doc_traversal_guard（nul
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-audit-risk-fixes
  status: active

## FR-daemon-063 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / c
变更：2026-09-28-audit-risk-fixes
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / changes 页 / test_governance / t；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-audit-risk-fixes/requirements.md#FR-11
最近确认：afc294c0cd99859b03ece73a26494b0d0a855938

## FR-auto-sillyhub-daemon-001 轮任务派生
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given pi 会话产生一轮 turn（turn_start → ... → turn_end）；When 轮内出现 tool_execution_start；Then 归一化器产出一组任务事件：turn_start 时 running（task_id=pi-t<seq>），turn_end 时按 stopReason 映射终态
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-01
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcf5q6:sillyhub-daemon/tests/interactive/pi-events.test.ts
  tests: sillyhub-daemon/tests/interactive/pi-events.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-pi-task-events
  status: active

## FR-auto-sillyhub-daemon-002 上报链路复用
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 归一化器产出 status/agent_task_status 事件；Then 经既有 envelope→_onMessage→_dispatchStatusEvent→cli onSessionEvent→notifyAgentTaskS
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-02
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcf61i:sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts
  tests: sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-pi-task-events
  status: active

## FR-auto-sillyhub-daemon-003 异常流防御
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上一轮任务仍 running 时新 turn_start 到达（上轮 turn_end 丢失）；Then 先补发上轮 completed 再开新行，不产生悬挂 running
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-03
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcf6cc:sillyhub-daemon/tests/interactive/pi-events.test.ts
  tests: sillyhub-daemon/tests/interactive/pi-events.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-pi-task-events
  status: active

## FR-auto-sillyhub-daemon-004 既有行为零回归
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 全部既有 pi-events 用例与 claude/codex 会话；Then 映射表零改动；既有用例仅 expected 数组适配（追加派生事件）；claude/codex 零变化
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-04
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcf6lv:sillyhub-daemon/tests/interactive/pi-events.test.ts
  tests: sillyhub-daemon/tests/interactive/pi-events.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 3a78fbc29a02bf28ff5217254bc9a0b252c03e21
  source_change: 2026-09-07-pi-task-events
  status: active

## FR-auto-sillyhub-daemon-005 断点状态记录行指纹
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-01
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-01
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-006 替换检测与全量自愈重报
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-02
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-02
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-007 钳位语义不变
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-03
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-03
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-008 legacy 状态零误伤
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-04
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-04
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-009 单测覆盖三态
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-05
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-05
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-010 零回归
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-06
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-06
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-011 类型检查零错
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-07
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

## FR-auto-sillyhub-daemon-012 frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProvide
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOvervi；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-01
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-team.test.tsx | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-013 daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ r
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-02
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-02
  tests: sillyhub-daemon/tests/cache-passthrough.test.ts | sillyhub-daemon/tests/runtime-handler.test.ts | sillyhub-daemon/tests/stats-passthrough.test.ts | sillyhub-daemon/tests/task-runner-budget.test.ts | sillyhub-daemon/tests/task-runner-policy-cache.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-014 e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given e2e 相关模块就绪；When e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-03
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-03
  tests: frontend/e2e/navigation.spec.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-015 turn-control-attachment-atomic mtimeMs 0.001ms 浮点差
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-04
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-04
  tests: sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-016 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given e2e / 测试 相关模块就绪；When 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-05
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-05
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | backend/tests/modules/auth/test_rbac_broadcast.py | sillyhub-daemon/tests/helpers/fake-child.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-017 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 修复不违背「非测试逻辑本身有误时禁止改测试通过」原；Then ：实现 bug 修实现，测试过时
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-06
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

## FR-auto-sillyhub-daemon-018 平台差异修测试断言并注明依据
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 平台差异修测试断言并注明依据；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-07
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-07
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-019 flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-08
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-08
  tests: sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-020 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
变更：2026-09-28-ci-failures-sweep
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-09
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

## FR-unmapped-122 多 Agent 二进制检测
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地安装了 claude、codex、cursor 等 agent CLI 环境变量 `SILLYHUB_CLAUDE_PATH` 设置为自定义路径；When daemon 启动并执行 agent 检测 daemon 检测 claude agent；Then 所有在 PATH 中可找到的 agent 都被识别，返回名称、路径、版本 使用环境变量指定的路径而非 PATH 查找
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-123 版本校验
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地 claude 版本为 1.9.0（低于 2.0.0 最低要求） 本地 codex 版本为 0.200.0（高于 0.100.0 最低要求）；When daemon 检测并校验版本 daemon 检测并校验版本；Then 该 agent 被标记为可用但版本不合规，注册时上报版本警告 该 agent 正常通过版本校验
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-124 多 Runtime 注册
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本地检测到 claude、codex、cursor 三种 agent；When daemon 向服务器注册；Then 服务器创建 3 条 daemon_runtime 记录，provider 分别为 "claude"、"codex"、"cursor"
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-125 执行协议分类
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任务分配给 provider="claude" 的 runtime 任务分配给 provider="codex" 的 runtime 任务分配给 provide；When TaskRunner 执行任务 TaskRunner 执行任务 TaskRunner 执行任务；Then 使用 stream-json 协议解析输出 使用 JSON-RPC 2.0 协议通信 直接读取 stdout 纯文本
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-126 前端展示
变更：2026-06-09-daemon-agent-detection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 服务器上注册了多个 daemon runtime；When 用户访问 /runtimes 页面；Then 表格中显示每个 runtime 的 provider 类型和版本
全文：.sillyspec/changes/archive/2026-06-09-daemon-agent-detection/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-127 守护进程注册
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-128 任务认领
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-129 任务执行
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-130 心跳续期
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-131 进度报告
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-132 任务完成
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-133 运行时管理
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-134 运行位置选择
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-135 优雅降级
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-136 密钥隔离
变更：2026-06-09-local-daemon
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-09-local-daemon/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-149 协议抽象层（方案B 核心）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 12 种 agent provider 各自有不同的 stdout 协议（stream_json / json_rpc / jsonl / ndjson / t；When TaskRunner 按 provider 取对应 `ProtocolAdapter` 开发者只新增一个 `ProtocolAdapter` 实现；Then adapter 的 `parse(line)` 将原始行转为统一 `AgentEvent`（text/tool_use/tool_result/error/co
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-01
最近确认：4a456728a

## FR-unmapped-150 provider → protocol 映射
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given provider 名称；When 调用 `getBackend(provider)`；Then 按 `PROTOCOL_PROVIDERS` 映射（stream_json:[claude,gemini,cursor] / json_rpc:[codex,h
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-02
最近确认：4a456728a

## FR-unmapped-151 通信契约对齐（G-02，P0）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given backend 的 `protocol.py` 定义的消息常量 WS 断线；When daemon 发送/接收 WS 消息 触发重连
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-03
最近确认：4a456728a

## FR-unmapped-152 lease 生命周期
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到 `task_available`；When 执行一次任务；Then 完整走通 `claim(拿 claim_token) → start → 流式 messages(submit) → complete(带 patch+stat
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-04
最近确认：4a456728a

## FR-unmapped-153 凭证管理（0600）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工具配置含 `{{USER_GITHUB_TOKEN}}` 占位符；When 渲染环境变量；Then 优先从 `~/.sillyhub/daemon/credentials.json` 取值，次取环境变量；凭证文件写入后权限为 `0600`（POSIX）。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-05
最近确认：4a456728a

## FR-unmapped-154 workspace git mirror
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任务携带 repo_url + branch；When 准备工作区；Then 执行 git mirror / pull --ff-only，执行后 collect git diff 生成 patch + files_changed；Win
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-06
最近确认：4a456728a

## FR-unmapped-155 agent 检测（12 provider）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本机环境；When daemon 启动检测；Then 对 12 种 provider 按优先级（env 覆盖 → PATH 查找 → 标记不可用）探测，做 `--version` 与最低版本校验，每个检测到的 ag
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-07
最近确认：4a456728a

## FR-unmapped-156 stdin control_request 应答
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 子进程（如 stream_json/claude）通过 stdin 发出 control_request；When backend 等待批准；Then daemon 保持 stdin 开启并按策略应答（自动批准工具使用），避免子进程 hang。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-08
最近确认：4a456728a

## FR-unmapped-157 CLI（commander）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在终端；When 执行 `start / stop / status / logs`；Then 与 Python 版（Click）命令名、配置项（--server/--token）、PID 文件、日志文件路径一致。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-09
最近确认：4a456728a

## FR-unmapped-158 增量可交付（G-04）
变更：2026-06-14-2026-06-13-daemon-nodejs-rewrite
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任一 Wave 完成；When 验收；Then `tsc` 编译通过 + `vitest` 该 Wave 单测全绿即可推进，不依赖后续 Wave。
全文：.sillyspec/changes/archive/2026-06-14-2026-06-13-daemon-nodejs-rewrite/requirements.md#FR-10
最近确认：4a456728a

## FR-unmapped-183 Admin 签发 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-184 Admin 列出 API Keys
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-185 Admin 吊销 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-186 API Key 鉴权（X-API-Key header）
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-187 鉴权 dependency header 优先级
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-188 API Key 持久化 last_used_at
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-189 daemon CLI --api-key 选项
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-190 daemon config.json 持久化 api_key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-191 前端 API Keys 管理页
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-192 runtimes 页面启动命令优先用 API Key
变更：2026-06-16-daemon-api-key
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-16-daemon-api-key/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-236 Codex runtime 创建 interactive session
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-005@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given `/runtimes` 中存在在线 Codex runtime；When 用户在 Codex runtime 会话弹窗中发送首条消息；Then frontend 调用 `createSession({provider:"codex"})`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-01
最近确认：3cace8c05

## FR-unmapped-237 Codex 支持同一 session 多轮对话
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given Codex `AgentSession` 已 active；When 用户发送第二条消息；Then frontend 调用 `injectSession(sessionId,prompt)`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-02
最近确认：3cace8c05

## FR-unmapped-238 Codex 支持运行中 interrupt
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given Codex turn 正在运行且 driver 已收到 `turn/started`；When 用户点击打断；Then backend 下发 `SESSION_INTERRUPT`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-03
最近确认：3cace8c05

## FR-unmapped-239 Codex 输出进入现有日志与 SSE
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given Codex app-server 输出 agent message、tool use、tool result 或 error；When daemon 收到 JSON-RPC notification；Then Codex driver 将其归一化为 flat message
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-04
最近确认：3cace8c05

## FR-unmapped-240 Codex session 支持 end 与历史回看
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given Codex `AgentSession` 处于 active 或 running；When 用户点击结束会话；Then backend 下发 `SESSION_END`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-05
最近确认：3cace8c05

## FR-unmapped-241 Codex 支持 reopen 与 daemon recovery
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given Codex ended/failed session 有 `agent_session_id` thread id Codex session 缺少 threa；When 用户点击继续对话或 daemon 启动恢复 尝试 reopen/recovery；Then backend 允许 provider `codex` reopen 系统不得伪造新 thread
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-06
最近确认：3cace8c05

## FR-unmapped-242 frontend Codex runtime 不走 quick-chat
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given runtime provider 为 `codex`；When `/runtimes` 弹窗渲染右侧会话区；Then 使用 `InteractiveSessionChatSection`
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-07
最近确认：3cace8c05

## FR-unmapped-243 Codex 普通 approval 策略与 Claude Code 一致
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-006@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given Codex session 配置为 `manual_approval=true` 且 `ask_user_only=true` Codex session 配置；When app-server 发出 command/file/permission approval request app-server 发出 command/fil；Then daemon 按 ask-only 策略 allow-through 并记录 metadata daemon 发送 backend `PERMISSION_RE
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-08
最近确认：3cace8c05

## FR-unmapped-244 Codex 用户输入请求复用现有 dialog 卡片
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-006@v1、D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given Codex app-server 发出 `item/tool/requestUserInput` Codex app-server 发出复杂 MCP elici；When daemon 收到 server request daemon 处理该 request；Then daemon 归一化为现有 `AskUserDialogCard` 可渲染的 `questions/options` request fail-closed
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-09
最近确认：3cace8c05

## FR-unmapped-245 Claude Code interactive 行为不回退
变更：2026-06-23-2026-06-23-codex-interactive-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1、D-008@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given provider 为 `claude`；When 用户创建、inject、interrupt、end、reopen、触发 AskUserQuestion；Then 现有 Claude Code 行为保持一致
全文：.sillyspec/changes/archive/2026-06-23-2026-06-23-codex-interactive-session/requirements.md#FR-10
最近确认：3cace8c05

## FR-unmapped-284 daemon idle 自动回收默认禁用（D-001）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-1
最近确认：4337b8a51

## FR-unmapped-285 idle 逃生口保留（D-001）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-2
最近确认：4337b8a51

## FR-unmapped-286 scan 完成主动 end_session（D-002）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-3
最近确认：4337b8a51

## FR-unmapped-287 stage 完成主动 end_session（D-002）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-4
最近确认：4337b8a51

## FR-unmapped-288 多轮对话不自动 end（D-002@v1 边界）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-5
最近确认：4337b8a51

## FR-unmapped-289 完成驱动 end 失败不阻塞 lease（D-002@v1 容错）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-6
最近确认：4337b8a51

## FR-unmapped-290 手动终止链路保持不变（D-003）
变更：2026-06-25-2026-06-25-interactive-idle-timeout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-25-2026-06-25-interactive-idle-timeout-fix/requirements.md#FR-7
最近确认：4337b8a51

## FR-unmapped-291 WorkspaceCreate 支持 spec_strategy 字段
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-01
最近确认：98d3e56dd

## FR-unmapped-292 daemon-client 创建时 strategy 落 spec_workspaces
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-003@v1、D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-02
最近确认：98d3e56dd

## FR-unmapped-293 strategy 经 scan lease payload 透传（backend→daemon）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-03
最近确认：98d3e56dd

## FR-unmapped-294 daemon 接收 specStrategy
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-04
最近确认：98d3e56dd

## FR-unmapped-295 pullSpecBundle platform-managed 分支现状回归
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-05
最近确认：98d3e56dd

## FR-unmapped-296 pullSpecBundle repo-mirrored 分支单次导入
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-06
最近确认：98d3e56dd

## FR-unmapped-297 pullSpecBundle repo-native 分支建 junction
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-07
最近确认：98d3e56dd

## FR-unmapped-298 junction 生命周期（复用/降级）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-08
最近确认：98d3e56dd

## FR-unmapped-299 repo-native rm 防误删守卫
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-09
最近确认：98d3e56dd

## FR-unmapped-300 packSpecDir 穿 junction + postSpecSync 三策略都走
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-10
最近确认：98d3e56dd

## FR-unmapped-301 前端创建表单 strategy 选项
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-004@v1、D-005@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-11
最近确认：98d3e56dd

## FR-unmapped-302 AgentRun.spec_strategy 读真实值
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-12
最近确认：98d3e56dd

## FR-unmapped-303 model.py repo-mirrored 注释更新
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-13
最近确认：98d3e56dd

## FR-unmapped-304 daemon-client 详情页扫描入口（首次/重新 scan 触发）
变更：2026-06-28-daemon-client-spec-sync-strategy
状态：active
摘要：（无场景名）
依据决策：D-006@v1
全文：.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/requirements.md#FR-14
最近确认：98d3e56dd

## FR-unmapped-305 开启子代理 text/thinking 流出（Claude SDK）
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 主 agent 在 Claude interactive session 中调用 Task/Agent tool 派生子代理；When `ClaudeSdkDriver.start()` 设置 `options.forwardSubagentText = true`；Then 子代理的 text/thinking 作为带 `parent_tool_use_id` 的 assistant/user message 经主流 query g
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-01
最近确认：f7f73d86c

## FR-unmapped-306 子代理消息归属识别与原样透传
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given daemon consume 收到一条带 `parent_tool_use_id` 非空的 SDK message（assistant 或 user）；When `_onMessage` 处理并经 `onTurnMessage` 转发；Then msg 顶层保留 `parent_tool_use_id`/`subagent_type`/`task_description`（原样，不剥离），backend
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-02
最近确认：f7f73d86c

## FR-unmapped-307 partial buffer 按 parent_tool_use_id 分桶隔离
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 主 agent 与一个或多个子代理在同一 interactive session 并发产出 partial（streaming delta）；When `_bufferPartial` / `_clearPartialBufferSync` / `_flushPartial` / `_emitOverrideS；Then 各自按 `parentKey = parent_tool_use_id ?? 'main'` 独立分桶；子代理完整 assistant message 只清自己
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-03
最近确认：f7f73d86c

## FR-unmapped-308 agentSessionId 不被子代理 init 覆盖
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 主 session 已写入 `agentSessionId`（主 system/init 先到），随后子代理 system/init 到达；When `_onMessage` 处理子代理 system/init；Then 直接跳过（`parent_tool_use_id` 非空守卫 + 现有 `===undefined` 守卫），主 session resume key 不被覆盖
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-04
最近确认：f7f73d86c

## FR-unmapped-309 depth 维护与透传
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given `SessionState.subagentDepth: Map<tool_use_id, depth>`；When `_onMessage` 处理 assistant message（含 tool_use blocks）与子代理消息
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-05
最近确认：f7f73d86c

## FR-unmapped-310 agent_run_logs 加归属列 + migration
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given `agent_run_logs` 表（现有无归属列）；When 执行 alembic migration；Then 加 `parent_tool_use_id VARCHAR(200) NULL` / `subagent_type VARCHAR(100) NULL` / `
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-06
最近确认：f7f73d86c

## FR-unmapped-311 _extract_sdk_messages 每条注入归属 + 落库
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given backend 收到 daemon 透传的 SDK message（带 parent_tool_use_id/subagent_type/depth）；When `_extract_sdk_messages` 展开为 flat records 且 `submit_messages` 落库；Then **每条** flat record 都带 parent_tool_use_id/subagent_type/depth（非首条 stamp，D-008）；落库
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-07
最近确认：f7f73d86c

## FR-unmapped-312 前端徽标 + 深度渲染
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 前端收到带归属列的 `agent_run_logs` 行；When `agent-log-viewer` / `logsToTurns` 渲染；Then `subagent_type` 非空 → 行首渲染 `[子代理:<subagent_type>]` 徽标（中文）；`depth > 0` → 按 depth 缩
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-08
最近确认：f7f73d86c

## FR-unmapped-313 向后兼容
变更：2026-06-28-daemon-subagent-transcript
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 历史 `agent_run_logs` 行（归属列 NULL）或未升级 daemon 的旧路径（msg 无归属字段）；When 前端渲染；Then 按 main agent 渲染（parent=null/depth=NULL→0），行为与现状一致
全文：.sillyspec/changes/archive/2026-06-28-daemon-subagent-transcript/requirements.md#FR-09
最近确认：f7f73d86c

## FR-unmapped-323 daemon register 上报版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 启动并以 release 构建（DAEMON_VERSION=语义版本，BUILD_ID=git SHA） daemon 为 dev 构建（BUI；When daemon 调 POST /api/daemon/register register；Then 请求体含 `daemon_version`（语义版本）+ `daemon_build_id`（SHA） 请求体含 `daemon_version`，`daemo
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-01
最近确认：3849dbf33

## FR-unmapped-324 daemon heartbeat 上报版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 已注册且在线；When daemon 周期性调 heartbeat（HTTP 或 WS）；Then payload 含 `daemon_version` + `daemon_build_id`
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-02
最近确认：3849dbf33

## FR-unmapped-325 backend 持久化 daemon 版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given backend 收到带 daemon_version/daemon_build_id 的 register/heartbeat 收到旧 daemon 不带版本字；When service 处理 upsert daemon_instances upsert；Then daemon_instances.version = 语义版本，daemon_instances.build_id = SHA 被写入 version/buil
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-03
最近确认：3849dbf33

## FR-unmapped-326 backend DTO 返回 daemon 版本
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon_instances 已存 version/build_id；When 前端调 GET /api/daemon/runtimes/page 或 GET /api/daemon/instances；Then 响应每项含 daemon_version/daemon_build_id（runtime 行）或 version/build_id（instance 行）
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-04
最近确认：3849dbf33

## FR-unmapped-327 GET /api/daemon/version 返回 latest 双字段
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 部署 bundle 提取失败 self-update 端点 POST /runtimes/{id}/self-update；When 前端调 GET /api/daemon/version；Then 响应含 `latest_version`（语义版本）+ `latest_build_id`（SHA），保留旧 latest/minRequired/downlo
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-05
最近确认：3849dbf33

## FR-unmapped-328 前端展示 daemon 版本 + 徽标
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 管理员打开 runtimes 管理页 runtime.daemon_build_id == latest.latest_build_id（且非 dev/unkn；When runtime 列表渲染；Then 每个 runtime 行显示其 daemon 版本号 + SHA 短码 + 徽标 显示「最新」徽标 显示「可升级」徽标 显示「未知」徽标
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-06
最近确认：3849dbf33

## FR-unmapped-329 前端升级按钮调 self-update
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 行显示「可升级」或「未知」，且 runtime 在线 self-update 端点返回 DaemonRuntimeOffline；When 管理员点击「升级到最新版」
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-07
最近确认：3849dbf33

## FR-unmapped-330 前端 offline 禁用升级按钮
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given runtime 离线；Then 升级按钮禁用（disabled），不可点击
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-08
最近确认：3849dbf33

## FR-unmapped-331 兼容旧 daemon
变更：2026-07-04-2026-07-04-daemon-version-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已部署的旧 daemon（不上报版本字段）；When 它 register/heartbeat；Then backend 不报错（字段 Optional），version/build_id 存 NULL，前端显示「未知」
全文：.sillyspec/changes/archive/2026-07-04-2026-07-04-daemon-version-management/requirements.md#FR-09
最近确认：3849dbf33

## FR-unmapped-343 daemon 停止写 `.sillyspec-platform.json`
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-344 `spec_version` 状态独立文件
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-345 保鲜读写迁移到新位置
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-346 `hasUnsyncedLocalChanges` 读新位置
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-347 dead code 清理
变更：2026-07-07-2026-07-07-platform-json-contract-align
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-07-07-2026-07-07-platform-json-contract-align/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-387 前端按操作系统自动检测并显示对应安装命令
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 用户打开 `/runtimes` 页面且 `InstallDaemonBlock` 已在客户端 mount；When 读取 `navigator.userAgent` 判定 OS（`/Win/` → Windows，其余 → unix）；Then 默认显示对应平台的安装命令（Windows → PowerShell 一行；unix → curl\|bash），首屏不渲染命令以避免 hydration 不一
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-01
最近确认：af41fac1d

## FR-unmapped-388 Windows 显示 PowerShell 一行（后端动态内嵌 server_url）
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given OS 选中为 Windows 且 `serverUrl = window.location.origin` 已就绪；When 渲染 Windows 命令；Then 显示 `irm <serverUrl>/daemon/install.ps1 | iex`，并附琥珀提示「在 PowerShell 或 cmd 中运行」；复制按
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-02
最近确认：af41fac1d

## FR-unmapped-389 提供 OS 手动切换开关
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given `InstallDaemonBlock` 展开；When 用户点击「macOS / Linux」或「Windows」切换按钮；Then 命令与提示切换为对应平台；默认选中值跟随 FR-01 自动检测，可被手动覆盖
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-03
最近确认：af41fac1d

## FR-unmapped-390 macOS / Linux 命令保持现状
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given OS 选中为 unix；When 渲染命令；Then 显示 `curl -fsSL <serverUrl>/daemon/install.sh | bash -s -- --server-url <serverUr
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-04
最近确认：af41fac1d

## FR-unmapped-391 install.ps1 复刻 install.sh 全逻辑（含 mcp-server.js）
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given Windows 用户执行 `irm <serverUrl>/daemon/install.ps1 | iex`；When install.ps1 运行
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-05
最近确认：af41fac1d

## FR-unmapped-392 后端 GET /daemon/install.ps1 公开端点
变更：2026-07-15-2026-07-14-daemon-install-os-aware
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given backend 镜像已打包 install.ps1 模板 请求经前端 rewrite 反代到达 backend；When `GET /daemon/install.ps1`（无 /api 前缀） 推导 server_url；Then 返回 200 + `Content-Type: application/x-powershell`，body 为模板且 `{{SERVER_URL}}` 已替换
全文：.sillyspec/changes/archive/2026-07-15-2026-07-14-daemon-install-os-aware/requirements.md#FR-06
最近确认：af41fac1d

## FR-unmapped-483 daemon 上报 started_at（覆盖 D-001@v1）
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-01
最近确认：b9b0454bb

## FR-unmapped-484 backend 存储 + machines 返回 started_at（覆盖 D-001@v1, D-002@v1）
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-02
最近确认：b9b0454bb

## FR-unmapped-485 前端机器头显示 started_at
变更：2026-08-05-daemon-start-time
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-05-daemon-start-time/requirements.md#FR-03
最近确认：b9b0454bb

## FR-unmapped-486 runtime 读端点返回 daemon 版本（覆盖 D-004@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-01
最近确认：9afbfe036

## FR-unmapped-487 构建号每次 build 自动变化（覆盖 D-001@v1, D-002@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-001@v1、D-002@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-02
最近确认：9afbfe036

## FR-unmapped-488 build-id.ts 移出版控后 tsc 不缺文件（覆盖 D-003@v1）
变更：2026-08-05-daemon-version
状态：active
摘要：（无场景名）
依据决策：D-003@v1
全文：.sillyspec/changes/archive/2026-08-05-daemon-version/requirements.md#FR-03
最近确认：9afbfe036

## FR-daemon-064 落盘串行链——最后一次 note 的值必最后落盘
变更：2026-10-09-status-root-write-race
状态：active
摘要：两次快速切换 root
全文：.sillyspec/changes/archive/2026-10-09-status-root-write-race/requirements.md#FR-01
最近确认：ad9c05fb8cb88d8510207c895a9157960bfa533d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-status-root-write-race:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「快速连续切换 ×20 → 落盘最终必为最后一次值（2026-10-09 竞态回归：串行链）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-status-root-write-race
  status: active

## FR-daemon-065 回归用例钉住
变更：2026-10-09-status-root-write-race
状态：active
摘要：回归可检
全文：.sillyspec/changes/archive/2026-10-09-status-root-write-race/requirements.md#FR-02
最近确认：ad9c05fb8cb88d8510207c895a9157960bfa533d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-status-root-write-race:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「切换 root → 落盘覆盖为最新值（既有用例转稳定；红证=旧码 CI run 37862831833 实跑红 + 本地 3 跑 1 红）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-status-root-write-race
  status: active

## FR-daemon-066 相关面全绿
变更：2026-10-09-status-root-write-race
状态：active
摘要：CI 转绿
全文：.sillyspec/changes/archive/2026-10-09-status-root-write-race/requirements.md#FR-03
最近确认：ad9c05fb8cb88d8510207c895a9157960bfa533d

## FR-daemon-067 hasLiveBackgroundTasks=true 的 run 收口不再向 submitMessages 发 [USAGE_NOTE] 行
变更：2026-10-10-usage-note-to-daemon-log
状态：active
摘要：收口时有存活后台任务
全文：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/requirements.md#FR-01
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-usage-note-to-daemon-log:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=true → 无 [USAGE_NOTE] 行，改发 run_cost_may_include_bg_tasks 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-usage-note-to-daemon-log
  status: active

## FR-daemon-068 排障意图保留：daemon 结构化日志记录存活后台任务标记 + 本轮 cost 差分（cost_delta_usd）
变更：2026-10-10-usage-note-to-daemon-log
状态：active
摘要：有存活后台任务且带成本快照
全文：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/requirements.md#FR-02
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-usage-note-to-daemon-log:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=true 且 total_cost_usd=24.10 → 日志 cost_delta_usd=24.1 挂收口 run」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-usage-note-to-daemon-log
  status: active

## FR-daemon-069 total_cost_usd 缺失时日志安全降级（字段 null，不抛错）
变更：2026-10-10-usage-note-to-daemon-log
状态：active
摘要：成本快照缺失
全文：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/requirements.md#FR-03
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-usage-note-to-daemon-log:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「total_cost_usd 缺失 → 日志 cost_delta_usd=null 且终态照常上报」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-usage-note-to-daemon-log
  status: active

## FR-daemon-070 daemon-usage-note.test.ts 改写为两态断言（无消息流行 + 有日志），先红后绿
变更：2026-10-10-usage-note-to-daemon-log
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/requirements.md#FR-04
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-usage-note-to-daemon-log:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts「hasLive=false → 无 [USAGE_NOTE] 行且无该日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-usage-note-to-daemon-log
  status: active

## FR-daemon-071 相关面（daemon-interactive-bridge 等）合跑通过 + tsc --noEmit 0 错
变更：2026-10-10-usage-note-to-daemon-log
状态：active
摘要：改动后合跑
全文：.sillyspec/changes/archive/2026-10-10-usage-note-to-daemon-log/requirements.md#FR-05
最近确认：fe99e67d4c7df4c6d1dc64fdb4b3612940c832fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-usage-note-to-daemon-log:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「相关面合跑回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-usage-note-to-daemon-log
  status: active

## FR-daemon-072 借用 lease 携带工作区上下文单键
变更：2026-10-10-borrow-sandbox-workspace-context
状态：active
摘要：默认场景；Workspace 行缺失/查询异常
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 借用会话派发（三标记点之一：dispatch_to_daemon / prepare_interactive_dispatch /；When backend 写借用沙箱标记（_stamp_borrow_sandbox_metadata）；Then lease metadata MUST 含单键 `borrow_workspace_context`（JSON 对象），字段集 =
- 场景：Workspace 行缺失/查询异常 — Given 借用派发时 workspace 行不存在或查询异常；When loader 执行；Then MUST 返回 None、MUST NOT 写键、MUST NOT 阻塞派发（best-effort，对齐借用
全文：.sillyspec/changes/archive/2026-10-10-borrow-sandbox-workspace-context/requirements.md#FR-01
最近确认：2d4702355

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-borrow-sandbox-workspace-context:task-01:acc-0-7dae3102
  tests: backend/app/modules/agent/tests/test_placement_borrow_integration.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-01:acc-1-534a304a
  tests: backend/app/modules/agent/tests/test_placement_borrow_integration.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-01:acc-2-e11a234b
  tests: backend/app/modules/agent/tests/test_placement_borrow_integration.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active

## FR-daemon-073 上下文含真实路径与只读边界声明，写隔离零改动
变更：2026-10-10-borrow-sandbox-workspace-context
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 借用会话的沙箱已准备 本变更上线；When daemon 渲染 AGENTS.md 任意借用会话尝试写沙箱外路径；Then 内容 MUST 含 lender 真实代码目录 root_path 与「可以读 / 禁止写（写守卫 写守卫判定逻辑 MUST NOT 与变更前有任何差异（红线）
全文：.sillyspec/changes/archive/2026-10-10-borrow-sandbox-workspace-context/requirements.md#FR-02
最近确认：2d4702355

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-borrow-sandbox-workspace-context:task-03:acc-0-ed1bb551
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-03:acc-1-21a26d1f
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-03:acc-2-297ca987
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-04:acc-0-796faeca
  tests: sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-04:acc-1-f58bf0c6
  tests: sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-04:acc-2-523f0305
  tests: sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active

## FR-daemon-074 claim payload 白名单透传与 daemon 归一化
变更：2026-10-10-borrow-sandbox-workspace-context
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given lease metadata 含 borrow_workspace_context；When daemon 认领（build_claim_payload）与归一化；Then claim payload MUST 含同名单键（真值守护）；daemon 归一化 MUST 双读
全文：.sillyspec/changes/archive/2026-10-10-borrow-sandbox-workspace-context/requirements.md#FR-03
最近确认：2d4702355

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-borrow-sandbox-workspace-context:task-02:acc-0-cee00335
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-02:acc-1-393e1372
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active
- row: 2026-10-10-borrow-sandbox-workspace-context:task-02:acc-2-e1bf0ac4
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-borrow-sandbox-workspace-context
  status: active

## FR-daemon-075 沙箱 AGENTS.md 落盘 fail-open
变更：2026-10-10-borrow-sandbox-workspace-context
状态：active
摘要：默认场景；旧 backend 无键
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given marker 分支 prepareWorkspace 成功且 execPayload.borrowWorkspaceContext 存在；When daemon 渲染写 AGENTS.md；Then 文件 MUST 落沙箱根（BORROW_CONTEXT_FILENAME='AGENTS.md'）；渲染/写入异常
- 场景：旧 backend 无键 — Given claim payload 无 borrow_workspace_context；When daemon 处理；Then MUST NOT 渲染/写任何文件（= 现状行为）。
全文：.sillyspec/changes/archive/2026-10-10-borrow-sandbox-workspace-context/requirements.md#FR-04
最近确认：2d4702355

## FR-daemon-076 零回归与双向兼容
变更：2026-10-10-borrow-sandbox-workspace-context
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 非借用 lease（borrowed=False） 新 backend 对旧 daemon 下发含新键的 claim payload；When 走完整派发链 旧 daemon 认领；Then metadata / claim payload MUST NOT 出现新键（逐字节不变）。 旧 daemon MUST 忽略未知键不报错。
全文：.sillyspec/changes/archive/2026-10-10-borrow-sandbox-workspace-context/requirements.md#FR-05
最近确认：2d4702355

## FR-daemon-077 本机现状快照拉取与对照
变更：2026-10-10-linked-repos-local-echo
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 成员机器 daemon 在线且绑定该工作区；When 成员在关联仓卡片点「刷新本机现状」（GET local-snapshot）；Then backend 经 RPC `linked_repos_snapshot` 现拉 daemon 侧快照（projects 登记面 +
全文：.sillyspec/changes/archive/2026-10-10-linked-repos-local-echo/requirements.md#FR-01
最近确认：f4f974870

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-linked-repos-local-echo:task-01:acc-0-91d1e8dd
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | sillyhub-daemon/tests/linked-repos-snapshot.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active
- row: 2026-10-10-linked-repos-local-echo:task-01:acc-1-5ff9bd9b
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | sillyhub-daemon/tests/linked-repos-snapshot.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active
- row: 2026-10-10-linked-repos-local-echo:task-01:acc-2-1fa61984
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | sillyhub-daemon/tests/linked-repos-snapshot.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active
- row: 2026-10-10-linked-repos-local-echo:task-02:acc-0-0e591632
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active
- row: 2026-10-10-linked-repos-local-echo:task-02:acc-1-919be75d
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active

## FR-daemon-078 降级路径
变更：2026-10-10-linked-repos-local-echo
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 离线、老 daemon（无 handler）、本机 sillyspec 缺读命令或**成员未绑定机器**；When 成员点刷新；Then 分别得到 daemon_offline / daemon_unsupported / 源级 skipped / binding_missing 的
全文：.sillyspec/changes/archive/2026-10-10-linked-repos-local-echo/requirements.md#FR-02
最近确认：f4f974870

## FR-daemon-079 一键导入
变更：2026-10-10-linked-repos-local-echo
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 快照含 local_only 条目（对照期已把 projects/repos 同名条目合并为单条：；When owner/admin 勾选后点「导入所选」（POST import）；Then 逐条独立成败：create_repo(name, rel_path?) 建行 +（含 abs_path 时）绝对路径写
全文：.sillyspec/changes/archive/2026-10-10-linked-repos-local-echo/requirements.md#FR-03
最近确认：f4f974870

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-linked-repos-local-echo:task-03:acc-0-0a63f53a
  tests: backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active

## FR-daemon-080 前端本机现状区
变更：2026-10-10-linked-repos-local-echo
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开关联仓卡片；When 查看本机现状区；Then 初始为引导文案（零请求，D-003）；刷新后按三态徽标展示（both ✓ / local_only 可勾选
全文：.sillyspec/changes/archive/2026-10-10-linked-repos-local-echo/requirements.md#FR-04
最近确认：f4f974870

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-linked-repos-local-echo:task-04:acc-0-91896792
  tests: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-linked-repos-local-echo
  status: active

## FR-daemon-081 daemon session_live_tasks RPC 返回会话活跃任务快照
变更：2026-10-11-task-sweep-daemon-truth
状态：active
摘要：问询
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-daemon-truth/requirements.md#FR-01
最近确认：ed9542f24dd515f923417163e8a2b71ba2b53477

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-daemon-truth:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts「注册表内的 task_id 全量返回」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-daemon-truth
  status: active

## FR-daemon-082 后端清扫改为确认制（daemon 真相源，废除全部时间启发式）
变更：2026-10-11-task-sweep-daemon-truth
状态：active
摘要：确认死才收；daemon 离线
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-daemon-truth/requirements.md#FR-02
最近确认：ed9542f24dd515f923417163e8a2b71ba2b53477

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-daemon-truth:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_daemon_confirmed_dead_only」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-daemon-truth
  status: active

## FR-daemon-083 run 收口延迟确认清扫 + 启动确认清扫
变更：2026-10-11-task-sweep-daemon-truth
状态：active
摘要：run 收口后孤儿收敛
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-daemon-truth/requirements.md#FR-03
最近确认：ed9542f24dd515f923417163e8a2b71ba2b53477

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-daemon-truth:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_run_scoped_filter」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-daemon-truth
  status: active

## FR-daemon-084 标记与复活保留 + 回归
变更：2026-10-11-task-sweep-daemon-truth
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-daemon-truth/requirements.md#FR-04
最近确认：ed9542f24dd515f923417163e8a2b71ba2b53477

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-daemon-truth:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_stopped_row_revives_on_running_heartbeat」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-daemon-truth
  status: active

## FR-daemon-085 daemon duration_api_ms 按会话差分上报
变更：2026-10-10-duration-api-cumulative-fix
状态：active
摘要：跨轮差分
全文：.sillyspec/changes/archive/2026-10-10-duration-api-cumulative-fix/requirements.md#FR-01
最近确认：303963b6019cd66b1865cd655f3f1e5e8ab4b86b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-duration-api-cumulative-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 跨轮累计快照差分」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-duration-api-cumulative-fix
  status: active

## FR-daemon-086 backend close 超界拒收
变更：2026-10-10-duration-api-cumulative-fix
状态：active
摘要：累计值拒收
全文：.sillyspec/changes/archive/2026-10-10-duration-api-cumulative-fix/requirements.md#FR-02
最近确认：303963b6019cd66b1865cd655f3f1e5e8ab4b86b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-duration-api-cumulative-fix:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_close_duration_api_ms_over_wall_rejected」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-duration-api-cumulative-fix
  status: active

## FR-daemon-087 相关测试通过（不跑全量）
变更：2026-10-10-duration-api-cumulative-fix
状态：active
摘要：双侧绿
全文：.sillyspec/changes/archive/2026-10-10-duration-api-cumulative-fix/requirements.md#FR-03
最近确认：303963b6019cd66b1865cd655f3f1e5e8ab4b86b

## FR-daemon-088 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例
变更：2026-10-12-pi-oldhost-fallback-pin
状态：active
摘要：旧版 pi 宿主收敛面钉住
全文：.sillyspec/changes/archive/2026-10-12-pi-oldhost-fallback-pin/requirements.md#FR-01
最近确认：293d1ec98be0e4e8bf0f8891cfba554052cfdd58

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-pi-oldhost-fallback-pin:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「pi(mcp=true，旧版宿主注入跳过形态) 成功轮：立即零代报；+90s 探测无 artifacts → 兜底代报（旧版 pi 宿主经延迟探测收敛，2026-10-12-pi-oldhost-fallback-pin）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-pi-oldhost-fallback-pin
  status: active

## FR-daemon-089 daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计
变更：2026-10-12-pi-oldhost-fallback-pin
状态：active
摘要：披露落盘
全文：.sillyspec/changes/archive/2026-10-12-pi-oldhost-fallback-pin/requirements.md#FR-02
最近确认：293d1ec98be0e4e8bf0f8891cfba554052cfdd58

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-pi-oldhost-fallback-pin:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「pi(mcp=true，旧版宿主注入跳过形态) 成功轮：立即零代报；+90s 探测无 artifacts → 兜底代报（旧版 pi 宿主经延迟探测收敛，2026-10-12-pi-oldhost-fallback-pin）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-pi-oldhost-fallback-pin
  status: active

## FR-daemon-090 生产代码零逻辑改动（注释与测试面变更）
变更：2026-10-12-pi-oldhost-fallback-pin
状态：active
摘要：零逻辑改动核验
全文：.sillyspec/changes/archive/2026-10-12-pi-oldhost-fallback-pin/requirements.md#FR-03
最近确认：293d1ec98be0e4e8bf0f8891cfba554052cfdd58

## FR-daemon-091 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件
变更：2026-10-12-pi-oldhost-fallback-pin
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-pi-oldhost-fallback-pin/requirements.md#FR-04
最近确认：293d1ec98be0e4e8bf0f8891cfba554052cfdd58

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-pi-oldhost-fallback-pin:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-pi-oldhost-fallback-pin
  status: active

## FR-daemon-092 linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）
变更：2026-10-12-daemon-path-guard-completion
状态：active
摘要：越界拒止；白名单内放行
全文：.sillyspec/changes/archive/2026-10-12-daemon-path-guard-completion/requirements.md#FR-01
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-daemon-path-guard-completion:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_snapshot：root_path 越界 → forbidden 且业务函数零调用」 | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 越界 → forbidden 且业务函数零调用（零 spawn）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-daemon-path-guard-completion
  status: active

## FR-daemon-093 pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）
变更：2026-10-12-daemon-path-guard-completion
状态：active
摘要：相对形态拒止；绝对形态放行
全文：.sillyspec/changes/archive/2026-10-12-daemon-path-guard-completion/requirements.md#FR-02
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-daemon-path-guard-completion:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/spec-sync.test.ts「rootPath 相对形态 → 抛错先于任何 fs 操作（repo-native mkdir/junction 不可达）」 | sillyhub-daemon/tests/spec-sync.test.ts「rootPath 绝对形态 → 守卫放行（盘符/UNC/POSIX 三形态判定见 linked-repos-path 单测，此处钉不误杀）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-daemon-path-guard-completion
  status: active

## FR-daemon-094 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿
变更：2026-10-12-daemon-path-guard-completion
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-12-daemon-path-guard-completion/requirements.md#FR-03
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-daemon-path-guard-completion:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 在 allowed_roots 内 → 放行（业务函数被调、payload 透传）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-daemon-path-guard-completion
  status: active

## FR-daemon-095 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）
变更：2026-10-12-daemon-path-guard-completion
状态：active
摘要：三平台可跑
全文：.sillyspec/changes/archive/2026-10-12-daemon-path-guard-completion/requirements.md#FR-04
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-daemon-path-guard-completion:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 越界 → forbidden 且业务函数零调用（零 spawn）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-daemon-path-guard-completion
  status: active

## FR-daemon-096 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts
变更：2026-10-12-daemon-path-guard-completion
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-daemon-path-guard-completion/requirements.md#FR-05
最近确认：bb36a60bb75a4bf650a7069cf62e94d595da4c44

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-daemon-path-guard-completion:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-daemon-path-guard-completion
  status: active

## FR-daemon-097 duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面
变更：2026-10-12-duration-nan-guard
状态：active
摘要：NaN 不进 payload 不污染基线
全文：.sillyspec/changes/archive/2026-10-12-duration-nan-guard/requirements.md#FR-01
最近确认：eba4ab5904d2f969b479704e0062bcbbfacb20ad

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-duration-nan-guard:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 为 NaN → 不进差分不污染基线（Number.isFinite 门，对齐 total_cost_usd 口径，2026-10-12-duration-nan-guard）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-duration-nan-guard
  status: active

## FR-daemon-098 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿
变更：2026-10-12-duration-nan-guard
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-12-duration-nan-guard/requirements.md#FR-02
最近确认：eba4ab5904d2f969b479704e0062bcbbfacb20ad

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-duration-nan-guard:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 为 NaN → 不进差分不污染基线（Number.isFinite 门，对齐 total_cost_usd 口径，2026-10-12-duration-nan-guard）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-duration-nan-guard
  status: active

## FR-daemon-099 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件
变更：2026-10-12-duration-nan-guard
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-duration-nan-guard/requirements.md#FR-03
最近确认：eba4ab5904d2f969b479704e0062bcbbfacb20ad

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-duration-nan-guard:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-duration-nan-guard
  status: active

## FR-daemon-100 linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变
变更：2026-10-12-regression-review-remediation
状态：active
摘要：白名单外但存在 → 放行；不存在 → 拒止
全文：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/requirements.md#FR-01
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-regression-review-remediation:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 不存在 → 抛错且业务函数零调用（错机派发保护）」 | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 白名单外但存在 → ql-20260831-006 语义放行（机器白名单不拦工作区根）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-regression-review-remediation
  status: active

## FR-daemon-101 handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）
变更：2026-10-12-regression-review-remediation
状态：active
摘要：结果体失败
全文：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/requirements.md#FR-02
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-regression-review-remediation:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/test_init_lease.test.ts「rootPath 相对形态 → ok:false 结果体（对齐「逐步 catch 不上抛」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-regression-review-remediation
  status: active

## FR-daemon-102 daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径
变更：2026-10-12-regression-review-remediation
状态：active
摘要：注释勘误
全文：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/requirements.md#FR-03
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c

## FR-daemon-103 num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿
变更：2026-10-12-regression-review-remediation
状态：active
摘要：口径统一
全文：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/requirements.md#FR-04
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-regression-review-remediation:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「num_turns/duration_ms 非有限值 → 不进 payload（isFinite 口径统一，2026-10-12-regression-review-remediation F1）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-regression-review-remediation
  status: active

## FR-daemon-104 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）
变更：2026-10-12-regression-review-remediation
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-regression-review-remediation/requirements.md#FR-05
最近确认：b63e251d656e77106b36eabed32f96d9f629e30c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-regression-review-remediation:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-regression-review-remediation
  status: active

## FR-daemon-105 刷新触发定向上行同步
变更：2026-10-13-change-files-refresh-sync
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 当前用户在工作区已绑定 daemon 且 daemon 在线，变更 X 存在于该 daemon 的本地工作区；When 用户请求 GET /api/workspaces/{ws}/changes/{id}/files；Then backend 经同步 RPC 触发该 daemon 仅对变更 X 串行执行 `sillyspec platform sync --change X` 与 `s
全文：.sillyspec/changes/archive/2026-10-13-change-files-refresh-sync/requirements.md#FR-01
最近确认：76ea8a958

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-change-files-refresh-sync:task-01:acc-0-036d6ab3
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-01:acc-1-4aff50b3
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-01:acc-2-3c6afb27
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-01:acc-3-c33d9d68
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-02:acc-0-81b49e5c
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-02:acc-1-7fb30af0
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-02:acc-2-aee65c2e
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-02:acc-3-6275c82a
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-03:acc-0-323df9a4
  tests: sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-03:acc-1-38fd6ddd
  tests: sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-04:acc-0-476f56ec
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-04:acc-1-90ec1ada
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-04:acc-2-23677cd7
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-05:acc-0-728c4848
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-05:acc-1-1defd16c
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-06:acc-0-70413122
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-06:acc-1-33a777eb
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active
- row: 2026-10-13-change-files-refresh-sync:task-06:acc-2-fe5cd1b8
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/app/page.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/linked-repos-snapshot.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/spec-sync.test.ts | sillyhub-daemon/tests/test_init_lease.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-refresh-sync
  status: active

## FR-daemon-106 四路静默降级
变更：2026-10-13-change-files-refresh-sync
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 未绑定 / 离线 / RPC 超时（15s）/ 远端返回错误（含老 daemon 未注册 method）；When 用户请求 GET files；Then 全部静默降级：log.info 留痕后直接返回现有镜像数据，HTTP 不 500、响应 schema 不变
全文：.sillyspec/changes/archive/2026-10-13-change-files-refresh-sync/requirements.md#FR-02
最近确认：76ea8a958

## FR-daemon-107 daemon 侧防抖
变更：2026-10-13-change-files-refresh-sync
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 同一 (workspace_id, change) 在 15s 内已触发过一次同步，或该 key 的同步正在执行；When 再次收到 sillyspec_sync_change RPC；Then 直接回执 skipped（debounced / in_flight），不重复执行 CLI
全文：.sillyspec/changes/archive/2026-10-13-change-files-refresh-sync/requirements.md#FR-03
最近确认：76ea8a958

## FR-daemon-108 仅此变更粒度
变更：2026-10-13-change-files-refresh-sync
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 任一次触发；Then daemon 只对该 change 执行同步命令，不触发全树同步
全文：.sillyspec/changes/archive/2026-10-13-change-files-refresh-sync/requirements.md#FR-04
最近确认：76ea8a958

## FR-daemon-109 daemon 侧参数守卫
变更：2026-10-13-change-files-refresh-sync
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 收到 sillyspec_sync_change 请求；Then change 过 SAFE_CHANGE_NAME_RE 白名单（拒路径穿越），workspace_id 过 UUID 形态守卫；无本地根映射返回结构化失败（n
全文：.sillyspec/changes/archive/2026-10-13-change-files-refresh-sync/requirements.md#FR-05
最近确认：76ea8a958

## FR-daemon-110 日志尾部查看
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 一台在线且已升级的 daemon 机器；When 管理员在机器卡点击「日志」并选择行数（100/500/2000，默认 500）；Then 弹窗展示 daemon.log 尾部对应行数内容 + 文件路径/大小/最后修改时间；超出尾部字节上限（256KB）时提示截断；点击「刷新」重新拉取
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-01
最近确认：255a46d66

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-log-config-view:task-01:acc-0-eeeeb013
  tests: sillyhub-daemon/tests/diag-rpc.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-01:acc-1-05db5eb0
  tests: sillyhub-daemon/tests/diag-rpc.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-01:acc-2-4a3d0203
  tests: sillyhub-daemon/tests/diag-rpc.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-02:acc-0-3181745b
  tests: backend/tests/modules/daemon/test_daemon_machine_diag.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-02:acc-1-47e4ef11
  tests: backend/tests/modules/daemon/test_daemon_machine_diag.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-02:acc-2-fe6949ec
  tests: backend/tests/modules/daemon/test_daemon_machine_diag.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-03:acc-0-21e140a0
  tests: frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx | frontend/src/components/daemon/__tests__/machine-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-03:acc-1-9e938628
  tests: frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx | frontend/src/components/daemon/__tests__/machine-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active
- row: 2026-10-13-daemon-log-config-view:task-03:acc-2-11c8d1ea
  tests: frontend/src/components/daemon/__tests__/daemon-diagnostic-dialog.test.tsx | frontend/src/components/daemon/__tests__/machine-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-log-config-view
  status: active

## FR-daemon-111 日志下载
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 日志 Tab 已展示尾部内容；When 点击「下载日志片段」；Then 浏览器下载与当前展示一致的行内容（文件名含机器名与 tail 标识）
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-02
最近确认：255a46d66

## FR-daemon-112 配置查看（默认脱敏）
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一台在线且已升级的 daemon 机器；When 管理员在机器卡点击「配置」；Then 弹窗展示当前生效配置 JSON；`token`/`api_key` 等敏感字段为掩码形式（前4位+***+后4位，不足8位整值掩码），并标注被掩码字段清单
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-03
最近确认：255a46d66

## FR-daemon-113 配置明文按需切换
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 配置 Tab 处于掩码态；When 点击「显示明文」；Then 向 daemon 发起 reveal=true 的二次拉取并显示明文；再次点击恢复掩码态（重新拉取掩码态）
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-04
最近确认：255a46d66

## FR-daemon-114 配置下载（恒脱敏）
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given 配置 Tab 可见（掩码或明文态）；When 点击「下载配置」；Then 下载恒脱敏 JSON 文件（无论页面处于掩码态还是明文态，敏感字段均为掩码，D-007）；按钮旁标注「下载内容始终脱敏」
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-05
最近确认：255a46d66

## FR-daemon-115 版本过旧提示
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 目标机器 daemon 未升级（未注册新 RPC）；When 打开日志/配置 Tab；Then 展示 warning 提示条「daemon 版本过旧，请先升级」，引导到机器卡「升级 daemon」，不弹技术错误
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-06
最近确认：255a46d66

## FR-daemon-116 日志不存在提示
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 目标机器 daemon 前台（TTY）运行，未落盘 daemon.log；When 打开日志 Tab；Then 展示提示条「daemon.log 不存在——前台运行不落盘日志」，说明后台运行/CLI 两种替代查看方式
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-07
最近确认：255a46d66

## FR-daemon-117 离线禁用
变更：2026-10-13-daemon-log-config-view
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 机器离线（无 WS 连接）；When 查看机器卡；Then 「日志」「配置」按钮禁用并给出离线 tooltip；若拉取过程中离线则展示错误条
全文：.sillyspec/changes/archive/2026-10-13-daemon-log-config-view/requirements.md#FR-08
最近确认：255a46d66

## FR-daemon-118 SillySpecManager 新增限频重探入口 retryProbeLocalIfUnknown：version 未知（null）且距上次 probeLocal 尝试超过 120 秒才真正重探；版本已知不重探；全路径自收敛不抛异常
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：版本未知且窗口已过；版本已知；限频窗口内
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-01
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sillyspec-version-probe-fast-retry:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「retryProbeLocalIfUnknown：版本未知+窗口已过 → 执行探测并刷新快照」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sillyspec-version-probe-fast-retry
  status: active

## FR-daemon-119 daemon 心跳每拍触发该入口且不阻塞心跳节奏（void 不 await，探测最坏 30 秒超时不拖心跳发送）
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：version 未知时心跳触发重探
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-02
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sillyspec-version-probe-fast-retry:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts「心跳触发 version 未知限频重探（void 不阻塞心跳）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sillyspec-version-probe-fast-retry
  status: active

## FR-daemon-120 旧假 manager（无新方法）注入时心跳不崩（duck-type 守卫，对齐 getCommandResult 惯例）
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：旧假 manager 无新方法
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-03
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sillyspec-version-probe-fast-retry:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts「旧假 manager 缺 retryProbeLocalIfUnknown → 心跳不崩按旧语义组包」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sillyspec-version-probe-fast-retry
  status: active

## FR-daemon-121 注册期探测失败场景：假「未安装」在 2 分钟限频窗口过后随重探自愈，成功后下一拍心跳带上真实版本
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：注册失败 → 心跳自愈链路
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-04
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sillyspec-version-probe-fast-retry:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「注册失败后窗口过期重探成功 → 下一拍心跳携带 version」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sillyspec-version-probe-fast-retry
  status: active

## FR-daemon-122 重探仍失败时限频窗口重新计时，不产生每拍连发探测
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：连续失败不连发
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-05
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-sillyspec-version-probe-fast-retry:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「重探失败窗口重计时 → 一个窗口至多一次探测」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-sillyspec-version-probe-fast-retry
  status: active

## FR-daemon-123 新增单测覆盖上述分支，相关既有测试（sillyspec-manager / daemon-heartbeat-sillyspec）不回归
变更：2026-10-13-sillyspec-version-probe-fast-retry
状态：active
摘要：测试面
全文：.sillyspec/changes/archive/2026-10-13-sillyspec-version-probe-fast-retry/requirements.md#FR-06
最近确认：3cab26f0d4064e25eaa6102dcab0387145d15bd6

## FR-auto-sillyhub-daemon-021 git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given WorkspaceTabs 注册 16 键（知识图谱插知识库后）/ When 渲染取 link / Then toHaveLength(16) 且 Git 日志
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-01
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-01
  tests: frontend/src/components/git-log/__tests__/git-log-page.test.tsx「TABS 增至 16 项，「Git 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-022 test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 无可恢复元数据的 stale run / When _cleanup_stale_runs_impl 执行 / Then error_detail 等于新文案两
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-02
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-023 sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 心跳 11 参平铺（第 11 machineId，undefined 占位）/ When 断言 call.length / Then toBe(11) 且第 7
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-03
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts「路径④ pending 可见性闭环」 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts「task-07 心跳携带…」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-024 provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given backend schema 字段为复数 list Literal / When readBackendAgentKindVocab 解析 / Then 词表=
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-04
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/provider-adapter-registry.test.ts「backend agent_kind 词表（源读取解析）⊆ 聚合表键（backend 可下发 kind 必有声明）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-025 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复落地 / When 本地相关面跑测 / Then 全绿；When push / When 五 workflow 完成 / Then 全部 success。
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-05
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

## FR-auto-sillyhub-daemon-026 tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-01
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts「MSG 总数 = 25」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-027 tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-02
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-028 tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-03
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「mission_worker + codex(mcp=false) + success + 全文非空 → 恰一次代报」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-029 daemon typecheck 过；不跑全量（规则 0），全量留给 CI
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-04
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

## FR-auto-sillyhub-daemon-030 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：超长字段截断；边界不截
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-01
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-031 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-02
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-032 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：单一实现核验
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-03
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

## FR-auto-sillyhub-daemon-033 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-04
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-034 daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：task_started 帧丢失、注册表仅剩 tool_use 派生的别名条目；三无孤儿终态（注册表缺失且无在跑 runId）
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-01
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agent-task-stuck-running:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts「Task/Agent tool_use 派生 agent_task_status 必带 tool_use_id」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task_notification 别名条目补发终态/静默注销/三无 WARN 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agent-task-stuck-running
  status: active

## FR-auto-sillyhub-daemon-035 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：TASK_NOTIFICATION 行 parent 缺失/错位，派发段在本轮已存在；task_id 也无法命中（任务从未在本轮出现）
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-02
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agent-task-stuck-running:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/task-line-assembler.test.ts「[TASK_*] parent 未命中按 task_id 兜底反查（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agent-task-stuck-running
  status: active

## FR-auto-sillyhub-daemon-036 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：回归防线
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-03
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

## FR-auto-sillyhub-daemon-037 daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：CJK 字节超限
场景正文：
- 场景：CJK 字节超限 — Given 载体行 structuredPatch 序列化含 30 000 个 CJK 字符（90 000 UTF-8 字节、30 000 字符）；When 解析；Then tool_result 段 edit_patch 缺省 undefined；字节不超限的 CJK patch（10 000 字符=30 000 字节）照常附着
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-01
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts「上限按 UTF-8 字节计（2026-10-13-editpatch-p3-cleanup）：CJK patch 字符数低于 64000 但字节超限 → 不附着；字节不超限 → 附着」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active

## FR-auto-sillyhub-daemon-038 agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：直连防回归
场景正文：
- 场景：直连防回归 — Given 对话化消息含 Write tool_use + 带 edit_patch 的 tool_result（配对成功）；When 展开对话视图渲染；Then Write 卡渲染红删绿增 diff 行与「变更对比（覆盖写入 +N −M）」标题
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-02
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/agent-log-card.test.tsx「edit_patch 直连：tool_result 段携带 structuredPatch 时 Write/Edit 卡渲染变更对比 diff」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active

## FR-auto-sillyhub-daemon-039 相关 daemon/frontend 测试通过，既有行为零回归
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：回归
场景正文：
- 场景：回归 — Given daemon agent-log 全套与 frontend agent-log-card/agent-log/tool-args-detail 套件；When 全部运行；Then 全绿 + daemon typecheck 零错误
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-03
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-03
  tests: frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active

## FR-auto-sillyhub-daemon-040 新模块 turn-anchor:recordTurnAnchor(cwd,sessionId,runId,anchorsDir?) 在轮边界对 git 工作区快照(临时 index 复制现场 index→GIT_INDEX_FILE 下 git add -A→write-tree 记 treeSha+HEAD sha),与该会话上一锚 diff-tree -r --numstat 得逐文件 additions/deletions(二进制记 null),追加 JSONL 到 <daemonStateDir>/.runtime/turn-anchors/<sessionId>.jsonl
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 带一次基线提交的 git 仓、anchorsDir 注入临时目录 / When 首次调用 recordTurnAnchor / Then 返回记录含 treeS
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-01
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「首轮（有基线提交）：tracked 修改与 untracked 新文件都进 diff；JSONL 落一条；prevTreeSha=null」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-041 untracked 新文件必须进锚与 diff(add -A 覆盖,验收:新增未跟踪文件出现在该轮 files)
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 基线提交后新建未跟踪文件 new-untracked.ts / When recordTurnAnchor / Then files 含 `{path:'new
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-02
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「首轮（有基线提交）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-042 零变化轮去重:treeSha 与上一锚相同则 deduped=true 且不追加记录
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 连续两次调用之间工作区零变化 / When 第二次 recordTurnAnchor / Then deduped=true、files=[]、JSONL 行数
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-03
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「零变化轮去重：treeSha 与上一锚相同 → deduped=true 且不追加 JSONL」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-043 失败安全:非 git 目录/git 不可用返回 null 永不抛错,onResult 接线为 fire-and-forget 不阻塞轮结果链路
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 不含 .git 的临时目录 / When recordTurnAnchor / Then 返回 null 且不抛错、不创建任何锚文件。
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-04
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「非 git 目录：返回 null 且不抛错（失败安全）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-044 同会话并发轮串行化(per-session promise 链),prev 锚优先内存、miss 时读 JSONL 尾行
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 已打过一锚后模块状态清零（vi.resetModules 重导入，等价重启）/ When 再打一锚 / Then prevTreeSha 从 JSONL 尾行恢
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-05
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「重启续锚：模块状态清空后从 JSONL 尾行恢复 prev 锚（内存 miss → 尾行兜底）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-045 单测覆盖:首轮 vs HEAD/增量轮/untracked/二进制 null/去重/非 git 仓 null/JSONL 落盘形态,tests 镜像 src 结构全绿
变更：2026-10-13-daemon-turn-anchor-snapshot
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 实现与测试就位 / When `pnpm vitest run tests/interactive/turn-anchor.test.ts` / Then 7/
全文：.sillyspec/changes/archive/2026-10-13-daemon-turn-anchor-snapshot/requirements.md#FR-06
最近确认：4bf6f9b6567a716137312a8d9eb665091f5d637d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-daemon-turn-anchor-snapshot:flow:测试绑定FR-06
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-daemon-turn-anchor-snapshot
  status: active

## FR-auto-sillyhub-daemon-046 TurnAnchorRecord 新增 totals：files 行数与 additions/deletions 加总（null 不计入），落盘记录携带，既有七用例零改动全绿
变更：2026-10-13-turn-anchor-flowdiff-shape
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-turn-anchor-flowdiff-shape/requirements.md#FR-01
最近确认：d0093bf059dd39691b718ed81ea371dc14263eab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-anchor-flowdiff-shape:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「totals：落盘记录携带且 null 行不计入（既有七用例零改动）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-anchor-flowdiff-shape
  status: active

## FR-auto-sillyhub-daemon-047 toFlowDiffShape 导出纯函数：输入记录返回 rows 与 totals（rows=files 原样，totals 同上语义），可直测
变更：2026-10-13-turn-anchor-flowdiff-shape
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-turn-anchor-flowdiff-shape/requirements.md#FR-02
最近确认：d0093bf059dd39691b718ed81ea371dc14263eab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-anchor-flowdiff-shape:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「toFlowDiffShape：投影形状与重算兜底（存量无 totals 记录）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-anchor-flowdiff-shape
  status: active

## FR-auto-sillyhub-daemon-048 typecheck 绿；新用例覆盖 totals 计算（含 null 行）与投影形状
变更：2026-10-13-turn-anchor-flowdiff-shape
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-turn-anchor-flowdiff-shape/requirements.md#FR-03
最近确认：d0093bf059dd39691b718ed81ea371dc14263eab

## FR-auto-sillyhub-daemon-049 不改 JSONL 既有字段与追加格式（additive：旧读者忽略新字段）
变更：2026-10-13-turn-anchor-flowdiff-shape
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-turn-anchor-flowdiff-shape/requirements.md#FR-04
最近确认：d0093bf059dd39691b718ed81ea371dc14263eab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-turn-anchor-flowdiff-shape:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-turn-anchor-flowdiff-shape
  status: active

## FR-auto-sillyhub-daemon-050 会话级缓存清理函数导出与 terminateSession 接线
变更：2026-10-14-turn-anchor-cache-eviction
状态：active
摘要：主路径；在飞锚链竞态
场景正文：
- 场景：主路径 — Given 一个已打锚的活跃会话 / When terminateSession 以 manual 或 driver_error 终结该会话 / Then `clearTu
- 场景：在飞锚链竞态 — Given 末轮锚链尚未收尾（fire-and-forget `void recordTurnAnchor` 在飞）/ When terminateSession 触发清理
全文：.sillyspec/changes/archive/2026-10-14-turn-anchor-cache-eviction/requirements.md#FR-01
最近确认：10c669ae3fd9bb6b65ae290c3e0aa22c2f1722ca

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-turn-anchor-cache-eviction:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「在飞锚链竞态：清理挂链收尾后执行，链与后续锚行为正确」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-turn-anchor-cache-eviction
  status: active

## FR-auto-sillyhub-daemon-051 清理后功能无回归（JSONL 尾行兜底恢复 prev 锚）
变更：2026-10-14-turn-anchor-cache-eviction
状态：active
摘要：主路径；零变化去重恢复
场景正文：
- 场景：主路径 — Given 会话已落两锚（第二锚含文件变化）/ When clearTurnAnchorCache 后再打第三锚（新增文件变化）/ Then 第三锚 prevTreeSha
- 场景：零变化去重恢复 — Given 会话已落一锚后清理 / When 再打一次零变化锚 / Then deduped===true 且不追加 JSONL（判重不因清理失效）。
全文：.sillyspec/changes/archive/2026-10-14-turn-anchor-cache-eviction/requirements.md#FR-02
最近确认：10c669ae3fd9bb6b65ae290c3e0aa22c2f1722ca

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-turn-anchor-cache-eviction:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「清理后续锚：prev 经 JSONL 尾行兜底恢复，diff 基线链与去重判定无回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-turn-anchor-cache-eviction
  status: active

## FR-auto-sillyhub-daemon-052 未知 sessionId 幂等安全
变更：2026-10-14-turn-anchor-cache-eviction
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 内存缓存无该 session 条目 / When 调用 clearTurnAnchorCache(该 id) / Then 正常返回 void，不抛任何异常。
全文：.sillyspec/changes/archive/2026-10-14-turn-anchor-cache-eviction/requirements.md#FR-03
最近确认：10c669ae3fd9bb6b65ae290c3e0aa22c2f1722ca

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-turn-anchor-cache-eviction:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「未知 sessionId 调用清理：无操作不抛（幂等）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-turn-anchor-cache-eviction
  status: active

## FR-auto-sillyhub-daemon-053 单测覆盖且相关测试全绿
变更：2026-10-14-turn-anchor-cache-eviction
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 新增用例与实现落地 / When 运行 sillyhub-daemon 的 turn-anchor 与 lifecycle 接线相关测试 / Then 全部通过
全文：.sillyspec/changes/archive/2026-10-14-turn-anchor-cache-eviction/requirements.md#FR-04
最近确认：10c669ae3fd9bb6b65ae290c3e0aa22c2f1722ca

## FR-unmapped-704 backend 提取与写回
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：乱序防御
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-05
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-0-cd45ab1f
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-1-9d7b3d5c
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-2-c4c134e7
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-3-5c300bde
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-705 tokens SSE 事件与 summary 下发
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：旧 daemon 兼容
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-06
最近确认：b15fafc3b

## FR-daemon-124 dsh 引擎注册与探测
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given daemon 所在机器安装了 dsh（版本 ≥0.2.1）；When daemon 启动执行 agent 探测；Then agent-detector 第 13 项命中（SILLYHUB_DSH_PATH env 覆盖 → PATH which），`--version` 解析入 M
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-01
最近确认：775d86011

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-dsh-engine-acp:task-01:acc-0-e9d6d24e
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-01:acc-1-9f4bef8c
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-01:acc-2-21ac8e25
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-08:acc-0-6ee58d57
  tests: sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-08:acc-1-39caa6ab
  tests: sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active

## FR-daemon-125 dsh 单聊会话全链路
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 探测到 dsh 且用户在单聊创建表单选择 dsh 引擎；When 提交创建（provider='dsh' 经 backend InteractiveProviderLiteral 校验通过）；Then daemon spawn `dsh --profile acp`（Windows .cmd shim 解析），initialize 握手 + session/n
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-02
最近确认：775d86011

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-dsh-engine-acp:task-02:acc-0-8f05ac37
  tests: sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-02:acc-1-8e98d7ba
  tests: sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-02:acc-2-d831c29f
  tests: sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-03:acc-0-3c21c497
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-03:acc-1-5cc0cb70
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-03:acc-2-0352b650
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-03:acc-3-a4b5bb73
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-05:acc-0-0e3ab8bd
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_linked_repos_sync.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active

## FR-daemon-126 打断
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given dsh 会话有 in-flight prompt；When 用户打断；Then 驱动发 session/cancel，turn 终止落库，子进程保持可续用
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-03
最近确认：775d86011

## FR-daemon-127 权限代答
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given dsh 会话 manual_approval=true 且收到 session/request_permission；When 服务端请求到达
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-04
最近确认：775d86011

## FR-daemon-128 模型路由（平台接管）
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话绑定了 LlmProvider（base_url/api_key/model）；When daemon 创建 dsh 会话；Then per-session DSH_HOME 写 profiles/acp/cordis.patch.yml（llm-pi-ai 自定义路由：api 按 base_
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-05
最近确认：775d86011

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-dsh-engine-acp:task-04:acc-0-6102300d
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py | sillyhub-daemon/tests/dsh-settings.test.ts | sillyhub-daemon/tests/interactive/provider-registry.test.ts | sillyhub-daemon/tests/provider-adapter-registry.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-04:acc-1-11fa8a5f
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py | sillyhub-daemon/tests/dsh-settings.test.ts | sillyhub-daemon/tests/interactive/provider-registry.test.ts | sillyhub-daemon/tests/provider-adapter-registry.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-04:acc-2-6281b493
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py | sillyhub-daemon/tests/dsh-settings.test.ts | sillyhub-daemon/tests/interactive/provider-registry.test.ts | sillyhub-daemon/tests/provider-adapter-registry.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active

## FR-daemon-129 caps 如实申报与三端镜像
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given dsh 引擎注册；Then PROVIDER_CAPS dsh 条目 16 键如实（Grill 修正后口径：compact=false/steering=false/dialog='nat
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-06
最近确认：775d86011

## FR-daemon-130 群附件门控口径统一
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 群消息带附件且目标成员引擎为 X；When 触发成员；Then 发送侧（messages.py:791-797）与触发侧（shadow.py:266-273）门控均按 get_provider_caps(X)["attach
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-07
最近确认：775d86011

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-dsh-engine-acp:task-06:acc-0-abb8664d
  tests: backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_p2.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-06:acc-1-7dea5b9e
  tests: backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_p2.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active

## FR-daemon-131 前端单聊引擎选项
变更：2026-10-15-dsh-engine-acp
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given dsh 在该 runtime 探测可用；When 用户打开单聊创建入口；Then SESSION_ENGINE_OPTIONS 含 dsh（图标/标签）；群聊 ENGINE_OPTIONS 不变
全文：.sillyspec/changes/archive/2026-10-15-dsh-engine-acp/requirements.md#FR-08
最近确认：775d86011

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-dsh-engine-acp:task-07:acc-0-1d874fde
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active
- row: 2026-10-15-dsh-engine-acp:task-07:acc-1-040e8ae5
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 775d8601138487ea46b736d4d83d8f4bf29314fe
  source_change: 2026-10-15-dsh-engine-acp
  status: active

## FR-daemon-132 zcode 引擎注册与探测
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 所在机器安装了 ZCode Desktop（内嵌引擎版本 ≥0.16.9）；When daemon 启动执行 agent 探测；Then 探测项命中（SILLYHUB_ZCODE_PATH env 覆盖 → PATH which zcode → Desktop 固定安装路径回退 fallbackP
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-01
最近确认：9e8ba08fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-zcode-engine-appserver:task-01:acc-0-5f7aae75
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-01:acc-1-02c2839e
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-01:acc-2-b0b68fa1
  tests: sillyhub-daemon/tests/agent-detector.test.ts | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-08:acc-0-7d2a4cdd
  tests: sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-08:acc-1-85728f33
  tests: sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active

## FR-daemon-133 zcode 单聊会话全链路
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1、D-007@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 探测到 zcode 且用户在单聊创建表单选择 zcode 引擎；When 提交创建（provider='zcode' 经 backend InteractiveProviderLiteral 校验通过）；Then daemon spawn `node <zcode.cjs> app-server --cwd <dir>`（env ZCODE_DATA_BASE_DIR 指
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-02
最近确认：9e8ba08fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-zcode-engine-appserver:task-02:acc-0-2a9286db
  tests: sillyhub-daemon/tests/interactive/zcode-envelope.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-02:acc-1-11b1a6e7
  tests: sillyhub-daemon/tests/interactive/zcode-envelope.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-03:acc-0-c809ae83
  tests: sillyhub-daemon/tests/interactive/zcode-events.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-03:acc-1-cc8241ab
  tests: sillyhub-daemon/tests/interactive/zcode-events.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-04:acc-0-f04ad0ac
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-04:acc-1-afc4b560
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-06:acc-0-834eeeca
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-06:acc-1-ff78fd21
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active

## FR-daemon-134 打断
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given zcode 会话有 in-flight 轮；When 用户打断；Then 驱动发 session/stop，turn 终止落库，子进程保持可续用
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-03
最近确认：9e8ba08fe

## FR-daemon-135 权限代答与服务端请求分发
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
依据决策：D-005@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given zcode 会话收到服务端主动请求；When 请求到达；Then 分发器按方法处理：session/requestRuntimePreferences（create/send 各一道）回默认偏好（15s 超时窗口内）；inte
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-04
最近确认：9e8ba08fe

## FR-daemon-136 模型路由（平台接管）
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 会话绑定了 LlmProvider（base_url/api_key/model）；When daemon 创建 zcode 会话；Then per-session 配置面（ZCODE_DATA_BASE_DIR 重定向的 v2 目录）写 provider_config.json（api.type 按
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-05
最近确认：9e8ba08fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-zcode-engine-appserver:task-05:acc-0-35889f68
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | sillyhub-daemon/tests/interactive/provider-registry.test.ts | sillyhub-daemon/tests/zcode-settings.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-05:acc-1-769899ea
  tests: backend/app/modules/agent/tests/test_provider_caps_alignment.py | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | sillyhub-daemon/tests/interactive/provider-registry.test.ts | sillyhub-daemon/tests/zcode-settings.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active

## FR-daemon-137 caps 如实申报与三端镜像
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given zcode 引擎注册；Then PROVIDER_CAPS zcode 条目 16 键如实（mcp=false/multimodal=false/attachments=false/subag
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-06
最近确认：9e8ba08fe

## FR-daemon-138 前端单聊引擎选项
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given zcode 在该 runtime 探测可用；When 用户打开单聊创建入口；Then SESSION_ENGINE_OPTIONS 含 zcode（图标/标签）；群聊 ENGINE_OPTIONS 不变
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-07
最近确认：9e8ba08fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-zcode-engine-appserver:task-07:acc-0-82d7b7e3
  tests: frontend/src/lib/daemon/__tests__/runtimes.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active
- row: 2026-10-15-zcode-engine-appserver:task-07:acc-1-65ce11bd
  tests: frontend/src/lib/daemon/__tests__/runtimes.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b6166e4f0a8eaaf65cf28c9c8bfc11fa180b9dc2
  source_change: 2026-10-15-zcode-engine-appserver
  status: active

## FR-daemon-139 compact 与思考档位通道（可选实现）
变更：2026-10-15-zcode-engine-appserver
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given zcode 会话开启；When 用户触发上下文压缩或切换思考档位；Then 驱动经 session/compact / session/setThoughtLevel 执行（caps.compact=true / thinking_le
全文：.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/requirements.md#FR-08
最近确认：9e8ba08fe

## FR-daemon-140 列表端点每会话注入 current_run_status（活跃 run 最新一条的状态：pending/running/pending_approval；无活跃 run 为 null），照 owner_name IN 批查先例零 N+1
变更：2026-10-16-session-run-status-realtime
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/requirements.md#FR-01
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-run-status-realtime:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_sessions_list_run_status.py「active_run_status_injected」 | backend/app/modules/daemon/tests/test_sessions_list_run_status.py「latest_active_run_wins_when_multiple」 | backend/app/modules/daemon/tests/test_sessions_list_run_status.py「no_run_at_all_yields_null」 | backend/app/modules/daemon/tests/test_sessions_list_run_status.py「terminal_run_yields_null」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-run-status-realtime
  status: active

## FR-daemon-141 前端判定优先级：终态红/绿不变；run=pending_approval 优先显示琥珀在等你；run=pending/running 优先转圈；其后活性 working/blocked 兜底（本地会话）；再 reconnecting 转圈；idle+完成标记绿点；其余留白
变更：2026-10-16-session-run-status-realtime
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/requirements.md#FR-02
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-run-status-realtime:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 活跃时留白规则不变」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run=pending → 转圈」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run=pending_approval → 琥珀点——run 权威压过活性 working」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run=running → 转圈」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-run-status-realtime
  status: active

## FR-daemon-142 完成通知新增 run 完成触发源：current_run_status 从活跃变 null 且会话非终态且不在该会话上 → 标记完成（与活性转移、终态两来源共键）
变更：2026-10-16-session-run-status-realtime
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/requirements.md#FR-03
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-run-status-realtime:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 活跃→null 但正选中该会话 → 不标记」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 活跃→null（run 终态收敛…）→ 完成角标出现」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-run-status-realtime
  status: active

## FR-daemon-143 schema 变更同步再生前端与 daemon 两处 api-types 并提交 openapi.json
变更：2026-10-16-session-run-status-realtime
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/requirements.md#FR-04
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-run-status-realtime:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_sessions_list_run_status.py「openapi_exposes_current_run_status」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-run-status-realtime
  status: active

## FR-daemon-144 后端列表注入测试 + 前端判定测试全过，lint/tsc 零告警
变更：2026-10-16-session-run-status-realtime
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-run-status-realtime/requirements.md#FR-05
最近确认：3472327464a8e8f9d8829a5e9b35fda123a9b719

## FR-daemon-145 pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活
变更：2026-10-16-daemon-pull-antiresurrect
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given LocalManifest 含 docs/b.md 且盘面 specDir 下无 docs/b.md（本地已删除、删除 op 未上行），When pullSpe
全文：.sillyspec/changes/archive/2026-10-16-daemon-pull-antiresurrect/requirements.md#FR-01
最近确认：056cff30397de0c5001874901cbbe03d6319df65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-daemon-pull-antiresurrect:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例1（核心）：manifest 有/盘面无/同步面 → 解包产物不落地（不复活）+ warn 点名」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-daemon-pull-antiresurrect
  status: active

## FR-daemon-146 manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变
变更：2026-10-16-daemon-pull-antiresurrect
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本地无 manifest 缓存（首拉），When pullSpecBundle 消费含任意文件的 bundle，Then bundle 全部文件落地、无防复活抑
全文：.sillyspec/changes/archive/2026-10-16-daemon-pull-antiresurrect/requirements.md#FR-02
最近确认：056cff30397de0c5001874901cbbe03d6319df65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-daemon-pull-antiresurrect:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例2：manifest 缺失（首拉）= 无抑制面，全量落地（既有行为不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-daemon-pull-antiresurrect
  status: active

## FR-daemon-147 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）
变更：2026-10-16-daemon-pull-antiresurrect
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 抑制面非空且 bundle 携带命中文件，When 不设恢复通道执行 pull，Then warn 日志点名被挡路径；When 设置 opts.restoreD
全文：.sillyspec/changes/archive/2026-10-16-daemon-pull-antiresurrect/requirements.md#FR-03
最近确认：056cff30397de0c5001874901cbbe03d6319df65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-daemon-pull-antiresurrect:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例3：restoreDeleted（opts / env）= 显式恢复，跳过抑制」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-daemon-pull-antiresurrect
  status: active

## FR-daemon-148 抑制跨 pull 持久——落地重建基线保留被抑制行，直至删除 op 上行成功自然衰减
变更：2026-10-16-daemon-pull-antiresurrect
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 被抑制 pull 完成且删除 op 未上行（manifest 基线仍含该行），When 第二次 pullSpecBundle 消费仍携带该文件的 bundle，
全文：.sillyspec/changes/archive/2026-10-16-daemon-pull-antiresurrect/requirements.md#FR-04
最近确认：056cff30397de0c5001874901cbbe03d6319df65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-daemon-pull-antiresurrect:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例1（核心）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-daemon-pull-antiresurrect
  status: active

## FR-daemon-149 vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过
变更：2026-10-16-daemon-pull-antiresurrect
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-16-daemon-pull-antiresurrect/requirements.md#FR-05
最近确认：056cff30397de0c5001874901cbbe03d6319df65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-daemon-pull-antiresurrect:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/pull-antiresurrect.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-daemon-pull-antiresurrect
  status: active

## FR-daemon-150 兜底读取 full-tree 记录，让跨变更冲突的对比可用
变更：2026-10-16-conflict-full-tree-compare
状态：active
摘要：默认场景；主路径（兜底命中）
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 某冲突在机器上落盘为 `spec-sync-conflict-full-tree.json` 且平台行按单变更名 `<change>` 请求对比；When `kind=spec-tree` 且按 `<change>` 读取记录返回 `conflict_record_missing`，而 `full-tree` 记录；Then 平台必须（MUST）以 `full-tree` 记录构建该变更范围内的对比并返回 200；兜底**必须只重试一次**（MUST NOT 递归或多次重取）；实现*
- 场景：主路径（兜底命中） — Given full-tree 记录含 `changes/archive/<change>/…` 路径；When 对比请求先失败为 `conflict_record_missing`；Then 返回 200 且 `record_label="full-tree"`；daemon RPC 恰好被调用两次（先 `<change>` 后 `full-tree
全文：.sillyspec/changes/archive/2026-10-16-conflict-full-tree-compare/requirements.md#FR-01
最近确认：d3c425bf6

## FR-daemon-151 对比只呈现所请求变更的范围，并标注来源
变更：2026-10-16-conflict-full-tree-compare
状态：active
摘要：默认场景；段边界防误吞
依据决策：D-006@v2
场景正文：
- 场景：默认场景 — Given 兜底命中且 `full-tree` 快照覆盖多个变更的路径；When 生成对比响应；Then 文件清单与 diff **必须（MUST）只包含** `changes/<change>/` 或 `changes/archive/<change>/` 属于该
- 场景：段边界防误吞 — Given full-tree 记录只含 `changes/foobar/…` 路径；When 请求 `<change>=foo`；Then 兜底不命中（MUST 返回原 `conflict_record_missing` 错误），不得把 `foobar` 的文件混入对比
全文：.sillyspec/changes/archive/2026-10-16-conflict-full-tree-compare/requirements.md#FR-02
最近确认：d3c425bf6

## FR-daemon-152 失败文案按真实错误码分支
变更：2026-10-16-conflict-full-tree-compare
状态：active
摘要：默认场景；记录缺失分支
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 对比请求失败；When 前端渲染失败卡；Then 分支键**必须（MUST）**为 `details.daemon_code`（daemon 业务失败时外层 `ApiError.code` 恒为 `HTTP_5
- 场景：记录缺失分支 — Given 对比返回 502 且 `details.daemon_code="conflict_record_missing"`；When 失败卡渲染；Then 文案为「该冲突在本机已无快照…请重新同步后再试」且页面上**不存在**「重试」按钮与「504」「离线」字样
全文：.sillyspec/changes/archive/2026-10-16-conflict-full-tree-compare/requirements.md#FR-03
最近确认：d3c425bf6

## FR-daemon-153 冲突行手动关闭入口（标记已处理）
变更：2026-10-16-conflict-full-tree-compare
状态：active
摘要：默认场景；关闭后消失与可复现
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 可操作者看到一条来自平台注册表的未决冲突行；When 点击行上「标记已处理」并二次确认；Then 前端**必须（MUST）**调 `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id
- 场景：关闭后消失与可复现 — Given 注册表有 1 条 open 行（含 2 个变更名的并列展示行）；When 可操作者确认「标记已处理」；Then 两行同时从列表消失；若该冲突仍在本机存在，下一次冲突推送**可以（MAY）**重新登记新的 open 行（不视为回归）
全文：.sillyspec/changes/archive/2026-10-16-conflict-full-tree-compare/requirements.md#FR-04
最近确认：d3c425bf6

## FR-daemon-154 契约与类型同步
变更：2026-10-16-conflict-full-tree-compare
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端 compare 响应新增可选字段；When 本变更交付；Then `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-
全文：.sillyspec/changes/archive/2026-10-16-conflict-full-tree-compare/requirements.md#FR-05
最近确认：d3c425bf6

## FR-daemon-155 buildZcodeProviderConfig 输出形状与宿主有效配置一致（providerConfigRules:{providerRules:[...]} + modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}），单测钉形状
变更：2026-10-17-zcode-provider-config-shape
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 有效 baseUrl/apiKey/model 的 provider；When 调用 buildZcodeProviderConfig；Then 返回对象满足上述形状（单测全等断言钉板）
全文：.sillyspec/changes/archive/2026-10-17-zcode-provider-config-shape/requirements.md#FR-01
最近确认：40217abbd7f2a0d0cac4d6af1e0f784f68e21689

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-zcode-provider-config-shape:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/zcode-settings.test.ts「schemaVersion=1 + providerOrder + providerRules 对象包裹 + modelConfigRules 两键（逐字段对齐宿主有效实例）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-zcode-provider-config-shape
  status: active

## FR-daemon-156 _applyModel 三路径（精确命中/大小写命中/超时回退）均发送字符串 modelId，单测钉超时回退路径
变更：2026-10-17-zcode-provider-config-shape
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given start opts.model='GLM-5.3' 且引擎推送目录条目 modelId='glm-5.3'（levels=[low,high,max], de；When _applyModel 执行；Then setModel 参数为 `{providerId:'sillyhub', modelId:'glm-5.3', options:{reasoningLevel
全文：.sillyspec/changes/archive/2026-10-17-zcode-provider-config-shape/requirements.md#FR-02
最近确认：40217abbd7f2a0d0cac4d6af1e0f784f68e21689

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-zcode-provider-config-shape:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「create → subscribe → setModel → 乒乓一轮全链路（帧形状钉板）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-zcode-provider-config-shape
  status: active

## FR-daemon-157 单测全绿（zcode-settings + zcode driver 相关）
变更：2026-10-17-zcode-provider-config-shape
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — When `pnpm vitest run <三文件>` 与 `pnpm typecheck`；Then 全部通过、无类型错误
全文：.sillyspec/changes/archive/2026-10-17-zcode-provider-config-shape/requirements.md#FR-03
最近确认：40217abbd7f2a0d0cac4d6af1e0f784f68e21689

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-zcode-provider-config-shape:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/zcode-events.test.ts | sillyhub-daemon/tests/zcode-settings.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-zcode-provider-config-shape
  status: active

## FR-daemon-158 重建 bundle 安装到本机 daemon 并重启，生产后端实测：新建 zcode 会话发一轮消息，turn 完成、回复落库渲染、模型路由走 SillyHub provider（daemon.log 无 Provider Registry/Select a model 错误）
变更：2026-10-17-zcode-provider-config-shape
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 新 bundle 已安装且 daemon 重启完成；When 经 POST /api/daemon/sessions 创建 zcode（及 dsh）会话发一轮消息；Then run completed、tokens 消费为真值、无上述错误日志
全文：.sillyspec/changes/archive/2026-10-17-zcode-provider-config-shape/requirements.md#FR-04
最近确认：40217abbd7f2a0d0cac4d6af1e0f784f68e21689

## FR-daemon-159 session/new 恒带 mcpServers:[] 占位（rc.2 必填、旧版兼容），探针验证握手通过
变更：2026-10-17-dsh-rc2-protocol-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-protocol-fix/requirements.md#FR-01
最近确认：162dbfefd8fa71afb10e792dc493c59dfaae4c0b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-dsh-rc2-protocol-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts「model + thinkingLevel=medium → set_config_option 扁平形状(configId=model/reasoning_effort)；off → 不发档位」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-dsh-rc2-protocol-fix
  status: active

## FR-daemon-160 set_config_option 改扁平形状（configId=model/reasoning_effort），设置失败降级 warn 非致命（不再杀会话），单测钉新形状
变更：2026-10-17-dsh-rc2-protocol-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-protocol-fix/requirements.md#FR-02
最近确认：162dbfefd8fa71afb10e792dc493c59dfaae4c0b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-dsh-rc2-protocol-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-dsh-rc2-protocol-fix
  status: active

## FR-daemon-161 驱动失败路径留痕：握手里程碑、consume failed 原因、子进程退出，daemon.log 可见
变更：2026-10-17-dsh-rc2-protocol-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-protocol-fix/requirements.md#FR-03
最近确认：162dbfefd8fa71afb10e792dc493c59dfaae4c0b

## FR-daemon-162 dsh 驱动相关单测全绿（15 用例）；typecheck 干净
变更：2026-10-17-dsh-rc2-protocol-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-protocol-fix/requirements.md#FR-04
最近确认：162dbfefd8fa71afb10e792dc493c59dfaae4c0b

## FR-daemon-163 writeDshHome 写三件套（package.json 模板清单 + pnpm-workspace.yaml + 无 compat 的 patch），单测钉三件与「禁 compat」
变更：2026-10-17-dsh-rc2-routing-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/requirements.md#FR-01
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-dsh-rc2-routing-restore:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/dsh-settings.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-dsh-rc2-routing-restore
  status: active

## FR-daemon-164 驱动 set_config_option 模型值 = ["sillyhub","<model>"] JSON 数组串，单测钉板
变更：2026-10-17-dsh-rc2-routing-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/requirements.md#FR-02
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-dsh-rc2-routing-restore:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts「model + thinkingLevel=medium → set_config_option 扁平形状…」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-dsh-rc2-routing-restore
  status: active

## FR-daemon-165 通知信封拆包兼容两种形状（有 update 键即拆），单测/真机验证回复落库
变更：2026-10-17-dsh-rc2-routing-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/requirements.md#FR-03
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-dsh-rc2-routing-restore:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts | sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-dsh-rc2-routing-restore
  status: active

## FR-daemon-166 UI 真机一轮：dsh 会话回复正常渲染，模型自答 GLM-5.3-FlashX/智谱
变更：2026-10-17-dsh-rc2-routing-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/requirements.md#FR-04
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9

## FR-daemon-167 typecheck + dsh 相关单测全绿
变更：2026-10-17-dsh-rc2-routing-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-dsh-rc2-routing-restore/requirements.md#FR-05
最近确认：3fe545c63a4538a83f96a965c92579982bd388e9

## FR-daemon-168 平台内切换供应商时，resume 前必须清洗 transcript 里的供应商私有块
变更：2026-10-16-provider-switch-transcript-sanitize
状态：active
摘要：主路径——切供应商后 resume 读到的历史已干净；边界——非切换轮不清洗 / 探测不到则不阻断
场景正文：
- 场景：主路径——切供应商后 resume 读到的历史已干净 — Given 会话历史含上一家供应商的私有块对（实证形态：同一条 assistant 消息内 `server_tool_use`；When 平台把该会话切到另一供应商并 reload（迁移 → 清洗 → resume）；；Then 隔离副本中该私有 id 消失、原正文以 `text` 保留、记录条数与链路字段不变、备份文件落盘，
- 场景：边界——非切换轮不清洗 / 探测不到则不阻断 — Given 同一份含私有块的历史；；When 只切人格（payload 不带 `providerConfig`）或探测不到 transcript；；Then 历史零改写、零备份（非切换轮），且 reload 照常成功（降级路径）。
全文：.sillyspec/changes/archive/2026-10-16-provider-switch-transcript-sanitize/requirements.md#FR-01
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-provider-switch-transcript-sanitize:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts「SAN-1 切供应商 → 隔离副本被清洗（私有 id 消失 + 记录链不变 + 备份落盘），宿主原件不动」 | sillyhub-daemon/tests/transcript-sanitize.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-provider-switch-transcript-sanitize
  status: active

## FR-daemon-169 清洗后的历史必须能被真实新供应商接受（实测证据）
变更：2026-10-16-provider-switch-transcript-sanitize
状态：active
摘要：对照实验——同一形态两种编码，端点一拒一收
场景正文：
- 场景：对照实验——同一形态两种编码，端点一拒一收 — Given 一段最小化 payload（含 `server_tool_use:analyze_image` + 同 id `tool_result`）；；When 分别以「原形态」与「等价 text 形态」请求真实端点；；Then 前者 400（错误文案与事故现场逐字一致）、后者 200（正常 completion）；且对实证会话的
全文：.sillyspec/changes/archive/2026-10-16-provider-switch-transcript-sanitize/requirements.md#FR-02
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d

## FR-daemon-170 模型错误分类器必须识别「供应商拒收历史」签名并给出可执行提示
变更：2026-10-16-provider-switch-transcript-sanitize
状态：active
摘要：签名命中与不误伤
场景正文：
- 场景：签名命中与不误伤 — Given 实证错误原文 / 变体文本 / 不含该签名的普通 400；；When 走归类器；；Then 前者得「拒收会话历史」提示且 `type=unknown` / `code=400` / `retryable=false` 不变，
全文：.sillyspec/changes/archive/2026-10-16-provider-switch-transcript-sanitize/requirements.md#FR-03
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-provider-switch-transcript-sanitize:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/model-error/classifier.test.ts「实证 MiniMax 400 文案 → message/hint 覆写为可执行中文提示（type/retryable 不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-provider-switch-transcript-sanitize
  status: active

## FR-daemon-171 守护测试必须覆盖清洗内核三类形态、链路完整性与备份
变更：2026-10-16-provider-switch-transcript-sanitize
状态：active
摘要：测试面全绿
场景正文：
- 场景：测试面全绿 — Given 本变更的三份测试文件与既有 interactive 套件；；When 跑 `vitest run tests/interactive tests/transcript-sanitize.test.ts tests/model-er；Then 全绿零失败。
全文：.sillyspec/changes/archive/2026-10-16-provider-switch-transcript-sanitize/requirements.md#FR-04
最近确认：030eceeece1388442415e8cd66c3cd3cc443083d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-provider-switch-transcript-sanitize:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/model-error/classifier.test.ts | sillyhub-daemon/tests/transcript-sanitize.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-provider-switch-transcript-sanitize
  status: active

## FR-daemon-172 宿主机档位变化 → 本机默认会话引擎自动重载
变更：2026-10-19-host-settings-live-reload
状态：active
摘要：主路径——空闲本机默认会话即时跟随；边界——运行中与终态
场景正文：
- 场景：主路径——空闲本机默认会话即时跟随 — Given 一个本机默认、宿主目录 transcript、空闲的 claude 会话，且 watcher 已建基线；；When 宿主 settings.json 的 env 块被换成新档位（如 GLM → MiniMax）且连续两拍一致；；Then 该会话引擎被重载（旧句柄 close、新句柄 `--resume` 同一 agentSessionId、env 重建），
- 场景：边界——运行中与终态 — Given 同类会话正处于生成中（首 turn 未收尾）；；Then 标记 `pendingConfigSwitch`，当前轮不被打断，轮收尾后才重载；终态（ended/failed）与
全文：.sillyspec/changes/archive/2026-10-19-host-settings-live-reload/requirements.md#FR-01
最近确认：e5a2c7ee31881d2d20c3f831c729ca01c07a81e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-host-settings-live-reload:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts「HOST-1 本机默认 + 宿主目录 transcript + 空闲 → 立即重载（resume 不变、不喂轮）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-host-settings-live-reload
  status: active

## FR-daemon-173 触发精度与零误伤
变更：2026-10-19-host-settings-live-reload
状态：active
摘要：精度——非 env 变化与损坏容错
场景正文：
- 场景：精度——非 env 变化与损坏容错 — Given watcher 已建基线；；When 仅改 permissions/hooks 字段、或写入半截 JSON、或删除文件；；Then 不触发任何重载且进程不抛异常；文件恢复且 env 块确有变化后照常确认触发。
全文：.sillyspec/changes/archive/2026-10-19-host-settings-live-reload/requirements.md#FR-02
最近确认：e5a2c7ee31881d2d20c3f831c729ca01c07a81e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-host-settings-live-reload:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/host-settings-watcher.test.ts | sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts「HOST-2 绑平台供应商的会话 → 零触碰」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-host-settings-live-reload
  status: active

## FR-daemon-174 守护测试与真机验证留痕
变更：2026-10-19-host-settings-live-reload
状态：active
摘要：测试面全绿
场景正文：
- 场景：测试面全绿 — Given 本变更两份测试文件与 interactive 套件；；When 跑 `vitest run tests/interactive` + `tsc --noEmit`；；Then 全绿零失败。
全文：.sillyspec/changes/archive/2026-10-19-host-settings-live-reload/requirements.md#FR-03
最近确认：e5a2c7ee31881d2d20c3f831c729ca01c07a81e5

## FR-daemon-175 冲突推送（base_version 乐观锁冲突/墓碑拦截/rename 目标占用六类被拒点）时，被拒 op 的机器侧内容蒸馏留档进 open 行 details_json.local_archive（单文件文本 32K 字符帽截断留标记、总量 512KB 帽超出停存内容仅留路径清单、300 文件帽），推送主流程零新增 RPC 且留档失败不阻断
变更：2026-10-20-conflict-platform-archive
状态：active
摘要：乐观锁冲突的 add/update 留档内容；delete 冲突留档为缺失；非 utf8 内容置 binary 不存文本；三重帽逐级降级
场景正文：
- 场景：乐观锁冲突的 add/update 留档内容 — Given 清单行 version=2，daemon 推 add/update base_version=1 且 hash 不符（冲突被拒）；When apply_ops 处理该 op；Then open 行 `local_archive` 含条目 `{path, missing: false, content: <解码后文本>, binary: fal
- 场景：delete 冲突留档为缺失 — Given 清单行 version=2，daemon 推 delete base_version=1（冲突被拒）；Then 条目为 `{path, missing: true, content: null}`——机器侧状态是「已删除」
- 场景：非 utf8 内容置 binary 不存文本 — Given 被拒 add 的 content 解码后非 utf8；Then 条目 `{path, binary: true, content: null, missing: false}`
- 场景：三重帽逐级降级 — Given 单文件解码后 40000 字符 → 截断至 32000 且 truncated=true；Given 留档累计序列化超 512KB → 后续条目 content
全文：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/requirements.md#FR-01
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-conflict-platform-archive:flow:测试绑定FR-01
  tests: backend/app/modules/spec_workspace/tests/test_conflict_local_archive.py「六类被拒点留档形态与三重帽」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-conflict-platform-archive
  status: active

## FR-daemon-176 对比端点在 daemon 返回 conflict_record_missing 且行内 local_archive 覆盖所请求变更路径时，以留档构造对比响应（record_label=platform-archive、covered_changes/path_total 同口径裁剪），平台侧仍实时读 spec_root——记录亡后对比不再 502
变更：2026-10-20-conflict-platform-archive
状态：active
摘要：记录双缺 + 留档覆盖（主路径）；留档条目为 missing（机器侧已删）
场景正文：
- 场景：记录双缺 + 留档覆盖（主路径） — Given 机器上 `<change>` 记录与 `full-tree` 记录双缺（conflict_record_missing），open 行 local_archiv；When 请求该变更对比；Then 返回 200，`record_label="platform-archive"`，文件清单只含该变更路径，diff 为留档内容 vs 平台当前内容
- 场景：留档条目为 missing（机器侧已删） — Given 留档条目 `{path: changes/<change>/x.md, missing: true}`，平台侧该文件存在；Then 该文件分类为 `platform_only`（与 daemon 快照 missing 条目同语义）
全文：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/requirements.md#FR-02
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-conflict-platform-archive:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_sillyspec_compare.py「platform-archive 回退命中构造」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-conflict-platform-archive
  status: active

## FR-daemon-177 无留档或留档不含所请求变更路径时，错误路径与现状逐字节一致（四臂文案不变）
变更：2026-10-20-conflict-platform-archive
状态：active
摘要：留档不含所请求变更；损坏的 details_json
场景正文：
- 场景：留档不含所请求变更 — Given open 行 local_archive 只含 `changes/foobar/…` 路径，请求 `<change>=foo`；Then 重抛原 conflict_record_missing 网关错误，不把 foobar 路径混入对比
- 场景：损坏的 details_json — Given open 行 details_json 非法 JSON 或 local_archive 非法结构；Then 按无留档处理重抛原错误（fail-soft，不 500）
全文：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/requirements.md#FR-03
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-conflict-platform-archive:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_sillyspec_compare.py「无留档/不含变更路径/非 missing 错误不回退」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-conflict-platform-archive
  status: active

## FR-daemon-178 前端对比弹窗对 record_label=platform-archive 显示留档来源横幅（平台留档快照·冲突时点机器侧内容 vs 平台当前内容）
变更：2026-10-20-conflict-platform-archive
状态：active
摘要：留档横幅与 full-tree 横幅互斥呈现
场景正文：
- 场景：留档横幅与 full-tree 横幅互斥呈现 — Given 响应 record_label="platform-archive"；Then 弹窗顶部出现留档横幅且 full-tree 横幅不出现（record_label 单值互斥）
全文：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/requirements.md#FR-04
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-conflict-platform-archive:flow:测试绑定FR-04
  tests: frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx「platform-archive 留档横幅」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-conflict-platform-archive
  status: active

## FR-daemon-179 既有对比/增量同步/墓碑守卫测试零回归，新增后端留档构建+回退与前端横幅测试
变更：2026-10-20-conflict-platform-archive
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/requirements.md#FR-05
最近确认：ffab0aa2e9dafa7c1fa67528d15f08941d4ee87b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-conflict-platform-archive:flow:测试绑定FR-05
  tests: backend/app/modules/daemon/tests/test_sillyspec_compare.py | backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py | backend/app/modules/spec_workspace/tests/test_sync_incremental.py | frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx「既有套件零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-conflict-platform-archive
  status: active

## FR-daemon-180 _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文
变更：2026-10-21-gitlog-conflict-quotepath
状态：active
摘要：主路径；残余强制引号
全文：.sillyspec/changes/archive/2026-10-21-gitlog-conflict-quotepath/requirements.md#FR-01
最近确认：21e877fc467eca703395f8b9d60dccfa4f67326d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-conflict-quotepath:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/host-fs-handler-worktree.test.ts「WT4d 冲突列举命令带 -c core.quotepath=false + C 引号中文路径解码」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-gitlog-conflict-quotepath
  status: active

## FR-daemon-181 daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数
变更：2026-10-21-gitlog-conflict-quotepath
状态：active
摘要：真实仓端到端
全文：.sillyspec/changes/archive/2026-10-21-gitlog-conflict-quotepath/requirements.md#FR-02
最近确认：21e877fc467eca703395f8b9d60dccfa4f67326d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-conflict-quotepath:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts「真实 git 中文文件名 merge 冲突：conflicts[].file 原文 + marker_lines 计数」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-gitlog-conflict-quotepath
  status: active

## FR-daemon-182 跑 git merge 相关既有测试全绿，daemon tsc 零错
变更：2026-10-21-gitlog-conflict-quotepath
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-gitlog-conflict-quotepath/requirements.md#FR-03
最近确认：21e877fc467eca703395f8b9d60dccfa4f67326d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-gitlog-conflict-quotepath:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/host-fs-handler-worktree.test.ts「WT3/WT3b/WT4/WT4b/WT4c 既有回归全绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-gitlog-conflict-quotepath
  status: active

## FR-daemon-183 daemon spec 自动推送支持整机关闭（env）与按工作区关闭（flag 文件），关闭态为 no-op（返回 null、不动 pending_push），knowledge hits 上行不受影响
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：env 整机关闭；按工作区 flag 关闭；pending_push 不动
场景正文：
- 场景：env 整机关闭 — Given `SILLYHUB_DAEMON_SPEC_SYNC_OFF=1` 且 mock client 的 postSpecSync 为 spy，When 调 `pos
- 场景：按工作区 flag 关闭 — Given 仅 `~/.sillyhub/daemon/spec-sync-off/{wsId}.flag` 在位（env 未设），When 该 ws 调 postSpec
- 场景：pending_push 不动 — Given 关闭态命中且 specRoot/.runtime/pending_push 标记已存在，When 推送被跳过，Then 标记文件保持原样（不写不清）。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-01
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/spec-sync-off-switch.test.ts「env 整机关闭返回 null 且零请求」 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts「flag 按工作区关闭他 ws 不受影响」 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts「parseSpecSyncOffEnv 大小写与脏值」 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts「关闭态 pending_push 不动」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-184 status 采集超时支持 SILLYHUB_DAEMON_STATUS_TIMEOUT_MS env 覆盖
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：env 合法生效；非法回退默认
场景正文：
- 场景：env 合法生效 — Given env=120000 且构造 manager 未注入 deps.statusTimeoutMs，When 执行一轮采集，Then 传给执行器的 timeoutM
- 场景：非法回退默认 — Given env 为 'abc'、'-1'、'0' 或空白，When 构造 manager，Then 采集超时为默认 30_000。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-02
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「deps 注入优先于 env」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「env 合法覆盖采集超时」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「env 非法回退默认 30s」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-185 status 采集对连续失败目标自动退避降频，成功即复位
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：连败退避降频；成功复位
场景正文：
- 场景：连败退避降频 — Given 某目标连败 3 次，When 第 4~9 轮采集，Then 跳过 spawn；第 10 轮恢复实采尝试。
- 场景：成功复位 — Given 目标已处退避态且某轮实采成功，When 之后再次失败，Then 连败从 1 重新计数（不立即退避）。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-03
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「成功复位重计」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「连败 3 次进入退避降频」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「退避轮取模实采」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「首次进退避 warn 一次」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-186 登记根带 .git/sillyspec-crossrepo.json 的工作区采集自动跳过并一次性提示
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：跨仓跳过一次性指路；标记删除后恢复
场景正文：
- 场景：跨仓跳过一次性指路 — Given cwd 带 crossrepo 标记（内含 workspace 字段），When 连续多轮采集，Then 不 spawn、info 指路日志只出现一次、不产生失
- 场景：标记删除后恢复 — Given 某轮标记已被删除，When 下一轮采集，Then 恢复正常 spawn 路径。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-04
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「crossrepo 标记跳过 spawn 且一次性指路」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「标记删除恢复采集」 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts「跳过不记失败」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-187 hub-client 全部 fetch 带显式 AbortSignal 超时
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：源码面全量断言
场景正文：
- 场景：源码面全量断言 — Given hub-client.ts 全文，When 扫描全部 fetch( 调用点，Then 每一处调用的实参块内均含 signal。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-05
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/hub-client-fetch-timeout-surface.test.ts「hub-client 全部 fetch 带 signal」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-188 daemon 具备事件循环 lag 周期监控，超阈值留 warn 证据
变更：2026-10-21-daemon-sync-hardening
状态：active
摘要：超阈值告警；正常窗口静默
场景正文：
- 场景：超阈值告警 — Given 注入假直方图窗口 max=6000ms、阈值 5000ms，When 一拍采样，Then 输出 warn event_loop_lag 且统计字段齐全。
- 场景：正常窗口静默 — Given 假直方图 max=100ms，When 一拍采样，Then 不输出 warn（仅 debug tick）。
全文：.sillyspec/changes/archive/2026-10-21-daemon-sync-hardening/requirements.md#FR-06
最近确认：28656ff43d1c7fe40924545732e7445cbaca0492

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-daemon-sync-hardening:flow:测试绑定FR-06
  tests: sillyhub-daemon/tests/event-loop-watch.test.ts「循环退出 disable 直方图」 | sillyhub-daemon/tests/event-loop-watch.test.ts「正常窗口静默」 | sillyhub-daemon/tests/event-loop-watch.test.ts「超阈值 warn 携带统计字段」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-daemon-sync-hardening
  status: active

## FR-daemon-189 change.patch 内容等于 git diff c71b875a1..e88ffddb7 两源码文件
变更：2026-10-21-archive-patch-repair
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-archive-patch-repair/requirements.md#FR-01
最近确认：5c97d62770d4dddf8fa3d9ea833b8905f3cbd098

## FR-daemon-190 change-patch.json files/totals/scopeAudit.rows 与 git 实况一致，verdict 不确定处注记兜底
变更：2026-10-21-archive-patch-repair
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-archive-patch-repair/requirements.md#FR-02
最近确认：5c97d62770d4dddf8fa3d9ea833b8905f3cbd098

## FR-daemon-191 patchSha256 与新 patch 字节哈希一致且原错误锚值保留于 repair 注记字段
变更：2026-10-21-archive-patch-repair
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-archive-patch-repair/requirements.md#FR-03
最近确认：5c97d62770d4dddf8fa3d9ea833b8905f3cbd098

## FR-daemon-192 patch-file 切片实跑返回两源码文件 diff，平台投影重新同步
变更：2026-10-21-archive-patch-repair
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-archive-patch-repair/requirements.md#FR-04
最近确认：5c97d62770d4dddf8fa3d9ea833b8905f3cbd098

## FR-daemon-193 同一工作区连续 2 次推送冲突（rebase 重试仍败）时 daemon 自动备份并删本地 manifest、立即走全量 tar 重推（本地为准），全程零人工
变更：2026-10-21-spec-conflict-autoheal
状态：active
摘要：连续两次冲突触发自愈；单次冲突不触发；env 禁用；成功清零
场景正文：
- 场景：连续两次冲突触发自愈 — Given manifest 缓存在位且 mock 客户端增量推送恒 conflict、全量 tar 推送成功，When 连续调两次 postSpecSync，Then 第
- 场景：单次冲突不触发 — Given 首次冲突，When postSpecSync，Then 必须抛 SpecPushConflict 且 manifests-backup/ 无新文件。
- 场景：env 禁用 — Given SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0，When 连续多次冲突，Then 始终照旧上抛、不删 manifest、无备份。
- 场景：成功清零 — Given 冲突 1 次后推送成功，When 再次冲突，Then 计数从 1 重计（不立即自愈）。
全文：.sillyspec/changes/archive/2026-10-21-spec-conflict-autoheal/requirements.md#FR-01
最近确认：2c0969435e1c7c9b5010460bae10d4a20977eced

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-spec-conflict-autoheal:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts「env 0 禁用自愈」 | sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts「单次冲突不触发」 | sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts「成功清零重计」 | sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts「连续两次冲突自愈全量重推」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-spec-conflict-autoheal
  status: active

## FR-daemon-194 event-loop 循环 abort 退出不再被 _fire 误记 loop_crashed
变更：2026-10-21-spec-conflict-autoheal
状态：active
摘要：优雅退出
场景正文：
- 场景：优雅退出 — Given 注入的 sleep 在第 N 拍 abort reject（reason 为非 AbortError 的 Error），When await runEventL
全文：.sillyspec/changes/archive/2026-10-21-spec-conflict-autoheal/requirements.md#FR-02
最近确认：2c0969435e1c7c9b5010460bae10d4a20977eced

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-spec-conflict-autoheal:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/event-loop-watch.test.ts「abort 退出优雅 resolve 不 reject」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-spec-conflict-autoheal
  status: active

## FR-daemon-195 off 开关命中日志标明来源（env 或 flag）
变更：2026-10-21-spec-conflict-autoheal
状态：active
摘要：env 命中标来源；flag 命中标来源
场景正文：
- 场景：env 命中标来源 — Given 仅 env 开启，When postSpecSync 被跳过，Then isDaemonSpecSyncOff 返回 'env' 且 warn 日志含「来源=e
- 场景：flag 命中标来源 — Given 仅 flag 文件在位，When postSpecSync 被跳过，Then 返回 'flag' 且 warn 日志含「来源=flag」。
全文：.sillyspec/changes/archive/2026-10-21-spec-conflict-autoheal/requirements.md#FR-03
最近确认：2c0969435e1c7c9b5010460bae10d4a20977eced

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-spec-conflict-autoheal:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/spec-sync-off-switch.test.ts「跳过日志含来源字样」 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts「返回值细化 env/flag/null」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-spec-conflict-autoheal
  status: active

## FR-daemon-196 轮元信息合并为唯一一行
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-008@v1、D-016@v1、D-021@v1
场景正文：
- 场景：默认场景 — Given 一个已完成轮（`replyAt` 存在）；When 在对话视图或「全部（进度）」视图渲染该轮；Then 轮号 / 状态 / 结束时刻 / 历时 / tokens / tok·s 必须全部落在**同一条**元信息行内（整页「历时」字样只出现一次）；对话视图必须经 `
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-01
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-01:acc-0-19274c8c
  tests: frontend/src/components/daemon/__tests__/ | frontend/src/components/sessions/__tests__/
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-01:acc-1-d2dfb31e
  tests: frontend/src/components/daemon/__tests__/ | frontend/src/components/sessions/__tests__/
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-197 答复正文提档到 15px / 1.8 / 0.65em
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-008@v1、D-013@v1、D-016@v1、D-021@v1
场景正文：
- 场景：默认场景 — Given 任意一轮的答复正文（段模型 `TextSegmentView`，或旧回退路径的 `seg-text-body` 气泡）；When 桌面端渲染（不在 `[data-variant="mobile"]` 作用域内）；Then `.seg-text-body` 内的 `.wmde-markdown` 必须是 15px / 行高 1.8 / 段距 0.65em（`frontend/src
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-02
最近确认：328788cbe

## FR-daemon-198 过程行退档到 11.5px + muted/80，并带 D-025 固定语义标签
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-002@v1、D-013@v1、D-016@v1、D-021@v1、D-025@v1
场景正文：
- 场景：默认场景 — Given 思考行或工具行；When 渲染；Then 两者必须同为 `text-[11.5px]` + `text-muted-foreground/80`（`frontend/src/components/dae
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-03
最近确认：328788cbe

## FR-daemon-199 工具行去外框、改 2px 左规线
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-016@v1、D-021@v1
场景正文：
- 场景：默认场景 — Given 一个工具行（`turn-segment-views.tsx:808` 的工具行容器）；When 静息与 hover 两种态；Then 必须去掉满宽描边与卡底，改 2px 左规线；静息必须 `border-border/60`、hover 必须 `border-l-brand-600`；行尾动作
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-04
最近确认：328788cbe

## FR-daemon-200 过程块与答复块 14px 分区
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-021@v1
场景正文：
- 场景：默认场景 — Given 「全部（进度）」视图的助手列（`data-testid="turn-progress-column"`，`turn-timeline.tsx:2053`）；When 同时渲染过程段与答复正文段；Then 列内过程行之间必须是 7px（`gap-[7px]`），答复正文块必须额外上留 7px（`[&>.seg-text-body]:mt-[7px]`），两区实际间
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-05
最近确认：328788cbe

## FR-daemon-201 轮间只留留白、禁止任何分割线
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-008@v1、D-016@v1、D-020@v1
场景正文：
- 场景：默认场景 — Given 任意轮列表（`turn-block` 容器，`turn-timeline.tsx:1712`）；When 渲染轮与轮之间的边界；Then 禁止出现任何边框/分割线（`turn-block` 不得含 `border-b`，也不得含 `border-border`），只允许 28px 留白（`pb-7
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-06
最近确认：328788cbe

## FR-daemon-202 用户气泡压暗 + 附件 chips 双档
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-016@v1
场景正文：
- 场景：默认场景 — Given 用户气泡及其内部图片/文件 chip；When 会话页（新形态）渲染；Then 用户气泡必须走压暗的 brand 基底 + 细边（不再是整屏最亮的纯亮蓝大块）；附件 chip 必须支持 `tone: "onPrimary" | "brand
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-07
最近确认：328788cbe

## FR-daemon-203 左栏 chip 统一 9px、轮数右贴
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-016@v1
场景正文：
- 场景：默认场景 — Given 会话列表行（`frontend/src/components/sessions/session-list-panel.tsx`）；When 渲染引擎 / 档案 / 轮数 chip 与行时间；Then chip 必须统一 `h-[14px]` + `text-[9px]`（`session-list-panel.tsx:3773`），轮数必须右贴（`ml-au
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-08
最近确认：328788cbe

## FR-daemon-204 三主题只走语义 token
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-003@v1、D-013@v1、D-015@v1、D-015@v2
场景正文：
- 场景：默认场景 — When 切换 `html[data-theme]`；Then 本变更的全部视觉改动必须只用语义 token（`hsl(var(--…))`、`--color-*` 或 token 派生类名，含 `/80`、`/60` 这类
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-09
最近确认：328788cbe

## FR-daemon-205 轨迹装配器必须是纯函数且覆盖全部边界
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-022@v1、D-024@v1、D-026@v1
场景正文：
- 场景：默认场景 — Given 真实会话导出的 `logs` + `runs`；When 调用 `buildTrajectory(logs, runs, opts?)`（`frontend/src/components/daemon/trajecto；Then 必须按 `runs` 顺序分组，零日志 run 必须不产轮且不占轮号；轮内必须按事件时间排序（同毫秒用 `agent_event.seq` 稳定，无 seq 的
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-10
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-02:acc-1-b0ea7d39
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-02:acc-2-182b044c
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-206 轨迹视图是第三个入口，不是替换
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-022@v1、D-024@v1、D-026@v1
场景正文：
- 场景：默认场景 — Given 已装配的 `Trajectory`；When 渲染 `TrajectoryView`（`frontend/src/components/daemon/trajectory/trajectory-view.t；Then 必须只做展示（无 fetch / 无 store / 无 context，数据由 props 注入）；必须是三段结构：泳道时间轴（输入 / 模型 / 工具三泳道
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-11
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-10:acc-0-789f5890
  tests: sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-10:acc-1-d7e706db
  tests: sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-10:acc-2-44d3e4de
  tests: sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-10:acc-3-12841231
  tests: sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-10:acc-4-8891d819
  tests: sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-12:acc-0-cf28e0d2
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-12:acc-1-315735c7
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-12:acc-2-f5a86175
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-12:acc-3-c44bed40
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-207 轨迹数据面由 SSR 读盘注入，禁止回到 public/
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-010@v1、D-018@v1、D-022@v1
场景正文：
- 场景：默认场景 — Given dev server 在跑；When `GET /proto/session-trajectory`；Then 必须返回 200，且首屏 SSR HTML 必须已含完整账本（不依赖浏览器 JS 才出现）；真实导出必须由 Server Component 从 `fronte
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-12
最近确认：328788cbe

## FR-daemon-208 文件变更卡 1b——daemon 每轮工作区快照
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-023@v1
场景正文：
- 场景：默认场景 — Given daemon 侧一轮开始与结束；When 轮首与轮尾；Then 轮首必须记录 HEAD 作为 baseline；轮尾必须执行 `git status --porcelain -z --untracked-files=norm
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-13
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-08:acc-0-cae104ca
  tests: backend/app/modules/daemon/tests/ | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-08:acc-1-c90f4e83
  tests: backend/app/modules/daemon/tests/ | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-08:acc-2-8d4e6538
  tests: backend/app/modules/daemon/tests/ | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-08:acc-3-89d11596
  tests: backend/app/modules/daemon/tests/ | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-09:acc-0-9f8f99d4
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-09:acc-1-7c06fdc9
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-09:acc-2-0c9d6570
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-09:acc-3-ffa5481f
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-09:acc-4-c6dc913a
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | sillyhub-daemon/tests/interactive/ | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-13:acc-0-50152569
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-13:acc-1-7ac5f9a9
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-13:acc-2-8306e2cc
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-13:acc-3-a5935696
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | sillyhub-daemon/tests/version.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-209 文件变更卡归因与老版本降级
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-023@v1
场景正文：
- 场景：默认场景 — Given 一轮结束且快照显示有文件改动；When 前端渲染该轮的变更卡；Then 每个文件必须标注归因：有 `edit_patch` 的指向具体编辑（点开看哪次编辑）；有改动但无 patch 的必须标「命令行/脚本改动」；daemon 版本过
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-14
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-11:acc-0-872866f6
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-11:acc-1-9e593925
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-11:acc-2-643baaa3
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-11:acc-3-2d990048
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-11:acc-4-6b58092d
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-210 文件变更卡的性能红线与降级
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-023@v1
场景正文：
- 场景：默认场景 — Given 一轮结束时的采集；When 在高轮次会话（21 轮 / 1271 条日志为基线语料）上重复执行
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-15
最近确认：328788cbe

## FR-daemon-211 并行会话隔离＝显式标注，不引入每会话 worktree
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-023@v1
场景正文：
- 场景：默认场景 — Given 一个共享工作区被多个会话同时使用；When turn 级卡片列出改动文件；Then 卡片必须注明「可能含并行会话改动」；本变更禁止为此强制引入每会话独立 worktree（留作后续根治项）；ignored 目录的探测结果必须标明来源是 mtim
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-16
最近确认：328788cbe

## FR-daemon-212 定稿原型必须由真实组件 + 水合后 DOM 产出
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-005@v1、D-009@v1、D-010@v1、D-014@v1、D-017@v1、D-019@v1
场景正文：
- 场景：默认场景 — Given 需要给用户看「可双击的真实稿」；When 产出定稿原型；Then 定稿原型必须由 `/proto/*` dev 路由渲染真实生产组件产生，再对**水合后 DOM** 序列化导出（内联 CSS、剥 `<script>` / `<
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-17
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-03:acc-0-ba3b1255
  tests: frontend/e2e/proto-file-card.spec.ts | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-03:acc-1-40b46d82
  tests: frontend/e2e/proto-file-card.spec.ts | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-03:acc-2-22949e78
  tests: frontend/e2e/proto-file-card.spec.ts | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-14:acc-0-67de79b4
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-14:acc-1-4ec07da9
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-14:acc-2-b1e888ad
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-213 导出脚本自带机械校验，不达标不产出
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-014@v1、D-018@v1、D-019@v1
场景正文：
- 场景：默认场景 — Given 运行 `frontend/scripts/export-hydrated.mjs`；When 水合未达标或产物不合格；Then 脚本必须以非 0 退出且**不落盘**（`export-hydrated.mjs:953-957`：`problems` 非空即 `fail()`，落盘 `wr
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-18
最近确认：328788cbe

## FR-daemon-214 `/proto/*` 与真实数据面的 dev-only 边界
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-010@v1、D-014@v1、D-018@v1
场景正文：
- 场景：默认场景 — Given `/proto/*` 路由与 `frontend/.proto-staging/`；When 生产构建、导航与鉴权；Then 这些路由必须 dev-only：禁止进导航、禁止被生产页面引用（实测 `frontend/src` 下非 `proto` 文件零引用）、且不在 middlewa
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-19
最近确认：328788cbe

## FR-daemon-215 折叠只作候选能力，禁止接线成默认行为
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-004@v1、D-009@v1、D-012@v1
场景正文：
- 场景：默认场景 — Given `frontend/src/components/daemon/turn-fold.ts` 与 `TurnTimeline.detailLevel`；When 调用方未传 `detailLevel`；Then 必须与现行为等价（零渲染变化）；只有传入非 `detailed` 档且轮状态为 `completed` 时才可折；运行中 / 失败 / 被打断的轮禁止折叠；本变
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-20
最近确认：328788cbe

## FR-daemon-216 技术栈边界——禁止客户端插件化架构
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 本仓客户端技术栈（Next.js 14 + React 18 + TanStack Query + antd）；When 引入任何新依赖或新装配机制；Then 禁止引入 Cordis、slot 注册表或客户端插件加载机制；对 DSH 的借鉴必须限于交互模型、数据投影口径与视觉细节；本变更禁止改动 `frontend/p
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-21
最近确认：328788cbe

## FR-daemon-217 性能线出界，禁止顺手优化
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
依据决策：D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 本变更已改动默认渲染形态（去 hairline、字阶、间距、折叠候选）；When 评估首屏 / 翻页 / 滚动 / 流式四项性能；Then 本变更禁止把性能优化纳入交付（四项症状归性能变更承接）；若某项改动显著改变性能画像，必须由性能变更复测基线，禁止在本变更内顺手优化；本变更禁止改动会话取数与分页
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-22
最近确认：328788cbe

## FR-daemon-218 会话 × 模型用量明细只读端点（工作树已落盘的范围内交付）
变更：2026-10-20-session-page-dsh-alignment
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个属于当前用户的会话（`session_id`）；When `GET /api/daemon/sessions/{session_id}/model-usage`；Then 必须返回 `{ session_id, items[], truncated }`，`items[]` 逐条直映 `agent_run_model_usage`
全文：.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/requirements.md#FR-23
最近确认：328788cbe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-page-dsh-alignment:task-04:acc-0-13f031ce
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-04:acc-1-0d0bd63a
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-04:acc-2-9339d5f9
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-15:acc-0-227c2716
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-15:acc-1-ff03fa06
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-15:acc-2-c68a5787
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-15:acc-3-2b5dad5f
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active
- row: 2026-10-20-session-page-dsh-alignment:task-15:acc-4-0ca61594
  tests: backend/app/modules/daemon/tests/test_session_model_usage.py | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 0ca435b1700f9719306ca92a8af3af08711ba3d0
  source_change: 2026-10-20-session-page-dsh-alignment
  status: active

## FR-daemon-219 会话组件底部「智能体档案」后面展示该会话当前所在 git 分支
变更：2026-10-21-session-git-branch
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-session-git-branch/requirements.md#FR-01
最近确认：4f66ab1e2364cbdfeafb01bb48f3dec9c6d08b3a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-session-git-branch:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「renders git branch indicator after profile control」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-session-git-branch
  status: active

## FR-daemon-220 分支信息为实时查询（非创建时快照）：会话运行期间分支变化后，展示随之更新（轮询刷新）
变更：2026-10-21-session-git-branch
状态：active
摘要：分支切换后自动更新
全文：.sillyspec/changes/archive/2026-10-21-session-git-branch/requirements.md#FR-02
最近确认：4f66ab1e2364cbdfeafb01bb48f3dec9c6d08b3a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-session-git-branch:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「git branch indicator polls with refetchInterval」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-session-git-branch
  status: active

## FR-daemon-221 无 git 仓库/无 cwd 的会话有优雅降级展示，不报错
变更：2026-10-21-session-git-branch
状态：active
摘要：空态与故障
全文：.sillyspec/changes/archive/2026-10-21-session-git-branch/requirements.md#FR-03
最近确认：4f66ab1e2364cbdfeafb01bb48f3dec9c6d08b3a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-session-git-branch:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「hides git branch indicator on no_git / no_root」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-session-git-branch
  status: active

## FR-daemon-222 工作区顶部既有 GitStatusBar 行为不变
变更：2026-10-21-session-git-branch
状态：active
摘要：零回归
全文：.sillyspec/changes/archive/2026-10-21-session-git-branch/requirements.md#FR-04
最近确认：4f66ab1e2364cbdfeafb01bb48f3dec9c6d08b3a

## FR-daemon-223 派发溯源盖戳（user_input 日志 metadata_.turn_trigger）
变更：2026-10-22-turn-trigger-metadata-p2
状态：active
摘要：三源盖戳；群聊合并
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-metadata-p2/requirements.md#FR-01
最近确认：125f15809bfcba92270420feb915fffc88a8cec2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-metadata-p2:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_session_queue.py::TestTurnTriggerStamp「test_idle_inject_stamps_turn_trigger（三源盖戳）」+「test_schedule_busy_queue_row_origin_and_replay_stamp（队列回放
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-metadata-p2
  status: active

## FR-daemon-224 定时消息全链溯源
变更：2026-10-22-turn-trigger-metadata-p2
状态：active
摘要：忙轮定时消息
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-metadata-p2/requirements.md#FR-02
最近确认：125f15809bfcba92270420feb915fffc88a8cec2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-metadata-p2:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_session_queue.py「scheduled 忙轮排队行 origin='schedule' 与回放盖戳」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-metadata-p2
  status: active

## FR-daemon-225 前端 metadata 优先分类 + schedule 触发行
变更：2026-10-22-turn-trigger-metadata-p2
状态：active
摘要：metadata 优先
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-metadata-p2/requirements.md#FR-03
最近确认：125f15809bfcba92270420feb915fffc88a8cec2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-metadata-p2:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「metadata 优先分类与 schedule 触发行」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-metadata-p2
  status: active

## FR-daemon-226 回归与类型门
变更：2026-10-22-turn-trigger-metadata-p2
状态：active
摘要：全量回归
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-metadata-p2/requirements.md#FR-04
最近确认：125f15809bfcba92270420feb915fffc88a8cec2

## FR-daemon-227 /settings/providers 供应商列表有「设为默认」操作，已设默认的行有明确默认标记，且有对称「取消默认」操作
变更：2026-10-21-provider-set-default-ui
状态：active
摘要：设为默认主路径；取消默认；凭证探测失败
全文：.sillyspec/changes/archive/2026-10-21-provider-set-default-ui/requirements.md#FR-01
最近确认：59c6466d29feb3c10add4e51bb0c41d8c84ae007

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-provider-set-default-ui:flow:测试绑定FR-01
  tests: frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx「凭证探测失败 toast 错误且状态不变」 | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx「取消默认恢复设为默认」 | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx「设为默认成功显示徽标并刷新」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-provider-set-default-ui
  status: active

## FR-daemon-228 set/unset-default 收敛为仅置位——移除运行中会话热切换，只对新会话生效（用户 2026-10-21 拍板，否决原「保留热切换」倾向 D-001）
变更：2026-10-21-provider-set-default-ui
状态：active
摘要：运行中会话不受影响；取消默认
全文：.sillyspec/changes/archive/2026-10-21-provider-set-default-ui/requirements.md#FR-02
最近确认：59c6466d29feb3c10add4e51bb0c41d8c84ae007

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-provider-set-default-ui:flow:测试绑定FR-02
  tests: backend/app/modules/llm_provider/tests/test_llm_provider.py「set/unset 后 affected_sessions=0 且 notify_provider_switch 未被调用」 | backend/app/modules/llm_provider/tests/test_router.py「set-default/unset-default 端点返回 affected_sessions=0」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-provider-set-default-ui
  status: active

## FR-daemon-229 会话未显式选供应商时注入用户默认供应商凭证，未设默认回落本机（既有 claim 链路，UI 加回即通）
变更：2026-10-21-provider-set-default-ui
状态：active
摘要：零回归
全文：.sillyspec/changes/archive/2026-10-21-provider-set-default-ui/requirements.md#FR-03
最近确认：59c6466d29feb3c10add4e51bb0c41d8c84ae007

## FR-daemon-230 新增/更新前后端测试覆盖
变更：2026-10-21-provider-set-default-ui
状态：active
摘要：默认行渲染
全文：.sillyspec/changes/archive/2026-10-21-provider-set-default-ui/requirements.md#FR-04
最近确认：59c6466d29feb3c10add4e51bb0c41d8c84ae007

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-provider-set-default-ui:flow:测试绑定FR-04
  tests: frontend/src/lib/api/__tests__/llm-providers.test.ts「setDefaultProvider/unsetDefaultProvider 请求形态与返回解析」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-provider-set-default-ui
  status: active

## FR-daemon-231 app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）
变更：2026-10-22-merge-regression-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given grants 目录测试 / When 隔离或全量运行 / Then 62 用例全绿且零 errors（fixture 建表成功）。
全文：.sillyspec/changes/archive/2026-10-22-merge-regression-fixes/requirements.md#FR-01
最近确认：c4a82ff0be9d18ad4cdaa333e43ff178b0007e8b

## FR-daemon-232 test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors
变更：2026-10-22-merge-regression-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-22-merge-regression-fixes/requirements.md#FR-02
最近确认：c4a82ff0be9d18ad4cdaa333e43ff178b0007e8b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-merge-regression-fixes:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py「TestInitClaimDefensiveDegrade::test_no_token_issued_when_workspace_id_missing」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-merge-regression-fixes
  status: active

## FR-daemon-233 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署
变更：2026-10-22-merge-regression-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given diff 面 = grants conftest + lease 测试文件 / When 逐 hunk 核对 / Then 无生产文件变更。
全文：.sillyspec/changes/archive/2026-10-22-merge-regression-fixes/requirements.md#FR-03
最近确认：c4a82ff0be9d18ad4cdaa333e43ff178b0007e8b

## FR-daemon-234 progress show 失败且 stdout envelope codes 含 db_missing 时，连续 3 次后该工作区根从采集目标淘汰（回调通知 daemon 删 _sillyspecStatusRoots 并持久化），不再探测、心跳 map 清除该槽位，日志留 evicted 记录
变更：2026-10-22-sillyspec-probe-db-missing-evict
状态：active
摘要：连续 db_missing 后淘汰；淘汰后重新 claim 恢复采集
全文：.sillyspec/changes/archive/2026-10-22-sillyspec-probe-db-missing-evict/requirements.md#FR-01
最近确认：b01334c76b3644cff83b081c3942d73823c95f46

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-sillyspec-probe-db-missing-evict:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「db_missing 连续 3 次 → 第 3 次淘汰（evict 回调/心跳槽位清除/日志），第 4 轮不再探测」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-sillyspec-probe-db-missing-evict
  status: active

## FR-daemon-235 非 db_missing 的非零退出保持既有 nonzero_exit 记账不变，且日志附带 stdout 首行便于诊断
变更：2026-10-22-sillyspec-probe-db-missing-evict
状态：active
摘要：未知非零退出
全文：.sillyspec/changes/archive/2026-10-22-sillyspec-probe-db-missing-evict/requirements.md#FR-02
最近确认：b01334c76b3644cff83b081c3942d73823c95f46

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-sillyspec-probe-db-missing-evict:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「非 db_missing 非零退出：保持 nonzero_exit 记账、日志带 stdout_head、不淘汰」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-sillyspec-probe-db-missing-evict
  status: active

## FR-daemon-236 采集成功重置连败计数；淘汰后若根被重新 claim 注册则恢复采集
变更：2026-10-22-sillyspec-probe-db-missing-evict
状态：active
摘要：成功重置
全文：.sillyspec/changes/archive/2026-10-22-sillyspec-probe-db-missing-evict/requirements.md#FR-03
最近确认：b01334c76b3644cff83b081c3942d73823c95f46

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-sillyspec-probe-db-missing-evict:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「采集成功重置连败计数：2 次失败 → 成功 → 再 2 次失败不淘汰」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-sillyspec-probe-db-missing-evict
  status: active

## FR-daemon-237 daemon 定向测试全绿，既有采集/降级语义零回归
变更：2026-10-22-sillyspec-probe-db-missing-evict
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-22-sillyspec-probe-db-missing-evict/requirements.md#FR-04
最近确认：b01334c76b3644cff83b081c3942d73823c95f46

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-sillyspec-probe-db-missing-evict:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「db_missing 连续 3 次 → 第 3 次淘汰（evict 回调/心跳槽位清除/日志），第 4 轮不再探测」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-sillyspec-probe-db-missing-evict
  status: active

## FR-daemon-238 列表端点批量注入等待回答标记（照 current_run_status 的 IN 批查先例，零 N+1），存在 pending 对话请求的会话下发该标记
变更：2026-10-20-session-awaiting-answer-status
状态：active
摘要：等待回答的会话带标记；回答后标记消失；零 N+1
全文：.sillyspec/changes/archive/2026-10-20-session-awaiting-answer-status/requirements.md#FR-01
最近确认：c0dbab0121e933d6bbfec711f0839bec0c580290

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-awaiting-answer-status:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py「pending 对话注入 pending_dialog_kind；answered 不注入；无对话 None；IN 批查」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-awaiting-answer-status
  status: active

## FR-daemon-239 左侧状态指示器新增「问号」形态（等待回答），压过 run running 的转圈；终端态 failed/ended 仍权威优先
变更：2026-10-20-session-awaiting-answer-status
状态：active
摘要：等回答压过转圈；终态仍优先；回答后回归转圈
全文：.sillyspec/changes/archive/2026-10-20-session-awaiting-answer-status/requirements.md#FR-02
最近确认：c0dbab0121e933d6bbfec711f0839bec0c580290

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-awaiting-answer-status:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx「问号形态：pending_dialog_kind 压过 running 转圈、让位 failed/ended、回答后回归转圈」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-awaiting-answer-status
  status: active

## FR-daemon-240 无 pending 对话的会话展示零回归（既有五分类不变）
变更：2026-10-20-session-awaiting-answer-status
状态：active
摘要：既有分类回归
全文：.sillyspec/changes/archive/2026-10-20-session-awaiting-answer-status/requirements.md#FR-03
最近确认：c0dbab0121e933d6bbfec711f0839bec0c580290

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-awaiting-answer-status:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx「None 时既有五分类零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-awaiting-answer-status
  status: active

## FR-daemon-241 后端注入与前端指示器有单测覆盖，触及面测试全绿
变更：2026-10-20-session-awaiting-answer-status
状态：active
摘要：守卫路径
全文：.sillyspec/changes/archive/2026-10-20-session-awaiting-answer-status/requirements.md#FR-04
最近确认：c0dbab0121e933d6bbfec711f0839bec0c580290

## FR-daemon-242 对话视图运行中轮次（pending/running/interrupting）末尾渲染单行横向跑马灯，展示思考/工具/子代理/文件/系统事件等过程信息，终态轮不渲染
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：运行中展示；终态消失
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-01
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「按段文档序产出条目，跳过 text 答复段」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-243 事件按发生顺序逐条横向滑过；新事件实时入队，无新事件时循环播放最近事件，保持持续流动感
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：事件密集；短暂空闲；打开时已有历史
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-02
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道按顺序完整渲染全部条目，不复制内容循环」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-244 同一段的流式文本更新不重复刷屏：按段 id 去重，每段只入队一次（工具状态变化就地更新不新增）
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：思考流式增长
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-03
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「同一段 id 的流式更新就地覆盖文本，不重复入队（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-245 「进度」「轨迹」视图与历史轮次渲染行为零变化；旧回退轮（segments undefined）不接入
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：切换视图
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-04
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「对话视图 + 终态轮次 → 不渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-246 现有主题下视觉协调，移动端不溢出，prefers-reduced-motion 下降级为静态展示最新一条
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：减少动态效果
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-05
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-247 用户上滚离开底部或组件不可见时暂停轮播，回到底部恢复
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：上滚离开
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-06
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-06
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「组件不可见时暂停滚动，恢复可见后继续（FR-06）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-248 新增纯函数与组件测试，相关测试通过；lint / typecheck 通过
变更：2026-10-22-conversation-live-marquee
状态：active
摘要：交付核验
全文：.sillyspec/changes/archive/2026-10-22-conversation-live-marquee/requirements.md#FR-07
最近确认：0bc8e38f727cf2fe343cea748bf7cc493aa8c50e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-conversation-live-marquee:flow:测试绑定FR-07
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「条目超过上限时只保留最近 200 条」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-conversation-live-marquee
  status: active

## FR-daemon-249 排队消息等纯文本展示中的附件/工作区引用标记统一简化为简洁文件名标签，不再露出 uuid
变更：2026-10-22-session-composer-slim
状态：active
摘要：排队消息含附件引用；复制用户消息
全文：.sillyspec/changes/archive/2026-10-22-session-composer-slim/requirements.md#FR-01
最近确认：4d6c17185a01e72e287a48f8a0b1f003dd5f63b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-composer-slim:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/attachment-refs.test.ts「formatRefsForPlainText（展示层引用简化）」 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「引用标记在摘要与展开正文中简化为文件名」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-composer-slim
  status: active

## FR-daemon-250 配置条移除中断自动续跑开关与运行中提示，入口合并进输入框左侧 + 号菜单并可切换
变更：2026-10-22-session-composer-slim
状态：active
摘要：在 + 菜单切换续跑；终态禁用
全文：.sillyspec/changes/archive/2026-10-22-session-composer-slim/requirements.md#FR-02
最近确认：4d6c17185a01e72e287a48f8a0b1f003dd5f63b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-composer-slim:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx「autoResume 传入 → 菜单渲染勾选项；点击切换并保持菜单打开」 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「配置条无续跑开关与运行中提示（即使旧调用方残留传参也不渲染）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-composer-slim
  status: active

## FR-daemon-251 最右侧模型额度改为紧凑动态小图标，只显示最低剩余百分比，点击弹出完整明细
变更：2026-10-22-session-composer-slim
状态：active
摘要：多供应商多窗口；低额度变色
全文：.sillyspec/changes/archive/2026-10-22-session-composer-slim/requirements.md#FR-03
最近确认：4d6c17185a01e72e287a48f8a0b1f003dd5f63b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-composer-slim:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「智谱 quota 正常 → 图标只显会话供应商首窗口百分比；明细（模型名/各窗口/重置）在浮层」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-composer-slim
  status: active

## FR-daemon-252 桌面与移动端行为一致，附件预览/排队/发送等既有功能不回归
变更：2026-10-22-session-composer-slim
状态：active
摘要：移动端
全文：.sillyspec/changes/archive/2026-10-22-session-composer-slim/requirements.md#FR-04
最近确认：4d6c17185a01e72e287a48f8a0b1f003dd5f63b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-composer-slim:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx「autoResume.disabled（会话结束/离线）→ 禁用且点击不触发」 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx「desktop（缺省 mobile=false）：与 mobile 同形态（图标 + 首窗口百分比），明细点击浮层」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-composer-slim
  status: active

## FR-daemon-253 相关单测与 lint 通过
变更：2026-10-22-session-composer-slim
状态：active
摘要：交付核验
全文：.sillyspec/changes/archive/2026-10-22-session-composer-slim/requirements.md#FR-05
最近确认：4d6c17185a01e72e287a48f8a0b1f003dd5f63b6

## FR-daemon-254 进行中（running/pending/interrupting）轮次底部元信息行只显示「开始 HH:MM:SS · 历时 mm:ss」，无「结束」字样，历时随时间每秒递增
变更：2026-10-23-live-turn-meta-time
状态：active
摘要：进行中轮次底部元信息（主路径）；进行中但数据层仍带 replyAt（防御）；进行中但计时锚点缺失
全文：.sillyspec/changes/archive/2026-10-23-live-turn-meta-time/requirements.md#FR-01
最近确认：475a8da2eec4b9e711dbd43e881244d506a474aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-live-turn-meta-time:flow:测试绑定FR-01
  tests: test/src/components/daemon/__tests__/turn-time-display.test.tsx「进行中轮次：底部元信息只显开始+实时历时，无结束字样（fake timers 走秒递增）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-live-turn-meta-time
  status: active

## FR-daemon-255 轮次完成后该行恢复「开始 · 结束 · 历时」三段（既有行为不变）
变更：2026-10-23-live-turn-meta-time
状态：active
摘要：运行中 → 完成态切换；活跃 run 快照补齐不再伪造 replyAt
全文：.sillyspec/changes/archive/2026-10-23-live-turn-meta-time/requirements.md#FR-02
最近确认：475a8da2eec4b9e711dbd43e881244d506a474aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-live-turn-meta-time:flow:测试绑定FR-02
  tests: test/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「活跃 run 快照（finished_at=null）不再把 replyAt 回退成 started_at」 | test/src/components/daemon/__tests__/turn-time-display.test.tsx「进行中→完成：元信息行切换为开始·结束·历时三段（走秒组件卸载）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-live-turn-meta-time
  status: active

## FR-daemon-256 终态轮（无进行中态）显示零回归，既有 turn-time-display 测试全绿
变更：2026-10-23-live-turn-meta-time
状态：active
摘要：完成轮双锚点（回归锁定）
全文：.sillyspec/changes/archive/2026-10-23-live-turn-meta-time/requirements.md#FR-03
最近确认：475a8da2eec4b9e711dbd43e881244d506a474aa

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-live-turn-meta-time:flow:测试绑定FR-03
  tests: test/src/components/daemon/__tests__/turn-time-display.test.tsx「既有完成轮/仅 replyAt 回退/进度视图用例全绿（零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-live-turn-meta-time
  status: active

## FR-daemon-257 轨道推进改为接近目标时自然减速（缓出），不再线性急停；事件密集时仍能加速追赶
变更：2026-10-23-marquee-motion-polish
状态：active
摘要：单条事件后的推进；事件爆发
全文：.sillyspec/changes/archive/2026-10-23-marquee-motion-polish/requirements.md#FR-01
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-motion-polish:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道速度随距离缓出，接近目标时减速（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-motion-polish
  status: active

## FR-daemon-258 条目内部滚动窗口左右各加约 10px 渐隐遮罩，文本进出柔和；滚动速度维持约 3s 一圈
变更：2026-10-23-marquee-motion-polish
状态：active
摘要：运行中滚动；完成后
全文：.sillyspec/changes/archive/2026-10-23-marquee-motion-polish/requirements.md#FR-02
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-motion-polish:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目渲染 lucide 图标与转圈，文本区带内部滚动（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-motion-polish
  status: active

## FR-daemon-259 容器流光改为更窄、更低对比、带模糊、更慢（不少于 6s）的柔和扫过，消除色块感
变更：2026-10-23-marquee-motion-polish
状态：active
摘要：空闲态
全文：.sillyspec/changes/archive/2026-10-23-marquee-motion-polish/requirements.md#FR-03
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c

## FR-daemon-260 prefers-reduced-motion 下新增动效全部关闭，reduced 静态展示不变
变更：2026-10-23-marquee-motion-polish
状态：active
摘要：减少动态效果
全文：.sillyspec/changes/archive/2026-10-23-marquee-motion-polish/requirements.md#FR-04
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-motion-polish:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-motion-polish
  status: active

## FR-daemon-261 现有跑马灯 22 用例通过，lint / typecheck 通过
变更：2026-10-23-marquee-motion-polish
状态：active
摘要：交付核验
全文：.sillyspec/changes/archive/2026-10-23-marquee-motion-polish/requirements.md#FR-05
最近确认：997f1963fcc327dd57cce4cc431382d1c309270c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-motion-polish:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-motion-polish
  status: active

## FR-daemon-262 git 跟踪的技能目录一律不删除
变更：2026-10-23-skill-prune-git-safe
状态：active
摘要：git 仓正式技能被保护
全文：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/requirements.md#FR-01
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-skill-prune-git-safe:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: git 跟踪目录即使不在 skillRefs 也保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-skill-prune-git-safe
  status: active

## FR-daemon-263 daemon 管理的未跟踪副本仍被裁剪
变更：2026-10-23-skill-prune-git-safe
状态：active
摘要：非 git 工作目录裁剪 daemon 副本
全文：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/requirements.md#FR-02
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-skill-prune-git-safe:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: daemon 库未跟踪副本不在 skillRefs 时被裁剪」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-skill-prune-git-safe
  status: active

## FR-daemon-264 非 git 仓工作目录仅删 daemon 库目录
变更：2026-10-23-skill-prune-git-safe
状态：active
摘要：用户自建目录被保护
全文：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/requirements.md#FR-03
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-skill-prune-git-safe:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: 非 git 目录仅删 daemon 库技能,用户自建目录保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-skill-prune-git-safe
  status: active

## FR-daemon-265 删除条件收敛为三重与
变更：2026-10-23-skill-prune-git-safe
状态：active
摘要：三重与边界；git 跟踪信息不可得时降级安全
全文：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/requirements.md#FR-04
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-skill-prune-git-safe:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: git ls-files 失败按无跟踪信息降级」 | sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: 三重与边界与保留原因日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-skill-prune-git-safe
  status: active

## FR-daemon-266 触及面测试与类型零错
变更：2026-10-23-skill-prune-git-safe
状态：active
摘要：验收门
全文：.sillyspec/changes/archive/2026-10-23-skill-prune-git-safe/requirements.md#FR-05
最近确认：dd0532e5d5ffdcb72e047c5a157a4bf4d4fa786a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-skill-prune-git-safe:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/skill-manager.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-skill-prune-git-safe
  status: active

## FR-daemon-267 inject 时 runId === 当前 currentRunId（mid-turn steering）不得 stale-reset、不得布防看门狗
变更：2026-10-23-watchdog-steering-guard
状态：active
摘要：忙轮 steering 同 runId
全文：.sillyspec/changes/archive/2026-10-23-watchdog-steering-guard/requirements.md#FR-01
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-watchdog-steering-guard:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「mid-turn steering（同 runId）不 stale-reset、不布防看门狗」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-watchdog-steering-guard
  status: active

## FR-daemon-268 stale 判定改用最后轮内事件时间（onMessage 更新），不再用上次 inject 时间
变更：2026-10-23-watchdog-steering-guard
状态：active
摘要：轮内事件新鲜时 inject；onMessage 刷新最后事件时间
全文：.sillyspec/changes/archive/2026-10-23-watchdog-steering-guard/requirements.md#FR-02
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-watchdog-steering-guard:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「轮内事件新鲜时 inject 不触发 stale-reset」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-watchdog-steering-guard
  status: active

## FR-daemon-269 看门狗不得对已经产生过事件的 run 布防
变更：2026-10-23-watchdog-steering-guard
状态：active
摘要：已观测 run 再次 inject；真僵尸轮仍触发
全文：.sillyspec/changes/archive/2026-10-23-watchdog-steering-guard/requirements.md#FR-03
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-watchdog-steering-guard:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「已观测事件的 run 不再布防看门狗」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-watchdog-steering-guard
  status: active

## FR-daemon-270 回归测试：同 runId steering + 静默 90s 不触发；新 runId 真吞消息仍触发
变更：2026-10-23-watchdog-steering-guard
状态：active
摘要：测试矩阵
全文：.sillyspec/changes/archive/2026-10-23-watchdog-steering-guard/requirements.md#FR-04
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-watchdog-steering-guard:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-watchdog-steering-guard
  status: active

## FR-daemon-271 daemon 现有测试与 tsc 通过
变更：2026-10-23-watchdog-steering-guard
状态：active
摘要：验证命令面
全文：.sillyspec/changes/archive/2026-10-23-watchdog-steering-guard/requirements.md#FR-05
最近确认：8e6a6b644c3481a47ec381533ce4422fcc9b64d7

## FR-daemon-272 close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，code/message/hint/raw/reset_at 语义与 daemon model-error/classifier 对齐）
变更：2026-10-24-close-run-quota-fallback
状态：active
摘要：限额错误日志兜底补写（主路径，2026-10-23 实证形态）；result_summary 携带限额文本同样兜底
场景正文：
- 场景：限额错误日志兜底补写（主路径，2026-10-23 实证形态） — Given 一个 running 的交互 run，其日志已落库一行 `channel='stdout'`、内容为 `[ASSISTANT] API Error: Reque；When close_interactive_run 以 is_error=True、error=None、status="error_max_turns" 收口，；Then run.status=="failed" 且 error_code=="interactive_failed"，且 run.error_detail 非空并满足
- 场景：result_summary 携带限额文本同样兜底 — Given 一个 running 的交互 run 且无相关日志行，；When close_interactive_run 以 is_error=True、error=None、result_summary="API Error: Requ；Then run.error_detail 非空且 type=="quota_exceeded"（reset_at 解析失败为 None）。
全文：.sillyspec/changes/archive/2026-10-24-close-run-quota-fallback/requirements.md#FR-01
最近确认：92bbf833e5595acbe7617b6bd61ad6f25c9fc748

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-close-run-quota-fallback:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_quota_error_log_inferred_into_error_detail」 | backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_quota_error_via_result_summary_inferred」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-close-run-quota-fallback
  status: active

## FR-daemon-273 新 daemon 已回传 error 时不覆盖，现行为不变
变更：2026-10-24-close-run-quota-fallback
状态：active
摘要：daemon 回传优先
场景正文：
- 场景：daemon 回传优先 — Given 一个 running 的交互 run，其日志已落库限额错误文本行，；When close_interactive_run 以 is_error=True、error=ModelErrorDTO(type=auth_failed, code；Then run.error_detail["type"]=="auth_failed"（未被日志推断的 quota_exceeded 覆盖），且本次收口不产生 quot
全文：.sillyspec/changes/archive/2026-10-24-close-run-quota-fallback/requirements.md#FR-02
最近确认：92bbf833e5595acbe7617b6bd61ad6f25c9fc748

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-close-run-quota-fallback:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_daemon_error_takes_precedence_over_log_inference」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-close-run-quota-fallback
  status: active

## FR-daemon-274 日志无 API Error 行或不命中限额特征时行为不变（error_detail 保持 NULL，既有兜底文案照旧）
变更：2026-10-24-close-run-quota-fallback
状态：active
摘要：非限额错误不伪造；无任何错误日志行不伪造
场景正文：
- 场景：非限额错误不伪造 — Given 一个 running 的交互 run，其日志已落库 `[ASSISTANT] API Error: 401 invalid api key`（无 429），；When close_interactive_run 以 is_error=True、error=None 收口，；Then run.error_detail 保持 None，error_code=="interactive_failed"，output_redacted 为「本轮执行
- 场景：无任何错误日志行不伪造 — Given 一个 running 的交互 run 且无任何含 "API Error" 的日志行、result_summary=None，；When close_interactive_run 以 is_error=True、error=None 收口，；Then run.error_detail 保持 None，既有兜底文案照旧落 output_redacted。
全文：.sillyspec/changes/archive/2026-10-24-close-run-quota-fallback/requirements.md#FR-03
最近确认：92bbf833e5595acbe7617b6bd61ad6f25c9fc748

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-close-run-quota-fallback:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_no_api_error_log_keeps_legacy_behavior」 | backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_non_quota_api_error_not_inferred」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-close-run-quota-fallback
  status: active

## FR-daemon-275 补 backend 测试覆盖上述分支，既有相关测试不回归
变更：2026-10-24-close-run-quota-fallback
状态：active
摘要：回归面
场景正文：
- 场景：回归面 — When 对 backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py 与新测；Then 全部用例通过。
全文：.sillyspec/changes/archive/2026-10-24-close-run-quota-fallback/requirements.md#FR-04
最近确认：92bbf833e5595acbe7617b6bd61ad6f25c9fc748

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-close-run-quota-fallback:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-close-run-quota-fallback
  status: active

## FR-daemon-276 pi edit 成功结束时从入参合成补丁
变更：2026-10-24-pi-edit-patch-synth
状态：active
摘要：单块替换；多块替换
全文：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/requirements.md#FR-01
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-pi-edit-patch-synth:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「edit 单块合成(行号定位精确)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-pi-edit-patch-synth
  status: active

## FR-daemon-277 pi write 成功结束时合成全新增 hunk
变更：2026-10-24-pi-edit-patch-synth
状态：active
摘要：新建文件
全文：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/requirements.md#FR-02
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-pi-edit-patch-synth:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「write 全新增 hunk 合成」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-pi-edit-patch-synth
  status: active

## FR-daemon-278 失败/超限一律不附着
变更：2026-10-24-pi-edit-patch-synth
状态：active
摘要：定位失败放弃
全文：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/requirements.md#FR-03
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-pi-edit-patch-synth:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/pi-edit-patch-synth.test.ts「失败/形态不符/定位失败/64KB 超限一律不附着」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-pi-edit-patch-synth
  status: active

## FR-daemon-279 弹窗文案区分"agent 改过但无补丁"
变更：2026-10-24-pi-edit-patch-synth
状态：active
摘要：pi 历史轮次（存量无补丁数据）
全文：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/requirements.md#FR-04
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-24-pi-edit-patch-synth:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「agent 编辑过但无补丁的区分文案」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-24-pi-edit-patch-synth
  status: active

## FR-daemon-280 触及面测试与类型零错
变更：2026-10-24-pi-edit-patch-synth
状态：active
摘要：验收门
全文：.sillyspec/changes/archive/2026-10-24-pi-edit-patch-synth/requirements.md#FR-05
最近确认：4d07114b353e26c3c2462eebf3133b4cff03ac55

## FR-daemon-281 processItems 的 system_event 在轨迹账本显示为「上下文」类型行（真实文案与时间锚点，缺锚点用轮首，不伪造）
变更：2026-10-22-trajectory-context-jump
状态：active
摘要：主路径；缺锚点；零回归
场景正文：
- 场景：主路径 — Given 一轮 processItems 含 `system_event`（text="Agent sent a message"，ts=轮中段时刻）；When 打开轨迹
- 场景：缺锚点 — Given `system_event` 无 ts；When 派生；Then 行锚点=该轮首锚点，行不丢失。
- 场景：零回归 — Given 一轮无任何 system_event；When 派生；Then 该轮行集合与改动前完全一致。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-context-jump/requirements.md#FR-01
最近确认：bbe1bbf6ba02b08fa3ef2bf7a5558d94f4d026ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-context-jump:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-context-jump
  status: active

## FR-daemon-282 轨迹视图下点击左侧轮次刻度，账本滚动定位到对应轮次首行并选中（复用 handleJumpToTurn 的轨迹分支）
变更：2026-10-22-trajectory-context-jump
状态：active
摘要：主路径；未加载轮
场景正文：
- 场景：主路径 — Given 轨迹视图 + 多轮会话；When 点击左侧第 N 轮刻度；Then 账本滚动到第 N 轮首行且该行选中（详情面板显示该行）。
- 场景：未加载轮 — Given 目标轮尚未加载（预览态）；When 点击该轮刻度；Then 行为不劣化——预览轮本就不进轨迹（既有 D-006 语义），定位跳过该轮不报错。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-context-jump/requirements.md#FR-02
最近确认：bbe1bbf6ba02b08fa3ef2bf7a5558d94f4d026ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-context-jump:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-context-jump
  status: active

## FR-daemon-283 点击时间线条块或键盘 ↑/↓ 移动选中时，账本自动把选中行滚入视野
变更：2026-10-22-trajectory-context-jump
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 账本已滚出选中行视口；When 点击时间线某条块；Then 对应行被选中且滚回视野。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-context-jump/requirements.md#FR-03
最近确认：bbe1bbf6ba02b08fa3ef2bf7a5558d94f4d026ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-trajectory-context-jump:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-trajectory-context-jump
  status: active

## FR-daemon-284 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0
变更：2026-10-22-trajectory-context-jump
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑轨迹目录与会话面板相关测试与 tsc；Then 全部通过。
全文：.sillyspec/changes/archive/2026-10-22-trajectory-context-jump/requirements.md#FR-04
最近确认：bbe1bbf6ba02b08fa3ef2bf7a5558d94f4d026ff

## FR-daemon-285 会话当前变更存在 sillyspec 工作树时（标准目录布局且未清理），指示项显示该工作树的分支与目录（经 stat 探测命中，root 取工作树路径）
变更：2026-10-25-session-git-worktree-root
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-25-session-git-worktree-root/requirements.md#FR-01
最近确认：02a41abacd68fef103b96a0e005733cccc0566bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-git-worktree-root:flow:测试绑定FR-01
  tests: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_prefers_active_sillyspec_worktree」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-git-worktree-root
  status: active

## FR-daemon-286 无工作树/已清理/探测失败的会话行为与现状一致（落回 cwd→绑定根链，空态照旧）
变更：2026-10-25-session-git-worktree-root
状态：active
摘要：回退形态
全文：.sillyspec/changes/archive/2026-10-25-session-git-worktree-root/requirements.md#FR-02
最近确认：02a41abacd68fef103b96a0e005733cccc0566bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-git-worktree-root:flow:测试绑定FR-02
  tests: backend/tests/modules/daemon/test_session_git_status.py「test_git_status_no_change_anchor_skips_probe」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-git-worktree-root
  status: active

## FR-daemon-287 响应新增 root_source 字段标识根来源，前端在工作树形态给出可见标识
变更：2026-10-25-session-git-worktree-root
状态：active
摘要：前端标识
全文：.sillyspec/changes/archive/2026-10-25-session-git-worktree-root/requirements.md#FR-03
最近确认：02a41abacd68fef103b96a0e005733cccc0566bc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-git-worktree-root:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「shows worktree badge when root_source is worktree」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-git-worktree-root
  status: active

## FR-daemon-288 explorer 文件树 git 状态着色
变更：2026-10-25-explorer-git-status
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v2、D-005@v1、D-007@v1、D-008@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given 用户已绑定本机工作区且 daemon 在线，工作区为 git 仓库；When 用户进入工作区「文件」页；Then 文件树文件名按 git 状态着色——新增/新文件=绿（success）、修改=蓝（primary）、忽略=灰（muted）；含改动的祖先目录名旁显示蓝点；忽略条
全文：.sillyspec/changes/archive/2026-10-25-explorer-git-status/requirements.md#FR-01
最近确认：19783ad99

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-explorer-git-status:task-01:acc-0-30c9c743
  tests: sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-01:acc-1-2fab0eb7
  tests: sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-01:acc-2-54b853a8
  tests: sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-07:acc-0-0bea604f
  tests: frontend/src/components/explorer/__tests__/file-explorer.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active

## FR-daemon-289 Git 日志页「工作区更改」修改文件集合卡
变更：2026-10-25-explorer-git-status
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-003@v2、D-007@v1、D-009@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given 同上；When 用户进入工作区「Git 日志」页；Then 在状态条下方展示「工作区更改」卡：按 IDEA 分组（更改 / 未纳入版本管理 / 已忽略聚合）展示改动文件目录树，文件行四色 + 增删行数（untracked
全文：.sillyspec/changes/archive/2026-10-25-explorer-git-status/requirements.md#FR-02
最近确认：19783ad99

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-explorer-git-status:task-04:acc-0-cbca0911
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-04:acc-1-1ff449eb
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-04:acc-2-62e9a76c
  tests: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-06:acc-0-4840f065
  tests: frontend/src/components/git-log/__tests__/git-log-page.test.tsx | frontend/src/components/git-log/__tests__/git-status-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-06:acc-1-bad39a8b
  tests: frontend/src/components/git-log/__tests__/git-log-page.test.tsx | frontend/src/components/git-log/__tests__/git-status-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active

## FR-daemon-290 文件级「工作区 vs 最近一次提交」diff 弹窗
变更：2026-10-25-explorer-git-status
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 用户在「工作区更改」卡点击任一文件行；When 弹窗打开；Then 展示该文件工作区内容与最近一次提交（HEAD）的 unified diff（红删绿增，64KB 截断提示，二进制提示）；基线一律 HEAD 不分暂存组（D-00
全文：.sillyspec/changes/archive/2026-10-25-explorer-git-status/requirements.md#FR-03
最近确认：19783ad99

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-explorer-git-status:task-05:acc-0-e274185c
  tests: frontend/src/components/git-log/__tests__/file-tree.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-05:acc-1-7b7453f6
  tests: frontend/src/components/git-log/__tests__/file-tree.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active

## FR-daemon-291 后端只读端点与降级
变更：2026-10-25-explorer-git-status
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 任意持有 WORKSPACE_READ 权限的用户；When 调用 `GET /workspaces/{wid}/git-log/dirty-files` 或 `GET /workspaces/{wid}/git-log/；Then 正常时返回文件清单（path/status/additions/deletions/binary）+ 忽略聚合条目，或 diff 文本（status/trunc
全文：.sillyspec/changes/archive/2026-10-25-explorer-git-status/requirements.md#FR-04
最近确认：19783ad99

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-explorer-git-status:task-02:acc-0-6d298736
  tests: backend/tests/modules/git_log/__init__.py | backend/tests/modules/git_log/test_git_log_dirty_files.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-02:acc-1-e87ec008
  tests: backend/tests/modules/git_log/__init__.py | backend/tests/modules/git_log/test_git_log_dirty_files.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active
- row: 2026-10-25-explorer-git-status:task-02:acc-2-4a05ca50
  tests: backend/tests/modules/git_log/__init__.py | backend/tests/modules/git_log/test_git_log_dirty_files.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active

## FR-daemon-292 类型产物同批再生成
变更：2026-10-25-explorer-git-status
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given backend DTO schema 有新增（GitDirtyFilesResponse 等 4 个）；When 本变更收口提交；Then `backend/openapi.json`、`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-
全文：.sillyspec/changes/archive/2026-10-25-explorer-git-status/requirements.md#FR-05
最近确认：19783ad99

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-explorer-git-status:task-03:acc-2-7da9d193
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 3615228c11a82dc5cb5689c5157e95ccf015cca9
  source_change: 2026-10-25-explorer-git-status
  status: active

## FR-daemon-293 转发段阶段发布（backend 自产，零 daemon 依赖）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-011@v1
场景正文：
- 场景：默认场景 — Given 用户在会话发送消息（create/inject 均适用），backend 已创建控制指令；When 控制指令下发 WS 成功（dispatched）/ daemon ack 回执到达（delivered——以 daemon 真实确认为准，非 mark_deli；Then backend 分别向 `agent_session:{id}` 发布 `phase=dispatched` / `phase=delivered` 的 `tu
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-01
最近确认：cf17c6a9f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-stage-progress:task-01:acc-0-5a1412ca
  tests: backend/app/modules/daemon/tests/test_turn_phase_events.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-01:acc-1-d20a55b0
  tests: backend/app/modules/daemon/tests/test_turn_phase_events.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-01:acc-2-bdca2a72
  tests: backend/app/modules/daemon/tests/test_turn_phase_events.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-01:acc-3-1ed8f1d6
  tests: backend/app/modules/daemon/tests/test_turn_phase_events.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-05:acc-0-eb04719c
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-05:acc-2-2757ebe1
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active

## FR-daemon-294 启动准备段阶段上报（daemon → backend 新端点）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-013@v1
场景正文：
- 场景：默认场景 — Given daemon 领取租约开始创建交互式会话（新会话首轮），run_id 已定（firstRunId 恒非空）；When skills 链接 / spec 拉取 / MCP 预取 / AI 进程启动 / 就绪五个步骤边界到达（SWR 命中跳过的步骤不发事件）；Then daemon 经 `POST /api/daemon/sessions/{session_id}/turn-phase` 上报（run_id 必填）；任一上报失
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-02
最近确认：cf17c6a9f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-stage-progress:task-02:acc-0-932bc7f4
  tests: sillyhub-daemon/tests/turn-phase-report.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-02:acc-1-616d9f08
  tests: sillyhub-daemon/tests/turn-phase-report.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-02:acc-2-3c5a1c25
  tests: sillyhub-daemon/tests/turn-phase-report.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-02:acc-3-ac91886b
  tests: sillyhub-daemon/tests/turn-phase-report.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active

## FR-daemon-295 轮内段阶段上报（daemon）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-013@v1
场景正文：
- 场景：默认场景 — Given 消息注入既有会话（追问轮）或 AI 产出首个事件；When InputQueue push 完成 / onMessage 撤看门狗处；Then daemon 分别上报 `inject_received` / `first_event`；`first_event` 每轮至多一次（防重键 `(session
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-03
最近确认：cf17c6a9f

## FR-daemon-296 状态条阶段文案（frontend 消费与展示）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1、D-010@v1、D-012@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 会话面板运行中轮收到 `turn_phase` 事件（词表 9 值，含 backend 发布的 `dispatched`/`delivered`；payload；When 事件按 run 归属路由到当前轮（缺失/null run_id 的事件防御性丢弃；at=本地到达时刻 Date.now()）；Then 状态条状态标签位显示词表对应中文文案（`PHASE_LABEL` 映射），替代笼统「排队中/执行中」；`first_event` 之后标签退位、右侧活动摘要接管
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-04
最近确认：cf17c6a9f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-stage-progress:task-03:acc-0-fa612601
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-03:acc-1-b2df4660
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-03:acc-2-d7e99587
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-03:acc-3-ae31b33b
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-04:acc-0-80d4f0e3
  tests: frontend/src/components/daemon/__tests__/turn-time-display.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-04:acc-1-c0c2a91a
  tests: frontend/src/components/daemon/__tests__/turn-time-display.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-04:acc-2-22a10eeb
  tests: frontend/src/components/daemon/__tests__/turn-time-display.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-04:acc-3-f6a78f98
  tests: frontend/src/components/daemon/__tests__/turn-time-display.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active

## FR-daemon-297 阶段超时警示（frontend 本地计时）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 当前轮存在 `currentPhase` 且未到 `first_event` 退位；When 当前阶段停留时长 ≥ 30 秒（前端常量，每秒 tick 判定）；Then 状态条整条切警示样式（warning token 边框/底色/文字）并追加「已等待 N 秒」；不弹窗、不阻断正常阶段推进展示
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-05
最近确认：cf17c6a9f

## FR-daemon-298 事件协议与类型同步
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-012@v1
场景正文：
- 场景：默认场景 — Given `TurnPhaseReportRequest` DTO 进入 OpenAPI；When 后端 schema 变更落库；Then 同一变更内跑 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` 并提交两处 api-types；前端
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-06
最近确认：cf17c6a9f

## FR-daemon-299 等待交互轮判死豁免（backend 复扫链，2026-10-26 生产实证补录）
变更：2026-10-26-session-stage-progress
状态：active
摘要：默认场景
依据决策：D-014@v1
场景正文：
- 场景：默认场景 — When 复扫链 `_recheck_deferred_runs` 对该轮执行判死评估（日志停滞超宽限窗，且 daemon 活性门为 False 或 None——含生产实；Then 豁免判死，保持 running 并继续追踪等待真终态；超 24h 上限或无 askwait 信号的轮回落既有判死路径（SERVICE_RESTART_INTER
全文：.sillyspec/changes/archive/2026-10-26-session-stage-progress/requirements.md#FR-07
最近确认：cf17c6a9f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-stage-progress:task-06:acc-0-7491724d
  tests: backend/tests/modules/agent/test_stale_run_recheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-06:acc-1-d012cca6
  tests: backend/tests/modules/agent/test_stale_run_recheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active
- row: 2026-10-26-session-stage-progress:task-06:acc-2-bd2be69e
  tests: backend/tests/modules/agent/test_stale_run_recheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: b377bb75bbb0c4bf603e59b2bcd5d009a8f21276
  source_change: 2026-10-26-session-stage-progress
  status: active

## FR-daemon-300 生产会话轮内 inject_received/first_event 阶段事件实际到达前端(生产会话验证,状态条翻动)
变更：2026-10-26-turn-phase-prod-fix
状态：active
摘要：恢复会话后续轮（生产实证形态）
场景正文：
- 场景：恢复会话后续轮（生产实证形态） — Given 一个经 daemon 重启恢复的活跃会话（生产会话 221ac351 同形态）；When 用户发送一条新消息；Then 状态条必须在合理时延内离开「执行器已接收」档（经 inject_received/first_event 推进或退位到活动摘要），agent 日志流照常（主消息
全文：.sillyspec/changes/archive/2026-10-26-turn-phase-prod-fix/requirements.md#FR-01
最近确认：f8d6db60af6d40416709c57f4719802dbc28ace5

## FR-daemon-301 断点根因定位并修复(有代码修复,非仅绕过)
变更：2026-10-26-turn-phase-prod-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-turn-phase-prod-fix/requirements.md#FR-02
最近确认：f8d6db60af6d40416709c57f4719802dbc28ace5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-turn-phase-prod-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/turn-phase-observability.test.ts「上报链路触发」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-turn-phase-prod-fix
  status: active

## FR-daemon-302 上报可观测:失败首次 warn 留痕(不再静默黑盒),成功路径可通过配置观测
变更：2026-10-26-turn-phase-prod-fix
状态：active
摘要：上报失败；观测开关
场景正文：
- 场景：上报失败 — Given daemon POST turn-phase 收到非 2xx 或网络异常；When 上报失败首次发生；Then 必须记 warn 一条；同 session+phase 的再次失败禁止重复 warn
- 场景：观测开关 — Given 环境变量 SILLYHUB_TURN_PHASE_TRACE=1；When 阶段上报成功；Then 必须记 info（phase+run_id）；开关关闭时成功必须零日志（现状保持）
全文：.sillyspec/changes/archive/2026-10-26-turn-phase-prod-fix/requirements.md#FR-03
最近确认：f8d6db60af6d40416709c57f4719802dbc28ace5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-turn-phase-prod-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/turn-phase-observability.test.ts「失败首次 warn+去重/TRACE 开关 info/默认成功静默」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-turn-phase-prod-fix
  status: active

## FR-daemon-303 backend 网络环境 NAT 场景(observed IP 不在任何网卡网段)文案不再自相矛盾:低置信标注与地址建议并存时删「拼地址信息不可用」断言,该断言仅在真无网卡数据时出现
变更：2026-10-26-turn-phase-prod-fix
状态：active
摘要：NAT 出口（生产实证形态：observed=112.2.37.34 公网、网卡=10.10.128.145/172.23.144.1 内网）；无网卡数据（保持现状）
场景正文：
- 场景：NAT 出口（生产实证形态：observed=112.2.37.34 公网、网卡=10.10.128.145/172.23.144.1 内网） — Given 机器 observed_ip 为公网地址且 interfaces 非空、无一网卡网段包含 observed_ip；When 渲染【网络环境】段该机器行；Then 必须含低置信标注与「访问地址建议用 …（多网卡未定，候选：…）」；禁止出现「拼地址信息不可用」
- 场景：无网卡数据（保持现状） — Given 机器 interfaces 为空；When 渲染该机器行；Then 「无可用 IPv4 地址」/信息不足类断言必须保留（不得因本变更丢失）
全文：.sillyspec/changes/archive/2026-10-26-turn-phase-prod-fix/requirements.md#FR-04
最近确认：f8d6db60af6d40416709c57f4719802dbc28ace5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-turn-phase-prod-fix:flow:测试绑定FR-04
  tests: backend/tests/modules/daemon/test_network_context.py「NAT 场景禁『拼地址信息不可用』+候选在/无网卡数据态断言保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-turn-phase-prod-fix
  status: active

## FR-daemon-304 send 超时逐出与异常逐出路径均对旧 socket 主动 close（code=4000），daemon 侧可感知断线并重连
变更：2026-10-26-ws-evict-close
状态：active
摘要：超时逐出触发主动关闭；异常逐出触发主动关闭；close 本身失败不反噬逐出
场景正文：
- 场景：超时逐出触发主动关闭 — Given 某 daemon 连接已注册且其 `send_json` 抛 `TimeoutError`，When `send_to_runtime` 执行完毕，Then 返
- 场景：异常逐出触发主动关闭 — Given 某 daemon 连接已注册且其 `send_json` 抛一般异常（如 `RuntimeError`），When `send_to_runtime` 执行完毕
- 场景：close 本身失败不反噬逐出 — Given 被逐出 ws 的 `close` 方法抛异常，When 逐出路径执行完毕，Then 异常被吞掉（不向上传播）、逐出结果与既有语义完全一致。
全文：.sillyspec/changes/archive/2026-10-26-ws-evict-close/requirements.md#FR-01
最近确认：97d4780904d3f99be61dc78d641f6e34ee291707

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-ws-evict-close:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_close_failure_does_not_break_eviction」 | backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_evicted_socket_gets_closed_on_send_error」 | backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_evicted_socket_gets_closed_on_timeout」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-ws-evict-close
  status: active

## FR-daemon-305 逐出 close 仅作用于被逐出的旧连接对象，不误伤并发重连的新连接（对象身份校验）
变更：2026-10-26-ws-evict-close
状态：active
摘要：身份校验放过新连接
场景正文：
- 场景：身份校验放过新连接 — Given 路由表中某 daemon_id 的连接已被 new_ws 替换，When 以 old_ws 触发 `_evict_stale`，Then 返回 False、ne
全文：.sillyspec/changes/archive/2026-10-26-ws-evict-close/requirements.md#FR-02
最近确认：97d4780904d3f99be61dc78d641f6e34ee291707

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-ws-evict-close:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_ws_hub.py「TestSlowConnectionEviction::test_evict_identity_check_spares_reconnected_new_socket」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-ws-evict-close
  status: active

## FR-daemon-306 现有 ws_hub 相关测试全绿
变更：2026-10-26-ws-evict-close
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 既有 ws_hub 四个测试文件，When 全量执行，Then 全部用例通过、无新增失败。
全文：.sillyspec/changes/archive/2026-10-26-ws-evict-close/requirements.md#FR-03
最近确认：97d4780904d3f99be61dc78d641f6e34ee291707

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-ws-evict-close:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_ws_hub.py | backend/app/modules/daemon/tests/test_ws_hub_permission.py | backend/app/modules/daemon/tests/test_ws_hub_policy.py | backend/app/modules/daemon/tests/test_ws_hub_session_control.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-ws-evict-close
  status: active

## FR-daemon-307 agent 正文手机端真满宽：.seg-text-body 限宽 mobile 100%(globals.css 压 calc(100%-120px))，轮过程区缩进 mobile 36+14px→12+8px，desktop 阅读限宽原样保留
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-01
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

## FR-daemon-308 轮次分隔 mobile 轻量化：去胶囊框(边框/底色/阴影/毛玻璃)改纯文字+两侧细线，desktop 形态不变
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-02
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round2:flow:测试绑定FR-02
  tests: frontend/src/components/chat/__tests__/round-divider.test.tsx「mobile=true：胶囊允许收缩折行（去 shrink-0/nowrap）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round2
  status: active

## FR-daemon-309 输入区 mobile 收纳：行尾用量徽章(CtxUsageBar 插槽)mobile 不渲染(功能仍在头部 ⋯ 菜单 ql-20260915-011)，desktop 照旧
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-03
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round2:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round2
  status: active

## FR-daemon-310 悬浮元素玻璃化：TabBar 胶囊/FAB/移动顶栏 bg-card/75+backdrop-blur-md，PC 端同步=会话悬浮窗体(session-panel-page 输入区外框除外——非悬浮层无穿行内容)玻璃化——用户原话授权 PC 同步
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-04
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round2:flow:测试绑定FR-04
  tests: frontend/src/components/mobile/mobile-tab-bar.test.tsx「悬浮胶囊形态（quick-a4939946 + visual-round2 玻璃效果）：胶囊容器圆角+玻璃半透明+离底占位」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round2
  status: active

## FR-daemon-311 顶部执行信息与本地 Agent 日志 mobile 收进 ⋯ 菜单（用户原话「参考 pc 端，放进按钮里点击再显示」）：两面板默认不渲染，菜单开关控制，开即挂载
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-05
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round2:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round2
  status: active

## FR-daemon-312 相关测试面全绿(tab-bar 玻璃契约用例更新/round-divider/session-config-bar/session-panel-variant/page.m-session-chat 零回归)
变更：2026-10-27-mobile-chat-visual-round2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round2/requirements.md#FR-06
最近确认：a758f2707ab5d0ddade35f7fdd7bb1de93dbb25d

## FR-daemon-313 会话面板 dialog 与 page 两模式创建定时消息时，输入框已上传附件的 id 随请求体 attachment_ids 携带
变更：2026-10-27-scheduled-send-attachments
状态：active
摘要：带附件创建定时消息；无附件创建定时消息（零回归）
全文：.sillyspec/changes/archive/2026-10-27-scheduled-send-attachments/requirements.md#FR-01
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-scheduled-send-attachments:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时创建请求携带附件 id」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-scheduled-send-attachments
  status: active

## FR-daemon-314 定时消息创建成功后，输入框附件 chips 与附件元数据镜像同步清空（与文本草稿清空同口径）
变更：2026-10-27-scheduled-send-attachments
状态：active
摘要：创建成功清附件；创建失败保留现场
全文：.sillyspec/changes/archive/2026-10-27-scheduled-send-attachments/requirements.md#FR-02
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-scheduled-send-attachments:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时创建成功后清空附件 chips 与元数据镜像」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-scheduled-send-attachments
  status: active

## FR-daemon-315 定时发送弹窗在携带附件时展示附件预览列表，让用户可见附件将随消息发送
变更：2026-10-27-scheduled-send-attachments
状态：active
摘要：弹窗附件预览；无附件弹窗不占位
全文：.sillyspec/changes/archive/2026-10-27-scheduled-send-attachments/requirements.md#FR-03
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-scheduled-send-attachments:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「定时弹窗展示附件预览列表」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-scheduled-send-attachments
  status: active

## FR-daemon-316 带附件时允许空文本创建定时消息（对齐普通发送 D-7 看图说话口径），空文本且无附件仍禁用确认
变更：2026-10-27-scheduled-send-attachments
状态：active
摘要：附件豁免空文本；空文本无附件仍禁用
全文：.sillyspec/changes/archive/2026-10-27-scheduled-send-attachments/requirements.md#FR-04
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-scheduled-send-attachments:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx「带附件空文本可创建定时消息」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-scheduled-send-attachments
  status: active

## FR-daemon-317 更新/新增前端测试覆盖定时创建携带附件断言，相关测试与 lint 通过
变更：2026-10-27-scheduled-send-attachments
状态：active
摘要：测试与 lint 全绿
全文：.sillyspec/changes/archive/2026-10-27-scheduled-send-attachments/requirements.md#FR-05
最近确认：c2d6111ec3d0c98ee7bd96054eaa91fc0a24f734

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-scheduled-send-attachments:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog-scheduled-attachments.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-scheduled-send-attachments
  status: active

## FR-daemon-318 会话列表统计显示服务端真实总数（total），不再被 500 拉取上限截断
变更：2026-10-27-sessions-total-and-status-filter
状态：active
摘要：总数超过拉取上限
全文：.sillyspec/changes/archive/2026-10-27-sessions-total-and-status-filter/requirements.md#FR-01
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-sessions-total-and-status-filter:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_session_history.py「status_counts 五态之和 = 真实总数（>limit 拉取上限场景）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-sessions-total-and-status-filter
  status: active

## FR-daemon-319 状态筛选统一为四档：全部/在线（原运行中·活跃）/已结束/失败，各档带真实计数（服务端口径）
变更：2026-10-27-sessions-total-and-status-filter
状态：active
摘要：chips 计数不受当前档位影响；在线档过滤为三态聚合
全文：.sillyspec/changes/archive/2026-10-27-sessions-total-and-status-filter/requirements.md#FR-02
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-sessions-total-and-status-filter:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_session_history.py「status_group=ongoing 三态命中 + status 与 status_group 同传 422」 | frontend/src/components/mobile/mobile-session-list.test.tsx「四 chips 渲染服务端计数且切档计数不漂移」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-sessions-total-and-status-filter
  status: active

## FR-daemon-320 手机端默认只展示最新 10 条会话，且所有在线会话不限 10 条全部展示
变更：2026-10-27-sessions-total-and-status-filter
状态：active
摘要：在线会话超出默认条数
全文：.sillyspec/changes/archive/2026-10-27-sessions-total-and-status-filter/requirements.md#FR-03
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-sessions-total-and-status-filter:flow:测试绑定FR-03
  tests: frontend/src/components/mobile/mobile-session-list.test.tsx「默认 10 条 + 在线全显 + 显示全部展开」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-sessions-total-and-status-filter
  status: active

## FR-daemon-321 后端 list_sessions 响应附 status_counts 分状态计数（与 total 同口径），前端与 daemon 类型同步再生成
变更：2026-10-27-sessions-total-and-status-filter
状态：active
摘要：status 与 status_group 互斥
全文：.sillyspec/changes/archive/2026-10-27-sessions-total-and-status-filter/requirements.md#FR-04
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-sessions-total-and-status-filter:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_session_history.py | frontend/src/components/mobile/mobile-session-list.test.tsx「消费再生成类型渲染统计行」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-sessions-total-and-status-filter
  status: active

## FR-daemon-322 触及 src/test 的改动相关单测通过且 lint 无新增错误
变更：2026-10-27-sessions-total-and-status-filter
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-sessions-total-and-status-filter/requirements.md#FR-05
最近确认：9c86c078c5c3d91ea63cd439d1137a079a07a6a7

## FR-daemon-323 daemon 解析后台任务终态信号并上报
变更：2026-10-28-bg-task-status-report
状态：active
摘要：主路径；格式漂移降级
全文：.sillyspec/changes/archive/2026-10-28-bg-task-status-report/requirements.md#FR-01
最近确认：af1edd441

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-bg-task-status-report:task-01:acc-0-fd0e499f
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-01:acc-1-e07dcbf3
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-02:acc-0-08ae6b7e
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-02:acc-1-fa1f4184
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-02:acc-2-cc0beb2f
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-03:acc-0-dac009a5
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-03:acc-1-26c7a293
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-03:acc-2-23d66a4b
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active

## FR-daemon-324 backend 事件模型扩展与 SSE 透传
变更：2026-10-28-bg-task-status-report
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-bg-task-status-report/requirements.md#FR-02
最近确认：af1edd441

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-bg-task-status-report:task-04:acc-0-271e34c6
  tests: backend/app/modules/daemon/tests/test_session_bg_task_final.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-04:acc-1-a9889c7e
  tests: backend/app/modules/daemon/tests/test_session_bg_task_final.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-04:acc-2-f84f3f92
  tests: backend/app/modules/daemon/tests/test_session_bg_task_final.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active

## FR-daemon-325 前端条目终态翻转
变更：2026-10-28-bg-task-status-report
状态：active
摘要：主路径；旧 daemon 兼容
全文：.sillyspec/changes/archive/2026-10-28-bg-task-status-report/requirements.md#FR-03
最近确认：af1edd441

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-bg-task-status-report:task-05:acc-0-2a84e0ee
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-05:acc-1-a6c3938e
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-05:acc-2-40093977
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active

## FR-daemon-326 会话空闲期后台任务运行中计数
变更：2026-10-28-bg-task-status-report
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-bg-task-status-report/requirements.md#FR-04
最近确认：af1edd441

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-bg-task-status-report:task-06:acc-0-ceb65083
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-06:acc-1-818389cf
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active
- row: 2026-10-28-bg-task-status-report:task-06:acc-2-fcce7941
  tests: frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-bg-task-status-report
  status: active

## FR-daemon-327 三侧测试与兼容零回归
变更：2026-10-28-bg-task-status-report
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-28-bg-task-status-report/requirements.md#FR-05
最近确认：af1edd441

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-bg-task-status-report:task-07:acc-0-6ad601bb
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_spec_binding.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: af1edd44187856b8fe330d398bba246225796c4c
  source_change: 2026-10-28-bg-task-status-report
  status: active

## FR-daemon-328 daemon 三引擎心跳源——长操作期间按引擎能力产出实时心跳
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景；Claude 大文件写入；zcode 遥测工具参数增量（spike 结论）
场景正文：
- 场景：默认场景 — Given 会话轮内模型正在生成工具参数（如写大文件）或等待首包；When Claude（input_json_delta 字符计数）/ codex（token_usage_updated 权威值）/ zcode（遥测 tool_inp；Then daemon **必须**节流 1s 产出一条 turn_heartbeat 心跳消息（kind ∈ awaiting_first_token/generati
- 场景：Claude 大文件写入 — Given Claude 引擎模型正在流式生成 Edit 大参数（input_json_delta 持续到达）；Then 每秒至多一条心跳（kind=generating, estimated, est_chars 累计），轮结束清零
- 场景：zcode 遥测工具参数增量（spike 结论） — Given spike 查实 2026-10-15 协议实测钉板的 v4/telemetry kind 枚举含 tool_input_delta（工具参数流式增量）；Then zcode 心跳直接消费该 kind 字符增量（estimated），原「chunkLength 折算 + 不覆盖则降级脉冲」构想废弃（信号不涨即无心跳，前端自
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-01
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-29-engine-live-perception:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts「input_json_delta 心跳计数/节流/轮收尾清零」 | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts「token_usage_updated 桥接心跳」 | sillyhub-daemon/tests/interactive/zcode-events.test.ts「tool_input_delta 心跳增量与字段缺失无信号」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-29-engine-live-perception
  status: active

## FR-daemon-329 backend 心跳端点不落库直发 + 三端键名逐字对齐
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景；心跳不膨胀日志表
场景正文：
- 场景：默认场景 — Given daemon 经 onTurnMessage 鸭子消息上报 turn_heartbeat_report；When daemon.ts 拦截并 POST turn-heartbeat 端点（照抄 turn_phase 先例）；Then backend notify 端点（越权防护照抄 notify_turn_phase）**必须**经 Redis SSE 直发前端且**禁止**落库 Agent
- 场景：心跳不膨胀日志表 — When 心跳以 1s/条持续 5 分钟（长会话）；Then AgentRunLog 表零新增行，SSE 正常收到每条心跳
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-02
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-29-engine-live-perception:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_turn_heartbeat_events.py「turn_heartbeat SSE 直发不落库」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-29-engine-live-perception
  status: active

## FR-daemon-330 前端等待三态 + 估算补显 + main 优先选主
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景；估算与权威值区分；主/子代理并发
场景正文：
- 场景：默认场景 — Given 轮内跑马灯等待条目渲染（最新真实条目非 running）；When 心跳状态到达（main 心跳）或无心跳；Then 等待条目**必须**呈现三态——无心跳=「等待模型响应 · Ns」（现状不变）；awaiting_first_token=「正在等待模型响应 · 已发送上下文」
- 场景：估算与权威值区分 — Given generating 心跳持续（est_tokens=12000）；Then 显示「已产出约 12,000 token」（灰），段落结束权威 ↓54,160 更新后估算补显消失
- 场景：主/子代理并发 — Given 主 agent 与子代理同时长操作（两路心跳并发）；Then 主会话跑马灯只显示 main 心跳，子代理卡片显示子代理心跳，互不抖动
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-03
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-29-engine-live-perception:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「等待三态与估算补显（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-29-engine-live-perception
  status: active

## FR-daemon-331 估算值零污染聚合
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景；预算切断阈值不受心跳影响
场景正文：
- 场景：默认场景 — Given 心跳消息流经 daemon 事件通道与 backend；Then 估算值/心跳**禁止**进入 usage 台账（liftSessionUsage）、预算软切断、计费聚合、ctx 环与 tok/s 分子——既有 usage 消
- 场景：预算切断阈值不受心跳影响 — Given 心跳持续产出 est_tokens 累计值；Then aggregateSessionUsage/checkBudgetCutoff 输入与无心跳时完全一致
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-04
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-29-engine-live-perception:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts「心跳消息不进 usage 台账聚合」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-29-engine-live-perception
  status: active

## FR-daemon-332 无心跳兼容回退（brownfield）
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景；旧 daemon 会话
场景正文：
- 场景：默认场景 — Given 旧 daemon / 历史会话 / 心跳链路任一环失败；Then 前端无心跳状态**必须**回落现状纯计时等待条目（FR-frontend-064 行为零回归）；心跳刷新 lastEventAt **禁止**（语义=最后真实内
- 场景：旧 daemon 会话 — Given daemon 未升级（无 turn_heartbeat SSE 事件）；Then 等待条目行为与本变更前完全一致
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-05
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-29-engine-live-perception:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「无心跳 → 现状纯计时文案（零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-29-engine-live-perception
  status: active

## FR-daemon-333 测试与静态检查全绿
变更：2026-10-29-engine-live-perception
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更落地
全文：.sillyspec/changes/archive/2026-10-29-engine-live-perception/requirements.md#FR-06
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
