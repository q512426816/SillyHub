---
author: qinyi
created_at: 2026-08-30 16:52:20
---
# 任务清单（Tasks）

- [x] task-01: 后端 usage DTO 契约（schema.py 四个新 DTO + 两列表字段，含计算字段惯例注释）
- [x] task-02: 后端聚合服务 usage_service.py（去重执行集合 + 详情两段聚合 + 时间三元组 + 轮次）(depends_on: task-01)
- [x] task-03: 后端批量摘要投影（enrich_summaries 尾段 + quicklog 列表组装处，零 N+1）(depends_on: task-02)
- [x] task-04: 后端两个 usage 端点（CHANGE_READ + 404 resource-hiding）(depends_on: task-02)
- [x] task-05: 后端聚合测试 test_usage_stats.py（并集去重/兜底桶/时间 NULL 组合/404/批量投影）(depends_on: task-03, task-04)
- [x] task-06: 契约生成与前端 API 封装（pnpm gen:types + lib/changes.ts + lib/quicklog.ts）(depends_on: task-05)
- [x] task-07: 前端用量卡组件 change-usage-card.tsx（useQuery 自取数 + 折叠明细 + 口径注脚 + 边界态）与组件测试 (depends_on: task-06)
- [x] task-08: 前端两个列表「执行」列（changes/page.tsx + quicklog-table.tsx）与测试补充 (depends_on: task-06)
- [x] task-09: 前端两个详情渲染点接线（变更详情页 + quicklog 抽屉）(depends_on: task-07)
- [x] task-10: 契约收口（api-types.ts + openapi.json 复核同步）与回归（change 模块 pytest + frontend 测试 + tsc）(depends_on: task-05, task-07, task-08, task-09)
