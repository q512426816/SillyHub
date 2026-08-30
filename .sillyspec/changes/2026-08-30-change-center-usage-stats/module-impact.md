---
author: qinyi
created_at: 2026-08-30 17:04:11
---
# 模块影响分析（Module Impact）— 变更中心用量与耗时统计

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:change | 修改+新增 | schema.py 新增 UsageByModelItemRead/UsageTotalsRead/UsageSummaryRead/ChangeUsageRead DTO + ChangeSummary.usage/QuicklogEntryListItem.usage 计算字段；新增 usage_service.py 聚合服务（去重执行集合 + 详情两段聚合 + 批量摘要零 N+1）；service.py enrich_summaries 尾段挂批量 usage 投影；router.py 新增 GET /changes/{cid}/usage、GET /quicklog-entries/{ql_id}/usage 端点 + quicklog 列表组装处填充 usage |
| backend:change-tests | 新增 | tests/test_usage_stats.py（并集去重/兜底桶/时间 NULL 组合/404/批量投影/deleted 行），task-05 创建 |
| frontend:changes-page | 修改 | changes/page.tsx 变更列表加「执行」列（task-08） |
| frontend:components-changes | 新增+修改 | 新增 detail/change-usage-card.tsx 用量卡组件（+组件测试，task-07）；quicklog-table.tsx 加「执行」列（task-08）；quicklog-drawer.tsx 挂用量卡（task-09）；变更详情页 [cid]/page.tsx 挂用量卡（task-09）；quicklog-table.test.tsx 补新列断言（task-08） |
| frontend:lib | 修改 | lib/changes.ts 新增 getChangeUsage、lib/quicklog.ts 新增 getQuicklogUsage（task-06） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物（pnpm gen:types），task-06 生成、task-10 复核，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/SillyHub/modules/change.md`（change 模块卡，如存在该名）或对应 change 模块文档 | 补两个 usage 端点与列表 usage 字段契约摘要 | pending |
| `docs/SillyHub/modules/frontend.md` 或前端组件模块文档（changes 域组件清单） | 补 change-usage-card 组件条目与两列表新列 | pending |
| `_module-map.yaml` | usage_service.py 归 change 模块既有目录、组件归 components/changes 既有目录，无需新映射条目；待 scan 刷新 | skipped |
