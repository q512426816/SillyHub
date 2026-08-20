---
schema_version: 1
doc_type: task
id: task-06
title: End-to-end acceptance on local Docker environment
title_zh: 端到端验收（Docker 重建 + b97f8231 实测）
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 3
allowed_paths:
  - backend/app/modules/runtime
  - sillyhub-daemon/src
  - frontend/src/app/(dashboard)/workspaces/[id]/runtime
depends_on: [task-01, task-02, task-03, task-04, task-05]
provides: []
expects_from:
  - task-01~05: 全部实现与单测
goal: AC-01 + AC-04 落实验证——真实环境 runtime 页显示仓库真实数据；三端测试全绿
implementation: 本机重建受影响服务镜像（backend/frontend，daemon 走 daemon-dist 随 backend 分发或本机直跑验证）；浏览器/curl 验证 b97f8231 工作区 runtime 页三类数据非空且来自仓库 .sillyspec/.runtime/；跑三端测试（daemon 按 local.yaml flaky 规避方案）
acceptance: 进度卡显示项目/当前阶段/当前变更；user-inputs 与产物列表非空；backend runtime 模块 pytest、daemon vitest、frontend vitest+tsc 全绿
verify: 页面实测截图/数据核对 + 三端测试命令输出
constraints: 验收只读不写生产数据；发现缺陷回到对应 task 修复后重验
---

# task-06：端到端验收

依据：requirements AC-01/AC-04；plan.md Wave 3。
