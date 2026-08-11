---
author: qinyi
created_at: 2026-08-12T09:38:00+08:00
change: 2026-08-11-change-progress-projection
---

# 模块影响分析（Module Impact）— 变更中心接入进度同步层（workspace 隔离 + 实时投影）

## 变更概述

补全进度同步链路第③段（收件箱 → 变更中心展示）：workspace-scoped token 派生隔离（`shpsync_`，参照 McpToken）+ 收件箱 `platform_change_progress` 加 workspace_id 复合唯一 + change 模块 enrich 实时 read-only join 投影 `current_stage`（覆盖猜值，fallback 现有值，不投 status）+ connect 换发（跨仓 sillyspec）+ 契约 §14。建立在已归档两段（主仓 sillyhub-platform-sync 收件箱层 + sillyspec 仓 platform-progress-sync 客户端 push/pull）之上。跨两仓。

## 真实变更文件（以 git diff 为准，真实 > 声明）

### 主仓 backend（commit ce0ae202，verify PASS 后 worktree apply 回 main）

**新增**（platform_sync 模块扩展 + change 投影测试）：
- `backend/app/modules/platform_sync/token_model.py`（PlatformSyncTokenORM：shpsync_ token 表，参照 McpToken+ApiKey）
- `backend/app/modules/platform_sync/token_service.py`（PlatformSyncTokenService create/authenticate，sha256 直存 + hash O(1) 查表派生）
- `backend/app/modules/platform_sync/workspace_router.py`（2 新端点专用 router：POST platform-sync-tokens + POST resolve-by-root-path）
- `backend/app/modules/change/tests/conftest.py`（注册 platform_change_progress + platform_sync_tokens 表，供 enrich join 测试）
- `backend/app/modules/change/tests/test_enrich_projection.py`（投影层 6 用例：命中覆盖/fallback/批量 IN/隔离不串/畸形 payload/read-only 不投 status）
- `backend/app/modules/platform_sync/tests/test_workspace_router.py`（5 用例：签发 201/403 + resolve-by-root-path 404/403/200）
- `backend/migrations/versions/20260811150000_platform_sync_workspace.py`（建 platform_sync_tokens 表 + platform_change_progress 加 workspace_id 复合唯一）

**修改**：
- `backend/app/modules/platform_sync/model.py`（PlatformChangeProgressORM 加 workspace_id nullable + 复合唯一约束）
- `backend/app/modules/platform_sync/auth.py`（require_platform_sync 返 `(User, workspace_id|None)`，shpsync_/shk_live_/JWT 三路径分流）
- `backend/app/modules/platform_sync/service.py`（upsert/list/get 全加 workspace_id 参数，is_(None) 处理过渡期 NULL）
- `backend/app/modules/platform_sync/router.py`（3 端点从 auth 解包 workspace_id 透传 service）
- `backend/app/modules/platform_sync/schema.py`（3 DTO：PlatformSyncTokenCreateRequest/Response + ResolveByRootPathRequest/Response）
- `backend/app/modules/platform_sync/tests/conftest.py`（注册 token_model 表）
- `backend/app/modules/platform_sync/tests/test_router.py`（适配 workspace_id 参数）
- `backend/app/modules/change/service.py`（`_project_current_stage` 批量 IN join + enrich_summaries/enrich_with_workspace_ids 覆盖 current_stage + fallback，read-only 不投 status）
- `backend/app/main.py`（include_router platform_sync_workspace_router）
- `backend/conftest.py`（根 db_engine 补 `import llm_provider model`，修 agent-profile-bind-llm-provider 遗留预存债，task-07 顺手）

### 主仓 生成产物（commit 9ec9982c，task-11 gen:types）
- `backend/openapi.json`（同步 2 新端点 + 3 DTO schema）
- `frontend/src/lib/api-types.ts`（同步类型，前端业务零消费——两端点供 sillyspec 工具 connect 用，NG-7 不做 UI）

