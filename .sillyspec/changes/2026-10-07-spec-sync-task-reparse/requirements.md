---
author: flow-machine-draft
created_at: 2026-10-07T13:43:18.668Z
---
# 需求规格（Requirements）— 2026-10-07-spec-sync-task-reparse

## 功能需求

### FR-01: spec-sync 自动连动任务表重解析

必须：`_run_reparse_once` 在 `ChangeService.reparse` 后按同一 scope 连动 `TaskService.reparse`——非归档 name 逐行解析（archive_hit 时全量；location='deleted' 软删行跳过）；best-effort：连动失败仅告警（task_reparse_failed）不阻断同步主流程，变更表重建照常。

#### 场景：任务卡改写跟随

Given 厚档变更已有 4 张任务卡且任务表已解析 4 行
When 增量同步落盘改题后的 task-01 与新增 task-05（change_dirs 标注该变更）
Then drain 后任务表 5 行、task-01 标题为新值

### FR-02: 测试覆盖连动与失败面

必须：新增测试覆盖 ①改写跟随（4→5、改题生效）②连动失败不阻断（monkeypatch 抛错 → 同步 200、变更表照常重建）；spec_workspace 与 task 模块既有测试不回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_tasks_md_rewrite_updates_task_rows」
FR-02: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_task_reparse_failure_does_not_block_sync」
