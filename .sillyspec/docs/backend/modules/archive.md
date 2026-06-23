---
schema_version: 1
doc_type: module-card
module_id: archive
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# archive

## 定位
已完成变更的归档与知识蒸馏。将 `done` 状态的 change 目录移动到 `archive/`，并从变更文档提取摘要生成知识库 markdown 写入 `.sillyspec/knowledge/`。同时操作数据库与文件系统。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/changes/{id}/archive` — 归档（仅 done 可归档）
- `POST /api/workspaces/{workspace_id}/changes/{id}/distill` — 蒸馏知识（任意状态均可）
- `ArchiveService.archive_change/distill_knowledge`；`_render_knowledge_md` 生成 md
- 错误：`ArchiveError`(400) / `ArchiveNotFound`(404) / `ChangeNotArchivable`(409，状态非 done)

## 关键逻辑
```
archive_change(workspace_id, change_id):
  change = get(change_id); assert change.workspace_id == workspace_id
  if change.status != 'done': raise ChangeNotArchivable
  ws = get(Workspace, workspace_id)
  shutil.move(root/{change.path}  →  root/archive/{change.path 斜杠转连字符})
  change.status = 'archived'; change.archived_at = now
  commit; return change

distill_knowledge(workspace_id, change_id):
  change, docs = load(change_id, ChangeDocument list)
  summary = {change_key, title, status, change_type, components, docs[]}
  md = _render_knowledge_md(summary)
  write .sillyspec/knowledge/{change_key}.md
```

## 注意事项
- 归档用 `shutil.move()` 同步阻塞，change 目录大时影响事件循环
- 归档目标目录名把 `change.path` 中的 `/` 替换为 `-`，`a/b` 与 `a-b` 会撞名
- `distill_knowledge` 无状态校验，任何状态都能蒸馏（不要求 done）
- 蒸馏文件已存在直接覆盖，无冲突处理；文档内容截取前 2000 字符、预览 500 字符
- 归档权限 `CHANGE_ARCHIVE`（高于 CHANGE_READ），蒸馏权限 `CHANGE_READ`
- 无独立数据库表，依赖 change.Change / ChangeDocument 与 workspace.Workspace 模型

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
