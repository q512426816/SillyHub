---
schema_version: 1
doc_type: module-card
module_id: change_writer
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# change_writer

## 定位
在指定 workspace（或 worktree lease）下生成 SillySpec 变更文档骨架，并创建对应的 `change` 记录。封装"建变更目录 + 写 MASTER/proposal/requirements/design/plan 模板 + 落库 change"这一复合动作，是 `sillyspec propose` 后端等价物。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/change-writer` — `create_change`，创建变更目录 + change 行 + MASTER.md + proposal.md
- `POST .../change-writer/generate` — `generate_document`，按 doc_type 生成单篇 markdown（proposal/requirements/design/plan）
- `POST .../change-writer/batch-generate` — 批量生成多篇文档
- `POST .../change-writer/execute` — `execute_change`，触发该变更的执行流程（转交 change/workflow）
- `ChangeWriterService.create_change(...)` → `Change`；`generate_document/batch_generate_templates` → 文件路径或落盘内容
- `markdown_builder.build_master_md / build_proposal_md / build_requirements_md / build_design_md / build_plan_md` 提供纯文本模板

## 关键逻辑
```
create_change(workspace_id, user_id, title, lease_id?):
  repo_dir = lease ? ExecEnvBuilder.repo_dir(lease.path)
                  : _repo_dir_for_workspace(workspace)
  slug = re.sub(r'[^a-z0-9]+','-', title.lower())[:40] or 'untitled'
  change_key = f"{UTC.now():%Y-%m-%d}-{slug}-{uuid4().hex[:6]}"
  write repo_dir/.sillyspec/changes/{change_key}/{MASTER,proposal}.md
  insert Change(change_key, status='draft', current_stage='draft')
  return change
```

## 注意事项
- `change_key` = 日期 + slug + 6 位随机 hex，避免重名；slug 取标题小写化后非字母数字转 `-`
- `_ensure_frontmatter` 保证每篇 md 带 `author` + `created_at` YAML frontmatter；已有 `---` 开头则不覆盖
- 优先写入 lease worktree，无 lease 时落 workspace 根（容器内路径），两条路径分支不可混用
- 模板由 `markdown_builder` 集中产出，新增文档类型先在 builder 加函数再在 service/router 放开
- 与 change（落库）、workspace（根路径）、worktree（lease 路径）三方耦合；ExecEnvBuilder 提供 lease→repo_dir 解析

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
