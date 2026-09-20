---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 本地执行与交互（daemon）

## 定位
跨组件「本地执行与交互」功能域 = backend daemon 模块（注册/心跳/租约/会话/WS Hub/文件与代理通道，调度与状态权威）+ sillyhub-daemon（Node ESM 进程，claude-agent-sdk / codex app-server 的实际执行体）。
backend 与 daemon 经 WebSocket + REST 双向通信，支持三种执行形态：批处理 lease（无状态任务）、交互式 session（有状态长对话）、host_fs/patch 文件通道（平台远程读写 daemon 宿主文件）。另承载 daemon 单文件分发（dist_router）与 LLM 网关透传（llm-proxy，master key 不出 hub 进程）。

## 契约摘要（backend 侧）
- **runtime / lease**：
  - RuntimeService：注册/心跳/实例列表/机器级聚合读（machines 含别名、版本、构建号、启动时间、用量视图，规避 N+1）/别名更新/离线标记/禁用启用删除/失联清理/自更新指令下发（复用 WS self_update 消息，仅改路由键）/本地缓存清理指令下发（WS cleanup 消息，fire-and-forget，daemon 侧黑名单删除且跳过有活跃交互会话的机器）/机器级删除（ql-20260829-006：`DELETE /machines/{id}` 物理删 daemon_instance，守卫链=归属 404 → 心跳 45s 新鲜 409（daemon 心跳 404 不重注册、删在跑机器=僵尸心跳，须先停 daemon）→ workspace_member_runtimes 绑定 409（daemon_id/runtime_id 双列 RESTRICT 前置）→ daemon_runtime_grants 409（含停用行）→ daemon_borrow_audit 409（审计红线不可删）→ in-flight lease/change_write 409（删前先收敛孤儿 lease，ql-20260830-006：interactive 绑定会话已 ended/failed 或 claimed 已过期的可证死行置 cancelled——生产实证 26 行 23 天孤儿把删除永久 409；真在途仍拦）→ IntegrityError 兜底 409；通过后 CASCADE 清该机全部 runtimes 及其会话/任务记录，scan_docs SET NULL；错误类 DaemonMachineInUse=HTTP_409_DAEMON_MACHINE_IN_USE；前端 MachineCard 仅离线机器可点删除）。
  - DaemonLeaseService：claim（claim_token 鉴权 compare_digest）/heartbeat/过期回收（expire_overdue_leases + stuck_terminating 告警）/cancel（区分 interactive 会话取消与 batch lease 取消两路下发）。
- **claim payload 组装**（lease/context）：
  - provider 配置四级解析：run 绑定 profile 的 `llm_provider_id`（归属校验 user_id==runtime.user_id + agent_kind 一致）→ 平台默认供应商 → 本机不注入。
  - openai_chat 类供应商不下发 master key，改发 `litellm_proxy` 标记 + hub 代理地址（daemon injector 转 ANTHROPIC_BASE_URL 指向 hub，子进程 Bearer 打 hub 代理）。
  - profile 透传（mcp/skills/凭证/allowed_roots）；mission 预算注入。
  - 供应商热切换：默认供应商变更 → 按 daemon 分组推 `DAEMON_MSG_PROVIDER_CONFIG_CHANGED`，daemon 在 turn 边界 reload（close 旧 query + resume agentSessionId 保留历史），停止推 null 回退本机凭证。
