---
author: qinyi
created_at: 2026-07-02 14:20:00
change: 2026-07-02-change-detail-file-tree-editor
---

# Module Impact — 变更详情文件树 + 手动编辑

> 仅含本变更真实改动文件。git diff 含预存未提交文件（daemon/lease/context.py、spec_workspace/*、workspace/member_runtimes/*、sillyhub-daemon/*、agent/service.py、workspace-access-guide/binding-guard 等）**非本次变更**，已排除。

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend/change | 新增能力 + 删除死代码 | router.py, schema.py, service.py, tests/test_router.py, tests/test_files_router.py | 新增 list_files/read_file/write_file/_resync_change_docs/list_pending_files/_resolve_change_dir + 4 files 端点 + 7 DTO；删除 get_document_content + GET /documents/{doc_type} + 2 过时测试 | yes |
| backend/daemon | schema 扩展 | model.py, schema.py, change_write_router.py | DaemonChangeWrite 加 kind 列（create/edit）+ migration 202607021100 + ChangeWritePendingItem/ClaimResponse kind 透传 + claim 端点 PG/SQLite 两分支透传 | yes |
| backend/migrations | 新增 revision | 202607021100_add_kind_to_daemon_change_writes.py | 加 kind 列（down=202607011300） | no |
| frontend | 新增组件 + 删除死代码 | lib/change-files.ts, components/change-file-tree.tsx, components/__tests__/change-file-tree.test.tsx, app/.../changes/[cid]/page.tsx, app/.../changes/page.tsx, lib/changes.ts | 文件树+编辑器+outbox 写回状态机组件；删生命周期图/文档完整性面板/DOC_TABS 查看器/死 wrapper | yes |

## 未映射文件

`_module-map.yaml` 不存在（modules 目录仅 frontend.md）。frontend 改动按 frontend.md 模块文档归属。

## 三重交叉验证

- 声明范围（design §6 文件清单）= 任务范围（plan/tasks）= 真实变更（git diff 本变更文件）。一致。
- 偏差：git diff 含预存未提交文件（非本次），已识别并排除。
