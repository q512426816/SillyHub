---
schema_version: 1
doc_type: module-card
module_id: archive
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# archive

## 定位
后端「变更归档与知识蒸馏」功能域：把已完成的 SillySpec 变更从 active 区移动到 archive 区，并从变更内容中蒸馏出可复用的知识（knowledge）写入 `.sillyspec/knowledge/`。是变更工作流的收尾环节，衔接 change 与 knowledge 两个功能域。

## 契约摘要
- API（tag=archive）：`POST /api/.../archive`（归档变更）、`POST /api/.../distill-knowledge`（从变更蒸馏知识）。
- `ArchiveService`：`archive_change(change_id)` 执行归档（状态/目录迁移），`distill_knowledge(change_id)` 生成知识摘要并落盘。
- 错误：`ArchiveError`（基类）、`ArchiveNotFound`、`ChangeNotArchivable`（变更未达可归档状态）。
- 依赖 change（变更状态判定）与 knowledge（输出目录约定）。

## 关键逻辑
```
# 归档前置校验
change 状态必须为终态 → 否则 ChangeNotArchivable
→ archive_change: 移动 .sillyspec/changes/<key>/ → changes/archive/<key>/
# 知识蒸馏
distill_knowledge(change_id) → 从 change 内容提取摘要 summary
→ knowledge_dir = ws/.sillyspec/knowledge/ → 写 <change_key>.md（_render_knowledge_md）
```

## 注意事项
- 归档是单向终态操作，移动后 active 区不再可见；`ChangeNotArchivable` 把关前置状态。
- 蒸馏出的知识文件名沿用 `change_key`，覆盖写入；若同名知识已存在会被替换。
- 归档与蒸馏可独立调用：归档不强制蒸馏，蒸馏不强制归档（但实践中常配套）。
- 知识输出目录依赖 SpecPathResolver 约定，不要硬编码路径。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
