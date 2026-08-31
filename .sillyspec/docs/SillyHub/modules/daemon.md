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
  - create/inject/interrupt/end/reopen/recover/confirm-reconnected/mark-recovery-failed/ready 上报 + SSE stream + logs（`GET /sessions/{id}/logs?after=` 增量游标，P4 2026-08-24：前端断线 resync/轮后对账增量拉取，游标-2s 重叠 + log_id 去重兜同批同 timestamp 边界）。
  - reopen 会话级供应商凭证链（ql-20260827-014，生产实证修复）：reopen_session 建 lease 时补写 `session_llm_provider_id`（与 create 同款键——漏写会让 claim/恢复链路解析不到会话供应商），SESSION_RESUME WS payload 携带 `resolve_bound_provider_config` 解密的 `provider_config`（与 claim payload 同一真相源）；解析失败/None 降级缺键 + warning 不阻断 reopen（对齐 claim 链 `_inject_provider_config` 降级语义），daemon 走本机凭证链。
  - 排队消息 retry 成功派发返回删除前快照（ql-20260827-019）：retry 翻 pending 后立即派发，成功即删行——re-get 必为 None，旧代码裸 assert 在此路径必 500（消息其实已发出）；现返回 detached 快照（status=dispatched），前端以 SSE/重拉队列为准。
  - 排队消息通知合并（ql-20260827-015，生产实证修复）：inject 端点恒 `queue_when_busy=True`，daemon 后台任务终态唤醒（ql-20260827-007 `_scheduleTaskWakeup`，2s debounce 只覆盖 2 秒窗口）在长轮期间每任务终态注入一条「[后台任务通知]」排队——计数只增不减、派发后逐条烧一轮模型汇报（会话 17f10040 实证）。修法：入队分支对通知前缀做同会话 pending 合并（任务行追加 + 头/尾计数改写、`_merge_task_wakeup_prompt` 行级解析），通知类排队恒 ≤1 条；普通消息互不合并。
  - create_session workspace 归属校验（2026-08-19-sessions-workspace-selector）：workspace_id 非空时先经 `allowed_workspace_ids(user, WORKSPACE_READ)` 校验可见性，不可见抛 404 `HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND`（校验在读 Workspace 行之前，不在事务内，失败不落库）。
  - `SessionReadiness` 模块级单例（mark_ready/wait/clear）：daemon create/recover 完成后 POST /ready 上报，backend 发 SESSION_INJECT 前 await wait(30s)，超时 fallback 仍发兼容旧 daemon——防 inject 早到 daemon 丢消息。
  - permission_service：权限请求落 dialog 行、pending/history/workspace 级聚合、响应下发、超时收敛。
  - 僵尸收敛 sweep 三档（`sweep.py`）：① reconnecting 超窗（180s）→ failed（DS-6 原档）；② `session_offline_sweep_once`——active/pending 会话其 runtime 非「online 且心跳≥600s 宽限」→ 主会话 suspended（非终态可 recover，run failed + 挂起 lease cancelled；worker 子会话/pending → failed，A5/S1 分流），suspended 非终态只广播列表 status_changed 不发 session_ended，超 24h GC 翻 failed 才发；③ `session_auto_recover_sweep_once`（ql-20260831-006-6d67）——suspended 主会话其 runtime 重新「online+心跳宽限内」且挂起满 60s → 翻 reconnecting + 发 SESSION_RESUME 控制指令（payload/供应商凭证对齐 reopen 路径），daemon restoreAndReconnect→confirm 翻 active；修 backend 重启场景 daemon WS 断开被误挂起后无人恢复（既有恢复链只在 daemon 自身重启时触发）。终态写入点 `cancel_lease`（kill 把会话置 ended）也广播 session_ended；SSE 生成器对 `session_recovery_failed` 同样收尾（agent/service.py stream_session_logs）。
