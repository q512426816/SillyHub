---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-09-02 12:00:00
---

# 守护进程中枢（daemon）

## 定位
本地 daemon 运行时的平台侧中枢：daemon 注册/心跳/版本分发、WebSocket 命令枢纽（ws_hub）、
任务租约（lease）、交互式 AgentSession 全生命周期、change-write 任务队列（claim 通道）、
host_fs RPC 代理、审计批量上行、LLM proxy 转发。`DaemonService`（service.py）为薄 facade
（~50 个 async 方法保留历史签名、router 零感知），实际拆在 runtime / lease / run_sync /
session / patch / audit / host_fs 子包；另有独立活 service：`lease_service.py`
`DaemonLeaseService`（claim 语义，`cancel_lease` 被 agent 模块跨模块调用）与
`permission_service.py` `DaemonPermissionService`（审批/dialog 解析）。

## 契约摘要
- 注册与运行时：`GET /api/daemon/version`（camelCase 契约，install.sh/前端消费）、
  `POST /register`、`POST /heartbeat`、`GET /runtimes`（当前用户可见）、
  `GET /runtimes/page`（管理员分页全 owner，q/type/status/user_id/limit/offset）、
  `PATCH /runtimes/{id}`（display_alias）、`DELETE /runtimes/{id}`（绑定时 409）、
  `/runtimes/{id}/disable|enable|offline|self-update`、`/runtimes/{id}/leases`、
  `/runtimes/{id}/list-dir|list-roots`（host_fs 代理）、`/runtimes/usage`、
  `/machines`、`/instances`、`/runtimes/{id}/pending-leases`；
  `POST /machines/{instance_id}/sillyspec-update`（admin，2026-08-31-machine-sillyspec-version：
  归属校验（`_get_owned_instance`，越权/不存在 404）→ ws_hub 推 `daemon:sillyspec_update`
  fire-and-forget，离线/发送失败 504 DaemonRuntimeOffline，成功 `{"sent":true}`；
  刻意不返回 latest_version——npm latest 由 daemon 自行探测经心跳上报）。
- WS 枢纽：`WS /api/daemon/ws` → `DaemonWsHub`：connect（新连接逐出旧 ws）、
  send_to_runtime / broadcast / notify_task_available / send_wakeup（唤醒去重滑窗）、
  send_heartbeat_ack / send_session_control / send_permission_response /
  send_self_update / send_policy_update、send_sillyspec_update（推
  `daemon:sillyspec_update`，DAEMON_MSG_SILLYSPEC_UPDATE 与 daemon protocol.ts
  逐字对齐，2026-08-31-machine-sillyspec-version）、send_rpc（rpc_id→future 关联，
  disconnect 时取消全部 pending 让调用方快速失败）、is_connected / connected_* 查询。
- lease：`POST /leases/{id}/claim|start|heartbeat|messages|complete|sync`、
  `POST /leases/{id}/runs/{run_id}/result`、`DELETE /leases/{id}`；
  `LeaseService`（lease/service.py）含 provider_switch 通知
  （lease/provider_switch.py，llm_provider 消费）与
  `_sync_stage_status_from_run`（从 AgentRun 推导回写 stages 视图，不读 sillyspec.db）。
  独立 `DaemonLeaseService`：claim_task（claim_token 生成）/ heartbeat_lease /
  expire_overdue_leases / alert_stuck_terminating_leases / cancel_lease /
  validate_claim_token；异常族 LeaseConflict / LeaseNotFound / LeaseTokenMismatch /
  LeaseNotClaimable。
- 会话：`POST|GET /sessions`、`DELETE /{id}`（终态才可删）、
  `/{id}/inject|reopen|interrupt|end`、`/{id}/recover|confirm-reconnected|
  mark-recovery-failed|ready`、`GET /{id}/stream`（SSE）、`/{id}/runs`、`/{id}/logs`、
  `GET /{id}/usage`（会话累计用量聚合，2026-08-29-session-usage-stats：owner-only 404，
  SessionUsageRead totals+by_model——agent_run_model_usage 按 model SUM 为主 + 无明细行
  run 的 AgentRun 四维列 NOT EXISTS 兜底（ctx_tokens 快照列排除，「未记录」桶末位
  api_requests=0），全 SQL 侧聚合）、
  `GET|POST /{id}/dialogs`（+history）、`POST /{id}/permissions/{rid}/response`；
  列表 `GET /sessions`：`limit` 收口 `le=500`（2026-08-23-sessions-workspace-hub
  D-103@v1，le=100→le=500 供门户树单页全量取回，>500 仍 422）；响应含非 ORM 列
  `owner_name`（FR-05/D-108@v2——router 层对本页 owner_ids `IN` 批量查
  users.username 注入，免逐行 N+1，照 terminating_at 批查先例；属主用户行缺失/
  username 未回填的旧数据兜底 None 不阻断列表，前端 null 显「—」）；
  `SessionService` 含 `inject_session_as_service`（服务身份注入，跳过用户归属校验，
  供 change 审批联动）。
