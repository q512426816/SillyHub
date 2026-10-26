---
author: flow-machine-draft
created_at: 2026-10-26T15:08:59.741Z
---
# 提案书（Proposal）— 2026-10-26-ci-red-to-green

## 动机

任务原话转写：修复四条CI工作流失败转绿
动机：main 分支 frontend-ci/daemon-ci/e2e-ci 自 10-25 起持续红，backend-ci Pytest 步骤疑似挂死。已定位：e2e-ci.yml 的 PG service 用 postgres:16-alpine，pgvector 迁移 20261015200000 fail-closed 中止；frontend-ci 稳定失败 5 个测试文件（sessions-portal/session-history-scroll/session-panel-load-earlier-full-turn/file-explorer-git-status/session-panel-history-race）；daemon-ci 失败于 session-thinking-level、task-lifecycle、daemon-interactive-spec-sync 三组测试。

成功标准：
- e2e-ci workflow PG service 镜像换 pgvector/pgvector:pg16，alembic 迁移可通过
- frontend 5 个失败测试文件与 daemon 失败测试在本地复现并修复，本地测试跑绿
- 推送后 GitHub Actions 四条 workflow 全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. e2e-ci workflow PG service 镜像换 pgvector/pgvector:pg16，alembic 迁移可通过
2. frontend 5 个失败测试文件与 daemon 失败测试在本地复现并修复，本地测试跑绿
3. 推送后 GitHub Actions 四条 workflow 全绿

## 成功标准（可验证）

1. e2e-ci workflow PG service 镜像换 pgvector/pgvector:pg16，alembic 迁移可通过
2. frontend 5 个失败测试文件与 daemon 失败测试在本地复现并修复，本地测试跑绿
3. 推送后 GitHub Actions 四条 workflow 全绿
