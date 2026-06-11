---
schema_version: 1
doc_type: module-card
module_id: lib-runtime
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-runtime

## 定位
Runtime Progress API 客户端。获取工作空间运行时进度和产物。

## 契约摘要
- `getRuntimeProgress(workspaceId)` — 获取运行时进度（阶段/步骤/状态）
- `getRuntimeUserInputsRaw(workspaceId)` — 获取用户输入原始内容
- `getRuntimeArtifacts(workspaceId)` — 列出产物文件
- `getRuntimeArtifactContent(workspaceId, filename)` — 获取产物文件内容
- 类型：RuntimeProgress、StageProgress、StageStep、ArtifactEntry

## 关键逻辑
- RuntimeProgress 包含 stages 映射，每个 stage 有 steps 数组
- 产物接口支持文件列表和文件内容查看
- getRuntimeUserInputsRaw 和 getRuntimeArtifactContent 返回 text/plain

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
