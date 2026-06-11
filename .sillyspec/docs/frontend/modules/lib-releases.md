---
schema_version: 1
doc_type: module-card
module_id: lib-releases
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-releases

## 定位
Release（发布）API 客户端。

## 契约摘要
- `listReleases(workspaceId, status?)` — 列出发布
- `createRelease(workspaceId, input)` — 创建发布
- `approveRelease(releaseId, data)` — 审批发布
- `listApprovals(releaseId)` — 列出审批记录
- `deployRelease(releaseId)` — 部署发布
- `promoteRelease(releaseId)` — 提升发布
- `rollbackRelease(releaseId)` — 回滚发布
- 类型：CreateReleaseInput

## 关键逻辑
- 完整的发布生命周期管理：创建 → 审批 → 部署 → 提升/回滚
- approveRelease 接受 releaseId（非 workspaceId），说明审批是全局操作

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
