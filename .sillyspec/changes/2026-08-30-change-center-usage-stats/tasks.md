---
author: qinyi
created_at: 2026-08-30 16:52:20
---
# 任务清单（Tasks）

- [ ] task-01: 后端 usage DTO 契约（schema.py 四个新 DTO + 两列表字段，含计算字段惯例注释）
- [ ] task-02: 后端聚合服务 usage_service.py（去重执行集合 + 详情两段聚合 + 时间三元组 + 轮次）
- [ ] task-03: 后端批量摘要投影（enrich_summaries 尾段 + quicklog 列表组装处，零 N+1）
- [ ] task-04: 后端两个 usage 端点（CHANGE_READ + 404 resource-hiding）
- [ ] task-05: 后端聚合测试 test_usage_stats.py（并集去重/兜底桶/时间 NULL 组合/404/批量投影）
- [ ] task-06: 前端 API 封装（lib/changes.ts + lib/quicklog.ts）
- [ ] task-07: 前端用量卡组件 change-usage-card.tsx（useQuery 自取数 + 折叠明细 + 口径注脚 + 边界态）与组件测试
- [ ] task-08: 前端两个列表「执行」列（changes/page.tsx + quicklog-table.tsx）与测试补充
- [ ] task-09: 前端两个详情渲染点接线（变更详情页 + quicklog 抽屉）
- [ ] task-10: 契约收口（pnpm gen:types 同步 api-types.ts + openapi.json）与回归
