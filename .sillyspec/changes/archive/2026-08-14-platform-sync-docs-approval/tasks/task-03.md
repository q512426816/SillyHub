---
id: task-03
title: service targeted-column refactor + 3 new methods + placeholder guard
title_zh: service 定向列重构 + 三新方法 + 占位行守卫
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P1
depends_on: [task-01]
blocks: [task-04, task-05]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
goal: >
  upsert_progress 重构为定向列 UPDATE（INSERT 不带 approval/documents）；新增 upsert_documents /
  set_approval / get_approval_record；占位行守卫（get_progress NULL→None / list_lightweight 过滤）。
implementation:
  - upsert_progress：现有整行替换改 UPDATE 只 SET latest_progress/last_pushed_at/last_pusher/updated_at；INSERT 分支只带这些列（approval/documents 留 NULL）；冲突检测（base_ts 409）逻辑不变
  - upsert_documents(workspace_id, name, documents)：_find_row 有→UPDATE 只 SET documents+updated_at；无→INSERT 占位（latest_progress NULL）+ 返回 synced 数
  - set_approval(workspace_id, name, decision, reason, decided_by)：approval JSON = {status: decision, reason, decided_at: now(UTC).isoformat(), decided_by}；UPDATE 只 SET approval+updated_at；行无 INSERT 占位；重复提交覆盖（后写赢）
  - get_approval_record(workspace_id, name)：返回 approval 列 dict 或 None（行不存在也是 None）
  - 守卫：get_progress 现有实现对 latest_progress IS NULL 行须返回 None（router 维持 404）；list_lightweight WHERE 加 latest_progress IS NOT NULL
  - 三写入路径共享 _find_row（col.is_(None) NULL 过渡期语义不变）
acceptance:
  - 单写者：push progress 后 approval/documents 保留；upsert_documents/set_approval 后 latest_progress 保留
  - 守卫：占位行 GET progress 404 + 列表无占位项
verify:
  - uv run pytest app/modules/platform_sync -q --no-cov（task-05 全量用例）
constraints: 409 base_ts 冲突路径零回归；is_(None) 过渡期语义不变。
---
