---
change: 2026-08-19-spec-mirror-tombstone-sync
title: 需求（Requirements）
author: qinyi
created_at: 2026-08-19 22:20:00
status: draft
---

# 需求（Requirements）

## FR-01 全量同步对账删除

全量同步落盘（`_write_spec_root`，被 `apply_sync` / `import_from_repo` /
`import_from_repo_sse` 三入口共用）在 per-file merge 完成后执行对账：以 merge
实际落盘集为基准，镜像中不属于该集合的文件软删（move 到
`spec_data_root/spec-backups/{ws}/{收敛批时间戳}/{rel_path}`），随后自底向上清理
空目录（spec_root 本身除外）。对账删除必须发生在 manifest 对齐与 reparse 之前。

验收：镜像多出的文件同步后从镜像树消失、备份区出现对应副本；幽灵变更目录整目录
消失（含中间空目录）。

## FR-02 坏包护栏

对账删除前执行双护栏，任一命中即跳过对账且不动镜像任何文件：
- 落盘集为空（空 tar / 全被过滤）→ 跳过；
- 镜像现有文件数 > 2 × max(落盘集大小, 200) → 中止 + warn 日志。

## FR-03 manifest 逐行对齐（墓碑语义）

`_write_spec_root` 末尾的全表 `DELETE SpecFileManifest` 改为逐行对齐：
- 落盘集命中：upsert（有行更新 hash / version+1 / exists=True；无行插 version=1）；
- 镜像被删文件：有行置 `exists=False` + version+1（墓碑）；无行不动；
- 不再全表 DELETE。

## FR-04 占位行保护时效

`_progress_reported_active_keys` 只把 `platform_change_progress.updated_at`
距今 ≤ 7 天的行计入保护集；更陈旧的行不再保护，全量 reparse 删除环正常删除其
对应 changes 行（无文档前提不变）。CLI 后续恢复上行时 `_ensure_change_row`
upsert 重建占位行。

## NFR-01 兼容性

daemon / CLI / 前端 / api-types 零改动；SSE done 事件新增 `converged_files` /
`converged_dirs` 字段为加法扩展。

## NFR-02 可审计性

对账删除的文件数 / 目录数写入结构化日志 + SSE done 事件；跳过 / 中止护栏时记
warn 日志含双方向文件数。

## 需求来源

- 用户报告：变更中心进行中计数 40 vs 真实 24（2026-08-19，本对话实测闭环）。
- 手工收敛实证根因：镜像只增不删 + 占位行无时效（详见 design.md §1）。
