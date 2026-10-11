---
author: flow-machine-draft
created_at: 2026-10-11T11:38:24.239Z
---
# 任务注册表（Tasks）— 2026-10-11-alembic-single-head-guard

- [x] task-01: backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI
- [x] task-02: deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法
- [x] task-03: 改动相关测试全绿（全量留给 CI）
