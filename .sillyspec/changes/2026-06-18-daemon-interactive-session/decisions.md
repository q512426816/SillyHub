---
author: qinyi
created_at: 2026-06-18T13:40:53
---

# 决策台账 — daemon-interactive-session

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 交互式会话实体命名 AgentSession

- type: term
- status: accepted
- source: code（术语碰撞识别）
- question: 代码现有 claude `session_id`（agent 内部）、`AgentRun.session_id`（quick-chat resume 用），新引入的"交互式会话"实体如何命名以避免碰撞？
- answer: 新实体命名 `AgentSession`（表 `agent_sessions`）；agent 内部会话 id（claude session_id / codex thread_id）存 `AgentSession.agent_session_id`；AgentRun 新增 FK 字段命名 `agent_session_id`，**不改动**现有 `AgentRun.session_id`（保留 claude resume 语义）。
- normalized_requirement: 新表名 `agent_sessions`；AgentRun→agent_sessions 的 FK 字段名必须为 `agent_session_id`，不得复用 `session_id`。
- impacts: [design §8.1, §8.3, R-05, task数据模型迁移]
- evidence: `backend/app/modules/agent/model.py` AgentRun.session_id 现有字段；`backend/app/main.py:141-158` quick-chat 用 session_id 做 resume
- priority: P2

## D-002@v1: 1 AgentSession = 1 长生命周期 lease，多 turn 复用 spawn 进程

- type: architecture
- status: superseded
- source: user（Q2 选择"session 作为 lease 上层"）+ explore（"agent 子进程即会话载体"）
- question: 交互式 session 与现有批处理 lease 怎么共存？session 的执行模型形态？
- answer: 1 AgentSession 对应 1 长生命周期 DaemonTaskLease（`kind=interactive`），多 turn 复用同一 spawn 进程（task-runner result 不 end stdin）；每 turn 一个 AgentRun（复用 AgentRunLog/SSE/resume_token 链路）。批处理 lease（`kind=batch`）保持原生命周期不变，用 kind 字段隔离两条路径。
- normalized_requirement: daemon_task_leases 增加 `kind` 字段（batch/interactive，默认 batch）；interactive lease 不进现有 `handle_lease_expiry` expire 回收；task-runner 按 kind 分流。
- impacts: [design §5, §8.2, R-04, R-06, task Wave1核心]
- evidence: `backend/app/modules/daemon/model.py` DaemonTaskLease（agent_run_id 1:1）；`sillyhub-daemon/src/task-runner.ts:721-751` stdin 写入点
- priority: P0

## D-002@v2: 1 AgentSession = 1 长生命周期 lease，每 turn 独立 spawn + resume

- type: architecture
- status: superseded（2026-06-18 由 D-002@v3 取代：spike-02 两硬门 H1/H2 通过，见 spike-02 §3.7；task-03 蓝图按 v3 重做，v2 蓝图归档为参考）
- supersedes: D-002@v1
- source: user（2026-06-18 execute 回退指令）+ spike-01 实测
- question: spike-01 未能证明 Claude/Codex 可在同一长驻进程内稳定完成两轮，交互式会话的进程边界如何回退？
- answer: 保留 1 AgentSession 对应 1 长生命周期 DaemonTaskLease，但进程降为 turn 级：首 turn 正常 spawn，后续 inject 为该 session 创建新 AgentRun 并以 `AgentSession.agent_session_id` 执行 `--resume`（Claude）或恢复 thread 后启动新 turn（Codex）；每个 turn 完成后进程退出。sessionStore 只保存 session/当前 run/内部会话 id 等元数据，不持有跨 turn child/stdin。interrupt 仅终止当前 run，session 仍 active；end 才完成 lease 并结束 session。
- normalized_requirement: session 与 interactive lease 仍为 1:1；session 与 AgentRun 为 1:N；每 turn 独立 spawn；后续 turn 必须复用 agent 内部 session/thread id；不得依赖 result 后 stdin 保持开放；session SSE 必须聚合多个 AgentRunLog 流。**当前交付能力为 turn 级交互（每 turn 完成才接受下一条），不承诺运行中注入；与 happy 的 turn 级交互语义一致，但 spawn 延迟 / 恢复失败 / 状态连续性仍会影响体验。**
- impacts: [design §5/§7/§8/§10/验收, requirements FR-01~FR-05/FR-08, tasks task-03/task-05/task-06/task-09, plan]
- evidence: spike-01 在 120 秒窗口内未获得 Claude 两轮 result 或 Codex 同 thread 两次 turn 完成证据；现有 quick-chat 已具备每轮新 AgentRun + resume 基础链路。
- priority: P0

