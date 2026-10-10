---
author: qinyi
created_at: 2026-10-10 18:55:00
---
# 任务清单（Tasks）— 2026-10-10-workspec-maintenance

> 本文件为任务唯一真相。任务卡见 tasks/task-NN.md（plan 阶段已展开）；勾选状态以本清单为准。

- [x] task-01: backend 数据模型与迁移——三表（workspace_linked_repos / paths / sync_states）、唯一约束、级联（FR-01/FR-02）
- [x] task-02: backend CRUD API 与权限——共享登记四端点 + my-path upsert + main.py sibling 挂载 + 越权/重名用例（FR-01/FR-02）(depends_on: task-01)
- [x] task-03: backend 同步编排与结果回报——sync 触发端点、WS RPC `linked_repos_sync`、daemon 回报端点（唯一落库通道）与 summary 填充（FR-04/FR-05）(depends_on: task-01, task-02)
- [x] task-04: daemon 双落盘例程——spawn `workspace add` + `register-repo`、能力探测降级、execFile 数组形参、结果归一回报（FR-03/FR-04/FR-07）(depends_on: task-03)
- [x] task-05: frontend 关联仓卡片——列表/Modal 表单/我的路径/状态列/立即同步/空态，双主题（FR-06）(depends_on: task-02, task-03)
- [x] task-06: api-types 再生成与联调收尾——`pnpm gen:types`、openapi.json 提交、跨端冒烟（FR-06）(depends_on: task-02, task-03, task-04, task-05)
