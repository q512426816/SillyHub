---
author: qinyi
created_at: 2026-09-22 20:11:04
generated_by: sillyspec-fourpiece-init
---
# 任务清单（Tasks）

- [x] task-01: 后端事件表 ORM + alembic 建表迁移 + conftest 建表 (depends_on: —)
- [x] task-02: 后端 schema + service（append_events 去重上限 / list_events 正序增量） (depends_on: task-01)
- [x] task-03: 后端 router 两端点（POST 写鉴权 / GET 读 scope） (depends_on: task-02)
- [x] task-04: 后端 pytest 五组（收/取/去重/鉴权/上限） (depends_on: task-01,02,03)
- [x] task-05: 前端 API 客户端 + gen:types 产物 (depends_on: task-02,03)
- [x] task-06: 前端观测事件折叠区组件 + 详情页挂载 (depends_on: task-05)
- [x] task-07: 前端 vitest 四组（渲染/告警高亮/空态/角标计数） (depends_on: task-06)
- [x] task-08: 端到端验收（curl 推 5 条含 2 warning → GET 正序去重 → 面板核对） (depends_on: task-04,07)
