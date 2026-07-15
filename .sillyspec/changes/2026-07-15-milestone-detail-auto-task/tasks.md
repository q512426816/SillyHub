---
author: WhaleFall
created_at: 2026-07-15 19:07:21
---

# 任务清单（Tasks）— 里程碑明细提交自动创建任务计划

> 仅列任务名与一句话范围，细节（Wave 分组、依赖、验收点）在 plan 阶段展开。

- task-01：`plan/service.py` 新增联动 helper 方法集（`_ensure_task_for_detail` / `_sync_task_fields` / `_migrate_task_to_version` / `_unlink_task` / `_resolve_project_context` / `_lookup_user_name`），复用 self._session、不单独 commit
- task-02：`create_detail` 重构为原子事务（session.add + 统一 commit），`status=done` 时触发建任务
- task-03：`_transition`（save_process→DONE）在统一 commit 前接入 `_ensure_task_for_detail`
- task-04：`import_commit` 在末尾统一 commit 前对每个 done 明细批量建任务
- task-05：`update_detail` 重构为原子事务 + 接入 `_sync_task_fields`；`delete_detail` 重构 + 接入 `_unlink_task`
- task-06：`change_process` 在统一 commit 前接入 `_migrate_task_to_version`
- task-07：新增 `backend/app/modules/ppm/plan/tests/test_detail_task_link.py`，覆盖 FR-01~FR-07 全部 GWT 边界（建/导入批量/编辑同步/变更迁移/删除解关联/执行人空跳过/版本链查重/强一致回滚）
- task-08：（可选）`milestone-details/page.tsx` 提交成功 toast 加「已自动创建任务」文案
- task-09：后端 curl 实测 create/save/import/update/change/delete 六路径联动 + grep 确认 import + 重建 backend Docker 部署验证
