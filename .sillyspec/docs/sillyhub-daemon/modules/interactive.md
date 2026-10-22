---
schema_version: 1
doc_type: module-card
module_id: interactive
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 交互式会话子系统（interactive）

## 定位

交互式会话子系统（`src/interactive/`，9 文件约 7900 行）：区别于 batch lease 的一次
性 spawn，提供同进程多轮长驻会话。分层：SessionManager（生命周期，不依赖任何
provider SDK）→ provider-neutral driver 契约（driver.ts 纯类型）→ ClaudeSdkDriver
（Claude Agent SDK）/ CodexAppServerDriver（codex app-server JSON-RPC）双实现；
辅助件 InputQueue（输入队列）、PermissionResolver（远程人审）、
claude-transcript-dir（transcript 位置探测）、
JsonSessionPersistence（元数据持久化）、types.ts（局部类型，独立于 src/types.ts）。

## 契约摘要

- **SessionManager**：`create` / `inject` / `interrupt` / `end` / `fail` /
  `restoreAndReconnect`（重启恢复，按 record.stage/provider 路由）/
  `markReconnected` / `refreshClaimToken` / `setBudgetTokens` / `isOverBudget` /
  `markPendingSwitch` / `reloadWithProvider`（会话内切供应商，热重启 env）/
  `markPendingConfigSwitch` / `reloadWithConfig`（会话内切档案，承载切换轮
  prompt）/ `requestPermission` / `requestUserDialog` / `hasLiveBackgroundTasks`（后台任务存活只读查询，2026-09-15-background-task-permission-lockout FR-01）/ `registerBorrowSandbox` /
  `snapshotPersistable` / `flush` / `start|stop|scanOnce`（空闲扫描）。
- **driver.ts 契约**：`UserTurnInput`（provider-neutral 输入单元）/
  `InteractiveDriverMessage|Result`（宽松字段，daemon 按 provider 归一化）/
  `InteractiveDriverHandle`；SDK 类型只允许出现在具体 driver 内部。
- **ClaudeSdkDriver**：SDK query 同进程多轮；`resolveClaudeExecutable` 把 Windows
  cmd-shim wrapper 解析到真 .exe（防 spawn EINVAL）；canUseTool / onUserDialog /
  mcpServers 透传 SDK options。
- **CodexAppServerDriver**：spawn `codex app-server --listen stdio://`；握手
  initialize → initialized → thread/start|resume（每条间隔 300ms）；turn 串行
  （turn/completed 后才消费下一条）；turn/interrupt；flat message 契约
  `{event_type, content, metadata, session_id=threadId}`；审批 fail-closed 拦截
  （不透传 adapter 的 accept 模板）。
- **InputQueue**：单订阅 AsyncIterable；close 后 push 抛 ClosedError；close 前
  push 的消息必须全部 yield 完。
- **PermissionResolver**：canUseTool 远程人审 pending 注册表；request_id 用
  randomUUID；`PERMISSION_FALLBACK_TIMEOUT_MS = 5min+5s` 兜底。
- **JsonSessionPersistence**：`<daemonStateDir()>/sessions.json`（默认 ~/.sillyhub/daemon，SILLYHUB_DAEMON_DIR 隔离生效——quick 2026-09-01 风险审查修收口漏项：原直拼 homedir()，隔离实例启动会加载真实用户会话档案去 recover、flush 以本实例快照整文件覆写；路径经 `defaultSessionFilePath()` 懒求值，无参构造在构造时读 env）原子写
  （tmp+rename，0600）+ 单 promise queue 串行化；损坏 quarantine、单条 schema
  非法丢弃隔离。

## 关键逻辑

