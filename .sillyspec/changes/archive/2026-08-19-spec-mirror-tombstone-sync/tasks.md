---
change: 2026-08-19-spec-mirror-tombstone-sync
title: 任务清单（Tasks）
author: qinyi
created_at: 2026-08-19 22:20:00
status: draft
---

# 任务清单（Tasks）

> 只列任务名与归属，细节（Wave 分组 / 依赖 / 文件级步骤）在 plan 阶段展开。

- task-01：`_write_spec_root` 对账删除阶段（落盘集收集 + 软删 move + 空目录清理 + 护栏）
- task-02：manifest 逐行对齐（替代全表 wipe，墓碑语义）
- task-03：占位行保护 7 天时效窗（`_progress_reported_active_keys`）
- task-04：对账统计与 SSE done 事件扩展（converged_files / converged_dirs）+ 结构化日志
- task-05：新增 / 修改测试（对账删除 / 护栏 / manifest 墓碑 / local.yaml 覆盖删除 / 占位时效边界）
- task-06：全量回归（spec_workspace + change 模块测试）+ gen:types 不适用确认（无 API 契约变化）