## D-002@v3: 新增交互执行 driver 层（ClaudeSdkDriver + CodexAppServerDriver），与 TaskRunner 并存

- type: architecture
- status: accepted（2026-06-18 spike-02 §3.7 两硬门 H1/H2 通过；正式 supersedes D-002@v2）
- supersedes: D-002@v2
- source: 三份架构分析收敛（2026-06-18）
- question: spawn+resume（v2）每 turn 开销大、状态不连续；是否改为 SDK 同进程多轮（参考 happy 执行面）？
- answer: 新增 `InteractiveSessionManager` + driver 层与现有 `TaskRunner`（batch）**并存**，不替换：TaskRunner 继续管 batch lease + 其他 provider（现有 adapter 不动）；交互式会话由 `ClaudeSdkDriver`（官方 `@anthropic-ai/claude-agent-sdk` 的 `query(AsyncIterable)`，SDK 内部仍 spawn claude 但 stdin/stdout 管理权转移给 SDK）和 `CodexAppServerDriver`（参考 happy 常驻 app-server 客户端，后续独立落地）驱动。现有 lease / WS / AgentRun / AgentRunLog / Redis / SSE / 权限审计全部保留。
- normalized_requirement: driver 层与 TaskRunner 并存（非替换）；现有 batch 路径零改动；不照搬 happy 控制面（Fastify/Socket.IO/E2E/machine API/daemon 生命周期/离线 session/TUI）；**不 Big Bang**——先 ClaudeSdkDriver，Codex 后续单独；SDK 路线交互语义仍为 turn 级（result 后 push 下一条），**运行中注入在 SDK 下语义未知，需 spike 验证，不得外推 happy 行为**；task-03/06/07/08/09 按 v3 重做，task-01/04/05/10/11 保留。
- impacts: [plan task-03/06/07/08/09 按 v3 重做，task-01/04/05/10/11 保留；execute 前置 SDK 集成 spike]
- evidence: 三份分析共识；happy `claudeRemote.ts:153`/`sdk/query.ts:72`/`codexAppServerClient.ts:165` 执行面参考
- priority: P0
- spike 结论（2026-06-18，详见 `spike-02-architecture-validation.md` §3.7）: **H1 通过**（Windows env 继承鉴权 + SDK 默认内置 claude.exe，不依赖系统 claude.CMD）；**H2 通过**（AsyncIterable 同进程两轮，第二轮含首轮上下文、同 session_id）；D1 `interrupt()` turn 级、可续轮；D2 `canUseTool` 远程审批延迟不超时（caveat：GLM 后端 Write 工具失败，非路线阻塞）；D3 跨进程 resume 恢复上下文（SDK 自动持久化 `~/.claude/projects/`）；D4 result 是干净边界、无孤儿后台事件；S1 不支持运行中注入（turn 级）。**caveat**：本环境后端为智谱/GLM 中转（`ANTHROPIC_BASE_URL=open.bigmodel.cn`，模型映射 glm-5.2），工具兼容性是真实部署风险；结论对官方 Anthropic 后端需另证；`streamInput` 主动注入与长时间后台 bash 归属未单独覆盖，留待 driver 实现阶段补验

