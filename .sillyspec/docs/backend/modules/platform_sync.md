---
schema_version: 1
doc_type: module-card
module_id: platform_sync
source_commit: ce0ae202
author: qinyi
created_at: 2026-08-12T09:45:00+08:00
---
# platform_sync
## 定位
SillySpec 跨仓进度同步层的后端收件箱 + workspace 隔离 + 变更中心投影数据源。承接 sillyspec 工具（`platform sync`）上行的六表进度 JSON（`serializeForSync()` 投影，含权威 `current_stage`），按 workspace 隔离存储，供 `change` 模块 enrich 实时 read-only join 投影 `current_stage` 到变更中心展示。不碰派发层（与 `/api/workspaces/{wid}/changes/*` stage 流转正交，契约 D-004）。

三段链路定位：① 工具→收件箱（sillyspec 仓 serializeForSync+push）② 收件箱存储+下行（**本模块**）③ 收件箱→变更中心展示（本模块被 change 模块 join 消费，2026-08-11-change-progress-projection 补全）。

前置模块由 2026-08-10-sillyhub-platform-sync 建立（3 端点 + PlatformChangeProgressORM 单行）；2026-08-11-change-progress-projection 加 workspace 隔离（token 派生 + 复合唯一）+ token 签发/换发 2 新端点 + change 模块投影消费。scan 漏登本子模块，本卡 2026-08-12 补建。

## 契约摘要
- **收件箱 3 端点**（inline `/changes`，无前缀 router.py，`require_platform_sync` 鉴权）：
  - `POST /api/changes/{name}/progress`：工具上行进度，body = serializeForSync 六表 JSON + `X-Base-Timestamp`/`X-Pushed-At`/`X-Pusher` 头；`upsert_progress` 按 `(workspace_id, change_name)` 复合键写；§4.2 base_ts 字典序冲突 → 409 ConflictResponse。
  - `GET /api/changes`：收件箱列表（`list_lightweight`，裸数组，按 workspace 隔离）。
  - `GET /api/changes/{name}/progress`：单 change 进度详情（裸 dict，反查不到 404）。
- **token 签发端点**（workspace_router.py，prefix `/workspaces`）：
  - `POST /api/workspaces/{workspace_id}/platform-sync-tokens`：workspace 成员签发 `shpsync_` token，`require_permission(WORKSPACE_WRITE)`（owner/developer 可签，viewer → 403）；明文 token 仅 201 返一次，DB 存 sha256。
  - `POST /api/workspaces/resolve-by-root-path`：connect 换发，body `{root_path}`，鉴权 = `shk_live_`（ApiKeyService）或 JWT；流程：反查活跃 workspace（`_find_active_by_root_path`，不到 → 404）→ 手动 `has_permission(WORKSPACE_WRITE)`（workspace_id 来自 body 反查非路径，无法用 Depends 注入 RBAC；无权限 → 403，D-006 安全闭环）→ 签发 `shpsync_`（created_by=调用者）→ 200 `{workspace_id, token}`。
- **鉴权**：`require_platform_sync` 返 `tuple[User, workspace_id|None]`，三路径分流：`shpsync_` → PlatformSyncTokenService.authenticate 派生 (user=created_by, workspace_id)；`shk_live_` → ApiKeyService（过渡期 workspace_id=None）；JWT → fallback。workspace_id 唯一取自 `platform_sync_tokens.workspace_id`（token 派生），绝不信任 body。
- **契约**：`sillyspec/docs/sillyspec/sillyhub-progress-sync-contract.md`（跨仓，存 sillyspec 仓）§3 body 不含 workspace_id（走 token 派生），§14 workspace 隔离（本次补）。

