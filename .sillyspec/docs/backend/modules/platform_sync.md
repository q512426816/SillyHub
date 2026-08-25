---
schema_version: 1
doc_type: module-card
module_id: platform_sync
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 跨仓同步通道（platform_sync）

## 定位
SillySpec CLI 直跑时的跨仓上行通道（进度 / 文档 / 审批 / quicklog / spec 文件增量同步），workspace 隔离。凭证与 mcp_gateway 的 McpToken 同构：`shpsync_` 前缀长期 token（明文 = 前缀 + 32 随机字节，库存 sha256、前缀 O(1) 分流）签发时派生 (user, workspace_id)，是写通道唯一开放形态。change 模块读时经 `latest_progress` 投影 current_stage（read-only join，不双写）。

## 契约摘要
- 进度（`platform_sync_router`，无 prefix，路径内写全 `/changes/...`，main 挂 `/api`）：
  - `POST /api/changes/{name}/progress`（写）：CLI 上行进度，body 裸六表 JSON，`X-Base-Ts` 乐观锁基准，`pushed_at` / `user` 元信息。
  - `GET /api/changes`（读）：收件箱轻列表（`list_lightweight`，占位行 Python 层过滤）。
  - `GET /api/changes/{name}/progress`（读）：完整 progress JSON；不存在/跨 workspace → 404（客户端 fetchJson null 降级不阻断）。
- spec 文件增量同步（spec-file-incremental-sync，均写权限 `require_platform_sync_write`）：
  - `GET /api/changes/-/spec-manifest` → `SpecManifestResponse`：服务器权威清单（`SpecManifestFileEntry`：path / hash(SHA-256 hex) / version / exists，含软删行）。
  - `POST /api/changes/-/spec-sync` → `SpecSyncResponse`：CLI diff 出的 `FileOp[]`（add/update/delete/rename，每文件带 `base_version`）一次 POST，透传 `SpecWorkspaceService.apply_ops` 单事务；conflict 不改状态码（恒 200，`conflict=true` + `server_versions` 交 CLI 提示人工拍板）。
- 审批与文档：`GET|POST /api/changes/{name}/approval`（读门控 + 写闭环，reject 后 CLI execute 真正阻断）；`POST /api/changes/{name}/documents`（`DocumentsSyncRequest` 为 RootModel 裸扁平 map，顶层即文件名）。
- `POST /api/quicklog-entries`（写）：quicklog 条目上行（`QuicklogEntryORM` / `QuicklogEntryPushRequest`）。
- agent 会话日志上报（2026-08-23-platform-agent-log-ingest，协议 sillyspec 仓 `docs/platform-agent-log-protocol.md` §1）：
  - `POST /api/agent-logs`（写）：CLI `sillyspec run` 入口探测本地 harness 日志后 best-effort 推送**路径+元信息**（不含内容）；`(workspace_id, log_path)` 幂等 upsert 整行覆盖（`AgentSessionLogORM` / `platform_agent_logs` 表，CLI 留底是 invocations 计数权威）；任意 2xx 即成功。
  - `GET /api/agent-logs?workspace_id=&limit=`（读）：会话详情「本地 Agent 日志」面板数据源；scope 复用 `_read_args`（越权 workspace → 空列表不 403），`last_seen_at DESC NULLS LAST` 排序。
  - agent 日志会话化（2026-08-23-agent-activity-sessions，协议 sillyspec 仓 §1 v1.1）：
    - `POST` 增 body 级 `hub_session_id`（daemon env 注入，命中且同 ws → entries 关联该会话；未命中静默降级）与 entry 级 `change_key`/`quick_id`（随 entry 持久化，D-009）；无 hub → 按 `(workspace, harness, ctx)` find-or-create `origin='tool_report'` 会话（agent_sessions 加 origin/aggregation_key/title 列）。
    - `GET /api/agent-logs?session_id=`（读）：会话关联条目（普通会话尾部折叠条目 + tool_report 会话主体）。
    - `GET /api/agent-logs/{id}/content`（读）：daemon `host_fs.read_file` 直连（不走 delegate degrade）、format 黑名单 409、尾部 256KB 字节截断、404/409/504 错误族。
- workspace 面（`platform_sync_workspace_router`，prefix=/workspaces）：`/api/workspaces/{workspace_id}/platform-sync-tokens` 签发；`POST /api/workspaces/resolve-by-root-path` connect 换发（含手动 `has_permission(WORKSPACE_WRITE)` 403/404 闭环）。

