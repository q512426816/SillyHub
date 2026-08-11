---
author: qinyi
created_at: 2026-08-11 15:43:48
---
# 任务清单（Tasks）

## W1 数据层
- [x] task-01: 新建 `platform_sync/token_model.py` — `PlatformSyncTokenORM`（workspace_id/token_hash/created_by/name/scope/last_used_at/revoked_at/created_at，参照 McpToken+ApiKey，无 key_prefix/expires_at）
- [x] task-02: 改 `platform_sync/model.py` — `PlatformChangeProgressORM` 加 workspace_id 列 + 复合 PK `(workspace_id, change_name)`
- [x] task-03: 新建 alembic migration — 建表 + 加列 + 复合唯一（棕地免回填）

## W2 token 签发鉴权
- [x] task-04: 新建 `platform_sync/token_service.py` — `PlatformSyncTokenService.create()`（shpsync_ 签发）/`authenticate()`（hash 查表派生 user=created_by + workspace_id）
- [x] task-05: 改 `platform_sync/auth.py` — `require_platform_sync` 返回 `(User, workspace_id|None)`，shpsync_ 派生 / shk_live_ 过渡

## W3 收件箱隔离
- [x] task-06: 改 `platform_sync/service.py` — `upsert_progress`/`list_lightweight`/`get_progress` 全加 workspace_id 过滤
- [x] task-07: 改 `platform_sync/router.py`（3 端点取 workspace_id）+ 新增 `workspace_router.py`（prefix=/workspaces 放两新端点）+ `schema.py`（3 个 Pydantic 模型）；resolve-by-root-path 带 WORKSPACE_WRITE 校验（403/404，D-006）

## W4 投影层
- [x] task-08: 改 `change/service.py` — `enrich_summaries`（list 批量 IN join）/`enrich_with_workspace_ids`（single = 匹配）join 覆盖 current_stage + fallback（read-only，**不投 status**，D-004@v2）

## W5 connect 下发 + 契约（跨仓 sillyspec）
- [x] task-09: 改 `sillyspec/src/sync.js` — connect 扩展调 resolve-by-root-path 换发 + replaceTopLevelSection 写入（mcp 段同源坑不动，NG-4）
- [x] task-10: 改契约 `sillyhub-progress-sync-contract.md` — 补「§14 workspace 隔离」章节（token 派生 + 签发端点 + connect 换发 + WORKSPACE_WRITE 权限）

## W6 gen:types + 测试
- [x] task-11: `pnpm gen:types` 同步 `api-types.ts` + `openapi.json`
- [x] task-12: 各模块 pytest（platform_sync/change）+ connect 联调 + 排查本机 platform sync POST 500（R-06）
