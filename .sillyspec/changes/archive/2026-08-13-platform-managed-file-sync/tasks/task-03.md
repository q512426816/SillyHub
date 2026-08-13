---
id: task-03
title: service.py 新增 apply_ops（add/update/delete/rename + base_version 409 + 软删 move + 备份区 + containment + .runtime 拒 + 写清单）+ 旧 tar 落盘失效 manifest
title_zh: 增量 op 应用核心（apply_ops + 软删备份 + 旧 tar 失效清单）
created_at: 2026-08-13 15:23:34
author: qinyi
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-004@v1, D-005@v1, D-006@v1, D-008@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
goal: >
  实现增量同步核心——apply_ops 逐 op 落盘 + base_version 乐观锁 + 软删 move 出 spec_root 到备份区，并让旧 tar 全量落盘失效文件级清单（Q7）
implementation:
  - apply_ops(workspace_id, ops) 返回 new_versions/conflict/server_versions；逐 op 查清单行——有行且 version!=base_version 记 conflict+server_versions 跳过，无行走 R-07 兜底（add/update 视为新建 version=1，delete no-op 幂等）；校验失败不落盘不 commit，冲突 op 跳过其余照常 apply
  - containment 对齐 service.py:544-556（\ 转 /、拒绝对路径/盘符、resolve+relative_to 捕获 ../ 与 symlink，_spec_bundle_invalid 422）；.runtime 首段拒 422
  - add/update 写盘+upsert 清单；delete 软删 move 到 spec_data_root/spec-backups/{ws}/{ts}/{path}（备份目标同 containment）+ exists=False + version+1 + 机会式修剪早于 30 天备份（R-06）
  - rename 校验 new_path 同 containment + shutil.move + 清单 path 更新；_write_spec_root（旧 tar 落盘点）提交后删该 ws 全部 spec_file_manifest 行（Q7）
acceptance:
  - 各 op 正确 apply + 清单 version 递增；base_version 过期 conflict=True+server_versions 且冲突文件不落盘；.runtime/越界 422；软删移备份区 exists=False；旧 tar apply_sync 后清单行清空；R-07 兜底与 R-06 30 天修剪生效
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov && cd backend && uv run ruff check app/modules/spec_workspace/service.py
constraints:
  - containment 必须与 _extract_spec_tar_to_staging:544-556 机制一致（R-09）；软删是 move 非 copy（D-010）；备份区在 spec_root 外（D-008/BL-2）；冲突部分 apply 不静默覆盖（NFR-02）；spec_file_manifest 唯一写者=apply_ops（D-011），scan_docs reparse 不碰
provides:
  - contract: apply_ops
    fields: [ops, base_version, new_versions, conflict, server_versions, soft_delete_move, backup_dir, containment, runtime_reject, hash_fallback]
  - contract: old_tar_invalidates_manifest
    fields: [delete manifest rows on old tar push]
expects_from:
  task-01:
    - contract: spec_file_manifest_model
      needs: [workspace_id, path, content_hash, version, exists, updated_at]
  task-02:
    - contract: spec_incremental_dto
      needs: [FileOp]
---