## 关键逻辑
```
require_platform_sync 三路径分流（Bearer）:
  shpsync_ → PlatformSyncTokenService.authenticate → (User, workspace_id)   [写+读]
  shk_live_（ApiKey）→ 只读;  其它 → get_current_user（JWT）→ 读并集
  写端点一律 require_platform_sync_write: 仅 shpsync_, 其余 403
upsert_progress（契约 §4.2 base_ts 乐观锁）:
  base_ts 空/缺失 → 无条件接受（首次同步/无基准）
  stored = row.last_pushed_at; stored > base_ts（ISO 8601 UTC 字符串字典序比较, 不转 datetime）
    → conflict（回 platform_progress + last_pushed_at, 不落盘）
  否则 → _apply 落 progress JSON + _ensure_change_row 占位行 + _sync_change_owner
spec-sync: row.version != op.base_version → conflict=true（另有同内容豁免 D-008@v2）
```

## 注意事项
- **两套乐观锁语义别混**：progress 上行是 `base_ts` ISO 字符串字典序；spec 文件 ops 是整数 `base_version` 版本比较（逻辑在 spec_workspace.apply_ops，本模块只透传）。
- `platform_change_progress` 主键形态（fix-platform-progress-pk 后）：独立 `id` UUID 主键 + `(workspace_id, change_name)` 复合唯一；`workspace_id` 为 NULL 的历史过渡行用 `is_(None)` 匹配。documents/approval 是同表定向 JSON 列（单写者），migration 20260814220000 加列零回填。
- router 刻意**不自带 prefix**：为避开 FastAPI 对 `GET /changes` 的 redirect；`{name}` 动态路由与 `/-/spec-manifest` 字面路由共存依赖声明顺序，加新端点放对位置。
- `DocumentsSyncRequest` 必须保持 RootModel 裸 map（CLI `JSON.stringify(documents)` 顶层即文件名）；列表占位行过滤在 Python 层做（SQLite JSON 列 `'null'` 字符串坑，SQL IS NOT NULL 不可靠）。
- shpsync_ 明文只在签发响应出现一次；`get_or_issue` 的「复用」= 吊销旧 + 签新（明文不可恢复），供 init claim 注入 local.yaml（明文不落 lease.metadata）。
- `_sync_change_owner` 用 token 签发人真实 User id 对齐 `ux_changes.owner_id`（best-effort 失败不阻断）；**冲突分支不触碰 owner**——被拒上行不得改责任人。
- spec-manifest 读清单也收紧为写权限（清单是增量写协议一部分，防探测文件布局）；`scope.workspace_id is None` 一律 403 fail-closed。
- 消费链是 CLI（写）+ change 投影（读），前端不直接调写端点；改响应字段前先对 sillyspec 仓 sync.js 契约，别单侧改。

- agent-logs 会话绑定（2026-08-25-session-spec-binding）：upsert_agent_log_entries hub 分支补消费 entry 的 change_key/quick_id（原完全忽略）绑到 hub 会话；聚合分支 tool_report 会话组级落绑定；两键互斥并存 quick 优先；default 伪键由 bind_session_to_change 内部守卫兜底不建 placeholder。

## 人工备注

