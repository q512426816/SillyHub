---
author: qinyi
created_at: 2026-10-03
---
# 模块影响分析（Module Impact）— 本地用量水位差分归属

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:migrations | 新增 | migrations/versions/20261003020000_add_agent_log_usage_marks.py：水位表（task-01） |
| backend:platform-sync | 修改 | model.py UsageMarkORM（task-01）；service.py upsert 循环插水位 + 修剪豁免首末（task-02） |
| backend:platform-sync-tests | 修改 | test_agent_log_push.py 补水位用例（插值/连续/双空/修剪豁免/存量基线重推）+ 既有回归（task-02） |
| backend:change | 修改 | usage_service.py 本地段改差分双路径（首水位锚定/NOT EXISTS 谓词沿用/quicklog 同构）（task-03） |
| backend:change-tests | 修改 | test_usage_stats.py 补守恒/滞后反例/存量兼容/互斥用例（task-03） |
| docs:backend-modules | 修改 | platform_sync.md/change.md 归属协议段更新（task-04） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| （无） | — |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/platform_sync.md` | 上报节补水位协议段（水位差分归属/修剪豁免） | done |
| `.sillyspec/docs/backend/modules/change.md` | 本地段补差分双路径 + 两卡分叉声明 + workspace 锚参 | done |
| `_module-map.yaml` | 水位表归 platform_sync 既有目录，无新映射 | skipped |
