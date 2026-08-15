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
在指定 workspace（或 worktree lease）下生成 SillySpec 变更文档骨架，并创建对应的 `change` 记录。封装"建变更目录 + 写 MASTER/proposal/requirements/design/plan 模板 + 落库 change"这一复合动作，是 `sillyspec propose` 后端等价物。2026-08-14-change-center-conversation-driven 起：create/proxy-create/documents/generate/documents/batch-generate/execute 端点随前端「新建变更」表单下线删除（D-001 / Grill F-5，无调用方），router 保留空壳供 main.py include_router 挂载；服务层 `ChangeWriterService` / `markdown_builder` 保留（markdown 模板仍被内部流程复用）。

## 契约摘要
- ⚠️ 2026-08-14 起 HTTP 端点全删：`POST /change-writer`（create_change）/ `.../generate` / `.../batch-generate` / `.../execute` 已下线，router 仅空壳（tags=[change_writer]，无路由）供 include_router 挂载，避免 dangling import。
- 服务层保留：`ChangeWriterService.create_change(...)` → `Change`；`generate_document/batch_generate_templates` → 文件路径或落盘内容
- `markdown_builder.build_master_md / build_proposal_md / build_requirements_md / build_design_md / build_plan_md` 提供纯文本模板（供服务层 / 其它调用方）

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
- **用户可见错误文案中文（2026-08-15-error-message-l10n）**：本模块面向前端用户的 raise message 已全部中文化（中文短语+行动指引，技术 ID 在 details）；守护测试 tests/core/test_error_message_l10n.py 强制新文案含 CJK。
- `change_key` = 日期 + slug + 6 位随机 hex，避免重名；slug 取标题小写化后非字母数字转 `-`
- `_ensure_frontmatter` 保证每篇 md 带 `author` + `created_at` YAML frontmatter；已有 `---` 开头则不覆盖
- 优先写入 lease worktree，无 lease 时落 workspace 根（容器内路径），两条路径分支不可混用
- 模板由 `markdown_builder` 集中产出，新增文档类型先在 builder 加函数再在 service/router 放开
- 与 change（落库）、workspace（根路径）、worktree（lease 路径）三方耦合；ExecEnvBuilder 提供 lease→repo_dir 解析
- 2026-08-14-change-center-conversation-driven：端点全删后本模块无对外路由，`ChangeWriterService` / `markdown_builder` 保留为内部能力；前端已无调用方（create-change 页已删，lib/changes.ts 清理 createChange/proxyCreateChange/executeChange）。

## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-14-change-center-conversation-driven**（D-001 / task-07）：create / proxy-create / documents/generate / documents/batch-generate / execute 端点删除（前端「新建变更」表单下线后无调用方，Grill F-5 连带清理 execute/documents）；router 保留空壳（prefix=/workspaces/{workspace_id}，tags=[change_writer]，无路由）供 main.py include_router 挂载。测试：test_router.py 删除 + test_proxy.py 大幅裁剪。
<!-- MANUAL_NOTES_END -->
