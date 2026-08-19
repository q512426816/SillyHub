---
change: 2026-08-19-spec-mirror-tombstone-sync
title: 平台 spec 镜像全量同步删除对账收敛
author: qinyi
created_at: 2026-08-19 22:20:00
status: proposed
---

# 提案（Proposal）

## 问题

平台 spec 镜像（`/data/spec-workspaces/{ws}/`）的全量同步路径只增不删：
`_write_spec_root` 落盘 tar 时保留「镜像里 staging 未包含的文件」（D-006@v2 的
「他人独有文档保护」），但该策略无法区分**他人独有文档**与**改名 / 删除 / 归档
产生的幽灵残留**。实证（2026-08-19 生产）：镜像 active 变更目录 41 个 vs 真实仓库
24 个，变更中心「进行中」计数虚高 15 条；「重新扫描」忠实重扫过期镜像（deleted=0）
无法收敛。

同时，`change` 模块 reparse 删除环的占位行保护（ql-20260815-002）无时效——
`platform_change_progress` 上行过一次 `status=active` 且无文档的占位行永久滞留，
实测 6 条测试残留行永不消失。

## 方案

全量同步对账收敛（方案 A）：

1. `_write_spec_root` 补**对账删除**阶段——以 merge 实际落盘集为基准，镜像独有
   文件软删 move 到既有备份区（`spec-backups/{ws}/{ts}/`，30 天修剪），空目录
   自底向上清理；坏包双护栏（空 tar 跳过 + 文件数比例 2×max(落盘集,200) 中止）。
2. `spec_file_manifest` 由全表 wipe 改为**逐行对齐**——被删文件行置 `exists=False`
   墓碑（保留乐观锁谱系，daemon 缓存命中墓碑不再死锁）。
3. 占位行保护加 **7 天时效窗**（`platform_change_progress.updated_at`）——陈旧
   占位行在全量 reparse 正常删除；CLI 恢复后 upsert 重建，不丢数据。

删除语义与增量路径 `apply_ops`（D-011，已完备）收敛为同一套（备份区 / 墓碑 /
修剪），DB 收敛复用既有 reparse 链路，零新增触发面。

## 收益

- 归档 / 删除 / 改名后，镜像与变更中心自动收敛，不再需要手工清理（本次 17 目录
  + 6 DB 行的手工作业成为最后一次）。
- 「从仓库导入」「同步到服务器」「重新扫描」三个既有入口全部获得收敛能力。
- daemon / CLI / 前端零改动（无 API 契约变化）。

## 不在范围内 / Non-Goals

- 不动增量协议 `apply_ops`（已完备）。
- 不做后台对账任务 / 定时清理调度。
- 不做 UI 手动清理入口。
- 不改 daemon tar 打包方、CLI spec-sync、前端、api-types。

## 影响模块

- `backend/app/modules/spec_workspace`（主：service.py 对账删除 + manifest 对齐）
- `backend/app/modules/change`（次：service.py 占位保护时效）

## 关联

- 前置实证：2026-08-19 变更中心计数手工收敛（本对话，未走 change）
- 增量协议先例：2026-08-13-platform-managed-file-sync（D-011 manifest / 备份区）
- 软删复活语义：ql-20260819-004（墓碑不算占用 / add 复活）