- 群聊（group chat）子域（group/，2026-09-01-session-group-chat）：router+service
  两文件，端点统一挂 `/api/daemon/group-chats`（照 audit_router 先例进 daemon 前缀）：
  群 CRUD（POST 建/GET 列表含成员摘要 chips/GET 详情/PATCH 改名开关/POST end 解散）、
  成员（POST 添加用户或 agent 成员/PATCH 六要素热切换/DELETE 移除/POST reset-memory）、
  POST `/{id}/messages` 群消息 @路由、POST `/{id}/typing` 心跳。核心机制：
  - @路由：`_parse_group_mentions`（全/半角 @ 昵称精确命中成员表 display_name，
    @全体/@all 广播全部 agent 成员）；未@仅落时间线进群背景摘要（context_window
    默认 20 条、单条 500 字/总长 6000 字，含 agent 回复）。
  - 影子懒建三件套（照 worker `_dispatch_worker_core` 先例）：①直接 ORM 建行
    AgentSession(kind='group_member', config.manual_approval=False)；②
    prepare_interactive_dispatch(pinned_runtime_id=成员机器, stage='group_member')
    走 grants 授权分支（pinned_skip_owner_check=False，见 agent 卡 placement）；
    ③回填成员表 shadow_session_id/shadow_status。忙轮排队 AgentSessionQueuedMessage
    按入队时刻摘要快照派发（不吃后续群进展）。
  - 互@护栏（Redis 全 TTL 自清理）：`group_chain:{载体run_id}` 链去重集+深度
    （cross_mention_depth 默认 2、TTL 30min）、`group_rate` 60s 滑窗限频 6 次/分钟、
    不自我触发；链状态经 run metadata source_carrier_run_id/chain_depth 双轨可查。
  - 热切换：provider/llm_provider/agent_profile 变更走 SESSION_SWITCH_CONFIG 下轮
    边界生效；runtime/workspace 变更影子 end+pending 按新六要素懒重建（记忆重置）。
  - typing/presence：`group_typing:{gid}` pub/sub（preview ≤400 字、TTL 2.5s，不落库
    不进上下文，agent 触发时后端自动发一条）+ `group_presence:{gid}:{uid}` TTL 60s
    （群 SSE 生成器循环续期）。
  - 桥接投影（run_sync/service.py 两改动点）：①submit_messages **事务内双写投影行**
    ——影子行落库后同事务插新 PK 投影行（run_id=群载体 run、dedup_key 复用、
    metadata={member_id, member_name, source_log_id}），PublishIntent 增
    group_id/member_id/member_name/member_session_id/projection_log_id，群频道事件
    log_id 用投影行 id（实时与回放同 id，前端去重天然兼容）；②close_interactive_run
    群影子收口发 turn_completed 带 member 身份，随后执行互@检测。仅投影 assistant
    文本段，tool_call/thinking 不进群。
  - 权限分支（参与者制，session/service.py 三处 `_get_owned_session_for_update`/
    `get_agent_session`/`get_agent_session_logs` + permission_service.py 三处 + SSE
    内联校验）：kind='group' 首查未命中经 `get_group_accessible_session` 探测
    （群成员表命中→workspace admin→404 不泄露存在性）；群消息落载体 run
    （status='completed' 纯载体）；`agent_sessions:changed` payload 增
    audience_user_ids（群事件=全部用户成员）；群 SSE 多路订阅
    （agent_session:{gid} + group_typing:{gid} 双 pubsub 合流，event: typing 区分）。
- change-write 队列（change_write_router.py）：`GET /runtimes/{id}/pending-change-writes`、
  `POST /change-writes/{id}/claim`（daemon 认领，生成 claim_token）、
  `POST /change-writes/{id}/complete`（done/failed 回执）、
  `PATCH /change-writes/{id}/progress`（BL-3：仅 status=claimed 可写；
  D-004 单一写者——只写 files_total/files_processed 不改状态；写计数同步刷新
  claimed_at 作活跃心跳）。
