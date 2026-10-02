---
author: qinyi
created_at: 2026-10-02
---
# 任务清单（Tasks）

- [ ] task-01: 存储层迁移——migration 20261002010000 + AgentSessionLogORM 加 5 列用量快照（可 up/down）
- [ ] task-02: 摄取链路——usage_ingest.py 服务 + router 挂载 fire_background_task + test_usage_ingest.py 单测（候选/节流/幂等/降级）(depends_on: task-01)
- [ ] task-03: 聚合本地段——usage_service 详情/列表/quicklog 三处 + schema 注释 + test_usage_stats.py 用例（双计防护/守恒/NULL 跳过）(depends_on: task-01)
- [ ] task-04: 前端展示与契约收口——gen:types 复核零 diff + change-usage-card「本地 CLI」桶行/注脚 + 组件测试 + tsc (depends_on: task-03)