## 关键逻辑
```
# 工具上行（push）：
sillyspec sync → POST /api/changes/{name}/progress
  Authorization: Bearer shpsync_... → require_platform_sync
    → PlatformSyncTokenService.authenticate（hash 查表）派生 (user, workspace_id)
  → PlatformSyncService.upsert_progress(workspace_id, name, body, ...)
    → _find_row（workspace_id=None 用 col.is_(None)，SQL = 不匹配 NULL）
    → 按 (workspace_id, change_name) 复合键 upsert

# 变更中心投影（read-only join，change 模块消费，D-002）：
ChangeService.enrich_summaries(changes)  # list
  → _project_current_stage([(change.workspace_id, change.change_key), ...])
    → select workspace_id, change_name, latest_progress
        where (workspace_id, change_name) in (pairs)   # 复合 IN，禁 N+1（R-03）
    → 取 latest_progress.changes[0].current_stage 覆盖 ChangeSummary.current_stage
    → join 不命中 / 解析失败 / workspace_id NULL → 不进映射 → fallback 现有值（D-003）
# 不投 status（D-004@v2，sillyspec status 仅 active/archived，archived 由 current_stage==archive 派生）
# 不双写 changes 表（避免双写一致性 + agent 流程也写 changes.current_stage 冲突）

# connect 换发（跨仓 sillyspec sync.js）：
sillyspec platform connect → 健康 check 后用 user 级 shk_live_ + 本地 root_path
  → POST /api/workspaces/resolve-by-root-path → 200 {workspace_id, token: shpsync_...}
  → replaceTopLevelSection 文本级写 local.yaml platform 段（保留注释/CRLF/其他段字节级）
  → 404/403/断网降级沿用原 token 不阻断（best-effort）
```

## 注意事项
- **workspace_id nullable + 复合唯一约束（非复合 PK）**：SQL PK 列不允许 NULL，但 shk_live_ 过渡期需写 None 行（design §9），故用 `UniqueConstraint(workspace_id, change_name)` + workspace_id nullable，而非复合 PK。投影 join 时 change.workspace_id 非 None，NULL 过渡行自然不匹配 → fallback。
- **`is_(None)` vs `=`**：service `_find_row`/`list_lightweight` 对 workspace_id=None 必须用 `col.is_(None)`，SQL `=` 不匹配 NULL 会导致过渡期全局行查不到。
- **D-006 安全闭环**：resolve-by-root-path 用 shk_live_（user 级不绑 workspace）+ root_path，若无权限校验，任意持有者可猜 root_path 为他人 workspace 签 token 绕过隔离。手动 `has_permission(WORKSPACE_WRITE)`（非 require_permission——workspace_id 是 body 反查出来的不在路径）闭环。
- **三前缀独立互不复用**：`shpsync_`（本服务）/ `shk_live_`（ApiKeyService）/ `shmcp_`（McpToken）。connect 的 mcp 段同源坑（NG-4：sync.js 把 platform token 复用进 mcp 段，但真 McpToken 是 shmcp_）本变更不顺带修，留单独 change。
- **投影 read-only**：change 模块 enrich 只 select 不写，覆盖发生在返回的 DTO 层（model_validate 独立对象），不 mutate 传入的 Change ORM、不写库（D-002）。
- 根 `backend/conftest.py` db_engine 需 `import llm_provider model`（agent_profiles.llm_provider_id FK→llm_providers，否则 create_all 报 NoReferencedTableError 阻断所有 db_engine 测试，task-07 顺手补的预存债）。

## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-11-change-progress-projection**（D-001~006 / R-01~08）：加 workspace 隔离（D-001 token 派生，参照 McpToken 模式建 PlatformSyncTokenORM + PlatformSyncTokenService，shpsync_ 前缀）+ PlatformChangeProgressORM 加 workspace_id nullable 复合唯一 + require_platform_sync 返 (User, workspace_id|None) 三路径分流 + service upsert/list/get 全加 workspace_id（is_(None) 处理 NULL 过渡期）+ 2 新端点（platform-sync-tokens 签发 / resolve-by-root-path connect 换发含 D-006 手动 has_permission WORKSPACE_WRITE 403/404 闭环）+ change 模块 `_project_current_stage` 批量 IN join 投影 current_stage（D-002 read-only 不双写）+ fallback（D-003）+ 不投 status（D-004@v2 撤销，sillyspec status 仅 active/archived）+ connect 跨仓换发（D-005 replaceTopLevelSection 保留注释，降级 best-effort）+ 契约 §14。前置 sillyhub-platform-sync 建模块时 scan 漏登 _module-map，本次补建本卡。
<!-- MANUAL_NOTES_END -->
