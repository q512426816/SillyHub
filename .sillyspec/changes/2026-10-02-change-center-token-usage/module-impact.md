---
author: qinyi
created_at: 2026-10-02
---
# 模块影响分析（Module Impact）— 变更中心展示本地 CLI 执行用量

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:migrations | 新增 | migrations/versions/20261002010000_add_platform_agent_log_usage.py：platform_agent_logs 加 5 列用量快照（task-01） |
| backend:platform-sync | 修改+新增 | model.py AgentSessionLogORM 加 5 列（task-01）；新增 usage_ingest.py 摄取服务（候选/节流/Semaphore/覆盖写/全降级，task-02）；router.py push_agent_logs 挂 fire_background_task（task-02）；schema.py 内部快照结构（task-02） |
| backend:platform-sync-tests | 新增 | tests/test_usage_ingest.py（候选筛选/节流/幂等/离线 method_not_found 降级/上报响应不变，task-02） |
| backend:change | 修改 | usage_service.py 详情/列表/quicklog 三处加本地段（NOT EXISTS 会话级二选一 +「本地 CLI」桶 + totals=Σby_model 守恒，task-03）；schema.py 注释口径更新（task-03） |
| backend:change-tests | 修改 | tests/test_usage_stats.py 追加本地段用例（纯本地/混合双计防护/共享会话/存量 NULL/quicklog/列表批量，task-03） |
| frontend:components-changes | 修改 | detail/change-usage-card.tsx「本地 CLI」绿阶桶行 + 请求列「—」+ 注脚双 kind 更新（task-04）；__tests__/change-usage-card.test.tsx 补桶行/空态/注脚用例（task-04） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物（pnpm gen:types），task-04 复核预期零 diff（DTO 未变），不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/backend/modules/platform_sync.md`（如存在，否则归 backend.md） | 补 usage_ingest 摄取链路条目 + 快照五列说明（execute 收尾同步） | pending |
| `docs/backend/modules/change.md`（如存在，否则归 backend.md） | usage_service 本地段口径补录（execute 收尾同步） | pending |
| `_module-map.yaml` | usage_ingest.py 归 platform_sync 既有目录，无需新映射条目；待 scan 刷新 | pending |
