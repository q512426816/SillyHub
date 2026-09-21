## FR-daemon-001 daemon 上报 session ready（fresh + recover）
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-01
最近确认：287cc9dbd

## FR-daemon-002 backend 接收 ready + 内存管理
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-02
最近确认：287cc9dbd

## FR-daemon-003 backend inject 等 ready
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-03
最近确认：287cc9dbd

## FR-daemon-004 生命周期与边界
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-04
最近确认：287cc9dbd

## FR-daemon-005 测试
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-05
最近确认：287cc9dbd

## FR-daemon-006 worker/主会话分流挂起
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 停止或掉线，该 daemon 名下有 active 会话 主会话（无 parent）被挂起；When suspend_sessions_for_daemon 或 session_offline_sweep_once 执行 daemon 回来；Then **worker 子会话**（parent_session_id 非空）→ session failed(error_code=daemon_interrupt
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-01
最近确认：023352ce0

## FR-daemon-007 worker 自动重派
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given worker 子会话被分流标 failed 同一 worker attempt>=3 重派 dispatch 失败（无在线 daemon 等）；When 挂起事务提交后 挂起再次触发；Then 异步触发重派：从 AgentSession 行重建 dispatch 上下文（provider/model/workspace_id/worktree_bran
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-02
最近确认：023352ce0

## FR-daemon-008 daemon 消费 resume 续会话
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given worker lease 被 claim 且 payload 含 resume_session_id payload 不含 resume_session_id（；When daemon _startInteractiveSession 执行；Then SessionManager.create 传 resume key → SDK --resume 续会话（历史延续；等 inject 才跑新 turn——对齐
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-03
最近确认：023352ce0

## FR-daemon-009 resume 失败自动降级
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given create 带 resume key 后 SDK 启动报 session 损伤（session not found/no conversation/unabl；When daemon 检测命中；Then 清 resume key 重建 fresh 会话一次 + 事件上报 resume_downgraded（终态 metadata 备查）；再失败→普通 creat
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-04
最近确认：023352ce0

## FR-daemon-010 claim 白名单 interactive 补透传
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given lease metadata 含 resume_session_id 且 lease kind=interactive；When build_claim_payload 走 interactive 分支；Then payload 透传 resume_session_id（当前仅 batch 分支透传——Grill C-02 修复点）
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-05
最近确认：023352ce0

## FR-daemon-011 升级空闲屏障
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 收到 SELF_UPDATE 指令或探测到磁盘版本变更 推迟期间触发重发 升级链执行中（下载完成、stop 之前）；When 存在「进行中」工作（在跑 interactive 轮次 status==='running'，或在跑 batch lease _controllers 非空；空；Then 推迟升级：记录 pending（reason+目标+当前版本）+30s 后重探（无限等，每轮从零重跑 tryUpdate），不打断任何进行中工作 仅刷新目标版本
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-01
最近确认：d7003af10

## FR-daemon-012 更新所有权与失败恢复
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given tryUpdate 被触发（指令/探测/复查） 一切非「交接排定」路径（noop/下载失败/异常/终检回推迟） respawn 拉起失败；When 已有更新在途；Then 本次忽略并记日志（JS 单线程原子占位） 释放所有权+清 pending 文件；下一条 SELF_UPDATE 指令可再触发 进程已 stop 停摆保活（不退出
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-02
最近确认：d7003af10

## FR-daemon-013 磁盘旁路探测
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given bundle 文件被外部替换/降级（BUILD_ID 与内存不同） 探测失败（读文件失败/正则不中/任一侧为空）或 dev 构建；When self_reload_check_interval_sec（默认 600，0=关闭）周期探测（读文件正则提取 BUILD_ID，与 respawn 加载同一文；Then 触发 tryUpdate('disk_change')——走独立直启路径：不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-03
最近确认：d7003af10

## FR-daemon-014 backend 透传
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 心跳携带 pending_update {reason, current_version, target_version} 心跳无该字段 机器视图；When backend 心跳端点处理；Then upsert daemon_instances.pending_update（JSON nullable）；同内容 upsert 保留原 since，首次盖 n
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-04
最近确认：d7003af10

## FR-daemon-015 前端展示
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
依据决策：D-003@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 机器卡渲染且 pending_update 非空 升级完成（pending_update 清 NULL）；When reason==='server_command' reason==='disk_change'；Then warning 横幅「等待空闲后自动升级（每 30s 复查）」+副行（原因+版本对比）；「升级 daemon」按钮禁用 info 横幅「检测到程序文件已变更，等
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-05
最近确认：d7003af10

## FR-daemon-016 daemon 活性推导器（tailer + deriver 注册表）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — When tailer 周期（10s）对每路径 offset 差量续读尾部 本轮推导 下一周期 周期执行；Then 经 format→deriver 注册表推导出 5 态之一 + 证据摘要（zcode：completedAt 新鲜/toolCalls 未配对→working；
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-01
最近确认：4e01d1d44

## FR-daemon-017 daemon 自发现通道（双源汇聚）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given daemon spawn 记录 / sessions.json 重启恢复 / 15min 窗口重扫兜底（三层数据源） 守卫铁律 R-01；When 定位会话日志（claude/pi 直算路径先行；codex/zcode 窄扫+标记匹配） 无日志正向等待人类证据；Then 与 SillySpec 登记源按 (workspace, log_path) 汇聚去重进 watch list；裸 agent 会话（全程不调 sillyspe
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-02
最近确认：4e01d1d44

## FR-daemon-018 backend 状态落库与上报端点
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 鉴权通道（与 /api/agent-logs 同分流规则）；When POST /api/agent-logs/states 批量上报 (log_path, state, evidence, derived_at, last_ev；Then platform_agent_logs 行 upsert（state/state_derived_at/state_evidence/last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-03
最近确认：4e01d1d44

## FR-daemon-019 blocked 主动通知（第一方事件汇聚 + E-01 门控）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 会话进入 blocked（主源=第一方 PERMISSION_REQUEST 事件，D-012 优先级；日志推导仅裸 claude CLI 候选） E-01 实；When blocked 持续 ≥120s 未消解 证伪；Then Notification type=agent_blocked（dedupe_key=(session, blocked 段序号) 同段只发一次；站内 + Re
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-04
最近确认：4e01d1d44

## FR-daemon-020 前端展示（D-004@v1 两层）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 会话列表 / 工作台首页 / 会话详情 agent 日志面板；When 状态四字段可用（api-types 经 pnpm gen:types 重新生成）；Then ①会话列表每行行尾 ~18px 状态小灯（五态色 + 工作/阻塞呼吸闪烁，不新增列不改布局），悬停弹小卡（状态全名/静默时长=now-last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-05
最近确认：4e01d1d44

## FR-daemon-021 编排知情决策（P1e）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given worker 处于 running 派发模板（sillyspec 仓）决策规则；When 编排 agent 轮询 list_workers worker blocked 超阈值 / working 久无终态；Then 返回值附 liveness{state, evidence, derived_at}（daemon 推导经 mission 状态链路汇入；链路过重时降级为 ba
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-06
最近确认：4e01d1d44

## FR-daemon-022 历史会话对话化回看（恒读库）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 上报条目 format=zcode-model-io-jsonl，其 rollout 文件已被清理、会话存在于 zcode 本地 SQLite 会话含系统注入消；When 用户打开该会话的对话化视图（messages 端点） 归一化遍历 message 归一化 归一化；Then 完整渲染对话段（user_input/reply/thinking/tool_use/tool_result），不报"文件不存在" 该条 message 整体跳
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-01
最近确认：48240b713

## FR-daemon-023 原文视图从库合成（不截断）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given zcode 条目（无论文件在否） messages RPC 非 parsed 或抛错（not_found / method_not_found 老 daemon；When 用户打开原文视图（content 端点） content 端点处理；Then 后端先调 messages RPC，status=parsed 时返回九字段伪 jsonl（seq/kind/text/tool_name/tool_use_i
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-02
最近确认：48240b713

## FR-daemon-024 库读失败文件兜底
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given format=zcode 且 SQLite 读取失败（node:sqlite 不可用 / 库文件缺失 / 会话不在库 / 查询异常） 请求 path 越出 al；When messages RPC 处理 readAgentLogMessages 处理；Then 回落现有文件路径（lstat + parse-zcode-model-io）：文件在=正常解析成功；文件也缺=按现状 not_found 错误语义 assert
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-03
最近确认：48240b713

## FR-daemon-025 零改动面
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given claude / codex 条目 beforeSeq 翻页请求（「加载更早」）；When 任一读取端点处理 zcode 会话对话化视图；Then 分派路径与现状逐字节一致（不走 SQLite 分支） 窗口切片语义与文件 parser 对齐，翻页正常
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-04
最近确认：48240b713