<!-- MANUAL_NOTES_START -->
- **2026-08-23-agent-activity-sessions**：上报日志会话化——`platform_agent_logs` 加 `agent_session_id` FK；upsert 归属两分支（hub 关联 D-005 降级 / (harness, entry.ctx) find-or-create tool_report 会话 D-009，会话 owner=token 派生 user、provider 按 harness 映射 D-007、pending、last_active_at 心跳）；GET 增 session_id 过滤；新内容端点（直连 ws_rpc 26 用例）。配套：daemon 三路径注入 SILLYHUB_SESSION_ID（本仓 sillyhub-daemon/）、inject 懒激活（daemon/session，409 离线 AppError）、前端 🧾 徽标 + AgentLogSessionBody + 会话关联折叠条目（移除 workspace 级挂载 D-004）。跨仓 sillyspec commit 4e4fc6b0（entry 级 ctx + hub_session_id）；主仓 20f57f6c。端到端六项实证 runtime-evidence.md。
- **2026-08-23-platform-agent-log-ingest**：新增 agent 日志上报双端点（POST/GET /api/agent-logs）+ `platform_agent_logs` 表（迁移 20260823090000，(workspace_id, log_path) 复合唯一 upsert、结构化列不存 payload D-002、时间列 String ISO 原文 D-003）+ 前端会话详情 AgentLogCard 卡片（frontend/src/components/daemon/）。鉴权完全复用既有两依赖（写 shpsync_ fail-closed / 读 CHANGE_READ 并集）；消费方扩展为 CLI（写）+ 前端面板（读，此前前端不直接调本模块读端点——GET /agent-logs 是首个）。12 新测试（鉴权矩阵/幂等/去重/跨 ws/422/scope+排序+limit）；端到端双实证：worktree 后端 8010 真实 CLI 推送落 3 行 zcode 条目 + 部署后 8001 真实 200 与 invocations 1→2 心跳。附带修复两个「迁移单头断言写死 REVISION_ID 是 head」的过严测试（agent/tests/test_mission_session_id.py、tests/test_session_agent_session_id_migration.py，按意图放宽为单头+在链）。
- **2026-08-14-platform-sync-docs-approval**（D-001~004@v1）：补 CLI 预留两契约端点（POST documents 404 / POST approval 405 均为 sillyspec 仓 sync.js 的 959 行（跨仓引用，时点 2026-08-14）TBD-hub-api 未对齐）+ GET approval 改读库完整闭环（reject 后 CLI execute 真正阻断）。表加 documents/approval 两 JSON 列（migration 20260814220000 batch_alter_table 零回填）；service 三方法定向列单写者；46 测试（32 旧零回归 + 14 新含单写者/占位行守卫）；CLI E2E 三连验证（sync-docs 4 文档/approve/reject+GET 回读 rejected）；gen:types openapi 363 paths。两实现修正：DocumentsSyncRequest 用 RootModel 裸扁平 map（CLI JSON.stringify(documents) 顶层即文件名）；list 占位行过滤用 Python 层（SQLite JSON 'null' 字符串坑）。
- **2026-08-12-init-provision-local-yaml**（D-001）：PlatformSyncTokenService 新增 `get_or_issue(*, workspace_id, created_by) -> tuple[ORM, 明文]`——内联 select 旧未吊销（ws+created_by+revoked_at IS NULL）+ UPDATE 吊销（不新增 public revoke，零回归）+ 调既有 create（name='init-provisioned', scope=None）签新。供 init claim 时 `build_claim_payload`（daemon/lease/context.py mode=='init' 分支）现算注入 payload.platform_config.local_yaml（明文不落 lease.metadata_，D-002/P0）。"复用"语义=吊销旧+签新（明文不可恢复）。守 design §5.2。
- **2026-08-11-change-progress-projection**（D-001~006 / R-01~08）：加 workspace 隔离（D-001 token 派生，参照 McpToken 模式建 PlatformSyncTokenORM + PlatformSyncTokenService，shpsync_ 前缀）+ PlatformChangeProgressORM 加 workspace_id nullable 复合唯一 + require_platform_sync 返 (User, workspace_id|None) 三路径分流 + service upsert/list/get 全加 workspace_id（is_(None) 处理 NULL 过渡期）+ 2 新端点（platform-sync-tokens 签发 / resolve-by-root-path connect 换发含 D-006 手动 has_permission WORKSPACE_WRITE 403/404 闭环）+ change 模块 `_project_current_stage` 批量 IN join 投影 current_stage（D-002 read-only 不双写）+ fallback（D-003）+ 不投 status（D-004@v2 撤销，sillyspec status 仅 active/archived）+ connect 跨仓换发（D-005 replaceTopLevelSection 保留注释，降级 best-effort）+ 契约 §14。前置 sillyhub-platform-sync 建模块时 scan 漏登 _module-map，本次补建本卡。
- **ql-20260812-001-6eb8**（补 approval 端点）：新增 `GET /api/changes/{name}/approval`（router.py）+ `ChangeApprovalResponse`（schema.py）。根因 sillyspec CLI execute 启动时 GET 此端点查审批门控（sillyspec 仓 command.js 的 1071-1080 行，跨仓引用时点 2026-08-12），后端从未实现→404，CLI sync.js checkApproval 把 fetchJson null 误判 `{status: pending}` 卡死。方案：端点复用 `require_platform_sync` 鉴权，无条件返回 `ChangeApprovalResponse(status="approved", reason="no approval policy configured; auto-approved")`，不查库不 404；3 测试（200/401/JWT）。跨仓契约 `sillyhub-progress-sync-contract.md` 存 sillyspec 仓（本仓不持有，未同步）。sillyhub-daemon/src/api-types.ts 未同步（daemon 不消费 platform_sync 端点，无功能债，留后续）。
- **2026-08-13-fix-platform-progress-pk**（D-001~005）：`platform_change_progress` 主键缺陷修复——`change_name` 全局唯一单主键 → 独立 `id` UUID 主键（`default=uuid.uuid4`）+ `change_name` 去主键降普通列 + 保留 `(workspace_id, change_name)` 复合唯一。修跨 workspace 同名 500 与 NULL 历史行挡道两个缺陷（`_find_row` 复合键 / `_project_current_stage` join / upsert 回退逻辑全不变）；migration `batch_alter_table` 回填现有行 id；service `upsert_progress` INSERT 加 `id=uuid.uuid4()`。零 API 变更（端点/schema/body 不变，D-004，无 gen:types）。
<!-- MANUAL_NOTES_END -->