## D-003@v1: Wave1/2 不做崩溃恢复，Wave3 做 resume 持久化

- type: boundary
- status: accepted
- source: user（范围控制 YAGNI）+ happy 参考（resume 是独立健壮性层）
- question: 会话进程崩溃后是否立即支持恢复？resume 放在哪个 Wave？
- answer: Wave1/2 阶段 session 进程崩溃 = 会话结束（agent_sessions.status=failed），提示用户重新开始；resume 持久化（daemon 磁盘 + `--resume`/`thread/resume` 重 spawn）作为 Wave3 独立交付。
- normalized_requirement: Wave1/2 的 SessionStore 仅内存态；崩溃检测标 failed；Wave3 新增 persist/restore + agent_sessions.status 的 reconnecting 态。
- impacts: [design §3 非目标, §5 Wave3, R-03, task Wave3]
- evidence: explore 阶段 happy `daemon/run.ts:661 resumeSession` 参考
- priority: P1

## D-004@v1: session 空闲 30min 自动结束

- type: boundary
- status: accepted
- source: ai（默认值，平衡资源与体验）
- question: 长驻会话何时自动结束？避免 daemon 资源被无限占用。
- answer: session 空闲 30min（无 inject / 无活动）自动结束（daemon 侧 keep-alive 检测 last_active_at），可配置。用户也可随时手动结束。
- normalized_requirement: SessionStore 记录 last_active_at；daemon 定时扫描，空闲超 30min（配置项 session_idle_timeout_sec）的 active session 自动 end；agent_sessions.status=ended。
- impacts: [design §5 Wave1 SessionStore, 验收, task Wave1]
- evidence: explore happy keep-alive 2s 参考；本变更放宽到 30min 会话级
- priority: P1

## D-005@v1: session/lease/run 三元关系 + session 级 SSE 聚合（Design Grill 修正）

- type: consistency（一致性 + 可行性 + 定义，三条结构性问题的合并修正）
- status: accepted
- source: ai（Step12 Design Grill 交叉审查）
- question: design.md 初稿三处结构性矛盾——(a) DaemonTaskLease.agent_run_id 现有 1:1 约束与"每 turn 一个 AgentRun"冲突；(b) stream_run_logs 是 run 级订阅，跨 turn SSE 聚合未定义；(c) interactive lease 的 lease_expires_at/expire 回收语义未定义。
- answer: (a) interactive lease.agent_run_id=NULL，session↔lease 1:1（session.lease_id），session↔runs 1:N（run.agent_session_id）；(b) 新增 session 级 Redis channel `agent_session:{session_id}`，submit_messages 双 publish（run 级 + session 级），新增 stream_session_logs；(c) interactive lease.lease_expires_at=NULL 不进 handle_lease_expiry，结集中在 service.end_session。
- normalized_requirement: interactive lease.agent_run_id 必须为 NULL；必须存在 agent_sessions.lease_id（1:1）与 agent_runs.agent_session_id（N:1）；必须新增 session 级 Redis channel 与 stream_session_logs；interactive lease 不得设置 lease_expires_at。
- impacts: [design §8.4, §8.5, §7.2, R-04, R-08, task 数据模型迁移 + Wave1 SSE]
- evidence: `backend/app/modules/daemon/model.py:125`（lease.agent_run_id FK）；`backend/app/modules/agent/service.py:541` stream_run_logs（run 级）
- priority: P0

## D-006@v1: 本轮设计范围=全栈一次设计

- type: scope
- status: accepted
- source: user（2026-06-18 brainstorm step6）
- question: 交互式会话 driver 层设计范围边界？
- answer: 全栈一次设计——daemon ClaudeSdkDriver + InteractiveSessionManager / backend AgentSession+SSE 聚合 / frontend 交互式会话 UI，同一变更内完成，不拆分多变更。
- normalized_requirement: 本变更覆盖 daemon `src/interactive/` 模块 + backend agent_sessions/lease.kind/SSE + frontend 会话面板；内部 Wave 分组，不生成 MASTER.md。
- impacts: [design §5 Wave1-4, task 全栈 task-03~09, plan]
- evidence: brainstorm step6 用户决策1
- priority: P1

