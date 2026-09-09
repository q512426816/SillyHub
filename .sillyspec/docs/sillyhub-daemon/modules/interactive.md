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
  prompt）/ `requestPermission` / `requestUserDialog` / `registerBorrowSandbox` /
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
写守卫: policyEngine.canWrite(runtimeId, path, provider, tool) 覆盖 Write/Edit/
  MultiEdit + Bash 经 extractShellWritePaths 提取写目标；读工具不拦；
  policyEngine 未注入时退化 allowedRootsProvider fallback（空数组放行防全 deny）
主 agent MCP: isMainAgentSession(ctx.stage==='orchestrator') → mainAgentMcpConfigProvider
  经 mergeMcpConfigs 注入 daemon 内置 MCP server；恢复时按 record.stage 重注入
reloadWithProvider: buildSpawnEnv 构造新 env；null=停止供应商回退本机凭证。
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
<!-- MANUAL_NOTES_END -->
