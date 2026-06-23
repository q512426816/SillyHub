---
schema_version: 1
doc_type: module-card
module_id: lib-archive
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-archive

## 定位
工作空间级"变更归档"的前端 API 客户端。将已完成验证的 change 移入归档目录并打标，以及从变更中提炼（distill）归档摘要。对应 `/api/workspaces/{ws}/changes/{cid}/archive` 与 `/distill`。是 SillySpec 收尾阶段的前端入口。

## 契约摘要
| 函数 | 语义 | HTTP | 返回 |
|---|---|---|---|
| `archiveChange(workspaceId, changeId)` | 归档变更（移动到 archive 目录 + 标 archived） | POST `/api/workspaces/{ws}/changes/{cid}/archive` | `ArchivedChange` |
| `distillChange(workspaceId, changeId)` | 提炼变更（生成归档摘要/知识） | POST `/api/workspaces/{ws}/changes/{cid}/distill` | `Record<string, unknown>` |

类型：
- `ArchivedChange`：`id/workspace_id/workspace_ids[]/change_key/title/status/location/path/affected_components[]/change_type/owner_id/archived_at` 等。

## 关键逻辑
```
archive: 后端移动文件目录并写 archived_at，返回归档后的完整记录
distill: 从变更产物中抽取可复用知识，返回结构化摘要（具体字段由后端决定）
```

## 注意事项
- 归档前应先通过 `lib-changes.checkArchiveGate` 检查归档门禁（验证完成度等），未通过不应直接归档。
- `distillChange` 返回类型为宽泛的 `Record<string,unknown>`，前端需按后端契约解读。
- `ArchivedChange.workspace_ids` 为数组，说明归档后变更可跨工作空间可见。
- 归档是相对重的操作（文件移动），调用前应有确认。
- `_module-map` 标注 used_by 为空，目前无页面直接调用（多为 Agent 或 verify 流程触发）。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