- **session**：
  - create/inject/interrupt/end/reopen/recover/confirm-reconnected/mark-recovery-failed/ready 上报 + SSE stream + logs（`GET /sessions/{id}/logs?after=` 增量游标，P4 2026-08-24：前端断线 resync/轮后对账增量拉取，游标-2s 重叠 + log_id 去重兜同批同 timestamp 边界；gzip 回显的 dumps+compress 纯 CPU 段 asyncio.to_thread 化，ql-20260909-012——长会话几十 MB payload 压缩 100-300ms 原直接卡事件循环）；sillyspec 冲突对比 `SillySpecCompareService.compare` 的比对（同步 FS IO 逐文件 stat+read + difflib）与 2MB 体积护栏同样 to_thread 化（同上 ql，spec 树几百文件时原阻塞数百 ms-秒级）；spec-tree 的 identical 判定走 `_lines_equal` 行尾归一化（与 `_aligned_diff_rows` 同口径，ql-20260909-025——本地 Windows 检出 CRLF vs 平台副本 LF 的仅行尾/末尾换行差异不再判 modified，修「只看差异清单挂肉眼相同文件且逐行无高亮」假差异；ql-20260910-005 口径收紧：两处共用 `_normalized_lines` 单一源——`splitlines(keepends=True)` 逐行 `rstrip("\r\n")` 只归一 \r\n/\n/\r 三种真行尾，裸 splitlines 会把 \v/\f/\u2028 等罕见分隔符当行边界吞掉致字节不同判 identical，收紧后两处一致判 different 且高亮真实）。
  - reopen 会话级供应商凭证链（ql-20260827-014，生产实证修复）：reopen_session 建 lease 时补写 `session_llm_provider_id`（与 create 同款键——漏写会让 claim/恢复链路解析不到会话供应商），SESSION_RESUME WS payload 携带 `resolve_bound_provider_config` 解密的 `provider_config`（与 claim payload 同一真相源）；解析失败/None 降级缺键 + warning 不阻断 reopen（对齐 claim 链 `_inject_provider_config` 降级语义），daemon 走本机凭证链。
  - 排队消息 retry 成功派发返回删除前快照（ql-20260827-019）：retry 翻 pending 后立即派发，成功即删行——re-get 必为 None，旧代码裸 assert 在此路径必 500（消息其实已发出）；现返回 detached 快照（status=dispatched），前端以 SSE/重拉队列为准。
  - 排队消息通知合并（ql-20260827-015，生产实证修复）：inject 端点恒 `queue_when_busy=True`，daemon 后台任务终态唤醒（ql-20260827-007 `_scheduleTaskWakeup`，2s debounce 只覆盖 2 秒窗口）在长轮期间每任务终态注入一条「[后台任务通知]」排队——计数只增不减、派发后逐条烧一轮模型汇报（会话 17f10040 实证）。修法：入队分支对通知前缀做同会话 pending 合并（任务行追加 + 头/尾计数改写、`_merge_task_wakeup_prompt` 行级解析），通知类排队恒 ≤1 条；普通消息互不合并。
  - 派发轮 user_input 实时推送 + 打断终态可区分（ql-20260918-003，生产实证修复）：①排队派发轮（立即发送/轮末自动派发）的用户消息气泡实时缺失（刷新才可见）——根因是 `_inject_into_session` 的 user_input 日志由 backend 直接落库、不经 daemon 上报管线故无 Redis 发布，而前端实时路径 onLog 对 user_input 只提 preamble 不写 prompt；修法：commit 前快照标量、commit 后按 daemon 上报同形态（publish.py session_payload）补发 `event=log`+`channel=user_input` 事件，前端 page/dialog onLog 在 turn.prompt 为空时写入剥前导正文（含附件标记原文，直发占位轮/daemon 双提交裸文本版到达时非空天然幂等，终态轮重放带守卫不误置 currentRunId）。②打断轮被渲染成「轮次失败」误导（立即发送忙时打断/手动打断同源）——daemon SDK abort 上报 error_during_execution 落 run.status=failed；修法：turn_completed 事件补 `error_code` 直传（`_close_post_commit`），前端 deriveTurnTerminalStatus / runTerminalTurnStatus / mapRunStatus / dispatchRunSynth 四处识别 `error_code=interactive_interrupted` 映射 killed（UI「已中止」），真实失败（interactive_failed/interactive_unknown_status）与无码老事件保持 failed。
  - 单聊忙轮引导直注入（2026-09-18-single-chat-steering）：inject 端点（backend/app/modules/daemon/router/session_crud.py:588）provider 能力门控——请求可进忙轮分支时（不带切换维度且有 prompt/附件）读会话行 provider 经生成镜像 `get_provider_caps` 判 steering 键（单源 daemon PROVIDER_CAPS 第 14 键）：支持 → `busy_strategy="inject"` 复用群聊 `_inject_mid_turn_into_run` mid-turn 注入活跃轮（不建新 run 不 interrupt）；不支持（cursor/未知默认 false）或携带切换维度 → 维持 queue_when_busy 排队现状。SessionInjectResponse（:83）增 `steered` 出参（映射 service 层既有 `mid_turn`，不新建平行字段）。⚡ dispatch_now（backend/app/modules/daemon/session/service/queue.py:594?）不再无条件 interrupt：caps steering 且条目不带轮边界维度（profile/provider/model 快照全 None 且非 auto_resume）→ mid-turn 注入返 `dispatch_mode="steered"`（注入成功删排队行）；不可引导 → 既有 interrupt 接力（"interrupted"）；无活跃 run → 当场派发（"dispatched"）；QueueDispatchNowResponse（backend/app/modules/daemon/schema.py:567?）增 dispatch_mode 三态、interrupted 字段保留兼容派生。详见文末「增量（2026-09-18-single-chat-steering）」。
  - `/team` 前缀派发层剥离（ql-20260901-002）：前端发原始输入（消息气泡/历史回放显示 "/team 目标"，对齐技能指令显示形态；旧版前端剥离导致气泡丢前缀），agent 永不接收字面前缀——剥离收口到本层派发组装点 `_strip_team_command_prefix`（create 的 dispatch_prompt / inject 的 SESSION_INJECT payload 与 SESSION_SWITCH_CONFIG prompt；正则整条指令匹配，`/teams` 不误伤）。展示层（AgentRunLog user_input / 排队条目）保留用户原文；mission objective 回填（create 回落与 inject 占位回填）用剥后文本，裸 `/team` 剥后空文本不回填占位（前端裸指令无内容不发送，此处为 API 直发防御）。
  - create_session workspace 归属校验（2026-08-19-sessions-workspace-selector）：workspace_id 非空时先经 `allowed_workspace_ids(user, WORKSPACE_READ)` 校验可见性，不可见抛 404 `HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND`（校验在读 Workspace 行之前，不在事务内，失败不落库）。
  - `SessionReadiness` 模块级单例（mark_ready/wait/clear）：daemon create/recover 完成后 POST /ready 上报，backend 发 SESSION_INJECT 前 await wait(30s)，超时 fallback 仍发兼容旧 daemon——防 inject 早到 daemon 丢消息。
  - 自动续跑（2026-09-10-auto-resume-interrupted-turn）：recover 收敛中断 run 同事务内（SAVEPOINT）11 道守卫全过则把中断轮最后一条 user_input 包「先自查已完成部分再继续」提示词，以 origin='auto_resume:<源 run id>' 落排队消息（position 队首）；confirm 翻 active 后既有 D-008 钩子派发（G10 派发时守卫防手动重发竞态），新 run 打 metadata_.auto_resume_of（链上限 2 防崩溃循环）；守卫/模板单一源 session/service/auto_resume.py；开关 PATCH /sessions/{id}/auto-resume（config.auto_resume_interrupted，缺省开）；daemon 侧零改动。
  - permission_service：权限请求落 dialog 行、pending/history/workspace 级聚合、响应下发、超时收敛。2026-09-15-background-task-permission-lockout：payload.background_task=True（daemon 后台锚点态标记）时 current_run 校验块替换为 run_id 直查+agent_session_id 归属校验（后台任务派发轮次已 completed）；全部校验失败分支 return False 前经 _deny_respond 即时推 PERMISSION_RESPONSE deny（PLATFORM_PERMISSION_DROPPED: 前缀 + runtime_id ack 键，best-effort）——不再静默吞（线上实证重启后 run_mismatch 静默丢弃问答卡+daemon 无界挂起）。dialog 应答翻转是条件 UPDATE（`WHERE status='pending'`，0 行重读按终态抛 409 携先到者 answered_by/404——ql-20260910-005 先到先得原子化：守卫段 dialog 行是无锁快照且行锁随守卫 commit 释放，并发双答时旧 ORM 直写会后到覆写 answered_by/answer 且 SSE 双发；群聊影子答题放开后可答集合扩大到全体群成员，竞态可达性随之放大）。
  - 僵尸收敛 sweep 三档（`sweep.py`）：① reconnecting 超窗（180s）→ failed（DS-6 原档）；② `session_offline_sweep_once`——active/pending 会话其 runtime 非「online 且心跳≥600s 宽限」→ 主会话 suspended（非终态可 recover，run failed + 挂起 lease cancelled；worker 子会话/pending → failed，A5/S1 分流），suspended 非终态只广播列表 status_changed 不发 session_ended，超 24h GC 翻 failed 才发；③ `session_auto_recover_sweep_once`（ql-20260831-006-6d67）——suspended 主会话其 runtime 重新「online+心跳宽限内」且挂起满 60s → 翻 reconnecting + 发 SESSION_RESUME 控制指令（payload/供应商凭证对齐 reopen 路径），daemon restoreAndReconnect→confirm 翻 active；修 backend 重启场景 daemon WS 断开被误挂起后无人恢复（既有恢复链只在 daemon 自身重启时触发）。**排除项（quick 2026-09-01 风险审查修）**：候选与条件 UPDATE 均过滤 `deleted_at IS NULL`（suspended 软删残留行不复活——否则 confirm 翻 active + 补派发遗留排队消息成列表不可见僵尸）+ NOT EXISTS 归档工作区（对齐 reopen `_ensure_session_workspace_writable` 口径）；`confirm_session_reconnected` SELECT 同步加软删过滤（daemon 重启恢复链本地 sessions.json 仍含已删会话，迟到 confirm 按不存在→rejected）。终态写入点 `cancel_lease`（kill 把会话置 ended）也广播 session_ended；SSE 生成器对 `session_recovery_failed` 同样收尾（agent/service.py stream_session_logs）。
- **run_sync**：
  - `submit_messages`：daemon 上行消息落库；partial/complete 用 segmentId 跨调用去重（`_revoke_committed_partials` 撤已提交半截）；pending→running 用原子条件 UPDATE 防迟到的 submit 覆盖终态（lost update）。quick-9f86d2c3（2026-08-27，会话 e87622aa）：完整行展开 segmentId 格式对齐 daemon partial 的 task-13 格式 `${parent}:${mid}:${type}`（text/thinking；原 `${mid}:${idx}` 与 partial 永不匹配致同调用判定与跨调用清理全部空转、partial 行永久滞留 DB）；完整行落库时不再只依赖 override 信号——直接 `_revoke_committed_partials` DELETE 已 commit 的同 segmentId partial（interactive 每消息独立 HTTP 提交，partial 先 commit、完整行后到是常态）。quick-0e56260f（2026-08-27，会话 0ef651b6）：完整行落库点 backend **合成 override 令箭**——①落一行标记（content=`[*_OVERRIDE] <segmentId>`、segment_id=NULL 防误删、mid=unknown 退化跳过）：partial 落库前查标记（判定 3）堵「完整行 DELETE 跑完后 partial 事务才提交」的并发竞态 + 完整行实时发布丢失时轮后对账重放补投；②published_logs 追加同形信封（stale=True）实时治愈前端乱序胶水段（直播窗口 Redis 发布部分丢失 → 前端按到达序拼出非前缀胶水段，前缀收编失效；前端据令箭按段 id 任意位置撤回，复用既有 override 链路零改动）。标记行在历史回放分类为 override 不渲染；不计入返回 count。
  - `_cleanup_stale_runs_impl` failed 分支补 error_code=SERVICE_RESTART_INTERRUPTED + error_detail（2026-09-15-background-task-permission-lockout FR-04，completed 恢复分支不写）；daemon 侧配套：run 收口时会话仍有存活后台任务→追加 [USAGE_NOTE] 标注行（SDK 会话级累计快照差分的归属误导如实标注，不改数值）。
  - `sync_agent_run_status`、`close_interactive_run`（gate 任务仅 verify 阶段适用 `_gate_applicable`，勿扩大）。
  - `_trigger_stage_completion_callback`：lease 完结回调驱动 change stage 收口；`_advance_team_stage`：execute 团队 mission 全 worker 收敛后推阶段；`_handle_team_run_completion`。
  - gate/stage 状态变化事件发布（`_publish_gate_status_changed` / `_publish_stage_status_changed`）。