## D-007@v1: canUseTool 远程人审链路（WS→前端）

- type: architecture
- status: accepted
- source: user（2026-06-18 brainstorm step6）+ spike-02 §3.7 D2
- question: canUseTool 审批链路形态？（spike D2 验证回调可 await 任意延迟不超时）
- answer: ClaudeSdkDriver 的 canUseTool 回调内 WS 推 `tool_approval_request`（session_id/run_id/tool_use_id/tool/input）→ backend → 前端弹审批卡 → 用户 allow/deny → 回传 → daemon resolve 回调（allow/deny）。超时默认 5min 未响应→deny。复用现有 tool_gateway 审批框架。
- normalized_requirement: canUseTool 回调必须 await 远程人审结果（非本地策略自动放行）；审批请求经 WS→backend→frontend 路由；默认 5min 超时 deny；接入点复用 tool_gateway（design §7 定）。
- impacts: [design §5 Wave2, §7 接口, task-07 权限审批, FR-07]
- evidence: spike-02 §3.7 D2（canUseTool 回调 await 6s×3 claude 全程等待不超时）；brainstorm step6 决策2
- priority: P0

## D-008@v1: GLM 工具兼容性降级=错误透传

- type: boundary
- status: accepted
- source: user（2026-06-18 brainstorm step6）+ spike-02 §3.7 D2 caveat
- question: GLM 中转后端工具调用失败（spike D2 Write 失败）如何降级？
- answer: 错误透传——工具失败时把 tool_result(is_error=true) 返回给 claude，让 claude 自处理（重试/换方法/告知用户）。最小干预，不做 per-provider 工具黑白名单预禁。
- normalized_requirement: ClaudeSdkDriver 不做工具预过滤；工具执行失败的 tool_result 原样（is_error）经 SDK 返给模型；不针对 GLM 做特殊降级（如预禁 Write/Edit/Bash）。
- impacts: [design §5 Wave2, §10 R-GLM, task-07]
- evidence: spike-02 §3.7 D2 caveat（GLM 后端 Write 调用 3 次均 permission error、文件未创建，非 SDK 路线阻塞）；brainstorm step6 决策3
- priority: P1

## D-009@v1: SDK claude.exe 分发=只用系统 claude.CMD

- type: architecture
- status: accepted
- source: user（2026-06-18 brainstorm step6）
- question: SDK 内置 claude.exe（224MB）在 daemon 的分发方式？
- answer: 只用系统 claude.CMD——daemon dependencies 加 `@anthropic-ai/claude-agent-sdk` 主包；ClaudeSdkDriver 显式传 `pathToClaudeCodeExecutable` 指向 agent-detector 检测的系统 claude（2.1.181），**不带** `@anthropic-ai/claude-agent-sdk-win32-x64` 平台二进制包（optionalDependencies 不装）。daemon 安装体积不增，但部署强依赖用户预装 claude。
- normalized_requirement: daemon `package.json` dependencies 含 `@anthropic-ai/claude-agent-sdk`（主包）；ClaudeSdkDriver 必须显式传 `pathToClaudeCodeExecutable`（来自 agent-detector 检测结果），不依赖 SDK 默认内置 exe；agent-detector 未检测到 claude 时 driver 拒绝启动 interactive session（明确报错）。
- impacts: [design §5 Wave1, §7 ClaudeSdkDriver 接口, task-03/06, §10 R-exe]
- evidence: spike-02 §3.7 H1（默认内置 exe 验证）；brainstorm step6 决策4。**待验**：spike H1 验证的是默认内置 exe，"显式 pathToClaudeCodeExecutable=系统 claude" 需 execute 前补验（task-03 前置）。
- priority: P0
