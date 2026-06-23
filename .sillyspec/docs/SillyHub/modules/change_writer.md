---
schema_version: 1
doc_type: module-card
module_id: change_writer
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# change_writer

## 定位
后端「变更文档生成器」功能域：在仓库 `.sillyspec/changes/` 下创建变更目录并按 SillySpec 模板生成 markdown 文档（master/proposal/requirements/design/plan 等），支持单文档生成与批量模板生成。是变更工作流的「写盘起点」，生成的内容随后由 change 模块解析入库。

## 契约摘要
- API：变更创建 `POST .../changes`、markdown 生成 `POST .../changes/{id}/documents/{name}/generate`、批量生成 `POST .../changes/{id}/generate-all`。
- `ChangeWriterService`：`create_change`（建目录 + master 文档 + author/created_at frontmatter）、`generate_document`（按文档类型渲染）、`batch_generate_templates`（一次性补齐缺失模板）、`_repo_dir_for_workspace`、`_ensure_frontmatter`、`_get_active_lease`（写盘需持有 worktree lease）。
- `markdown_builder`：模板构造函数 `build_master_md / build_proposal_md / build_requirements_md / build_design_md / build_plan_md`。
- 错误：`ChangeWriteError`。
- 依赖 change（变更存在性）、workspace（仓库根）、core 的 SpecPathResolver 约定路径。

## 关键逻辑
```
# 创建变更
create_change → 校验 workspace + change 名唯一
→ _repo_dir_for_workspace → 创建 .sillyspec/changes/<key>/
→ build_master_md + _ensure_frontmatter(author, created_at) 落盘
# 单文档生成
generate_document(type) → markdown_builder.build_<type>_md → 写入对应文件名
# 批量生成
batch_generate_templates → 遍历缺失文档 → 逐个 build + 写入 → 返回生成清单
```

## 注意事项
- 写盘前必须 `_get_active_lease` 校验持有 worktree lease，避免向主仓库直接写；lease 失效会拒绝写入。
- `_ensure_frontmatter` 保证每份 markdown 带 author/created_at frontmatter，change 解析依赖这些元数据。
- 文档文件名严格遵循 SpecPathResolver 约定（proposal.md/design.md/plan.md/tasks.md），勿自创文件名。
- 批量生成幂等：已存在的文档默认不覆盖（除非策略指定）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