- **文件通道**：host_fs（delegate + WS RPC，平台对 daemon 宿主文件的读写原语，rpc_id 关联）；patch（apply_patch_to_worktree 经 host_fs delegate 打补丁）；change_write 代写队列端点（claim/complete，change_writer proxy 的对端）。
- **WsHub**：runtime→WebSocket 映射与 stale 驱逐；notify_task_available / send_wakeup / heartbeat_ack / session_control / permission_response / self_update / cleanup / policy_update / send_rpc（rpc_id 关联 + 超时取消 + 全量 cancel）。
- **llm-proxy**：`ANY /api/daemon/llm-proxy/{path}`——hub 进程持 master key 代理转发 LiteLLM；v1 路径白名单；校验 daemon apiKey 归属后注入 master key；模型归属校验失败拒绝。
- **WS 升级期鉴权**：无/坏凭据 close 4001，解析 user 与 DaemonInstance.user_id 归属不匹配 close 4003；query token 回退已删，未升级旧 daemon 一律 4001。
- **dist_router**：`/daemon/install.sh`、`latest.json`、单文件 JS——无 /api 前缀无鉴权的安装分发通道。
- **audit / model_error**：daemon 操作审计查询子域；模型报错 DTO 归一。
- facade `service.py` 集中 re-export 各子包（runtime→lease→patch→session 顺序）异常/常量，全部 import 路径兼容。

