## FR-daemon-001 daemon 上报 session ready（fresh + recover）
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-01
最近确认：287cc9dbd

## FR-daemon-002 backend 接收 ready + 内存管理
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-02
最近确认：287cc9dbd

## FR-daemon-003 backend inject 等 ready
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-03
最近确认：287cc9dbd

## FR-daemon-004 生命周期与边界
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-04
最近确认：287cc9dbd

## FR-daemon-005 测试
变更：2026-08-10-inject-wait-session-ready
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-08-10-inject-wait-session-ready/requirements.md#FR-05
最近确认：287cc9dbd

## FR-daemon-006 worker/主会话分流挂起
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 停止或掉线，该 daemon 名下有 active 会话 主会话（无 parent）被挂起；When suspend_sessions_for_daemon 或 session_offline_sweep_once 执行 daemon 回来；Then **worker 子会话**（parent_session_id 非空）→ session failed(error_code=daemon_interrupt
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-01
最近确认：023352ce0

## FR-daemon-007 worker 自动重派
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given worker 子会话被分流标 failed 同一 worker attempt>=3 重派 dispatch 失败（无在线 daemon 等）；When 挂起事务提交后 挂起再次触发；Then 异步触发重派：从 AgentSession 行重建 dispatch 上下文（provider/model/workspace_id/worktree_bran
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-02
最近确认：023352ce0

## FR-daemon-008 daemon 消费 resume 续会话
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given worker lease 被 claim 且 payload 含 resume_session_id payload 不含 resume_session_id（；When daemon _startInteractiveSession 执行；Then SessionManager.create 传 resume key → SDK --resume 续会话（历史延续；等 inject 才跑新 turn——对齐
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-03
最近确认：023352ce0

## FR-daemon-009 resume 失败自动降级
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given create 带 resume key 后 SDK 启动报 session 损伤（session not found/no conversation/unabl；When daemon 检测命中；Then 清 resume key 重建 fresh 会话一次 + 事件上报 resume_downgraded（终态 metadata 备查）；再失败→普通 creat
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-04
最近确认：023352ce0

## FR-daemon-010 claim 白名单 interactive 补透传
变更：2026-08-29-batch-session-inherit
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given lease metadata 含 resume_session_id 且 lease kind=interactive；When build_claim_payload 走 interactive 分支；Then payload 透传 resume_session_id（当前仅 batch 分支透传——Grill C-02 修复点）
全文：.sillyspec/changes/archive/2026-08-29-batch-session-inherit/requirements.md#FR-05
最近确认：023352ce0

## FR-daemon-011 升级空闲屏障
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-001@v1、D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given daemon 收到 SELF_UPDATE 指令或探测到磁盘版本变更 推迟期间触发重发 升级链执行中（下载完成、stop 之前）；When 存在「进行中」工作（在跑 interactive 轮次 status==='running'，或在跑 batch lease _controllers 非空；空；Then 推迟升级：记录 pending（reason+目标+当前版本）+30s 后重探（无限等，每轮从零重跑 tryUpdate），不打断任何进行中工作 仅刷新目标版本
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-01
最近确认：d7003af10

## FR-daemon-012 更新所有权与失败恢复
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given tryUpdate 被触发（指令/探测/复查） 一切非「交接排定」路径（noop/下载失败/异常/终检回推迟） respawn 拉起失败；When 已有更新在途；Then 本次忽略并记日志（JS 单线程原子占位） 释放所有权+清 pending 文件；下一条 SELF_UPDATE 指令可再触发 进程已 stop 停摆保活（不退出
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-02
最近确认：d7003af10

## FR-daemon-013 磁盘旁路探测
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given bundle 文件被外部替换/降级（BUILD_ID 与内存不同） 探测失败（读文件失败/正则不中/任一侧为空）或 dev 构建；When self_reload_check_interval_sec（默认 600，0=关闭）周期探测（读文件正则提取 BUILD_ID，与 respawn 加载同一文；Then 触发 tryUpdate('disk_change')——走独立直启路径：不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-03
最近确认：d7003af10

## FR-daemon-014 backend 透传
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 心跳携带 pending_update {reason, current_version, target_version} 心跳无该字段 机器视图；When backend 心跳端点处理；Then upsert daemon_instances.pending_update（JSON nullable）；同内容 upsert 保留原 since，首次盖 n
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-04
最近确认：d7003af10

## FR-daemon-015 前端展示
变更：2026-08-29-daemon-selfupdate-safety
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-003@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 机器卡渲染且 pending_update 非空 升级完成（pending_update 清 NULL）；When reason==='server_command' reason==='disk_change'；Then warning 横幅「等待空闲后自动升级（每 30s 复查）」+副行（原因+版本对比）；「升级 daemon」按钮禁用 info 横幅「检测到程序文件已变更，等
全文：.sillyspec/changes/archive/2026-08-29-daemon-selfupdate-safety/requirements.md#FR-05
最近确认：d7003af10

## FR-daemon-016 daemon 活性推导器（tailer + deriver 注册表）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — When tailer 周期（10s）对每路径 offset 差量续读尾部 本轮推导 下一周期 周期执行；Then 经 format→deriver 注册表推导出 5 态之一 + 证据摘要（zcode：completedAt 新鲜/toolCalls 未配对→working；
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-01
最近确认：4e01d1d44

## FR-daemon-017 daemon 自发现通道（双源汇聚）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given daemon spawn 记录 / sessions.json 重启恢复 / 15min 窗口重扫兜底（三层数据源） 守卫铁律 R-01；When 定位会话日志（claude/pi 直算路径先行；codex/zcode 窄扫+标记匹配） 无日志正向等待人类证据；Then 与 SillySpec 登记源按 (workspace, log_path) 汇聚去重进 watch list；裸 agent 会话（全程不调 sillyspe
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-02
最近确认：4e01d1d44

## FR-daemon-018 backend 状态落库与上报端点
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given daemon 鉴权通道（与 /api/agent-logs 同分流规则）；When POST /api/agent-logs/states 批量上报 (log_path, state, evidence, derived_at, last_ev；Then platform_agent_logs 行 upsert（state/state_derived_at/state_evidence/last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-03
最近确认：4e01d1d44

## FR-daemon-019 blocked 主动通知（第一方事件汇聚 + E-01 门控）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 会话进入 blocked（主源=第一方 PERMISSION_REQUEST 事件，D-012 优先级；日志推导仅裸 claude CLI 候选） E-01 实；When blocked 持续 ≥120s 未消解 证伪；Then Notification type=agent_blocked（dedupe_key=(session, blocked 段序号) 同段只发一次；站内 + Re
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-04
最近确认：4e01d1d44

## FR-daemon-020 前端展示（D-004@v1 两层）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 会话列表 / 工作台首页 / 会话详情 agent 日志面板；When 状态四字段可用（api-types 经 pnpm gen:types 重新生成）；Then ①会话列表每行行尾 ~18px 状态小灯（五态色 + 工作/阻塞呼吸闪烁，不新增列不改布局），悬停弹小卡（状态全名/静默时长=now-last_event_at
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-05
最近确认：4e01d1d44

## FR-daemon-021 编排知情决策（P1e）
变更：2026-09-07-agent-liveness-states
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given worker 处于 running 派发模板（sillyspec 仓）决策规则；When 编排 agent 轮询 list_workers worker blocked 超阈值 / working 久无终态；Then 返回值附 liveness{state, evidence, derived_at}（daemon 推导经 mission 状态链路汇入；链路过重时降级为 ba
全文：.sillyspec/changes/archive/2026-09-07-agent-liveness-states/requirements.md#FR-06
最近确认：4e01d1d44

## FR-daemon-022 历史会话对话化回看（恒读库）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
待复核：2026-09-26-daemon-hits-periodic-upload
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 上报条目 format=zcode-model-io-jsonl，其 rollout 文件已被清理、会话存在于 zcode 本地 SQLite 会话含系统注入消；When 用户打开该会话的对话化视图（messages 端点） 归一化遍历 message 归一化 归一化；Then 完整渲染对话段（user_input/reply/thinking/tool_use/tool_result），不报"文件不存在" 该条 message 整体跳
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-01
最近确认：48240b713

## FR-daemon-023 原文视图从库合成（不截断）
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
待复核：2026-09-26-daemon-hits-periodic-upload
依据决策：D-002@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given zcode 条目（无论文件在否） messages RPC 非 parsed 或抛错（not_found / method_not_found 老 daemon；When 用户打开原文视图（content 端点） content 端点处理；Then 后端先调 messages RPC，status=parsed 时返回九字段伪 jsonl（seq/kind/text/tool_name/tool_use_i
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-02
最近确认：48240b713

## FR-daemon-024 库读失败文件兜底
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
待复核：2026-09-26-daemon-hits-periodic-upload
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given format=zcode 且 SQLite 读取失败（node:sqlite 不可用 / 库文件缺失 / 会话不在库 / 查询异常） 请求 path 越出 al；When messages RPC 处理 readAgentLogMessages 处理；Then 回落现有文件路径（lstat + parse-zcode-model-io）：文件在=正常解析成功；文件也缺=按现状 not_found 错误语义 assert
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-03
最近确认：48240b713

## FR-daemon-025 零改动面
变更：2026-09-10-zcode-session-sqlite-read
状态：active
摘要：默认场景
待复核：2026-09-26-daemon-hits-periodic-upload
场景正文：
- 场景：默认场景 — Given claude / codex 条目 beforeSeq 翻页请求（「加载更早」）；When 任一读取端点处理 zcode 会话对话化视图；Then 分派路径与现状逐字节一致（不走 SQLite 分支） 窗口切片语义与文件 parser 对齐，翻页正常
全文：.sillyspec/changes/archive/2026-09-10-zcode-session-sqlite-read/requirements.md#FR-04
最近确认：48240b713

## FR-daemon-026 caps 第 12 键 compact
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given ProviderCaps 单源加 compact 键（claude/pi/codex=true、cursor=false、未知回退 false）；When gen 脚本三端生成 + 双守护测试同步；Then 新引擎漏声明即 satisfies 编译红 + 守护测试红；前端按钮门控与 backend 端点校验有真数据源
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-01
最近确认：1aacbb3d9

## FR-daemon-027 统一端点双分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given POST /api/daemon/sessions/{id}/compact（归属+caps+状态三校验）；When claude → 复用 inject 服务发 "/compact"（建 run；DaemonSessionTurnConflict 捕获映射 error）；Then 响应含 run_id/queued；When pi/codex → ws_hub.send_rpc('session_compact', timeout=15)
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-02
最近确认：1aacbb3d9

## FR-daemon-028 claude 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given caps.compact=true 且会话空闲；When 用户点压缩；Then inject 通道下发 /compact 文本，SDK 处理 slash，压缩轮作为正常 turn 收敛并在会话流可见；daemon 零改动
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-03
最近确认：1aacbb3d9

## FR-daemon-029 pi 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given session_compact RPC 到达 daemon；When session-manager 守卫通过后 PiRpcDriver.compact() 发 {"type":"compact"} 等 response；Then 回执 tokensBefore/estimatedTokensAfter 进 CompactResult → RPC result → 端点响应 → 前端通知带
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-04
最近确认：1aacbb3d9

## FR-daemon-030 codex 分路
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 同 FR-04；When CodexAppServerDriver.compact() 经新 id→pending 机制发 thread/compact/start {threadId}；Then 受理（空响应）→ ok=true 无数字；超时/错误如实回传
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-05
最近确认：1aacbb3d9

## FR-daemon-031 前端按钮
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 环浮层提供 onCompact 且 caps.compact=true；When turn running → 按钮禁用（tooltip 轮运行中）；预会话不渲染；cursor 引擎不渲染 点击 → compactSession() 调端点；Then 三分型成功通知（pi 数字/codex 受理/claude 已发送）或失败通知带 error 原文
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-06
最近确认：1aacbb3d9

## FR-daemon-032 结果呈现
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 压缩完成回执在端点响应中；Then 前端通知呈现；claude 流可见性由 /compact 轮承载；环分子在压缩后下一次调用 usage 到达自然回落（零改动链）
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-07
最近确认：1aacbb3d9

## FR-daemon-033 真机验证
变更：2026-09-14-session-ctx-compact
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 本机三引擎会话各一轮压缩；Then pi 通知带数字、claude 会话流出现压缩轮、codex 受理通知；三引擎下一轮环回落；R-01/02/03 风险点各有真机结论
全文：.sillyspec/changes/archive/2026-09-14-session-ctx-compact/requirements.md#FR-08
最近确认：1aacbb3d9

## FR-daemon-034 周期上行通道
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-01
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-daemon-hits-periodic-upload:flow:FR-01
  tests: tests/knowledge-hits-periodic.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-035 mtime/size 短路
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-02
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

## FR-daemon-036 失败不中断
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-03
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

## FR-daemon-037 绑定集守卫
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-04
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

## FR-daemon-038 双通道幂等与零回归
变更：2026-09-26-daemon-hits-periodic-upload
状态：active
摘要：（无场景名）
待复核：2026-09-26-sillyspec-command-queue
全文：.sillyspec/changes/archive/2026-09-26-daemon-hits-periodic-upload/requirements.md#FR-05
最近确认：bdbeb7bfdd5d8bfc9588aa885820d0360acf21e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-daemon-hits-periodic-upload:flow:FR-05
  tests: tests/knowledge-hits-periodic.test.ts | tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-daemon-hits-periodic-upload
  status: active

## FR-daemon-039 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 系统就绪；When 已归档变更若为轻量出身；Then 标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-01
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-thin-badge-survives-archive:flow:FR-01
  tests: __tests__/page-restore-assets.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-thin-badge-survives-archive
  status: active

## FR-daemon-040 出身判定:current_stage 为 archived 或 location 为 archive
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 系统就绪；When 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 creat；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-02
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

## FR-daemon-041 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 系统就绪；When 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-03
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

## FR-daemon-042 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-26-thin-badge-survives-archive/requirements.md#FR-04
最近确认：1556fe5581282d478fa783f2808213c8f6fddb32

## FR-daemon-043 frontend tsc 无错误
变更：2026-09-26-thin-badge-survives-archive
状态：active
摘要：默认场景
待复核：2026-09-26-sillyspec-command-queue
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
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
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-sillyspec-command-queue
  status: active
