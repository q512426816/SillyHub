---
author: qinyi
created_at: 2026-08-19T23:30:00
---

# 模块影响分析（Module Impact）— spec 镜像全量同步删除对账收敛（墓碑语义补全）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|------|----------|------|
| backend | 修改 | spec_workspace/service.py：`_write_spec_root` 新增对账删除阶段（`_converge_stale_files`）+ manifest 逐行墓碑对齐替代全表 wipe + SSE done 事件加 converged 字段；change/service.py：`_progress_reported_active_keys` 加 7 天时效窗；新增/修改两模块测试 |

## 未匹配文件

无

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（spec_workspace 对账收敛 + change 占位时效） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