- 版本分发（dist_router.py，无 /api 前缀）：`/daemon/install.sh`、`/daemon/install.ps1`、
  `/daemon/latest.json`、`/daemon/latest/sillyhub-daemon.js`、
  `/daemon/latest/mcp-server.js`。
  - `install.ps1` 编码契约（ql-20260826-006-cbf2 + ql-20260831-003）：源文件
    `sillyhub-daemon/scripts/install.ps1` 带**恰好一个** UTF-8 BOM（WinPS 5.1 对无 BOM 文件
    按 GBK 解码致中文乱码切碎引号）——BOM 的**单一来源就是源文件**；backend/Dockerfile
    **禁止再补 BOM**（历史 ql-20260824-005/006、ql-20260826-006 三次横跳：Dockerfile printf
    补 BOM 与源 BOM 叠加成双 BOM），并有"恰好一个 BOM"构建断言（首 3 字节 = EF BB BF 且
    第 4-6 字节 ≠ EF BB BF，违反即构建失败）。dist_router 用 `read_text(utf-8-sig)` 读模板
    以**剥掉 BOM**（防 `\ufeff` 污染 `irm | iex` 管道——残留 BOM 会让用户首行注释被当
    代码执行，报"无法将 Windows 项识别为 cmdlet"），响应
    `application/x-powershell; charset=utf-8`；测试锚点 `test_daemon_dist.py::test_install_ps1`
    （fixture 模板带单 BOM + 断言响应体不以 `\ufeff` 开头）。
  - nginx 部署契约（2026-08-26 修复）：宿主机 nginx（`/etc/nginx/sites-enabled/crrcdt`）
    把整个 `location /daemon/` **代理到后端 8001**（install.sh / install.ps1 / latest.json /
    *.js bundle 统一由 dist_router 从镜像 `/app/daemon-dist/` 吐最新版）。曾踩坑：原配置用
    `alias /var/www/sillyhub/daemon/` 直出静态目录，那份是 7月旧版——bundle 0.1.0、
    latest.json `fd0314c`、install.ps1 无 BOM 且 `{{SERVER_URL}}` 占位未替换 → 用户下载
    install.ps1 即 GBK 乱码解析失败、装到的是 0.1.0 旧 bundle。修复后该静态目录已弃用
    （文件仍残留在 `/var/www/sillyhub/daemon/`，无害，可后续清理）。
- 审计子域（audit/）：- grants 子域（grants/，2026-08-28-daemon-agent-share）：`daemon_runtime_grants` 统一授权表
  （workspace|platform 两类 grantee，唯一约束 NULLS NOT DISTINCT）；管理端点
  `GET|POST|PATCH|DELETE /api/daemon/shared-agents`（require_platform_admin，创建五重校验：
  runtime 限管理员自己名下在线/档案 visibility 显式升级/writable_dir ⊆ allowed_roots）+
  `GET /api/daemon/shared-agents/active`（任意登录用户）；`GET /machines`、`/runtimes/page`
  响应附加 `shared_to_me`（成员资格+daemon:borrow 双条件，SharedMachineView 含 runtimes 明细）；
  会话钉定校验 owner 短路 → `authorize_pinned_runtime`（workspace grant 放行写借用审计含
  grant_id；platform grant 的 runtime 直传钉定 404——共享唯一入口=档案检测分支，D-012）。
`POST /api/daemon/audit/batch`（daemon 批量审计上行）+ 查询端点。
- 其它：`GET|POST /llm-proxy/{path:path}`（daemon 侧 LLM 网关转发）、
  `GET /skills/latest/manifest`（skills bundle 分发，agent 模块消费）。
- host_fs：delegate.py + ws_rpc.py——经 WS RPC 读客户端文件系统
  （list_dir、sillyspec.db 读等；runtime/service.py 的 DaemonRpc* 异常族：
  Timeout/Conflict/GatewayError/ForbiddenError/RemoteGatewayError/RemoteError）。
  git RPC 族：git_apply/git_rev_parse/git_worktree_add/git_merge/
  git_worktree_remove——remove 可选 branch 参（ql-20260902-001：remove 成功后
  daemon 侧连带 `git branch -D` 删 workers/<id> 分支；旧 daemon 忽略未知参向后兼容）；
  worktree 三方法（add/merge/remove）显式传 150s RPC 传输预算
  （ql-20260903-002：daemon 侧 git 上限 120s、后端预算须大于它——走 30s 默认时
  检出落在 30~120s 窗口后端先放弃，真实 git 报错被 "rpc unavailable" 降级掩盖，
  且立即收残与 daemon 侧在跑的 add 竞态留残缺副本）。
