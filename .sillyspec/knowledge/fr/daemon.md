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
  tests: test/sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「快速连续切换 ×20 → 落盘最终必为最后一次值（2026-10-09 竞态回归：串行链）」
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
  tests: test/sillyhub-daemon/tests/daemon-status-root-persistence.test.ts「切换 root → 落盘覆盖为最新值（既有用例转稳定；红证=旧码 CI run 37862831833 实跑红 + 本地 3 跑 1 红）」
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