## 契约摘要（sillyhub-daemon Node 侧）
- **CLI**（cli.ts，commander）：start/stop/status/logs 四子命令；PID/日志文件在 `~/.sillyhub/daemon/`；start 必带 `--server`（不带会静默连 8000 兜底）；信号 handler 在 Daemon 内部注册，CLI 层不重复（防双重 stop）。status 运行中但运行锁反查失败时五个规范字段照旧（task-22 逐字断言）后追加中文提示行揭示回退 DEFAULT 档案（ql-20260906-001——生产实证未注册 daemon 显示 localhost 旧档案掩盖机器未上线）。
- **Daemon 类**（daemon.ts）：detectAgents → register → 三循环（lease 领取含 `_leasePollSkippable` 节流 / WS 心跳 / 会话控制）；无 agent 不注册时 `no_agents_detected` warn 级 + 中文修复提示（ql-20260906-001——launchd 默认 PATH 无 Homebrew CLI 目录致探测为空、机器 0 注册跑整天无人察觉，info 级静默一行用户无感）；停机 `_suspendSessionsOnStop` 在 `_registeredRuntimes` 为空（本进程从未注册成功）时跳过 suspend-batch（backend 无实例行必 404，2026-09-05 生产实证；遗留 active 会话由 600s offline sweep 兜底，A5 fallback 语义不变）；心跳回包 `_syncAllowedRoots`（JSON 相同短路防风暴）+ policy cache 同步；borrow workspace 管理器；turn result/message 回调（ql-20260909-011 起 message 上报走微批——per leaseId:runId 队列 20ms 窗攒批一次提交[单 drain 协程保序，flatSeq 入队前取号]，`SILLYHUB_INTERACTIVE_BATCH_MS=0` 旁路回逐条直发[vt 全局 0，既有断言语义不变]；onTurnResult/onSessionEnd 开头 `flushInteractiveBatches` 强制冲队保证 message 先于 result 落库，取代原 async 逐条串行）；session end 上报；recover/confirmReconnected；interactive create 抛错主动回传 notifyRunResult failed（P2b/daemon H4，2026-08-24 会话审查——interactive lease 恒 NULL 过期时间，不回传则 run 永久 pending）；认领段 cwd 守卫（2026-08-28-fix-cross-machine-worker-dispatch FR-05/D-004@v1——workspace 绑定会话 rootPath 非空字符串且非借用 marker 时经 `interactive-cwd-guard.ts` checkWorkspaceBoundCwd 白名单终检先行+stat 存在性，任一拒绝 notifyRunResult(error_during_execution, 中文 result_summary) 后 return **不 mkdir**（gap-8 无差别 mkdir 已收敛：仅空 rootPath 兜底路径保留，防错机派发静默建空目录跑偏；cwd 解析改 truthy 判定，`??` 不兜空串））。
- **autostart/**（跨平台自启策略，index.ts 按平台分派 macos/linux/windows）：macOS launchd plist 固化注册时 `process.env.PATH` 进 `EnvironmentVariables`（ql-20260906-001——launchd 默认 PATH 仅 /usr/bin:/bin:/usr/sbin:/sbin，Homebrew CLI 目录不在内 → daemon 探测不到 AI CLI 按「无 agent 不注册」语义机器永不上线，2026-09-05 生产实证 Mac-mini-3 注册 0 次；空 PATH 省略键退回旧行为）；Linux systemd 用户单元对称 `Environment=PATH=` 同缺陷修复；Windows 计划任务继承完整用户环境无此问题。
- **interactive/**：三驱动（2026-09-04-provider-pi-onboarding 增 pi）——pi-rpc-driver（`pi --mode rpc` 长驻 JSON-RPC：严格 LF 分帧禁 readline/get_state 握手合成 session_started/inject prompt-steer-follow_up 三模式+按 pi 错误文案降级/agent_settled 四级收敛/extension_ui_request 自动回 cancelled/ui resume 用 `--session` 旗标[非 --session-id]/crash 会话级 fail）+ pi-events 归一化（rpc 事件→AgentEvent v2，实证 pi 无顶层 error 事件——失败经 turn_end stopReason 浮出；usage cacheRead/cacheWrite→cache_read/cache_creation；2026-09-07-pi-task-events 增实例级 turnTask 状态机派生 status/agent_task_status——一轮一任务 task_id=pi-t<seq>（turn_start→running）、工具调用刷新 last_tool/tool_uses、turn_end stopReason error→failed 其余→completed（D-001/D-002@v1），status 事件先行、零侵入复用上报链路，pi 会话任务执行面板由此有数据）；providers.ts INTERACTIVE_PROVIDERS 注册表（family 复用 adapters 6 协议联合）+ProviderCaps 单源（三端镜像+源文件读取守护；steering 第 14 键——2026-09-18-single-chat-steering：运行中会话追加消息转向通道，pi/claude/codex=true、cursor 与未知 provider=false）；pi caps：resume/multimodal/thinking/model_select=true，mcp/edit_patch/permission_dialog/subagent=false（subagent vendored 示例扩展实证聚合型无归属）；vendored pi 扩展在 vendor/pi-extensions/（bundle 随发，SILLYHUB_PI_SUBAGENT_EXTENSION 可关）。claude-sdk-driver + codex-app-server-driver 双驱动（codex 多轮 consume 只订阅 input 队列一次——迭代器循环外创建，循环内 next()；InputQueue 单订阅，每轮重订阅第二轮必抛 SessionQueueDoubleSubscribeError，2026-08-24 会话审查 P2a 修复；codex 子进程非正常退出除 turn 级收敛外同时触发 onError 会话级 fail（P2b/daemon H2——只 turn 级收敛时会话 active 无消费者，后续 inject 永久挂起））；codex 驱动 2026-09-18-single-chat-steering 起 consume 改两层输入模型 + turn/steer 忙轮注入（currentTurnId 活跃直发，被拒/超时/未就绪回落 heldTurns 轮边界消费，见文末增量节）；session-manager（allowed_roots 写白名单 write-guard——显式写 + Bash 间接写重定向/cp/mv/tee 等都限根内、markPendingSwitch 热切换、reload 孤儿 consume 守卫 isAuthoritative）；input-queue（单订阅，reload 前 resetForResubscribe 保 pending inject）；permission-resolver；会话 jsonl 持久化（create 配供应商→写 daemon 隔离目录、未配→写宿主机 ~/.claude；resume/reload 经 claude-transcript-dir 探测实际位置设 CLAUDE_CONFIG_DIR，ql-20260822-009；SESSION_SWITCH_CONFIG 的 providerConfig 显式 null=切回本机——daemon.ts 路由不归一缺席为 null + reloadWithConfig !== undefined 判定（原双层 ?? 塌缩致切回本机仍跑旧供应商），切回本机时 jsonl 经 migrateClaudeTranscriptToHost 反向迁回宿主机，ql-20260824-018）；SESSION_RESUME 路由接收 backend 随带的 provider_config（snake/camel 双读、null 归一缺省）写 record.providerConfig 供 restoreAndReconnect 重建供应商 env——缺该透传时 reopen 恢复的 SDK 子进程无任何凭证（隔离 CLAUDE_CONFIG_DIR 无本机 OAuth 兜底）"Not logged in" 秒退、会话秒回 ended（ql-20260827-014）。
- **adapters/**：json-rpc / stream-json / ndjson / pi-json / text 多协议输出适配。
- **policy/**：filesystem-policy / runtime-policy（PolicyCache realpath 归一统一口径）/ audit-sink / path-utils（盘符根/Unix 根边界敏感前缀比较，root 已含尾 sep 勿再补）。
- **resilience/**：ResilienceService——submitWithRetry 流式消息退避重试（上限约 8s）用尽入 FileOutbox；retryTerminal 终态轻量重试；心跳健康信号触发 drainOutbox 补发（补发前校验 lease 有效/session 未终态，遇 422 claim_token 失效丢弃）。
- **spec-sync.ts**：spec 树双向同步——拉取 bundle（tar 解包）+ 推送增量（本地 manifest 与 hub spec-manifest 对比算 FileOp ops，hub 404 首推全量）；junction 挂载、pending-push 标记、`SpecPushConflict` 与 push-before-pull 防护。
- **mcp-server.ts（双 toolset）**：同一二进制双模式（env `MCP_TOOLSET`，缺省/拼错回落 orchestration=原 5 编排工具零变化）；`file` 模式=独立 server 名 `sillyhub-file` 仅注册 `upload_file`/`list_uploaded_files` 两工具（worker 注入不含编排工具，不触碰 CC-12 防递归）。路径校验 fail-closed：`MCP_ALLOWED_ROOT` 缺失/空串拒绝一切上传（path_out_of_root），resolve+分隔符前缀校验拒绝对路径/`..` 出根；文件本地读取经 hub-client multipart 直传 `POST /api/agent/file-artifacts`（内容不经 agent 上下文）。注入两条链（2026-08-23-agent-file-upload-mcp）：会话=cli.ts mainAgentMcpConfigProvider 双 server 表 + session-manager per-server env（MCP_SESSION_ID 双条目，injectMcpSessionId 调两次不改签名）；worker（仅 provider=claude）=task-runner 步骤 5.5 写 `os.tmpdir()` 0600 临时 .mcp.json（凭证 per-server env——spike-01 证父进程自定义 env 不透传 MCP 子进程，per-server env 是唯一可靠通道；**同步写**保持 spawn 前零真实异步 IO 间隙）+ run 终 finally 删除 + 构造进程级单次清扫残留 + stream-json buildArgs mcpConfigPath（claude 追加 `--mcp-config`，cursor 忽略）。spike-01（claude CLI 2.1.216 实测）：--mcp-config 与全套既有参数共存；.mcp.json env 支持 `${VAR}` 展开。
- **其它**：credential-injector（litellm_proxy 标记→ANTHROPIC_BASE_URL 指向 hub 代理；anthropic 形态 7 条映射规则，`settings_config.env` 空串值按「未配置」跳过不覆盖 api_key 注入——历史预设空占位曾盖掉真实 key 致会话 "Not logged in"（ql-20260823-007），`extra_env` 契约不变仍原样合并；one_m `[1m]` 后缀不止落角色 env——主模型同样生效：规则 3 `ANTHROPIC_MODEL` 与 interactive create/restore 的 `buildDriverOptions` options.model（claude 分支）都经 `withOneMSuffix` 按角色映射 one_m 勾选补缀，裸模型名会让 claude CLI 按默认 200k 窗口算、1M 供应商 ~160k 即触发引擎自动压缩（ql-20260920-004，会话 6e213eb3 实证；state.model/持久化保持裸名不受污染，reload 不传 model 走 env 同覆盖））、ws-client（连接带 X-API-Key header）、local-yaml-writer（init 下发 local.yaml 写盘）、model-error 分类、skill-manager、roots-rpc（磁盘根列举）、host-fs-handler、build-id 自动注入。
- **agent-log/**（2026-08-23-agent-log-conversation-view）：`parse-zcode-model-io.ts` zcode model-io 转录解析器（纯函数：窗口按绝对 offset 对齐合并 full/delta/tail、消息级 toolCalls/reasoning 块/字符串 content 段产出、剥 system 与 `<system-reminder>`、末行 response 补尾同文去重、坏行>50%→parse_error、20MB/5s 保护、200 段窗口+beforeSeq 切片）；`registry.ts` format→parser 注册表（MVP 仅 zcode-model-io-jsonl）。host-fs-handler 第十方法 `readAgentLogMessages(path, format, beforeSeq?)`：白名单守卫先于一切 IO、not_found/forbidden 与 readFile 同 throw 通道、解析结果 status 分层返回（parsed/unsupported/parse_error/too_large，外层 camelCase 内层 snake_case）；daemon.ts 注册 host_fs.read_agent_log_messages RPC。2026-09-10-zcode-session-sqlite-read：zcode format 在守卫后、registry 前先分派 `read-zcode-sqlite.ts` 读取器——恒读 `~/.zcode/cli/db/db.sqlite`（node:sqlite 经 createRequire 惰性加载只读开库，rollout 短命文件仅扫描发现与读取兜底；分派带**目录门**——log_path 须位于 `~/.zcode/cli/rollout` 内才进读取器，防自登记任意路径横向读库，与文件死活无关【ql-20260911-003-355a 的 lstat 存在性门以文件存在为授权凭证，误杀历史会话回看，已修订替换】）：extractZcodeSessId 提取（model-io-sess_<rest>.jsonl → sess_<rest>）、message×part 单查询归一化（tool 单 part 产 use+result 两段/隐藏三判据整条跳过/未知类型防御忽略计 skippedLines）、窗口与 parse-zcode-model-io 单源对齐（DEFAULT_MAX_SEGMENTS import）；读取器抛错（不可用/不在库/查询异常）原样落回文件流程 + console.info 单行回落日志（ql-20260911-005：原 console.debug 在 console-timestamp 包装外全程无痕、排障只能反编译 bundle，升级 info 并由 ZD3 断言锁住），claude/codex 不进分支；测试基建 createZcodeFixtureDb 真实 schema 造库（tests/agent-log/read-zcode-sqlite.test.ts 20 用例 + zcode-sqlite-dispatch.test.ts 分派四态 7 用例）。
- **git 只读五方法**（2026-08-25-workspace-git-log；第 5 个 git_status 增于 2026-08-26-workspace-git-status）：host-fs-handler 在既有十方法（stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml/run_command/read_agent_log_messages）之外新增 gitLog/gitRefs/gitShow/gitDiffFile 四只读方法（共十四）——execFile 独立 argv 跑 git log/for-each-ref/show/rev-parse（%x00 字段 +%x1e 记录分隔解析、tag `%(*objectname)` peeled 回退、diff 64KB 截断+二进制检测、空仓库 exit 128 转空态结构不走红通道）；daemon.ts 经 `ws.registerRpcHandler` **平名注册**（`git_log`/`git_refs`/`git_show`/`git_diff_file`，不走 `host_fs.` 前缀通道，CC-02），消费方=backend `git_log` 模块（工作区 Git 日志视图数据链路）。2026-08-26-workspace-git-status 增第 5 个平名方法 `git_status`（host-fs-handler 累计十五方法）：① `git remote` 预检（无 remote 记 `no_remote` 不跑 fetch）+ `git fetch --quiet` 15s 超时（独立于读超时；不经 runCmd，局部 execFile 读 err.killed/signal 判 `fetch_timeout`/`fetch_failed`，**fetch 失败仅记代号降级、不阻断其余字段**）② `status --porcelain=v2 --branch --no-show-stash`（branch/upstream/ahead-behind/untracked 计数/空仓库 empty 判据）③ `diff HEAD --numstat --no-renames`（files_changed/additions/deletions 单源求和）——十四字段结构化返回不抛，同一注册器平名注册，消费方=backend `git_log` 模块 status 端点。

## 关键逻辑
```
# 批处理 lease
create_lease(build_claim_payload 组装 provider/profile 注入) → daemon 领取 claim_task(claim_token)
→ TaskRunner 执行 agent → lease_complete → run_sync 回调 _trigger_stage_completion_callback / _advance_team_stage

# 交互会话
create_session → daemon _startInteractiveSession → POST /ready → SessionReadiness.mark_ready
→ inject_session: await wait(30s) → SESSION_INJECT → 消息经 submit_messages 上行(segmentId 去重)
→ 重启恢复: recover + restoreAndReconnect → confirm-reconnected(reconnecting→active + mark_ready 双保险)

# WS RPC（文件原语）
backend send_rpc(rpc_id, list_dir/list_roots/读写) → daemon host-fs-handler 执行 → rpc_result(rpc_id) → resolve_rpc

# 网络韧性
submitWithRetry(退避) → 用尽 → FileOutbox 暂存 → 心跳健康 → drainOutbox(校验 lease/session 后补发)
```

## 注意事项
- 群未读计数 get_group_unread_counts 的无界 count（2026-09-09 性能排查批4 评估后保留）：真有界方案 LATERAL+LIMIT 1 是 PG-only（SQLite 不支持，跨方言窗口函数版 O(U log U) 反劣于纯 count 的索引范围扫 O(U)）；现实规模下带阈值过滤的 count 走索引范围扫描毫秒级，未读规模实际可感知时再考虑 PG-only 分支
- lease 与 session 是两套执行模型：lease 无状态批处理（task_id 关联），session 有状态长交互（current_run、turn 冲突错误）；interactive lease 永不过期是不变量。
- daemon 重启后会话收敛是关键不变量：backend recover + Node 端恢复 + confirm-reconnected/mark-recovery-failed 三方配合，勿单侧改动握手顺序。
- llm-proxy 白名单/转发行为与 daemon 侧 credential-injector 的注入约定是双侧契约；master key 永不出 hub 进程。
- WS 升级期鉴权 4001/4003 语义由各调用方（WS 端点、llm-proxy）落地，共用凭据解析 helper 只做凭据→User。
- segmentId 去重约定（partial 行带 metadata.segmentId、complete 行 NULL）是双侧消息结构契约；pending→running 原子条件 UPDATE 防终态覆盖，勿改回 ORM 内存读改写。
- 已知问题（quick-9f86d2c3 实证，2026-08-27）：daemon session-manager 的 `_emitOverrideSignals`（[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]）单测绿但生产环境从未观测到达 backend（全库 0 条 override 消费痕迹、partial 行从未被其删除，run 6f5720ab / 会话 e87622aa）——静态推演 daemon 代码与 transcript（47/47 assistant 记录带 message.id、与 partial mid 一致）均应命中，失效点疑似在 daemon→backend HTTP 提交链路（daemon 日志走 Windows 服务 stdout 不可追溯）。backend 已改为完整行落库时自行 `_revoke_committed_partials`（不依赖 override），前端装配器双向收编兜底；override 链路本体待运行时插桩排查，修复前勿依赖它做任何清理。
- gate 仅 verify 阶段适用（`_gate_applicable`），勿恢复对任意 change run 跑 gate 的旧行为（曾致 quick 变更误报核验失败）。
- Node 侧 PolicyCache realpath 归一 + allowed_roots JSON 短路是心跳不卡死的关键；盘符根/Unix 根前缀比较勿再补尾部 sep（历史误 deny 事故）。
- spec-sync 推拉有顺序约束；daemon 侧 manifest 缓存过旧会推不出新 change（已知运维坑），从仓库导入 RPC 不受 30s 代理超时限制。
- BUILD_ID 注入格式（build-id.ts 无 `: string` 注解）被 backend `_compute_daemon_version` 正则依赖，改格式断 self-update。
- 会话附件 disk 交付落盘为内容寻址 `attachments/{sha256}.{白名单ext}`（同内容复用、EEXIST 跳过写入；展示名只在 prompt 清单注记「原文件名」）——与 backend MinIO 内容寻址同哲学，勿改回展示名+(n) 序号（路径歧义会诱发 agent 全目录读比对）。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260831-015-c6fe（quick）：会话列表归档过滤三态——list_agent_sessions 与 DaemonService facade 签名 archived: bool|None = False（None=不过滤全部，service 默认 False 内部调用零回归），router GET /api/daemon/sessions Query(default=None)（HTTP 不传=全部含已归档，「全部状态」语义修正）；前端显式 archived=false 的调用方（移动端默认视图 / use-daemon-machines 会话计数）保持原语义
<!-- MANUAL_NOTES_END -->
- 2026-08-20-session-multimodal-attachments：会话附件（图片多模态/文件落盘/multimodal 三态门控）涉及本模块（详见 changes 归档）
- ql-20260824-018-ecf9（quick）：SESSION_SWITCH_CONFIG providerConfig null=切回本机语义修复（daemon.ts 路由 + reloadWithConfig 双层 ?? 塌缩）+ transcript 反向迁移 migrateClaudeTranscriptToHost

## 文件结构更新（2026-09-07-arch-large-file-split）

backend daemon 模块四个大文件目录化（机械拆分 + 原路径兼容层，对外 API/schema 零变化——openapi.json 拆分前后零 diff 验收）：

- `router.py`（5468 行，D-010 merge 后 5649）→ `router/` **13 文件包**：`__init__.py`（312 行，_ENDPOINT_ORDER 表按原端点首现顺序 fail-fast 恢复注册顺序）+ 12 域文件——daemon_rpc / gateway_misc / heartbeat / lease / machines / notify / runtimes / session_crud / session_insights / session_queue / session_team / version（max session_crud 712，全部 ≤800，D-008@v2）。
- `session/service.py`（7176 行）→ `session/service/` **14 文件包**：`__init__.py`（1023 行，SessionService 类壳同名方法一行委托，含 6 私有符号保位）+ 13 子模块——attachments / control / create / errors / helpers / inject / inject_gates / ppm_activation / queue / read_model / recovery / results / session_lifecycle（子模块 max control 801）。
- `group/service.py`（4844 行）→ `group/service/` **10 文件包**：`__init__.py`（817 行类壳）+ 9 子模块——crud / helpers / members / mentions / messages / settings / shadow / timeline_reads / typing_presence（max crud 791）。
- `run_sync/service.py`（4055 行）→ `run_sync/service/` **9 文件包**：`__init__.py`（555 行）+ 8 子模块——close_run_steps / gate / group_bridge / publish / sdk_pipeline / stage_team / submit_commit / submit_steps（max close_run_steps 774）。
- 新增三个共享模块（task-11 轻重构白名单③④⑤）：`_background_tasks.py`（108 行，后台任务 mixin）、`event_publish.py`（51 行，Redis publish 统一）、`attachment_pipeline.py`（132 行，附件管线收敛）。
- monkeypatch 命名空间兼容规则（D-007）：被 patch 符号在子模块内经原模块命名空间延迟解析调用，`__init__.py` 顶部保持原绑定——157 处既有 patch 目标零失效、既有测试文件零修改（D-006）。

（本节只覆盖 backend 侧文件结构；Node 侧 sillyhub-daemon 的结构更新见项目级 modules/sillyhub-daemon.md 同名节。）

## worker_done 代报链（2026-09-10-review-dispatch-platform-fixes 系）
- 立即代报（task-03/ql-20260910-003）：onTurnResult 对 stage=mission_worker 且 caps.mcp===false 的成功轮，在 notifyRunResult 之后 fire-and-forget 代报 worker_done（summary=轮终全文，X-Session-Id 承载分身身份）；409/422 仅 warn。
- ql-20260911-028 延迟兜底：一切 mission_worker 成功轮 +90s 探测 getMissionStatus（session-scoped，opts.sessionId 一次性覆盖）——本 run artifacts 仍空且 mission 活跃 → 用 result/会话级最后全文（_lastAssistantTextBySession，onTurnMessage 完整 text 事件 + result 双写源，FIFO 500 上限）兜底代报；覆盖 mcp=true 分身不自报（活体 mission c4731a06：claude worker 未调工具）与 override 晚到空白 result 两形态；已自报/不活跃/无文本/探测失败均跳过仅日志。
## 2026-09-14-session-export 增量（ql-20260915-005-3268，P2-2 乱码根治）

- **子进程输出码页探测解码**：`spawn-env.ts` 新增 `decodeProcessOutputMaybe`（单块立即版：utf-8 fatal → GBK → Node 默认，同 autostart/windows.ts 既有先例）与 `CodepageDetectorDecoder`（有状态流式版：StringDecoder utf-8 保跨 chunk 多字节不烂，失败切 GBK 并冲刷缓冲——修 utf-8 子进程跨 chunk 半个中文字符被误判 GBK 的回归）。
- **接入全部捕获点**：spawn-stream.ts（stderr 立即版 + stdout 经 `decodeStream()` Transform 有状态版包给 readline，替代内部 StringDecoder('utf8')）；pi-rpc-driver.ts / cursor-driver.ts 的 LfLineFramer（换 CodepageDetectorDecoder）；cursor-driver.ts / codex-app-server-driver.ts stderr 立即版兜底。非 SDK 链（pi/cursor/codex/task-runner 捕获）字节级可控，故可探测解码；Claude SDK 链（claude CLI stdout 由上游 @anthropic-ai/claude-agent-sdk setEncoding('utf8')）字节在 SDK 边界已固化，治本已落地（ql-20260915-005 后续 quick）：buildSpawnEnv 出口 UTF8_DEFAULT_ENV 缺省注入 PYTHONIOENCODING=utf-8+PYTHONUTF8=1（仅键缺失/空串填入，显式配置优先），覆盖 task-runner/交互/resume 全路径，claude→Bash→孙进程全链继承，新会话起生效（存量乱码行不可还原）。
- **验证**：daemon typecheck 过；专项测试 151 passed（pi/cursor/task-runner/spawn-env，含跨 chunk 多字节 UTF-8 用例）；全量 4266 passed + 4 failed 均为并行在途 provider_config 热切换半成品（非本改动，基线同挂）。

## 增量（ql-20260916-003：GBK 流式回退死代码修复）

- **CodepageDetectorDecoder 重写**：上节流式版的「StringDecoder 失败切 GBK」是死代码——Node `StringDecoder.write()` 从不抛错（非法/GBK 字节直接替换 U+FFFD 返回），task-runner stdout 与 pi/cursor LfLineFramer 的 GBK 输出仍乱码落库（stderr 立即版 `decodeProcessOutputMaybe` 用 TextDecoder fatal 真 throw，不受影响）。重写为自管字节缓冲：`utf8CompletePrefixLen` 增量扫描最长完整合法 UTF-8 前缀（未决尾字节 ≤3 字节跨 chunk 续接不误切，区间收紧对齐 WHATWG：E0/ED/F0/F4 首连续字节限制），遇非法字节切 `TextDecoder('gbk')` 流式并把未决尾字节一并交 GBK 重解（原实现 `utf8.end()` 丢弃返回值丢字节）；small-icu 构造 GBK 解码器失败退非致命 utf-8。已知启发式边界：恰构成合法 UTF-8 的 GBK 双字节序列（trail 落 ASCII 区时两编码有交集）仍按 UTF-8 解，与立即版一致。
- **验证**：spawn-env 50 passed（新增 GBK 流式 9 用例：单 chunk 中文/双字节跨 chunk 两态/合法 UTF-8 跨 chunk 不误切/前缀不重复/收紧规则切 GBK/悬空尾替换字符）+ pi-rpc-driver 90 + task-runner 72 + typecheck 0。

## 增量（ql-20260917-006：上下文压缩状态帧事件化）

- **背景**：Claude SDK 自动/手动 context compaction 期间会发 `system/status` 帧（`status='compacting'` 进行中；结束帧 `compact_result='success'|'failed'`，失败附 `compact_error`，SDK 0.3.247 @anthropic-ai/sdk 类型声明（node_modules，略）），daemon 此前在 `claude-events.ts _normalizeSystemMessage` 尾部静默丢弃——前端无法在压缩过程中显示「上下文正在重新压缩」实时提示（线上会话 6e213eb3 两天 16 次压缩，用户明确要求压缩中回显 + 对话区隐藏续接摘要大段文本）。
- **归一化器**（`interactive/claude-events.ts`）：`subtype==='status'` 帧分流——`status==='compacting'` → `status/context_compacting`（metadata.phase=compacting）；`compact_result` 为 success/failed → 同 subtype（metadata.phase + 可选 error）；`status==='requesting'` 等其余帧维持丢弃（零回归）。`types.ts AgentStatusSubtype` 增 `context_compacting`（types/agent-event-schema zod 枚举/注释三处同步——schema 有「与 types.ts 一字面对齐」纪律）。`_normalizeSystemMessage` docstring 分派清单同步。
- **消费侧**（`interactive/session-manager/events.ts dispatchStatusEvent` 新 case）：无 active run 丢弃（口径同 bash_*）；经 `mgr.deps.onTurnMessage` 落 **stdout 协议行** `[COMPACT_STATUS] {"phase":...,"error":...}`——legacy flat 形态（`event_type:'text'`），backend 零改动（按 stdout 文本行持久 + SSE 推送）；前端 `classifySessionLog` 识别该前缀归 kind=compact_status。不走 eventToReportDict 透传：落行路径语义由消费侧显式声明，避免 status 事件被当作 status 文本行双写。
- **测试**：claude-events.test 增 1 用例（compacting/success/failed 三事件 + requesting 维持丢弃 + zod 校验过）；agent-event-schema.test 闭合枚举 7→8。

## 增量（ql-20260917-008：会话执行中直接切换配置，本轮结束后生效）

- **背景**：供应商/模型/档案切换的生效机制是 turn 边界 daemon reload（子进程 env 启动时烧死，D-002），但前端 running 时全置灰逼用户干等；且排队行无 model 快照（忙轮切模型派发静默丢失）、连续切换排多条切换轮、思考档忙轮 409。用户拍板：执行中允许直接切换、下一轮生效、重复切换覆盖（最后一次为准）。
- **排队行 model 快照**（`agent_session_queued_messages.model`，迁移 20260917160000）：补齐 task-11 缺口——入队落列 + 派发重放（`_inject_into_session(model=entry.model)`）成对。
- **纯切换覆盖合并**（`queue.py _handle_busy_turn`）：新请求为纯切换（空 prompt/无附件/带配置维度）且同发送者已有 pending 纯切换行（prompt="" 唯一形态）→ 逐字段覆盖（新请求非 None 的 profile/provider/model 盖旧值，None 不动——按维度「最后一次为准」，切供应商伴生 model="" 与后续单独切模型可组合），不新建行、position 不变；与任务通知 merge 同款行锁内原子。普通消息与切换双向不合并。
- **思考档忙轮暂存**（`agent_sessions.pending_thinking_level`，同迁移）：`set_session_thinking_level` 忙轮分支 409 → 覆盖式暂存 + 返回 `{ok:true, queued:true}`（schema 加 `queued` 字段，gen:types 同步）；`close_run_steps` run 终态钩子与排队派发并列 fire `apply_pending_thinking_level`（独立 session，复用 `_set_via_rpc` 全分支语义，成功清列、失败保留暂存下轮重试）。
- **验证**：queue 23（含新增合并 4 用例：逐字段覆盖/双向不合并/派发重放 model 快照——派发断言走 `_inject_into_session` spy）；thinking endpoint 24（忙轮 409 用例改 queued 契约 + 覆盖 last-wins 新增）；inject/switch_config/queue_actions 等相关套件共 100 绿；ruff+mypy 0；迁移 offline SQL 校验过。

## 增量（ql-20260918-001：纯切换合并查询修复——附件行不再炸 500/被误并入）

- **背景**：上节「prompt="" 是静默切换行的唯一形态」的断言不成立——inject 的 D-7 附件豁免（看图说话）同样落 `prompt=""` 的 pending 行（其本身 `is_pure_switch=False` 走新建行路径）。原 `scalar_one_or_none()` 按 prompt/sender 过滤：两条附件行存量下任一次纯切换命中 2 行抛 `MultipleResultsFound` → 接口 500；单条附件行时切换静默并入附件消息行、改写其 profile/provider/model 快照。
- **修法**（`queue.py _handle_busy_turn` 纯切换段）：查询改 `.scalars().all()` 取全部空 prompt 候选，Python 侧按「无附件 + 带切换维度（profile/provider/model 任一非 None）」筛真切换行（注入侧空 prompt 豁免仅切换/附件两形态，此谓词精确还原），多条时取 `(position, created_at)` 最大（最后一次为准）。行锁串行语义不变。
- **验证**：test_session_queue 新增 2 用例（两附件行 + 切换不 500 且附件行快照原样、切换只并入真切换行）；queue 25 + inject_silent_switch/inject_empty_prompt/knowledge 相邻面全绿；ruff/mypy（scoped）0。

## 增量（ql-20260918-004：思考档位暂存列两处竞态修复——apply CAS 清列 + 空闲直切对账）

- **背景（24h 风险审查 M1/M2）**：①`apply_pending_thinking_level` 的 `_set_via_rpc` 最长挂 15s，窗口内用户忙轮切档写入的新 pending 会被成功分支无条件 `pending=None` 清掉（丢用户意图，且触发本次 apply 的 run 已终态、无钩子补偿）；②空闲路径直切成功不清残留 pending——此前 apply 失败保留的陈旧暂存会在下一终态钩子被应用，静默反超用户显式选择。
- **修法**（`thinking_level.py`）：①apply 成功分支改 CAS 清列——`db.get` 命中身份映射缓存会掩盖并发写入，先 `refresh` 强制重读，仅当 pending 仍等于本次应用值才清，已被覆盖则保留交下一终态钩子（最后一次为准）；②新增 `_finish_idle_switch` 收尾（`set_session_thinking_level` 空闲分支）——锁内记录观察值 `stale_pending`，RPC 成功后 CAS 清列（陈旧暂存被显式选择取代、窗口内并发写入保留）；RPC 失败不新增暂存重试语义（无暂存维持 None），但陈旧暂存早于本次选择时覆盖为本次档位（防反超）。
- **验证**：test_session_thinking_level_endpoint 29（新增 5：RPC 窗口并发切档保留/无并发照常清、空闲成功清陈旧/失败覆盖陈旧/失败无陈旧维持 None——修复目标 3 例先红后绿、对照组 2 例始终绿）；ruff/mypy（scoped）0。

## 增量（2026-09-18-single-chat-steering：单聊忙轮引导（steering）直注入）

- **语义**：单聊会话在 agent 忙轮（活跃 run）时发送普通消息 = 引导注入当前活跃轮（不建新 run、不打断在途输出），对齐 pi / Claude Code / Codex 原生终端体验；与群聊 @ 忙轮 inject（quick 2026-09-02）复用同一 `_inject_mid_turn_into_run` 入口。
- **backend 侧**（task-05/06，锚点以收口版为准）：
  - 单聊 inject 端点门控链（backend/app/modules/daemon/router/session_crud.py:588）：请求可进忙轮分支时（不带切换维度且有 prompt/附件）读会话行 provider，经生成镜像 `get_provider_caps`（backend/app/modules/agent/provider_caps.py，单源 daemon PROVIDER_CAPS）判 steering 键——支持 → `busy_strategy="inject"`（inject_session 三层加参：router/service/facade），mid-turn 注入活跃轮；不支持（cursor / 未知 provider 默认 false）或携带切换维度（agent_profile_id/llm_provider_id/model 任一非 None——与 queue.py 忙轮 inject 分支「三者全 None」守卫同口径）→ 维持 `queue_when_busy=True` 排队现状零回归。门控读不前置：带切换维度时 inject 分支不可达直接跳过；空 prompt 且无附件时 422 判空先于查库（错误优先级零回归）。
  - `SessionInjectResponse`（backend/app/modules/daemon/router/session_crud.py:83）增 `steered: bool` 出参——映射 service 层既有 `SessionDispatchResult.mid_turn`（`_inject_mid_turn_into_run`（session/service/control.py）恒置 True），不新建平行字段；排队/降级/空闲新建轮恒 False。
  - ⚡ dispatch_now 引导式重构（backend/app/modules/daemon/session/service/queue.py:594? `dispatch_queued_message_now`）：不再无条件 interrupt。可引导判定 = provider caps steering=true **且**条目不带轮边界维度（profile/provider/model 快照全 None + 非 `auto_resume:` origin——续跑条目注入活跃轮会绕过接力派发侧 G10 超越守卫）→ 复用 `_inject_mid_turn_into_run` mid-turn 注入（群链标记剥离 / 附件宽容解析 / 附件归属基准与派发侧同款），注入成功删排队行 + 补发 queue_changed(action="dispatched")，返 `"steered"`；不可引导 → 既有 `_send_interrupt_control` 接力（现状），返 `"interrupted"`；无活跃 run → 当场派发，返 `"dispatched"`。commit 置顶先于注入/interrupt、失败不回滚（既有 R-03 口径）。`QueueDispatchNowResponse`（backend/app/modules/daemon/schema.py:567?）增 `dispatch_mode: Literal["steered","interrupted","dispatched"]` 三态；`interrupted` 旧字段保留兼容（= `dispatch_mode=="interrupted"`，backend/app/modules/daemon/router/session_queue.py:205 派生，旧前端不消费不受影响）；OpenAPI → `pnpm gen:types` 已同步（api-types.ts steered/dispatch_mode 均在）。
- **sillyhub-daemon Node 侧**（task-01/03）：
  - codex turn/steer 接线（interactive/codex-app-server-driver.ts）：consume 从单层「await 轮完成」改两层输入模型——空闲层取下一条输入（heldTurns 回落队列优先于输入队列）起轮；等待层 race「本轮 turn/completed vs 下一条输入到达」，输入先到且 `currentTurnId` 活跃（且本轮无回落保序、非 closing）→ `_writeTurnSteer`（:1899）发 `turn/steer {threadId, expectedTurnId: <当前活跃 turnId>, input: [{type:'text', text}]}`（0.147.0 实机定参，changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md §7/§8；受理回执 ~1ms，steer 不产生新 turn/started 对、不产生第二次 turn/completed，轮收敛时点不变）；被拒（-32600 含 no active turn / id 失配）/ 超时（DEFAULT_STEER_TIMEOUT_MS 10s）/ turnId 未就绪 → 该条 push 进 heldTurns 本地回落队列，轮完成后正常 turn/start 轮边界消费（保序约束：一旦本轮有回落，后续忙轮输入一律排其后不再 steer，防后到消息先于被拒消息注入）。turnId 提取修正双来源（:1613）：turn/started 通知 `params.turnId ?? params.turn.id`（0.147.0 实测 turnId 嵌 params.turn.id，旧单点提取恒 undefined 连带 interrupt 被卫语句挡死）+ turn/start 响应 result.turn.id 回填。轮级串行不变式不破坏（收到 turn/completed 才起下一轮 turn/start）。
  - pi：`_sendInject` 三模式既有零改动（streaming → steer 默认，被拒按 pi 错误文案单次降级重试 prompt↔steer / steer→follow_up，sillyhub-daemon/src/interactive/pi-rpc-driver.ts:1879）。
  - claude：SDK 命令队列吸收，驱动零代码改动——忙轮消息推进 `query({prompt: AsyncIterable})` 输入流（sillyhub-daemon/src/interactive/claude-sdk-driver.ts:402）由 SDK 命令队列吸收，**双形态**（spike-claude-steering 实测定论）：工具循环轮（agent 典型负载）= mid-turn fold（折进当前轮下一次 LLM 调用前，当前轮输出即体现注入指令）；纯生成轮（无工具间隙）= 轮结束吸收（同 session 次轮自动执行，效果=排队时延，不丢消息不失败，降级可接受）。queued_turn_count 真机不填充（CLI 2.1.216），断言走行为学证据（次轮自动执行 / 当前轮输出体现 + session_id 连续 + 全程无 interrupt）。
  - PROVIDER_CAPS（interactive/providers.ts）增 steering **第 14 键**：pi/claude/codex=true、cursor 与未知 provider=false（默认拒绝）；走既有三端生成单源（gen-provider-caps.mjs → backend provider_caps.py + frontend provider-caps.ts，alignment 测试守护），daemon 侧 mid-turn 行为是各 driver 的自然结果，不设 daemon 中心化门控（键仅供 backend 门控与前端降级标注消费）。
- **前端消费提示**（daemon.md 只记双端契约要点，组件细节归前端模块文档）：steering 消息三态（steering 引导中虚线气泡+脉冲 / delivered 已投递 / ended 本轮已结束未投递）为**纯内存展示态**（SteeredMsg 会话级 state，切会话/刷新即弃——刷新后由 user_input 留痕行（挂活跃 run，FR-6 留痕）历史回放自然并入轮 prompt，无新持久化状态/新表/新状态列）；page/dialog 双挂载点同步（session-panel-page.tsx / session-panel-dialog.tsx）；手写镜像 frontend/src/lib/daemon/sessions.ts:291 补 `steered?: boolean`（gen:types 覆盖不到）；MessageQueueBar ⚡ title 改引导语义两态（「立即引导进当前轮（不打断）」）+ steering=false 引擎行级「该引擎暂不支持引导」标注 chip（数据源 provider-caps.ts 生成镜像，可选 prop 未传不渲染）。
- **FR 对照**（design.md 设计目标逐条落点，requirements FR-01~06 同序）：

  | FR | daemon.md 落点 |
  |---|---|
  | FR-1 单聊忙轮发送=引导注入 | inject 端点 busy_strategy=inject 门控链 + steered 出参（本节 backend 侧第一条） |
  | FR-2 provider 能力矩阵与降级 | PROVIDER_CAPS steering 第 14 键三端生成 + get_provider_caps 门控 + cursor/未知 false 排队降级（本节 backend/Node 侧） |
  | FR-3 ⚡ 立即发送改引导式 | dispatch_now 三态（steered/interrupted/dispatched）+ QueueDispatchNowResponse.dispatch_mode（本节 backend 侧第三条） |
  | FR-4 零回归 | 切换维度守卫（inject 三维度全 None 才进 inject 分支；dispatch_now 条目快照/auto_resume 不 steer）+ 服务身份 409 不变 + interrupted 兼容保留 + 群聊 inject 同入口零改动 + 停止按钮 interrupt 语义不变 |
  | FR-5 前端三态展示 | session-panel page/dialog 引导中/已投递/ended 纯内存三态 + MessageQueueBar 降级标注（本节前端消费提示） |
  | FR-6 codex turn/steer 接入 | codex 两层输入模型 + _writeTurnSteer + heldTurns 被拒回落（本节 Node 侧第一条） |

- **集成证据**：codex 实机 turn/steer 探测记录 = changes/2026-09-18-single-chat-steering/spike-codex-turn-steer.md（0.147.0 定参 + S2 行为闭环 + 四类被拒不炸会话，实机原文零臆造）；claude SDK 吸收双形态 = changes/2026-09-18-single-chat-steering/spike-claude-steering.md（真机双场景）。缺口标注：单聊忙轮**真 daemon 会话**端到端引导用例无落盘记录（现覆盖 = backend/daemon/frontend 三端 mock 测试 + 两份 spike 实机探测脚本；影响面 = 平台侧 inject→SESSION_INJECT→driver steer 全链拼装未经真实 daemon 回归，留人工验收补录）。
- **零回归声明**：task-09 收口定向测试全绿（backend 125 + daemon 65 + frontend 66，commit 1934c322a）；本增量（task-10）纯文档同步，零代码/测试改动。

## 增量（ql-20260920-002-8626：24h 审查四风险修复——steering 链路收口）

2026-09-18 增量合入后 24h 只读审查发现的四处高/中风险，本 quick 修复：

- **①codex steer 窗口丢轮 outcome（高，会话软锁死）**：等待层 race 输入先赢后 `await _writeTurnSteer`（最长 10s）期间 `turn/completed` 到达时，outcome 只 resolve 进 promise（`finishTurn` 清 resolver），`continue` 回循环顶被空闲层 `beginTurn` 覆盖——`reportResult` 永不执行，backend run 永远 running、会话恒忙软锁死。修复：`finishTurn` 同步暂存 outcome（`completedOutcome`），消费统一收口 `consumeCompletedOutcome`（等待层轮分支 / 空闲层入口 / threadId 超时路径三点共用；closing/finalized 不报口径与拆分前逐条对齐，引擎侧 cancelled——interrupt 后 complete=cancelled——照报）。测试：driver 新增「completed 先于 steer 回执（被拒/成功两序）」2 用例（既有被拒用例刻意先回执后完成，恰好绕开该序）。
- **②steering 全链路丢 page_context**：忙轮 inject 分支与 dispatch_now steered 分支此前不传 page_context（排队路径会存 entry.page_context 并派发重放）——`_inject_mid_turn_into_run`（session/service/control.py）增 `page_context` 参数，`build_page_context_preamble` 前导只拼进 SESSION_INJECT payload prompt（user_input 留痕保持原文，与 `_dispatch_inject_turn` 口径一致）；两调用点透传（queue.py `_handle_busy_turn` / `dispatch_queued_message_now` steered 分支，后者与接力派发侧同款宽容解析重放）。
- **③mid-turn 注入缺 user_input log SSE 事件**：该路径日志行由 backend 直接落库（不经 daemon 上报管线），修复前不补发 Redis log 事件——前端引导气泡「已投递」转换（markSteeredDelivered 依赖 channel=user_input）生产不可达，恒显「本轮已结束，消息未投递」。修复：对齐 inject.py 直发路径（ql-20260918-003）commit 前快照 log_id/content/timestamp、commit 后按 daemon 上报同形态补发。
- **④dispatch_now 无锁双派发窗口**：置顶 commit（R-03）释放入口会话行锁后，原实现无锁查活跃 run 即 mid-turn 注入，违反 `_inject_mid_turn_into_run`「调用方持锁、锁内查 run」契约——run 恰在窗口内收敛时轮终态钩子接力派发（新建 run）+ steered 注入双执行同一条消息。修复：发送动作前 `_get_owned_session_for_update` 复锁 + status 复检 + 条目行复取（已被接力派发删除 → 返 "dispatched" 收口零注入）；置顶持久化先于发送的 R-03 语义不变。
- 验证：daemon codex-app-server-driver 68/68（含 2 新增）；backend queue_actions 34/34（含 4 新增）+ 相邻面 session_queue/user_preamble/inject_empty/session_router 70 + 群聊四件 105 全绿；双侧 tsc/ruff/mypy 定向零错。