### 跨仓 sillyspec（sillyspec 仓 main commit 16b30b7，非主仓 git diff）
- `sillyspec/src/sync.js`（connect 扩展：调 resolve-by-root-path 换发 shpsync_ + replaceTopLevelSection 写 platform 段保留注释，404/403/断网降级 best-effort）
- `sillyspec/docs/sillyspec/sillyhub-progress-sync-contract.md`（补 §14 workspace 隔离 5 小节：token 派生 D-001 / 两新签发端点含 D-006 / connect 换发降级 / 3 端点鉴权升级 / 变更中心实时投影 D-002/D-003/D-004@v2）

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend（platform_sync 子模块） | 数据结构变更 + 接口变更 + 新增 | `token_model.py` + `token_service.py` + `workspace_router.py` + `model.py` + `auth.py` + `service.py` + `router.py` + `schema.py` + `tests/{conftest,test_router,test_workspace_router}.py` | workspace 隔离：PlatformSyncTokenORM 新表（shpsync_ + sha256 + workspace_id FK）+ PlatformSyncTokenService create/authenticate 派生 (user,workspace_id) + require_platform_sync 返二元组三路径分流 + service upsert/list/get 全加 workspace_id（is_(None) 处理 NULL）+ workspace_router 2 新端点（platform-sync-tokens 签发 WORKSPACE_WRITE / resolve-by-root-path 换发含 D-006 手动 has_permission 403/404）+ PlatformChangeProgressORM 加 workspace_id nullable 复合唯一 + 3 DTO | false |
| backend（change 子模块） | 调用关系变更 + 逻辑变更 | `change/service.py` + `change/tests/{conftest,test_enrich_projection}.py` | 投影层：`_project_current_stage` 批量复合 IN join（tuple_.in_()，禁 N+1）+ enrich_summaries（list 批量）/enrich_with_workspace_ids（single =）覆盖 current_stage + fallback（join 不命中保留现有值，D-003）+ read-only 不写 changes 表（D-002）+ 不投 status（D-004@v2）+ conftest 注册 platform_sync 两表供测试 | false |
| backend（核心装配 + 预存债） | 接口变更 + 配置变更 | `main.py` + `conftest.py` + `migration 20260811150000` | include_router(platform_sync_workspace_router) + 根 db_engine 补 import llm_provider model（修预存 NoReferencedTableError 债）+ migration 建 platform_sync_tokens 表 + 加 workspace_id 复合唯一 | false |
| frontend | 配置变更 | `frontend/src/lib/api-types.ts` | gen:types 类型同步（2 新端点路径 + 3 DTO，CLAUDE.md 规则 20；前端业务零消费，两端点供 sillyspec 工具 connect） | false |
| sillyspec 工具仓（跨仓） | 接口变更 + 文档变更 | `sillyspec/src/sync.js` + `sillyspec/docs/.../sillyhub-progress-sync-contract.md` | connect 换发 shpsync_（resolve-by-root-path + replaceTopLevelSection 保留注释，降级 best-effort）+ 契约 §14 workspace 隔离 5 小节 | false |

## 未匹配文件

| 文件 | 原因 |
|---|---|
| `.sillyspec/local.yaml` | gitignored 本地配置，不入库；platform 段 token 连接后会变 shpsync_（connect 换发），mcp 段仍 shmcp_（NG-4 同源坑未动，留单独 change） |
| `.sillyspec/changes/2026-08-11-change-progress-projection/*` | 本次 change spec 文档（proposal/design/tasks/requirements/plan/decisions/tasks/task-01~12/verify-result/module-impact），归档时随目录移 archive/ |
| `sillyspec/` 仓改动 | 跨仓，不在主仓 git diff；commit 16b30b7 在 sillyspec 仓 main |

## 三重交叉验证

- **声明范围**（design.md §6 文件清单，含 verify Reverse Sync 补的 `backend/conftest.py`）：主仓 17 文件 + 跨仓 sillyspec 2 文件 + 生成产物 2 文件 = 21。design §6 列全。
- **任务范围**（tasks.md / plan.md W1-W6 12 task）：task-01~12 文件路径与 design §6 一致。
- **真实变更**（git diff ce0ae202 主仓 17 文件 + 跨仓 sillyspec 16b30b7 2 文件 + gen:types 9ec9982c 2 文件）：与声明范围对齐，无未声明改动、无声明未做。

**结论**：三重对齐，无漂移。verify Reverse Sync 已把 task-07 顺手补的 `backend/conftest.py`（预存债修复）补入 design §6，消除 execute 漏列。

## 备注

- 本变更新增的 platform_sync 子模块在 backend `_module-map.yaml` **仍无独立条目**（前置 sillyhub-platform-sync 当时也未加）——platform_sync 作为 backend 内子模块，归档时建议在 backend module-map 补条目（见 step 3 sync-module-docs）。
- 跨仓 sillyspec 仓改动已在 sillyspec 仓 main（16b30b7），不随主仓 archive 移动。
