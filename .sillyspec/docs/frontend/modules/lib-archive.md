---
schema_version: 1
doc_type: module-card
module_id: lib-archive
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 归档 API·已删除（lib-archive）

## 定位
**已删除模块（墓碑卡）**。`frontend/src/lib/archive.ts` 于 commit 35aa6638（2026-07-12，feat(change/workspace): 删 archive 越界代码）随 backend archive 模块整模块移除——daemon-client 架构下 backend 不再越界操作宿主文件，归档端点归属 sillyspec stage dispatch（D-001）。当前工作树与 map 基线 commit 744e3de4 中该文件均不存在。

## 契约摘要
无。旧契约 `archiveChange`（POST `.../changes/{cid}/archive`）与 `distillChange`（POST `.../changes/{cid}/distill`）已随文件删除，`frontend/src` 内 grep 零命中，无任何调用方。

## 关键逻辑
```
（无源码）
```

## 注意事项
- `_module-map.yaml` 仍列本模块为 active（paths 指向已消失文件）——属 map 陈旧条目，下次 scan 应剔除或标记 removed，勿据 map 认为此文件存在。
- 归档语义现存去向：归档门禁检查在 `lib-changes.checkArchiveGate`；归档确认动作为 `lib-changes.archiveConfirm`（经 `submitStageReview` action=`archive_confirm` 分发）；执行侧归档由 sillyspec stage 流程在后端完成，前端无独立归档客户端。
- 勿凭旧卡（ba87eec 版）描述恢复该文件——其记录的端点已不属于现架构。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
