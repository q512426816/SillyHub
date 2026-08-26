---
author: qinyi
created_at: 2026-08-26 21:58:10
change: 2026-08-26-workspace-git-status
---
# 任务清单（Tasks）

> 任务名唯一真相在本文件；plan.md Wave 段按纯 ID 引用。execute 勾选与 verify 对照都在本文件。

- [x] task-01: daemon git_status 方法（fetch 15s 局部 execFile 降级/porcelain v2 解析/numstat --no-renames 单源/空仓库与 detached 建模）+ 平名注册 + 单测 (depends_on: 无)
- [x] task-02: backend GET /git-log/status 端点 + GitLogStatusResponse schema + 六分支集成测试 (depends_on: 无)
- [x] task-03: gen:types 再生成 + useGitLogStatus（staleTime 60s）+ git-status-bar 共享组件（full/compact）+ 两页挂载 + 组件测试 (depends_on: task-01,task-02)
