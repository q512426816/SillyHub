---
schema_version: 1
doc_type: module-card
module_id: platform_sync
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 进度与规格同步（platform_sync）

## 定位
SillySpec CLI ↔ 平台的跨仓同步层。CLI（agent 进程内运行，或 daemon 的 spec-sync）把变更进度、四件套文档、审批记录、quicklog 条目回传平台落库，并经 manifest / spec-sync 两端点做 spec 文件的**服务器权威增量同步**。变更中心读时投影（current_stage 等）以此模块落库的数据为源。写通道仅接受 `shpsync_` workspace 级 token。

## 契约摘要
- 主 router（tag=platform-sync，9 端点）：
  - 进度：`POST /changes/{name}/progress`（base_ts 乐观锁上行）、`GET /changes/{name}/progress`
  - 列表：`GET /changes`（轻量列表，按读 scope 聚合）
  - 文档：`POST /changes/{name}/documents`（四件套全文扁平 map）
  - 审批：`GET /changes/{name}/approval`、`POST /changes/{name}/approval`
  - quicklog：`POST /quicklog-entries`
  - agent 日志（2026-08-23-platform-agent-log-ingest / 2026-08-23-agent-log-conversation-view）：
    - `POST /agent-logs`：CLI 批量幂等 upsert + 归属（hub_session_id 挂接 / (harness, ctx) find-or-create tool_report 会话）
    - `GET /agent-logs`：按读 scope 聚合列表
    - `GET /agent-logs/{id}/content`：原文尾部 256KB（读即弃；回落与二进制格式唯一通道）
    - `GET /agent-logs/{id}/messages?before_seq=`：对话化归一化消息——经 ws rpc host_fs.read_agent_log_messages 透传（MVP 解析 zcode model-io），status 四值一律 200 分层（parsed/unsupported/parse_error/too_large，前端判断回落）；唯一 422=老 daemon method-not-found；与 content 端点共享 scope 校验/二进制黑名单/daemon 定位/错误映射 helper（`_resolve_agent_log_read_target` / `_send_agent_log_rpc`）
  - spec 文件增量（spec-file-incremental-sync）：
    - `GET /changes/-/spec-manifest`：服务器权威清单全量行（含 exists=False 软删行）
    - `POST /changes/-/spec-sync`：FileOp 增量应用，单事务全成全败，返回 new_versions / conflict / server_versions；无标注时扫 ops 内 `changes/` 前缀兜底触发 reparse
- workspace_router（prefix=/workspaces，tag=platform-sync-tokens）：`shpsync_` token 签发 / 吊销
- 鉴权（auth.py 三路分流，`require_platform_sync` 读 / `require_platform_sync_write` 写）：
  - `shpsync_` 前缀 → `PlatformSyncTokenService.authenticate`（绑 created_by user + workspace）
    - **唯一写通道**，读/写均放行；收件箱隔离单 workspace（scope.workspace_id）
  - `shk_live_` / JWT → 仅读：CHANGE_READ workspace 并集 scope（platform_admin = 全 workspace）+ NULL 桶并入
    - **全局聚合语义已移除**（旧 workspace_id=None 全局读改并集，D-004@v1）
  - 边界约定：401 = 无凭据或凭据无效；403 = 凭据有效但写通道关闭
- 数据模型：
  - `PlatformChangeProgressORM`（`platform_change_progress`）：
    - id UUID 主键 + `(workspace_id, change_name)` 复合唯一（D-001@v1，跨 workspace 同名各占一行）
    - workspace_id nullable：shk_live_ 过渡期 None 行可写（唯一约束允许多 NULL）
    - `latest_progress` 裸 JSON 六表投影（serializeForSync，不强类型化）
    - `last_pushed_at` 用 **String 存 ISO 8601 UTC**（字典序即时间序，R-04 前提）
    - `documents` / `approval` 独立列——单写者原则（D-003@v1），upsert_progress 定向列 UPDATE 不触碰
  - `QuicklogEntryORM`：quick 条目推送落库
  - `PlatformSyncTokenORM`（token_model.py）：shpsync_ token 行
- `PlatformSyncService` 方法面：upsert_progress / list_lightweight / get_progress / upsert_documents / set_approval / get_approval_record / upsert_quicklog_entry / get_spec_manifest / apply_spec_ops

## 关键逻辑
```
upsert_progress(workspace_id, name, body, base_ts, pushed_at, user, user_id):
  base_ts 空/缺失 → 无条件接受（首次同步）
  stored = row.last_pushed_at；stored > base_ts（字符串字典序）→ 冲突
    → 返回平台侧 latest_progress（CLI 呈现冲突，不改任何数据）
  否则接受: _apply(upsert) + _ensure_change_row(占位) + _sync_change_owner(best-effort)
_apply 并发自愈: 并发双发 INSERT 撞复合唯一约束 → catch IntegrityError
  → rollback → 重查行改走 UPDATE（SQLite/PG 跨方言同抛 IntegrityError）
get_spec_manifest / apply_spec_ops: 透调 SpecWorkspaceService（共享 session；
  鉴权已在 router 层从 shpsync_ token 派生 workspace_id，本层不重复校验）
```

## 注意事项
- `PlatformSyncTokenService` 与 McpTokenService 形似（前缀 + sha256 直存 + hash O(1) 查表）但职责更窄：
  - 进度同步低频上行（每 stage 推进一次），**无 Redis 正负缓存**、last_used_at 每次成功后简单 UPDATE
  - token 绑 user（上行归属人派生 User），区别于 McpToken 不绑 user（第三方编排者）
- 三套 token 前缀独立互不复用：`shpsync_`（本模块）/ `shk_live_`（ApiKeyService）/ `shmcp_`（McpToken）；authenticate 先判前缀，不符直接 return None 不查库
- base_ts 比对是 ISO 8601 UTC **字符串字典序**（契约 §7），故 last_pushed_at 存 String 而非 DateTime——改列类型会破坏比对前提
- 冲突分支不触碰 owner：被拒绝的上行不得改责任人（`_sync_change_owner` 只在接受分支跑，user_id 由 token 签发人派生透传）
- CLI 写通道固化 `Bearer shpsync_`（sync.js），改前缀即断所有客户端；`shk_live_` 显式先判前缀分流还兼防 JWT 误送 ApiKeyService 的 O(n) bcrypt 扫库
- 消费方：daemon 的 `spec-sync.ts`（manifest/apply_ops 上报）、SillySpec CLI platform 同步客户端（外部）；变更中心经读时投影消费落库数据

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