```
create: 建 InputQueue + push 首消息 → 按 provider 选 driver（未注册抛
        UnsupportedProviderError）→ driver.start → fire consume 协程 → notifySessionReady
inject: status=running 时 pendingInjectCount++ + onTurnQueued（排队检测非拒绝）
turn 收尾: classifyModelError → result.modelError → daemon 桥接 notifyRunResult
后台锚点(2026-09-15-background-task-permission-lockout FR-01): onResult 收尾时后台任务注册表非空→保留 currentRunId 作锚点(status 照常翻 active)，末任务 task_notification 注销/会话终态清锚点；写通道守卫第三放行源 hasBackgroundTaskGrace(active+currentRunId+注册表非空)与 withinStaleFlipGrace 并列(注册表=权威存活信号)；4 处可达 resolver.register 经 backgroundTaskFlag 统一注入 background_task 标记(主轮进行中恒 false；requestUserDialogImpl/buildOnUserDialogCallback 前置硬检查不可达不注入)；PermissionRegisterInput.backgroundTask=true 时 dialog 也启 5min fallback(后台锚点态有界，主轮 dialog 维持无限期)；守卫 deny 带 PLATFORM_NO_RUNNING_TURN: 稳定平台故障码前缀(agent 可区分平台故障/用户拒绝)
写守卫: policyEngine.canWrite(runtimeId, path, provider, tool) 覆盖 Write/Edit/
  MultiEdit + Bash 经 extractShellWritePaths 提取写目标；读工具不拦；
  policyEngine 未注入时退化 allowedRootsProvider fallback（空数组放行防全 deny）
主 agent MCP: isMainAgentSession(ctx.stage==='orchestrator') → mainAgentMcpConfigProvider
  经 mergeMcpConfigs 注入 daemon 内置 MCP server；恢复时按 record.stage 重注入；
  引擎门 2026-10-10 起由 cli.ts 装配 providers.isMainAgentMcpCandidate（caps 驱动，
  见 2026-10-10-all-engines-mcp-injection 增量节）——谓词判定与注入管道分居两层
reloadWithProvider: buildSpawnEnv 构造新 env；null=停止供应商回退本机凭证。
  provider 维度门 PROVIDER_RELOAD_ENGINES（D-005@v2；2026-09-13 由手写
  ['claude','codex','pi'] 改 INTERACTIVE_PROVIDERS.switchable 派生，照前端
  provider-caps.ts PROVIDER_SWITCH_ENGINES 同款手法，provider-adapter-registry
  守护⑥ 锁"消费侧=注册表"）——新引擎声明 switchable:true 后前后端同解锁，
  不再出现前端放行而 daemon 侧抛错的漏网点；config-only 路径（人格/配置切换）
  不受限。
  CLAUDE_CONFIG_DIR（resume/reload 两路径）按 transcript 实际位置判定
  （claude-transcript-dir：隔离目录命中→隔离，保 ql-20260807-002 停供应商语义；
  仅宿主机 ~/.claude 命中→不隔离；探测不到→维持隔离默认，ql-20260822-009）；
  home 会话 + 生效供应商非空 → 先 migrateClaudeTranscriptToIsolated 把 jsonl
  复制进隔离目录再回隔离 env（复制非移动，home 原件停档；isolated 已有副本
  跳过防回灌；provider_config null=本机默认不迁移，读本机 settings/凭证，
  ql-20260822-001）
restoreAndReconnect: 同上按位置判定 + 迁移 + record.providerConfig 快照重建 env
  驱逐前活会话守卫（ql-20260831-001-6dde，ql-20260831-008-a52e 收窄为同 lease）：
  内存残留条目与恢复记录同 lease 且 status=running 或
  _pendingInjectCount>0（附件下载中）→ 抛 SessionBusyError 拒绝驱逐——驱逐=
  terminate 在途 driver，正在执行的 agent 工作被静默杀掉（恢复链触发瞬间的
  忙检只查一次，恢复在途期间新起的 turn 靠本守卫兜底）。daemon 侧两条消费
  分支：恢复链 catch → 入退避重试队列（不写 failed 不删记录，turn 结束后下一
  轮再重建）；backend SESSION_RESUME catch → warn 跳过（不驱逐不置 failed）。
  lease 不一致（backend reopen 恒建新 lease 下发 SESSION_RESUME）→ 旧 lease 已被
  backend 判死，running 僵尸也属孤儿工作，静默驱逐（ql-20260823-006 事故语义，
  否则真僵尸永远 SESSION_BUSY 重启死循环）；终态/空闲条目不受影响。
空闲扫描: _scanIdle → _onIdleExpire → end（running 先 interrupt 再 end 兜底）
```

## 注意事项

- 空闲回收默认**禁用**：`DEFAULT_IDLE_TIMEOUT_SEC = 0`（scan/stage 由 backend 主动
  end_session 收口，防假性空闲误杀）；env SESSION_IDLE_TIMEOUT_SEC 显式 >0 才恢复
  旧回收行为（逃生口）。扫描周期默认 60s。
- R-exe（Windows 命中率极高的坑）：detector 给的路径常是 npm cmd-shim wrapper
  （claude.cmd / codex.cmd），spawn 不带 shell → EINVAL。claude driver 用
  resolveClaudeExecutable；codex driver 用 resolveWindowsCmdShim（失败回退
  shell:true）。
- PermissionResolver fail-closed 铁律：send 失败 / signal aborted / 5min 超时 /
  abortAll 全部 deny，绝不本地 allow；每 promise 只 settle 一次；listener settle
  时移除防泄漏。
- 持久化白名单：仅写 PersistedSessionRecord 字段；禁写 claim token / credential /
  prompt 轮次内容 / agent 输出 / Query 句柄 / InputQueue。例外：
  record.providerConfig 含 api_key（sessions-portal task-08 决策，恢复 resume 不丢
  配置；0600 与 credentials.json 同信任域）。
- SDK 自动持久化 transcript 由 SDK 写，daemon 不读不写，resume 靠 SDK 内部加载。
  位置随 create 时是否配供应商分两侧：配了（provider_config 第 0 层生效）写 daemon
  隔离目录 `claude-config/projects/<encoded-cwd>/<sid>.jsonl`；没配（本机凭证链）
  写宿主机 `~/.claude/projects/...`。resume/reload 用 claude-transcript-dir 探测
  实际在哪侧再设/删 CLAUDE_CONFIG_DIR（ql-20260822-009，见「关键逻辑」）。
- codex driver 常量：KILL_GRACE_MS=2000（SIGTERM→SIGKILL 升级）、stderr 上限
  20KB、握手间隔 300ms（codex.cmd 包装层 100ms 会丢 stdin）、turn/start 前
  threadId 等待上限 30s + 50ms 轮询（ql-20260909-026 早到 inject 竞态，测试可
  注入极小超时值）。
- manualApproval=true 才注入 canUseTool/onUserDialog；supportedDialogKinds 缺省
  ['AskUserQuestion']——AskUserQuestion 需回传用户选择，只能走 onUserDialog
  （canUseTool 只有 allow/deny）。
- interactive/types.ts 与 src/types.ts 是两套类型（SessionState 等仅前者有），
  ProviderConfig 从 src/types.ts type-only 引入（防运行时循环依赖）。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260822-001（移植主线）：「home 会话切供应商流量串本机网关」——回 ~/.claude resume 后用户 settings.json 的 env 块（cc-switch 指向本机网关）优先于进程注入的供应商 env，切了供应商流量串到 BigModel（E2E 实锤 400[1214] modelCode 不存在）。修复：home 会话 + 生效供应商非空时 migrateClaudeTranscriptToIsolated 复制 jsonl 进隔离目录再回隔离 env（reload/restore 双路径，restore 顺带自愈存量会话）。与本地 ql-20260821-016 线的 resolveResumeConfigDir 实现等价但落在 009 的 claude-transcript-dir 模块上（探测/迁移函数同文件单一来源）；语义差异：本地版「isolated 已有旧副本覆盖重写」改为「跳过防回灌」（isolated 是新真相源）。SessionManagerOptions.resumeDirs 注入 tmp 目录对做密闭测试；探测/迁移全链路 fs 吞错降级 home（R-01，绝不因迁移失败破坏会话）。
