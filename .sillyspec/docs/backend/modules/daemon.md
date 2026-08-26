---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-08-23 10:10:26
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
  `/machines`、`/instances`、`/runtimes/{id}/pending-leases`。
- WS 枢纽：`WS /api/daemon/ws` → `DaemonWsHub`：connect（新连接逐出旧 ws）、
  send_to_runtime / broadcast / notify_task_available / send_wakeup（唤醒去重滑窗）、
  send_heartbeat_ack / send_session_control / send_permission_response /
  send_self_update / send_policy_update、send_rpc（rpc_id→future 关联，
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
  `GET|POST /{id}/dialogs`（+history）、`POST /{id}/permissions/{rid}/response`；
  列表 `GET /sessions`：`limit` 收口 `le=500`（2026-08-23-sessions-workspace-hub
  D-103@v1，le=100→le=500 供门户树单页全量取回，>500 仍 422）；响应含非 ORM 列
  `owner_name`（FR-05/D-108@v2——router 层对本页 owner_ids `IN` 批量查
  users.username 注入，免逐行 N+1，照 terminating_at 批查先例；属主用户行缺失/
  username 未回填的旧数据兜底 None 不阻断列表，前端 null 显「—」）；
  `SessionService` 含 `inject_session_as_service`（服务身份注入，跳过用户归属校验，
  供 change 审批联动）。
- change-write 队列（change_write_router.py）：`GET /runtimes/{id}/pending-change-writes`、
  `POST /change-writes/{id}/claim`（daemon 认领，生成 claim_token）、
  `POST /change-writes/{id}/complete`（done/failed 回执）、
  `PATCH /change-writes/{id}/progress`（BL-3：仅 status=claimed 可写；
  D-004 单一写者——只写 files_total/files_processed 不改状态；写计数同步刷新
  claimed_at 作活跃心跳）。
- 版本分发（dist_router.py，无 /api 前缀）：`/daemon/install.sh`、`/daemon/install.ps1`、
  `/daemon/latest.json`、`/daemon/latest/sillyhub-daemon.js`、
  `/daemon/latest/mcp-server.js`。
  - `install.ps1` 编码契约（ql-20260826-006-cbf2）：源文件 `sillyhub-daemon/scripts/install.ps1`
    带 **UTF-8 BOM**（WinPS 5.1 对无 BOM 文件按 GBK 解码致中文乱码切碎引号）；dist_router
    用 `read_text(utf-8-sig)` 读模板以**剥掉 BOM**（防 `\ufeff` 污染 `irm | iex` 管道），
    响应 `application/x-powershell; charset=utf-8`。
  - nginx 部署契约（2026-08-26 修复）：宿主机 nginx（`/etc/nginx/sites-enabled/crrcdt`）
    `location /daemon/` 用 `alias /var/www/sillyhub/daemon/` 直出静态目录（install.sh /
    latest.json / .js bundle 走这份静态，无 server_url 注入需求）；但 `install.ps1` 必须
    走后端（注入 `{{SERVER_URL}}` + 补 charset），故加精确匹配
    `location = /daemon/install.ps1 { proxy_pass http://127.0.0.1:8001; ... }`（精确匹配
    优先于 `/daemon/` 前缀）。曾踩坑：install.ps1 也走静态目录 → 吐无 BOM 旧副本 + 占位符
    未替换 → 用户下载即 GBK 乱码解析失败。
- 审计子域（audit/）：`POST /api/daemon/audit/batch`（daemon 批量审计上行）+ 查询端点。
- 其它：`GET|POST /llm-proxy/{path:path}`（daemon 侧 LLM 网关转发）、
  `GET /skills/latest/manifest`（skills bundle 分发，agent 模块消费）。
- host_fs：delegate.py + ws_rpc.py——经 WS RPC 读客户端文件系统
  （list_dir、sillyspec.db 读等；runtime/service.py 的 DaemonRpc* 异常族：
  Timeout/Conflict/GatewayError/ForbiddenError/RemoteGatewayError/RemoteError）。
- 模型：daemon_instances（build_id/版本）、daemon_runtimes（display_alias、
  allowed_roots、owner）、daemon_task_leases、daemon_change_writes
  （files_total/files_processed 计数列）、session_dialog_requests。

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
## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
