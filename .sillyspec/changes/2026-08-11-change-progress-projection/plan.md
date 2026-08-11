---
plan_level: full
author: qinyi
created_at: 2026-08-11 15:43:48
change: 2026-08-11-change-progress-projection
---

# 实现计划（Plan）

> 技术方案确定（参照 mcp_gateway McpToken 模式 + 已就绪 connect replaceTopLevelSection writer + 已核实 root_path 反查），无新技术栈/未验证集成/安全隔离已闭环 → **不需要 Spike**。跨仓范围（task-09/10 在 sillyspec 工具仓）注明在任务说明。

## Wave 1 数据层（并行，无上游依赖）
- [x] task-01: 新建 `platform_sync/token_model.py` — `PlatformSyncTokenORM`（覆盖：FR-01, D-001@v1）
- [x] task-02: 改 `platform_sync/model.py` — `PlatformChangeProgressORM` 加 workspace_id + 复合 PK（覆盖：FR-02, D-001@v1）
- [x] task-03: 新建 alembic migration — 建表 + 加列 + 复合唯一（覆盖：FR-08）

## Wave 2 token 签发鉴权（依赖 Wave 1 的 model）
- [x] task-04: 新建 `platform_sync/token_service.py` — create/authenticate（覆盖：FR-01, D-001@v1）
- [x] task-05: 改 `platform_sync/auth.py` — require_platform_sync 派生 workspace（覆盖：FR-02, D-001@v1）

## Wave 3 收件箱隔离（依赖 Wave 2 auth）
- [x] task-06: 改 `platform_sync/service.py` — upsert/list/get 加 workspace_id（覆盖：FR-02, D-001@v1）
- [x] task-07: 改 `platform_sync/router.py` + 新增 `workspace_router.py`+`schema.py` — 收件箱取 workspace + 两新端点 + D-006 WORKSPACE_WRITE 校验（覆盖：FR-01, FR-03, D-005@v1, D-006@v1）

## Wave 4 投影层（依赖 Wave 1 model 的 workspace_id 列）
- [x] task-08: 改 `change/service.py` — enrich 批量 join 覆盖 current_stage + fallback，**不投 status**（覆盖：FR-04, FR-05, D-002@v1, D-003@v1, D-004@v2）

## Wave 5 connect 下发 + 契约（跨仓 sillyspec，依赖 Wave 3 resolve-by-root-path 端点）
- [x] task-09: 改 `sillyspec/src/sync.js` — connect 换发 + replaceTopLevelSection 写入（覆盖：FR-03, D-005@v1）
- [x] task-10: 改契约 `sillyhub-progress-sync-contract.md` — 补 §14 workspace 隔离（覆盖：FR-03, D-005@v1）

## Wave 6 gen:types + 测试 + 收尾（依赖全部）
- [x] task-11: `pnpm gen:types` 同步 api-types.ts + openapi.json（覆盖：FR-07）
- [x] task-12: 各模块 pytest + connect 联调 + R-06 本机 500 排查（覆盖：FR-01~FR-08）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新建 PlatformSyncTokenORM | W1 | P0 | — | FR-01, D-001@v1 | 新表，参照 McpToken+ApiKey 字段集（含 created_by），无 key_prefix/expires_at |
| task-02 | model 加 workspace_id + 复合 PK | W1 | P0 | — | FR-02, D-001@v1 | PlatformChangeProgressORM 加列 + PK 改 (workspace_id, change_name) |
| task-03 | 新建 alembic migration | W1 | P0 | task-01,02 | FR-08 | 建表+加列+复合唯一；棕地免回填 |
| task-04 | token_service create/authenticate | W2 | P0 | task-01 | FR-01, D-001@v1 | shpsync_ 签发 + hash 查表派生 user/workspace |
| task-05 | auth 派生 workspace | W2 | P0 | task-01 | FR-02, D-001@v1 | require_platform_sync 返 (User, workspace_id\|None)，shk_live_ 过渡 |
| task-06 | 收件箱 service 加 workspace_id | W3 | P0 | task-02,05 | FR-02, D-001@v1 | upsert/list/get 全加 workspace 过滤，upsert 键改复合 |
| task-07 | router + 新端点 + schema | W3 | P0 | task-04,05,06 | FR-01,03, D-005,006 | 收件箱 3 端点取 workspace；platform-sync-tokens + resolve-by-root-path（WORKSPACE_WRITE） |
| task-08 | 投影层 enrich join | W4 | P0 | task-02,06 | FR-04,05, D-002,003,004@v2 | list 批量 IN / single =；fallback；不投 status |
| task-09 | connect 换发（跨仓） | W5 | P0 | task-07 | FR-03, D-005@v1 | sillyspec/src/sync.js connect 调 resolve-by-root-path + replaceTopLevelSection 写 local.yaml |
| task-10 | 契约补章（跨仓） | W5 | P1 | task-07 | FR-03, D-005@v1 | sillyhub-progress-sync-contract.md 补 §14 |
| task-11 | gen:types 同步 | W6 | P0 | task-07,08 | FR-07 | pnpm gen:types 提交 api-types.ts + openapi.json |
| task-12 | pytest + 联调 + R-06 | W6 | P0 | task-01..11 | FR-01~08 | platform_sync/change 子模块 pytest；connect 联调；R-06 排查 |

## 关键路径

task-01 → task-04 → task-05 → task-07 → task-09 → task-11（端到端交付最长链；W1→W6 整体线性，无并行分支依赖——task-09 跨仓可先于 task-08/11 联调）

## 全局验收标准

- [ ] backend `app/modules/platform_sync` + `app/modules/change` 子模块 pytest 全绿（local.yaml test_strategy=module 命中）
- [ ] R-06 本机 platform sync POST 500 已排查修复（curl 复现无 500，根因闭环）
- [ ] connect 换发 workspace-scoped token 写入 local.yaml（保留注释）；反查 404 / 无权限 403 / 断网降级均不阻断
- [ ] 变更中心 current_stage 显示工具上行权威值（覆盖猜值）；workspace A/B 同名 change 不串进度
- [ ] 未上行 / quick-<uuid8> change fallback 现有值，行为不变
- [ ] resolve-by-root-path：无 WORKSPACE_WRITE → 403；root_path 反查不到 → 404
- [ ] gen:types 同步 `api-types.ts` + `openapi.json` 已提交（类型不落后后端）
- [ ] brownfield：未配置新功能（shk_live_ 过渡、直线 fallback）行为不变

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01,04,05,06 | platform_sync 子模块 pytest；upsert 复合键隔离用例 |
| D-002@v1 | task-08 | change 子模块 pytest：list 批量 IN join 用例 |
| D-003@v1 | task-08 | fallback 用例（join 不命中保留现有值） |
| D-004@v2 | task-08 | 不投 status 用例（status 不变） |
| D-005@v1 | task-07,09,10 | connect 联调：resolved token 写 local.yaml |
| D-006@v1 | task-07,09 | 403 用例（无 WORKSPACE_WRITE） |
| FR-01~FR-08 | task-01~12 | 对应 task 验收 + 全局验收标准 |