- ql-20260822-009：修复「已结束会话点重新打开 4 秒后被 daemon 打回 ended」。根因：create（spawn-env buildSpawnEnv）只在 provider_config 存在时隔离 CLAUDE_CONFIG_DIR（ql-20260729-002），未配供应商会话的 transcript 写在宿主机 ~/.claude；而 restoreAndReconnect/_reloadSession 无条件强制隔离目录（ql-20260807-002 防停供应商后找不到 jsonl）→ resume 去隔离目录找 transcript 必失败 → claude 报错退出 → fail → backend end_session（daemon 上报 failed 也记 ended）→ 用户 inject 409。修复：新增 claude-transcript-dir.ts 探测 `<sid>.jsonl` 实际在哪侧（扫两侧 projects/*/ 一层，免复刻 cwd 编码），按位置设/删 env；探测不到维持原隔离默认（零回归兜底）。教训：两轮旧修复各修了一半场景（隔离侧/宿主侧），按 provider_config 现值推断 transcript 位置不可靠（热切换后是现值非创建值），只能按文件实存探测。
- ql-20260624-007：codex turn 收敛依赖 turn/completed 经 parseTurnCompleted 产 complete event → finishTurn(currentTurnPromise)；该方法已对齐 claude result 强契约（params.turn 缺失也必收敛，见 adapter-json-rpc 模块）。新增 codex 子进程 stdout 原始行落盘：consume 内 ctx.sessionId 存在时建 WriteStream 写 <daemonStateDir()>/runs/codex-interactive/<sessionId>.log（quick 2026-09-01 改派生隔离目录，原直拼 homedir()）（fire-and-forget 静默，不写日志不影响主流程），sessionId 经 CodexStartOptions 传入、session-manager._buildDriverOptions 一处填充（create+restore 共用）。下次 turn 卡死时看该日志确认 turn/completed 是否到达 / payload 长啥样。
- 2026-08-25-team-subsession-governance：分身受限 MCP 注入——SessionManagerOptions 新增 isWorkerSession/workerMcpConfigProvider，_resolveMainAgentMcp 头部分身分支（优先于主控谓词，create/restore/reload 三路共用）；stage=mission_worker 注入 sillyhub-worker 受限 server（mcp-server.ts registerWorkerTools 硬编码仅 worker_done 单工具，MCP_TOOLSET=mission_worker env 门控裁剪全量注册）——递归闸：分身禁入 8 个编排/file 工具，P2 下放派发工具时须重估 mcpRefs 豁免决策。
- 2026-08-26-team-subsession-recursion：分层工具集+会话闸——MainAgentMcpContext.worker_depth 全链承载（placement metadata→claim payload→归一化→snapshot 保档 restore 不丢档）；mcp-server 受限注册两档（非叶 depth<2 恰 5 件与 orchestration 共享 per-tool helper / 叶仅 worker_done，converge+report_progress 永不注册，旧 lease 缺键叶档兜底宁少勿多）；SessionManager.create 前置会话总数闸 SILLYHUB_MAX_ACTIVE_SESSIONS（默认 20，0 不限，restore 豁免，拒绝抛 SessionLimitReached 走既有 failed 上报）。
- ql-20260831-003-3c87：修复「daemon 重启后 30 分钟内新建会话全被 SESSION_LIMIT_REACHED 拒」。根因：会话闸「真活跃」口径（2026-08-26 P0：running 或 lastActiveAt 在 30 分钟窗口内）被恢复链自己击穿——markReconnected 在恢复成功后把 lastActiveAt 刷成 Date.now()，重启恢复的满额 idle 会话（实机 21 ≥ 20）全部被判真活跃；既有 P0 回归测试直塞 _store 造僵尸态、绕过 markReconnected，所以没拦住。修复：markReconnected 不再刷新 lastActiveAt（恢复是系统动作非用户活动，restoreAndReconnect 本就保档 record.lastActiveAt），活跃时间只由真实用户活动路径（inject/_onResult/interrupt/reload）维护；新增走完整 restoreAndReconnect→markReconnected 链的回归用例。lastActiveAt 其余消费点不受影响：inject 死锁检测仅看 running 态、idle 回收默认关。
- ql-20260831-011-2d44：message_delta 差分补读 input_tokens（轮内输入实时显示）。背景：GLM 兼容端点 message_start 不带 input（实证：会话轮内徽标 ↑0、终态才有 4.8 万），daemon 原只从 message_start 取 input、message_delta 只读 output/cache——若 GLM 在 delta 携带 cumulative input 也被丢弃。修法：_bufferPartial 的 delta 分支补 input 差分累加（lastCallInputTokens 基线在 message_start 设为 startUsage 值：官方 Claude delta 无 input 零影响 / start 带 input 时差分 0 不翻倍 / start 无 input 基线 0 全额计入），main 桶 ctx 同步加 input 差量。pendingUsage→flush→SSE tokens 链路既有，前端徽标已改「↑执行中…」占位（ql-20260831-010）。生效条件：GLM delta 是否真带 input 待下次会话实测（带则轮内实时显示输入，不带则维持现状等终态）。
- ql-20260907-002-b595：修复 PiRpcDriver「pi 轮内 API 重试恢复后 turn 仍报失败」（会话 33f958d2 实机案：前 2 次 attempt 超时的 ame.error 写满 pendingTurnError，第 3 次成功出完整答案仍被粘滞旧值翻成 error_during_execution——该值轮内只在下一轮 inject 前清一次）。修法（pi-rpc-driver.ts handleLine）：两个轮内恢复信号到达即置 null——① 归一化事件 text+override 全文（message_end 的 assistant 完整产出终态）；② 原始帧 turn_end 且 stopReason≠'error'（清在归一化之前，真实失败轮 stopReason='error' 仍由归一化器产 error 事件重新写入，防过清）。codex driver 不动（beginTurn+上报后双清、成败权威在 turn/completed turn_status，success 路径本就忽略 stale 值，无此问题）。
- ql-20260908-007（stdout/exit 竞态，2026-09-08 审查低置信项修复）：CursorDriver `_runTurn` 原在 exit 事件后立即读 result 快照——Node 的 exit 不保证 stdio 已排空（官方文档行为，Windows 管道/大输出下 exit 可先于残余字节送达），迟到字节里若正是 result 帧，本轮被报成「成功但无正文无 usage」（exit 0）或丢 result 细节（非 0）。修法：exit 路径收敛前等 stdout end/close（`stdoutDrainedP`，close 兜底 kill/僵流；已结束/已销毁立即过），宽限 killGraceMs 超时按已解析内容收敛防挂死，`framer.end()` 幂等 flush 兜底 close-without-end 尾行。测试侧注意：fake-child `_emitExit` 先 push(null) 再发 exit，模拟的是理想时序——竞态用例须直接 `child.emit('exit')` 保持流打开来复现乱序。
- ql-20260909-026-ff18（早到 inject 竞态，2026-09-09 生产实机案会话 e05addf7）：修复 CodexAppServerDriver「新建 codex 会话首句发出后永久无响应、run 永久 running、零日志」。根因：backend 建会话即派发首句，inject 经 inject_wait parked 路径在 create 完成后立即入队，consume 循环握手写完（三条 300ms 间隔、不等响应）即取到输入，此刻 codex 的 thread/start 响应尚未到达（h.threadId=null），_writeTurnStart 静默 return → currentTurnPromise 永不 resolve，消息丢失 + 会话卡死（用户侧 codex 会话必现不可用）。修法（codex-app-server-driver.ts）：consume 循环 beginTurn 后先 `_awaitThreadId`（check-first 50ms 轮询，已就绪零延迟，thread/start|resume 响应都能解）再写 turn/start；超时（默认 30s，构造参数 threadIdWaitTimeoutMs 可注入，测试传毫秒级）按 turn failed 收敛（error_during_execution + 超时摘要 + console.warn thread_id_wait_timeout），循环继续消费后续 inject，不再静默挂死。诊断工具：runs/codex-interactive/<sessionId>.log（ql-20260624-007）+ 手动 codex app-server 探针验证（codex 本身健康、MCP node_repl 启动失败不阻塞 turn）。同型隐患：claude/pi/cursor driver 若也有「握手不等响应就消费输入 + 静默守卫」组合需各自排查。
- ql-20260909-027-4b26（codex 用量差值记账，2026-09-09 用量审计）：修复 codex run token 全 NULL（生产 3 run 实证 + 探针复现）。根因：json-rpc 适配器只从 turn/completed 的 turn.usage/token_usage/tokens 提取（sillyhub-daemon/src/adapters/json-rpc.ts），codex 0.147 实测该帧不带 usage；用量唯一真源是每次 API 调用后的 `thread/tokenUsage/updated` 通知（params.tokenUsage.total 线程累计 / last 单调用 / modelContextWindow）。修法（全在 codex-app-server-driver.ts，不动共享 adapter 免影响 batch task-runner）：① CodexHandle 加 threadUsageTotal/usageBaseline 双基线；② handleLine 原始行解析该通知（includes 前置检查，更新 total 快照；turn 在途时向 onMessage 发「本轮累计差值」usage_update 事件——text+content='' 载体，ledger replace 语义消费单调递增轮累计，非在途 stray 通知只更新快照防基线竞态）；③ 轮 start（写 turn/start 前）快照基线，轮末 `_applyTurnUsageDelta` 补差值到 outcome.usage（success/failed 统一，turn/completed 自带 usage 时优先；total 回退时重置基线防长期负差值）。映射口径：inputTokens 为含 cached/cacheWrite 毛值（totalTokens=input+output 实证），input_tokens=Δinput-Δcached-Δwrite（净输入 clamp≥0）、cache_read=Δcached、cache_creation=Δwrite、output=Δoutput。已知限制：resume 后首轮若 codex 才补报历史累计 total 会多记（探针未见此场景，实测观察）。同审计发现的 pi 低报见 ql-20260909-028；batch codex 任务（task-runner 路径）用量仍缺——adapter 不动的前提下留待后续。
- ql-20260909-028-2582（pi 用量逐调用累加，2026-09-09 用量审计）：修复 pi run 用量严重低报（对账实机案会话 e3d7ddfa：260 次调用全会话真实 in=216,799/out=108,101/cacheRead=31,351,360，平台累加只记到 5.7%/8.5%/1.9%）。根因：pi-events 归一化对 message_end 的 message.usage 零产出（只有 turn_end 产 usage 快照事件），而 turn_end 定格的是**最后一次调用**的用量；pi-rpc-driver 旧代码 `turnUsage = ev.usage` 的 replace 语义建立在「turn_end=轮级累计」的错误口径上（pi 会话 jsonl ground truth 实证每条 message.usage 是单次调用量，input 随调用起伏非单调）→ 轮内工具循环的中间调用全部丢失。修法（pi-rpc-driver.ts，不动 pi-events）：① handleLine 对 message_end 原始帧逐条累加 assistant message.usage（accumulatePiUsage，字段映射同 buildUsageEvent）；② 事件循环 turn_end usage 快照到达时以累加和为准（定格值与最后一条 message_end 同一调用，防双计），并把轮累计注入事件本体（ev.usage + ev.metadata.usage）——ledger replace 语义与 live 显示都拿到正确轮级值；③ 累加为空（旧版 pi message_end 不带 usage / 全 0 错误轮）退回定格值零回归。轮 start 重置累加器。同场审计结论：cursor（result 帧整轮聚合）与 claude（SDK 轮累计）记账正确；pi 预算台账（usage.ts liftSessionUsage）经 turn_end 注入轮累计后同样修正。历史 run 的丢失用量无法回补（中间调用从未上报过）。
- ql-20260910-003-0d35（三家用量接按模型明细表，2026-09-10）：agent_run_model_usage 明细 + run 级 api_requests 原本只有 claude 有（SDK modelUsage 透传，daemon _deltaModelUsage 差分 + _modelUsageRows 拆行）；codex/pi/cursor run 无明细行 → 按模型统计页空。修法：InteractiveDriverResult 增 `modelUsage?: Record<model, camelCase 四维>`（driver.ts 新类型 DriverModelUsage + addToModelUsage/setModelUsageSnapshot helpers），三家驱动各自维护**会话累计快照**随 result 上报，复用 daemon 既有差分/拆行/api_requests 分摊管线（daemon.ts 零改动；backend 零改动）：① codex——thread/start|resume 的 response 提取 **result.model**（生产会话 02559587 真实日志重放实证：model 在 result 顶层，thread/started 通知与 result.thread 均只有 modelProvider 不带 model——首版误挂通知形状，单测自造帧过了但生产不生效，真实帧重放测试抓出），_extractTokenUsage 时 setModelUsageSnapshot 覆盖（净输入分桶，口径同 _usageDelta）；② pi——**get_state 握手响应 data.model.id**（实测 RPC 流无 model_change 事件——那是会话文件记录类型；get_state 实测含 model 对象；会话中途 /model 切换不跟踪），message_end 逐调用 addToModelUsage（pi 四维本就是净输入分桶）；③ cursor——system/init 帧提取 model（每轮进程启动重发），result 帧 usage（整轮聚合）逐轮 addToModelUsage。失败轮同样附带（真实消耗不因轮失败缺行）。模型名未知时不记快照（行为同修复前）；api_requests 三层：① pi/codex driver 在 result 带 `api_request_count` 精确值（pi=message_end 带 usage 的 assistant 消息数、codex=tokenUsage 通知数），daemon 组装优先采用；② 无精确值（claude/cursor）回落 assistant text 事件计数启发式；③ **usage-only 空事件（type=text + content=''）排除**（daemon.ts 计数点，实证 codex 3 调用被记 6 / pi 2 记 3，在途 usage_update 空事件误计；claude flush 桶同款受益）；run.model 由 backend close 从明细最大行填充（顺带修正）。
- ql-20260911-003-355a（24h 审查 P2 修复·用量/读取三件，2026-09-11）：① **pi/cursor 受控 reload 基线回收**——`_reloadSession` 重建 driver 句柄成功后经新 `SessionManagerDeps.onSessionReloaded`（可选回调）通知 daemon `onSessionReloaded` 删除 `_modelUsageBaselineBySession[sessionId]`：pi/cursor 的 modelUsage 快照 per-handle 从 0 累计，句柄重建后快照归零而基线残留会让恢复首轮差分少记（复位检测只拦 cur<base 形态）；与 onSessionEnd 的基线回收（ql-20260831-009）同族，锚点=句柄重建。② **zcode SQLite 读取内存预算**——readZcodeSqliteMessages 遍历行累计 data code unit，超 `DEFAULT_MAX_CONTENT_BYTES`（20MB，与文件路径 lstat 预检同源常量；opts.maxContentUnits 可注入测试）返回 too_large，不再全量物化后切 200 段窗口。③ **zcode 分派存在性门**——host-fs-handler zcode 先库后文件分派前先 `lstat(abs)`：上报 rollout 文件必须真实存在才进库读取器（log_path 可经 platform_sync 自登记任意路径；文件缺失 → 回落文件流程最终 not_found，与未上报路径同语义）。
<!-- MANUAL_NOTES_END -->

## 2026-09-12-chat-turn-auto-recovery 增量（pi-rpc-driver）

- 静默中断检测（FR-2）：轮收敛（agent_settled 后无 pendingTurnError）时判定 `!lastWasFinalText` → 合成 error result（`[silent stream truncation] 上一轮输出流中断…`），session-manager 既有 classifyModelError 按断流关键词归 provider_error/retryable=true，后端三分支自动恢复得以触发。
- `lastWasFinalText` 标记翻转两入口（message_end 边粒度）：①raw message_end 拦截处（与 usage 累计钩同位）按 content parts 是否含非空 text part 收口——[text,thinking] 同消息排列终值正确为 true；②归一化事件循环内仅 tool_result 翻 false（thinking/override/partial 不动标记）。每 inject 重置。
- 判定仅一条：settle 后仍无收尾正文即报 error（零活动轮 / usage-only 轮 / thinking 尾 / tool_result 尾全覆盖）；误报容忍=紧链上限 2 封顶（D-003），nudge 文案含「若已完成请说明」。

## 2026-09-13 24h 审查 P2 两修（ql-20260914-001-b14c）

- atomic-write 目录 fsync：writeFileAtomic rename 后补 `open(dirname, 'r') + sync()`（POSIX 掉电窗口目录项持久；Windows 不支持开目录 best-effort 吞掉）——tests/atomic-write.test 加 open('r') 探针断言（跨平台记录调用意图，Windows 真实 open 拒由实现吞）。
- PROVIDER_RELOAD_ENGINES 派生化：手写 `['claude','codex','pi']` 改从 INTERACTIVE_PROVIDERS.switchable 派生（照前端 provider-caps.ts 同款手法）并导出——provider-adapter-registry.test 新增守护⑥锁「消费侧=注册表」+ claude/codex/pi 语义锚；新引擎声明 switchable:true 后前后端同解锁，消除前端放行而 daemon 抛错的漏网点。

## 2026-09-14 24h 审查修复：codex driver JSON-RPC id 单计数器（ql-20260915-001-8312）

- 撞号缺陷：CodexHandle 曾有双 id 计数器——`nextRpcId`（turn/start·turn/interrupt，≥3 无上界）与 `nextJsonRpcId`（compact 等「等 response」请求，seed 100）。seed 100 只在会话前 ~97 次轮级 RPC 内避开 nextRpcId 空间；长会话越过交叉点后两计数器分到同号，同 id 并发在途时 `_maybeResolveJsonRpcResponse` 按先到回执错配唤醒 compact pending（误报成功/失败，压缩命令本体仍会发出执行）。
- 修法：删 `nextJsonRpcId` 字段，`_sendJsonRpcRequest` 改复用 `nextRpcId++` 单源分配——任意时刻在途请求 id 全局唯一，撞号结构性消除；turn 路径零改动（fire-and-forget 不经 jsonRpcPending 表的语义不变）。
- 回归锚：tests/interactive/codex-app-server-driver.test.ts 新增防碰撞用例（把 nextRpcId 推到旧交叉点 100 → compact 取 100、并发 turn/start 取 101 分号不同、turn 回执先到不误唤醒 compact、正主 id 回执才 resolve）；既有 pending 机制/compact 组 8 处 seed-100 断言同步改为统一计数器语义（未发 turn 时首取 3）。

## 2026-10-10-all-engines-mcp-injection 增量（四引擎 MCP 注入）

- **providers.ts**：新增导出 `isMainAgentMcpCandidate(provider, stage?)`——主控会话 MCP 引擎门从 `provider !== 'claude'` 硬拒改为 `getProviderCaps(provider).mcp` 能力驱动（未知 provider 默认拒绝；stage 口径不变：orchestrator/缺省注入、mission_worker 走分身分支不受影响）；`PROVIDER_CAPS.pi.mcp` 翻 true（唯一依据 SPIKE-00 实测，pi 1.1.0）；codex/cursor 维持 false（D-011@v1 受阻裁定——宿主引擎不可用未能实测，机制代码就绪，复评 SOP 见 providers.ts 两注释块 + spike-codex-mcp.md / spike-cursor-mcp.md）。三端同步：frontend/src/lib/provider-caps.ts 与 backend provider_caps.py 产物由 gen-provider-caps.mjs 重刷（各 1 行 diff），backend 对齐守护测试锁定。
- **pi-rpc-driver.ts**：start 函数体内消费 `opts.mcpServers`——有配置时调 pi-settings.writePiMcpConfig 写 per-session mcp.json（形态①原生配置）；版本门控 `detectPiMajorVersion`（spawn pi --version，5s 超时/失败/乱串 → -1）：major<1 跳过写盘 warn 不阻断（pi 0.x 无 MCP）；PI_CODING_AGENT_DIR 缺失或写盘失败同样降级 warn 不阻断 spawn（MCP 是增强能力，三重降级）。`parsePiMajorVersion` 纯函数可单测。
- **codex-app-server-driver.ts**：start 函数体内调 codex-settings.writeCodexMcpServers 写 per-session CODEX_HOME/config.toml [mcp_servers.*] 托管段——caps=false 当前不触达（谓词层先拦），机制就绪待 SPIKE-01 复评翻值。
- **cursor-driver.ts**：零逻辑 diff，仅忽略注释同步（cursor 通道留档分支）。
- 写盘调用点纪律（D-012@v1）：两处消费均在 driver start 函数体内运行时执行，模块顶层零调用，写盘器（pi-settings/codex-settings）低依赖不回引 interactive/（无 TDZ 环）；driver-factory/driver.ts 注入管道零 diff（引擎无关管道复用）。
- 端到端证据：acceptance-e2e.md 五环节（注入→connected→工具可见 upload_file/list_uploaded_files→JSON-RPC 调用→backend 出站 401 结构化回传）；真实上传落文件中心为 daemon 部署后线上复验项（D-013@v1）。

## 2026-10-20-session-page-dsh-alignment 增量（每轮工作区快照 1b 与 TTFT/attempt 采集）

> 落地范围：线 C 1b 的 daemon 采集面（task-09 / task-10）+ 上报出口最小扩字段（task-13 / D-028）。
> 契约形状与生命周期事件见 `.sillyspec/changes/2026-10-20-session-page-dsh-alignment/design.md`
> 「### 文件变更卡 DTO」「### 1b 承载面与读模型字段」「## 生命周期契约表」（E1-E4）。本段只写已落盘实现。

**承载件与入口**

- `collectTurnFileChanges()`（`sillyhub-daemon/src/interactive/turn-file-changes.ts:803`）：入参 `CollectTurnFileChangesInput`——`runId` / `workspaceRoot` / `baselineHead`（可选：`string` 已解析基线、`null` 非 git 仓、`undefined` 交给采集期 git 兜底）/ `toolCallPaths`（本轮 `tool_use` 派生的路径集合）/ `turnStartedAtMs`（轮首墙钟，ignored 目录 mtime 探测的时间下界）/ `limits` / `execFile`（可注入执行器，测试用）。出参 `TurnFileChangesSnapshot`：`runId`、`baselineHead`、`collectedAt`、`collectMs`、`status`、`reason?`、`truncated?`、`files[]`、`concurrentSessionsHint: true`（恒 true）。**纯采集**：不写库、不上报、永不抛错。
- `deriveTurnTiming()`（`sillyhub-daemon/src/interactive/turn-timing.ts:217`）：纯函数、零 I/O、零时钟读取，入参是本轮「已到达事件」的时间戳序列 + 轮首/轮终态时刻，出参 `TurnTimingSnapshot`（`runId` / `basis` / `ttftMs` / `totalMs` / `attempts[]`）。零事件 / 缺轮首时刻 / 派生出的 attempt 全零宽或轮总时长 ≤ 0 → `null`——**不返回空壳对象、不填 `ttftMs: 0` 冒充**（版本门控靠「整体省略字段」表达）。

**性能红线（D-023③，验收项不是建议）**

- 每轮 git 子进程 **≤3（生产恒 3）**：`status --porcelain -z --untracked-files=normal --no-renames` + `diff --name-status -z --no-renames <baselineHead>` + `diff --numstat --no-renames <baselineHead>`；baseline 未解析的兜底路径为 4 条（+`rev-parse`）；不按文件数扩子进程。全局参数恒带 `-c core.preloadIndex=true`、`-c core.quotePath=false`、`--no-optional-locks`（`GIT_BASE_ARGS` 常量，`sillyhub-daemon/src/interactive/turn-file-changes.ts:84`），禁 shell（`execFile` 参数数组）。
- **E1 轮首基线零子进程**：`readBaselineHead()`（`sillyhub-daemon/src/interactive/turn-file-changes.ts:930`）直接读 `<workspaceRoot>/.git/HEAD`（含 linked worktree 的 `gitdir:` / `commondir` / `packed-refs` 解析），三态 `string`（基线）/ `null`（非 git 仓，采集期不再跑 `rev-parse`）/ `undefined`（复杂形态，采集期由 git 自己兜底——那时已是轮尾，不占工作区 cwd 的短命窗口）；永不抛错。注释里写明「生产采集因此少一条 rev-parse」（生产 3 条：status + name-status + numstat；未解析基线兜底 4 条）的理由（Windows 上以工作区为 cwd 的任何子进程都会短暂占住目录）。
- 复杂度 O(改动数 + 工具调用数)，无全仓扫描；**禁 rename 检测**，`R`/`C` 条目归一成 delete + add 两条（`parsePorcelainZ`，`sillyhub-daemon/src/interactive/turn-file-changes.ts:329`）；`--untracked-files=normal` 下新增目录只报一条 `?? dir/`（不展开逐文件，是上限内的取舍）。
- **自适应硬超时**（默认 1500ms，见 `resolveTurnFileChangesLimits`；`/mnt/` ≥8s、历史 timeout 翻倍封顶 15s）：`Promise.race` + `AbortController` kill 子进程 → `status="partial"` + `reason="timeout"`；status 已成功时**保留已采清单**（files 非空、行数破折号），只有 status 本身失败才 `files: []`。
- 改动数超 `maxFiles=500` → `truncated=true` + `partial`（卡片照出，行级 +/− 退破折号）；`includeLineCounts=false` 退档（只跑 status）→ `partial` 且**不带 `reason`**（枚举里没有「行数未采」值，`files` 清单仍可信，行数不可信）。

**单工作区串行队列（防与用户操作争 `index.lock`）**

- `Map<workspaceRoot, tail>` 单飞队列，每工作区等待上限 `maxQueueDepth=1`（`reserveQueueSlot`，`sillyhub-daemon/src/interactive/turn-file-changes.ts:153`；`enterQueue`，`sillyhub-daemon/src/interactive/turn-file-changes.ts:174`）；工作区键在 Windows 上小写归一，避免同一目录两条队列。
- 队列已满 → **立即** `partial` + `reason="queue_overflow"`（不排队、不采集、不阻塞轮收尾）；同一工作区多会话并发轮尾绝不并发跑 git。

**ignored 目录 mtime 探测（R-09 的唯一补偿面）**

- `probeIgnoredByMtime()`（`sillyhub-daemon/src/interactive/turn-file-changes.ts:492`）：只对「不在 git 结果里」的本轮工具调用路径做 `stat` 探测；`mtime`（含 1s 时钟容差）落在轮首之后的文件 → `source="mtime"`、行数记 `0/0`（git 看不到的改动不伪造行数），`birthtime` 也在本轮之后 → `added`，否则 `modified`。
- **必须有 `turnStartedAtMs` 才探测**（缺省直接跳过）：没有时间下界就分不清「本轮新建」与「早就在那里的普通文件」，宁可不报也不假报。已知边界：tracked 但内容未变、仅 `mtime` 变了的文件可能被判成 `source="mtime"` 的 modified；卡片按来源标注，「不是 git 口径」对用户可见。

**归因**

- `EDIT_TOOL_NAMES` 白名单（edit / write / multiedit / notebookedit / apply_patch / edit_file / write_file，大小写不敏感）命中本轮工具调用路径 → `attribution="edit_patch"` + `editToolNames[]`（来源工具名，保序）；其余一律 `"command"`（命令行/脚本改动）。**禁止用 `edit_patch` 反推改动来源**（D-023：真实导出仅 91/1271 条带 patch，bash/sillyspec 类改动无 patch）。

**时序约束（E2 必须在轮终态落库之后异步执行）**

- 调用点 `SessionManager._onResult`（`sillyhub-daemon/src/interactive/session-manager.ts:1694`）：先取 `const runId = state.currentRunId`（`sillyhub-daemon/src/interactive/session-manager.ts:1697`，`onResult` 内部会清 `currentRunId`，不先取就丢本轮键）→ `await onResult(...)`（`sillyhub-daemon/src/interactive/session-manager.ts:1698`，轮终态 / SSE 终态在此落库）→ `_startTurnFileChangesCollection(state, runId)`（`sillyhub-daemon/src/interactive/session-manager.ts:1701`）**fire-and-forget**。禁止 await 采集：硬超时（默认 1500ms/慢盘自适应）绝不能拖住轮结束与 SSE 终态，快照允许「后到」（前端收到才渲染卡片）。
- 事件旁路累加在 `_onMessage`（`sillyhub-daemon/src/interactive/session-manager.ts:1704`）内、既有消费链之前：`_noteTurnToolCallPaths`（`sillyhub-daemon/src/interactive/session-manager.ts:1845`，工具入参路径集合）与 `_noteTurnTimingEvents`（`sillyhub-daemon/src/interactive/session-manager.ts:1876`，text/thinking/tool_use/tool_result 四类 + 事件到达墙钟 `atMs`）只读既有事件字段，**不改事件协议**；无 `runId` / 无累加器（恢复出的会话首轮等）时静默跳过，事件消费链零影响；两类累加器各有条数上限护栏（`TURN_FILE_CHANGES_MAX_TOOL_PATHS` / `TURN_TIMING_EVENT_MAX`）。
- **一次收口**：`_startTurnFileChangesCollection`（`sillyhub-daemon/src/interactive/session-manager.ts:1904`）先摘除累加器（一次性消费，防只增不减）→ `deriveTurnTiming` 派生本轮 timing（`turnEndedAtMs` 取进入本方法时的墙钟，即 `onResult` 刚结束的时刻，后续 git 采集耗时**不算进轮时长**）→ 采集 → `_buildTurnSnapshotReport`（`sillyhub-daemon/src/interactive/session-manager.ts:1954`）组装唯一 payload（`timing` 为 `null` 时**键不出现**，既不是空对象也不是 `{ basis }` 壳）→ `_reportTurnSnapshot`（`sillyhub-daemon/src/interactive/session-manager.ts:1977`）按 `runId` 覆盖写缓存 + 经 `setTurnSnapshotReporter`（`sillyhub-daemon/src/interactive/session-manager.ts:1770`）注入的 reporter 单次回调。全链 try/catch + `void`：采集或上报异常都不得回灌轮终态链路。
- 上报链路（D-028）：`daemon.ts` 的 `_onTurnSnapshot` 用 `buildRunSnapshotPayload` 把 `file_changes` / `timing` / `daemon_version` 追加进 `RunResultPayload`，**复用同一 run-result 端点补报**（首报载荷无法等待采集，故快照「后到」、复用同端点），不新增端点；`hub-client` 侧只做「字段缺失就不写」的最小扩字段（`undefined` → 键不出现 → backend 写 `capability="tool_only"`）。backend `(run_id)` 幂等覆盖写见 `backend/modules/daemon.md`「run 快照读模型」。

**TTFT / attempt 口径（D-032：实测恒 `approx`）**

- `TURN_TIMING_BASIS` 常量（`sillyhub-daemon/src/interactive/turn-timing.ts:144`）当前值恒为 `'approx'`：spike-02 逐 driver 核对后确认三引擎在 daemon 事件边界上**都没有稳定的「模型请求起点」信号**（claude 的 `message_start` 被归一化器用于 `api_duration_ms` 而不产 `AgentEvent`；codex `turn/started` 只标轮起点；pi `message_start` 是纯生命周期帧），`observed` 分支保留给未来驱动升级，当前无 producer——不装假开关。
- attempt 切分：起点 = 轮首（首 attempt）或**本批工具全部 `result` 返回**的时刻（并行工具取最后一条）；终点 = 下一个 `tool_use` 或轮终态；首 token = 首个 text/thinking delta。工具执行期到达的 text/thinking **不计入**模型占用，因此 attempt 与工具区间**零重叠**（构造性保证，非靠事后裁剪）。
- `ttftMs` 只取首个 attempt 的首 token 延迟；未取到 → `null`（禁填 0）。无时间戳的 delta 一旦出现，本 attempt 首 token 时刻永久未知——后到带时间戳的 delta 不得冒充（否则 TTFT 被写大）。
- 已知偏差（诚实披露）：claude 的 text 事件走 500ms partial 节流，TTFT 观测值最多偏大一个节流窗口；`attempts[].startedAt` 是上述**边界近似**而非请求发送时刻，前端必须按 `basis` 标注（见 `frontend/modules/components-daemon.md` 模型泳道两态）。

**遥测与降级语义**

- `getTurnFileChangesTelemetry()`（`sillyhub-daemon/src/interactive/turn-file-changes.ts:715`）读 50 样本滑窗（`TURN_FILE_CHANGES_TELEMETRY_WINDOW`）出 `samples` / `p50` / `p95` / `degradeRate` / `subprocessCountMax`；红线 p50 > 300ms 或降级率 > 5% 报警。spike-01 安静窗口实测：worktree 语料（21 改动）245ms / 480ms、主仓（111 改动）318ms / 379ms——重脏仓超线已登记 R-07，退档开关 `limits.includeLineCounts=false` 已实现并单测。
- `partial` **不是错误态**：卡片照出、行级 +/− 显示破折号，不伪造数字；`unavailable`（`not_a_repo` / `git_missing`）与 `failed`（未知 git 错误）由前端按 `capability="tool_only"` 走降级卡。任何情况下都不把「没有快照」写成「本轮无改动」（E6/E8 硬约束）。

## 2026-10-22-file-changes-card-fix 增量（采集口径与慢盘预算）

- 文件清单来源改为 `git status --porcelain -z` ∪ `git diff --name-status -z <baselineHead>`：status 覆盖未提交/未跟踪，name-status 覆盖**轮内已提交**改动；`git diff --numstat <baselineHead>` 只补行数/二进制。合并优先级 status > name-status > numstat（numstat-only 路径状态保守归 modified）。子进程：baseline 已知 ≤3（status/name-status/numstat），未解析基线的兜底路径 4（+rev-parse）。
- 分阶段收口：只有 status 失败才 `files=[]`；name-status/numstat 失败只降级状态精度/行数，保留已采清单（`status=partial` + `reason=timeout`）。外层硬超时同样按 `CollectProgress` 已完成阶段组装清单，不再丢掉 status 面。
- 预算：`resolveTurnFileChangesLimits()`——显式 limits > env `SILLYHUB_FILE_CHANGES_TIMEOUT_MS` > 默认 1500ms；`/mnt/<drive>/` 基础 ≥8000ms；该工作区 timeout 后翻倍升级（+2s 起步，封顶 15000ms，进程内记忆，`resetTurnFileChangesTelemetry()` 清空）。
- `editToolNames` 不再按工具名去重：数组长度 = 本轮编辑调用次数（前端「改N次」口径），工具名提示由前端去重展示。
- 测试面：`tests/interactive/turn-file-changes.test.ts` 新增轮内 commit 入列、numstat 超时保留清单、name-status 超时 numstat 兜底、慢盘预算、自适应升级、编辑调用计数 6 类用例；子进程预算断言随 3/4 条更新。
