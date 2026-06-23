---
schema_version: 1
doc_type: module-card
module_id: change
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# change

## 定位
后端「变更（change）」功能域：SillySpec 变更工作流的核心。解析工作区 `.sillyspec/changes/` 目录结构为变更视图，管理变更 CRUD、文档矩阵（proposal/design/plan/tasks）、阶段流转（transition）、人工 gate、进度同步、反馈提交、归档门槛检查，并在阶段切换时触发 Agent 执行派发。是 change_writer（生成）与 archive（归档）的桥梁，也是 agent 派发的上游。

## 契约摘要
- API（prefix=/workspaces/{workspace_id}, tag=change）：变更列表/详情 `GET /changes`、`/changes/{key|id}`、文档矩阵 `/changes/{id}/documents`、文档内容 `/changes/{id}/documents/{name}`、重解析 `POST /changes/reparse`、进度更新 `POST /changes/{id}/progress`、审批 `GET/POST /changes/{id}/approval` 等。
- `ChangeService`：`list_/get/get_by_key/get_documents/get_document_content/update_progress/transition/transition_with_dispatch/submit_feedback/check_archive_gate/reparse/sync_documents/approve/reject`，`resolve_human_gate(target_stage)` 计算人工 gate。
- `ChangeParser`：解析 `.sillyspec/changes/` 为 `ChangeParserResult`（`ParsedChange`/`ParsedDoc`/`ParseWarning`）。`_infer_change_type`、`_infer_affected_components`（读 `_module-map.yaml` 把变更涉及的文件路径反查回模块，`_load_module_map`/`_match_paths_to_modules`）。
- `SillySpecStageDispatchService`（dispatch.py）：阶段流转后的自动派发。`auto_dispatch_next_step`/`dispatch`/`reconcile_stale_runs`/`cleanup_orphan_dispatch_runs`/`cleanup_stale_pending_runs`/`read_verify_result`/`has_active_run`，`get_config_for_stage` 读阶段 agent 配置（`StageAgentConfig.requires_worktree`）。
- 依赖 change_writer（生成文档）、agent（派发执行）、workspace（解析根）。

## 关键逻辑
```
# 解析与反查模块
parse_workspace(sillyspec_root) → 各 change 目录 → _infer_affected_components
→ _load_module_map → _match_paths_to_modules(文件路径 → 模块 id)
# 阶段流转 + 自动派发
transition → resolve_human_gate 校验 → transition_with_dispatch
→ SillySpecStageDispatchService.dispatch → AgentService.start_stage_dispatch
→ dispatch 成功后 cleanup_orphan_dispatch_runs 收敛
# 重解析
reparse → 全量重扫目录 + _detect_renames + _sync_docs 同步入库
```

## 注意事项
- 模块影响分析依赖 `_module-map.yaml` 的 paths glob；若卡片 paths 不准，受影响模块判定会漏报。
- `transition` 必须过 `resolve_human_gate` 人工门，`transition_with_dispatch` 在门禁通过后串联 Agent 派发。
- `has_active_run` / `reconcile_stale_runs` 保证同一 change 不会并发派发多条 run，派发前会 `cleanup_before_dispatch`。
- `requires_worktree=True` 的阶段，派发前 AgentService 会申请 worktree lease 用于写盘。
- `reparse` 会重建文档矩阵，`_detect_renames` 处理变更重命名场景。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
