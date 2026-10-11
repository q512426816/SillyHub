---
author: flow-machine-draft
created_at: 2026-10-11T11:38:24.238Z
---
# 提案书（Proposal）— 2026-10-11-alembic-single-head-guard

## 动机

任务原话转写：动机：并行变更各自新增 alembic 迁移未合流即部署，生产 backend crash-loop 宕机约 2 分钟（2026-10-11 实证：Multiple head revisions，两迁移同父分叉），需在 CI 与部署预检双闸提前拦截。

成功标准：
- backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI
- deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法
- 改动相关测试全绿（全量留给 CI）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI
2. deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法
3. 改动相关测试全绿（全量留给 CI）

## 成功标准（可验证）

1. backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI
2. deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法
3. 改动相关测试全绿（全量留给 CI）