- **run_sync**：
  - `submit_messages`：daemon 上行消息落库；partial/complete 用 segmentId 跨调用去重（`_revoke_committed_partials` 撤已提交半截）；pending→running 用原子条件 UPDATE 防迟到的 submit 覆盖终态（lost update）。quick-9f86d2c3（2026-08-27，会话 e87622aa）：完整行展开 segmentId 格式对齐 daemon partial 的 task-13 格式 `${parent}:${mid}:${type}`（text/thinking；原 `${mid}:${idx}` 与 partial 永不匹配致同调用判定与跨调用清理全部空转、partial 行永久滞留 DB）；完整行落库时不再只依赖 override 信号——直接 `_revoke_committed_partials` DELETE 已 commit 的同 segmentId partial（interactive 每消息独立 HTTP 提交，partial 先 commit、完整行后到是常态）。quick-0e56260f（2026-08-27，会话 0ef651b6）：完整行落库点 backend **合成 override 令箭**——①落一行标记（content=`[*_OVERRIDE] <segmentId>`、segment_id=NULL 防误删、mid=unknown 退化跳过）：partial 落库前查标记（判定 3）堵「完整行 DELETE 跑完后 partial 事务才提交」的并发竞态 + 完整行实时发布丢失时轮后对账重放补投；②published_logs 追加同形信封（stale=True）实时治愈前端乱序胶水段（直播窗口 Redis 发布部分丢失 → 前端按到达序拼出非前缀胶水段，前缀收编失效；前端据令箭按段 id 任意位置撤回，复用既有 override 链路零改动）。标记行在历史回放分类为 override 不渲染；不计入返回 count。
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
- **CLI**（cli.ts，commander）：start/stop/status/logs 四子命令；PID/日志文件在 `~/.sillyhub/daemon/`；start 必带 `--server`（不带会静默连 8000 兜底）；信号 handler 在 Daemon 内部注册，CLI 层不重复（防双重 stop）。
- **Daemon 类**（daemon.ts）：detectAgents → register → 三循环（lease 领取含 `_leasePollSkippable` 节流 / WS 心跳 / 会话控制）；心跳回包 `_syncAllowedRoots`（JSON 相同短路防风暴）+ policy cache 同步；borrow workspace 管理器；turn result/message 回调（async 串行上报保证 message 先于 result 落库）；session end 上报；recover/confirmReconnected；interactive create 抛错主动回传 notifyRunResult failed（P2b/daemon H4，2026-08-24 会话审查——interactive lease 恒 NULL 过期时间，不回传则 run 永久 pending）；认领段 cwd 守卫（2026-08-28-fix-cross-machine-worker-dispatch FR-05/D-004@v1——workspace 绑定会话 rootPath 非空字符串且非借用 marker 时经 `interactive-cwd-guard.ts` checkWorkspaceBoundCwd 白名单终检先行+stat 存在性，任一拒绝 notifyRunResult(error_during_execution, 中文 result_summary) 后 return **不 mkdir**（gap-8 无差别 mkdir 已收敛：仅空 rootPath 兜底路径保留，防错机派发静默建空目录跑偏；cwd 解析改 truthy 判定，`??` 不兜空串））。
- **interactive/**：claude-sdk-driver + codex-app-server-driver 双驱动（codex 多轮 consume 只订阅 input 队列一次——迭代器循环外创建，循环内 next()；InputQueue 单订阅，每轮重订阅第二轮必抛 SessionQueueDoubleSubscribeError，2026-08-24 会话审查 P2a 修复；codex 子进程非正常退出除 turn 级收敛外同时触发 onError 会话级 fail（P2b/daemon H2——只 turn 级收敛时会话 active 无消费者，后续 inject 永久挂起））；session-manager（allowed_roots 写白名单 write-guard——显式写 + Bash 间接写重定向/cp/mv/tee 等都限根内、markPendingSwitch 热切换、reload 孤儿 consume 守卫 isAuthoritative）；input-queue（单订阅，reload 前 resetForResubscribe 保 pending inject）；permission-resolver；会话 jsonl 持久化（create 配供应商→写 daemon 隔离目录、未配→写宿主机 ~/.claude；resume/reload 经 claude-transcript-dir 探测实际位置设 CLAUDE_CONFIG_DIR，ql-20260822-009；SESSION_SWITCH_CONFIG 的 providerConfig 显式 null=切回本机——daemon.ts 路由不归一缺席为 null + reloadWithConfig !== undefined 判定（原双层 ?? 塌缩致切回本机仍跑旧供应商），切回本机时 jsonl 经 migrateClaudeTranscriptToHost 反向迁回宿主机，ql-20260824-018）；SESSION_RESUME 路由接收 backend 随带的 provider_config（snake/camel 双读、null 归一缺省）写 record.providerConfig 供 restoreAndReconnect 重建供应商 env——缺该透传时 reopen 恢复的 SDK 子进程无任何凭证（隔离 CLAUDE_CONFIG_DIR 无本机 OAuth 兜底）"Not logged in" 秒退、会话秒回 ended（ql-20260827-014）。
- **adapters/**：json-rpc / stream-json / ndjson / pi-json / text 多协议输出适配。
- **policy/**：filesystem-policy / runtime-policy（PolicyCache realpath 归一统一口径）/ audit-sink / path-utils（盘符根/Unix 根边界敏感前缀比较，root 已含尾 sep 勿再补）。
- **resilience/**：ResilienceService——submitWithRetry 流式消息退避重试（上限约 8s）用尽入 FileOutbox；retryTerminal 终态轻量重试；心跳健康信号触发 drainOutbox 补发（补发前校验 lease 有效/session 未终态，遇 422 claim_token 失效丢弃）。
- **spec-sync.ts**：spec 树双向同步——拉取 bundle（tar 解包）+ 推送增量（本地 manifest 与 hub spec-manifest 对比算 FileOp ops，hub 404 首推全量）；junction 挂载、pending-push 标记、`SpecPushConflict` 与 push-before-pull 防护。
- **mcp-server.ts（双 toolset）**：同一二进制双模式（env `MCP_TOOLSET`，缺省/拼错回落 orchestration=原 5 编排工具零变化）；`file` 模式=独立 server 名 `sillyhub-file` 仅注册 `upload_file`/`list_uploaded_files` 两工具（worker 注入不含编排工具，不触碰 CC-12 防递归）。路径校验 fail-closed：`MCP_ALLOWED_ROOT` 缺失/空串拒绝一切上传（path_out_of_root），resolve+分隔符前缀校验拒绝对路径/`..` 出根；文件本地读取经 hub-client multipart 直传 `POST /api/agent/file-artifacts`（内容不经 agent 上下文）。注入两条链（2026-08-23-agent-file-upload-mcp）：会话=cli.ts mainAgentMcpConfigProvider 双 server 表 + session-manager per-server env（MCP_SESSION_ID 双条目，injectMcpSessionId 调两次不改签名）；worker（仅 provider=claude）=task-runner 步骤 5.5 写 `os.tmpdir()` 0600 临时 .mcp.json（凭证 per-server env——spike-01 证父进程自定义 env 不透传 MCP 子进程，per-server env 是唯一可靠通道；**同步写**保持 spawn 前零真实异步 IO 间隙）+ run 终 finally 删除 + 构造进程级单次清扫残留 + stream-json buildArgs mcpConfigPath（claude 追加 `--mcp-config`，cursor 忽略）。spike-01（claude CLI 2.1.216 实测）：--mcp-config 与全套既有参数共存；.mcp.json env 支持 `${VAR}` 展开。
- **其它**：credential-injector（litellm_proxy 标记→ANTHROPIC_BASE_URL 指向 hub 代理；anthropic 形态 7 条映射规则，`settings_config.env` 空串值按「未配置」跳过不覆盖 api_key 注入——历史预设空占位曾盖掉真实 key 致会话 "Not logged in"（ql-20260823-007），`extra_env` 契约不变仍原样合并）、ws-client（连接带 X-API-Key header）、local-yaml-writer（init 下发 local.yaml 写盘）、model-error 分类、skill-manager、roots-rpc（磁盘根列举）、host-fs-handler、build-id 自动注入。
- **agent-log/**（2026-08-23-agent-log-conversation-view）：`parse-zcode-model-io.ts` zcode model-io 转录解析器（纯函数：窗口按绝对 offset 对齐合并 full/delta/tail、消息级 toolCalls/reasoning 块/字符串 content 段产出、剥 system 与 `<system-reminder>`、末行 response 补尾同文去重、坏行>50%→parse_error、20MB/5s 保护、200 段窗口+beforeSeq 切片）；`registry.ts` format→parser 注册表（MVP 仅 zcode-model-io-jsonl）。host-fs-handler 第十方法 `readAgentLogMessages(path, format, beforeSeq?)`：白名单守卫先于一切 IO、not_found/forbidden 与 readFile 同 throw 通道、解析结果 status 分层返回（parsed/unsupported/parse_error/too_large，外层 camelCase 内层 snake_case）；daemon.ts 注册 host_fs.read_agent_log_messages RPC。
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

<!-- MANUAL_NOTES_END -->
- 2026-08-20-session-multimodal-attachments：会话附件（图片多模态/文件落盘/multimodal 三态门控）涉及本模块（详见 changes 归档）
- ql-20260824-018-ecf9（quick）：SESSION_SWITCH_CONFIG providerConfig null=切回本机语义修复（daemon.ts 路由 + reloadWithConfig 双层 ?? 塌缩）+ transcript 反向迁移 migrateClaudeTranscriptToHost