- 模型：daemon_instances（build_id/版本；sillyspec 三列 2026-08-31-machine-sillyspec-version：
  sillyspec_version / sillyspec_latest_version VARCHAR(50) NULL + sillyspec_update JSON NULL
  ——升级状态机快照 {state, trigger, from_version, to_version, error, since}）、
  daemon_runtimes（display_alias、allowed_roots、owner）、daemon_task_leases、
  daemon_change_writes（files_total/files_processed 计数列）、session_dialog_requests。

## 关键逻辑
```
ws_hub RPC: send_rpc(rpc_id 注册 future, 10s 超时) → daemon 处理 →
  DAEMON_MSG_RPC_RESULT 按 rpc_id resolve; 断连取消全部 pending

change-write claim 生命周期: daemon 轮询 pending → claim(生成 token) →
  执行(progress 刷计数+claimed_at 心跳) → complete(ok/err)
GC(_gc_expired_change_writes): claimed 超时——kind=spec-sync 600s 长窗
  (SPEC_SYNC_CLAIM_TIMEOUT_SECONDS)其余 60s; 超时行清 claim 态回灌 pending
  供下轮重做(create/edit 覆盖写、spec-sync content-hash 合并均幂等);
  complete(ok=false) 永久错误仍 failed 不重试(无死循环)

stage 完成(形态A 留痕): gate task 只落 gate_result + gate_status=decided
  + 发 SSE; complete_lease 回调变轻(不 auto-dispatch 不自动同步 sillyspec.db);
  team 保留 merge_gate_results + complete_stage; 推进交 change 模块显式 advance
```

## 注意事项
- 用户可见错误文案中文：session/service.py 的 DaemonRuntimeOffline/DaemonOffline
  （创建/注入/打断/恢复 5 处）为中文短语 + 行动指引，UUID 移 `details`
  （前端 runtime-session-dialog 原样透传 message）。
- 路由顺序：`/runtimes/page`、`/runtimes/usage` 等固定路径必须声明在
  `/runtimes/{runtime_id}` 前，否则 FastAPI 把 `page` 当 UUID 解析 422。
- 跨 owner 管理：runtime get/disable/enable/delete/update 接收 `is_platform_admin`；
  `DELETE runtime` 遇未软删 workspace 绑定抛 `DaemonRuntimeInUse`(409，
  details 带占用列表)；软删引用先应用层解绑再删
  （PG FK RESTRICT 不看 deleted_at 的 dialect 差异坑，SQLite 测试漏网 PG 生产暴露）。
- 会话活动态 = pending/active/reconnecting；删终态会话前显式清空
  `AgentRun.agent_session_id` 保留运行历史；查询/写入按 `AgentSession.user_id`
  库层隔离。
- reopen provider gate：`{"claude","codex"}` 可恢复，其余抛
  DaemonSessionResumeUnsupported；`agent_session_id` 对 Claude 是 SDK session id、
  对 Codex 是 thread id。
- flat message（Codex driver 上报 event_type+content+metadata）与 Claude SDK raw
  message 同一落库路径；审批/dialog 走 PERMISSION_REQUEST/RESPONSE provider-neutral
  通道，`dialog_kind` 标记 codex_request_user_input / mcp_elicitation；
  ask_user_only=true 只阻塞用户输入/可归一化 elicitation，复杂 schema fail-closed
  上报 error log。
- 子 service 间调用经 facade 引用注入 + `__init__` lazy import 避免模块级循环；
  异常类定义在子包、facade re-export 保持
  `from app.modules.daemon.service import XxxError` 路径不变。
- `/daemon/version` 与 dist 端点是 install.sh/install.ps1 对外契约
  （camelCase noqa N815），改动即破坏远程安装。
- change_writer 的 `proxy_create_change` 经本模块 change-write 队列代写变更
  （占坑/回滚语义见 change_writer 卡片）；GC 回灌语义保证 daemon 中断不丢任务。

- 会话↔spec 绑定三入口（2026-08-25-session-spec-binding）：①run_sync.submit_messages 入库时解析 tool_kind='sillyspec' 命令自动绑变更（agent_session_id None/会话缺失/workspace None 三守卫，X-002）；②创建会话 change_id 补写 link（D-002 双写）+ quicklog_id 新参数落 quicklog 绑定（facade 需同步透传，否则 500）；③GET /sessions 筛选 change_id 改 M:N 子查询、新增 ql_id（(workspace_id, ql_id) 双条件防跨工作区串扰）。

- 会话树参数（2026-08-25-team-subsession-governance）：SessionService.create_session 追加
  parent_session_id/stage/first_run_mission_id/first_run_role 可选参数（缺省逐字节零回归），
  分身形态由 agent 模块 dispatch_worker 经 prepare_interactive_dispatch 原语直连消费
  （create_session 的 runtime 属主校验与跨 ws 代表钉定冲突，见该变更实现偏离记录）。
- 会话闸失败收口（2026-08-26-team-subsession-recursion）：run_sync close_interactive_run 增「失败即收口」
  ——首 run failed + 会话从未 ready + parent 非空三条件缺一不可 → 子会话置 failed+ended_at
  （对齐 _fail_worker_subsession 语义），防 daemon 会话闸拒绝后子会话永久 active；追问轮中途失败不命中。

- sillyspec 三列落库语义（2026-08-31-machine-sillyspec-version，D-002@v1 双通道——
  写入/清除在 RuntimeService register/heartbeat）：register 对 version/latest **无条件
  直写**（含 None=未安装/未知，本机卸载后重启收敛为 NULL 的唯一路径）且 sillyspec_update
  恒置 None（daemon 状态机在内存，进程重启即失）；心跳 version/latest 走兄弟字段语义
  （仅非 None 覆盖，缺省/null 均保留——pydantic 不可区分）；心跳 sillyspec_update 同
  pending_update 反向语义——None/无键即清除置 NULL，非 None upsert（首写/五键内容变化
  盖 since=now，同内容重放保留原 since 防退化成最后心跳时间；error 服务层截断 200）。
  DTO：register/heartbeat 请求各加两键 + `DaemonHeartbeatSillySpecUpdate`（state/trigger
  不收紧 Literal，宁宽勿断保心跳通道）；机器视图 `_build_machine_read` 显式逐字段组装
  三字段 + `MachineSillySpecUpdateRead` 嵌套（就近 MachinePendingUpdateRead，
  DaemonMachineReadWithPending 透出，仅 GET /machines）。
## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260831-004：run 失败原因透出链打通（实机两案：本机撞闸 SESSION_LIMIT_REACHED 原因只存 output_redacted 前端看不到；生产 wp 机会话 84cf91ab inject 已送达 daemon 但被静默丢弃，GC 判败只有 error_code 无文案）。① SessionRunRead 新增 failure_summary（validation_alias 直映 AgentRun.output_redacted，零查询改动；仅 failed 轮有语义——成功轮该列是 agent 输出摘要，前端勿当失败原因展示）；② control_commands GC inject 过期联动判败按 delivered_at 分桶写可读原因到 output_redacted（未送达=daemon 离线/断连 vs 已送达未执行=无回执）；③ 前端 normalize.buildSystemFailureItem + session-panel 三处失败轮错误卡逐级兜底（error_detail 模型层 → failure_summary → error_code 中文映射）。（遗留已清偿 ql-20260831-005-c7a7：daemon 侧 SESSION_INJECT 四条静默丢弃路径已改为立即 notifyRunResult 失败带中文原因，不再等 10 分钟 GC 收敛。）
- ql-20260831-012-cd5e（前端部分）：suspended 放开手动续聊——canResumeSession 加 suspended（backend reopen 本就接受，此前前端禁用是误判）+ 挂起横幅改双通道文案（自动恢复+可点「继续对话」立即恢复）。后端自动救回与本条同案撞车，采纳并行会话先落地的 session_auto_recover_sweep_once（ql-20260831-006-6d67，含 AUTO_RECOVER_MIN_AGE_SEC 防误抢优雅停机窗口），本会话的后端重复实现已在 rebase 时让路删除；实机锚同为生产 574793c6（部署重启后端致 wp 心跳断超 600s 被离线巡检挂起，runtime 回在线后永挂）。**quick 2026-09-01 风险审查修**：该文案承诺的「继续对话」入口当时并不存在（唯一 reopen 按钮只在 ended/恢复超时横幅渲染、输入框被 suspended 禁用、唯一渲染该按钮的 SessionHistoryView 无生产调用点）——页模式挂起横幅补真按钮接 handleReopen（backend reopen 接受 suspended）；dialog（attach）变体无 reopen 机制，文案改回只保自动恢复承诺。
<!-- MANUAL_NOTES_END -->
