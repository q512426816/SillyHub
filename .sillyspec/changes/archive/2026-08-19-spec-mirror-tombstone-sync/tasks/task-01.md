---
id: task-01
title: _write_spec_root 对账删除阶段
title_zh: 全量同步对账删除（软删 move + 空目录清理 + 双护栏）
author: qinyi
created_at: 2026-08-19T22:40:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05]
requirement_ids: [FR-01, FR-04]
decision_ids: []
provides:
  - contract: "_converge_stale_files(spec_root, landed_paths, backup_root) -> (converged_rel_paths, converged_dirs)"
    fields: [converged_rel_paths, converged_dirs]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
goal: >
  _write_spec_root 的 merge 循环后新增对账删除阶段：镜像里不在实际落盘集的文件
  move 到备份区，空目录清理，双护栏（空落盘集跳过 / 数量比例 2×max(n,200) 中止）
implementation:
  - merge 循环内收集 landed_paths（收集点在 _load_member 成功且 .runtime 过滤之后；含同内容 skip 分支）
  - 新增静态 helper _converge_stale_files，整体 asyncio.to_thread 执行
  - 护栏① landed_paths 为空 return（空集）
  - 护栏② len(disk_files) > 2*max(len(landed_paths),200) → warn 日志 spec_workspace.converge_aborted_ratio → return 空集
  - rglob("*") 收集磁盘文件（排除任意深度 .runtime 路径段）
  - 对 disk_file ∉ landed_paths：shutil.move 到 backup_root/{ts}/{rel}（同批一个 ts）
  - os.walk(topdown=False) 自底向上 rmdir 空目录（跳过 spec_root 本身）
  - 调 _prune_spec_backups(backup_root)（service.py:1115 既有）
  - 返回 (converged_rel_paths: set[str], converged_dirs: int)
acceptance:
  - 镜像独有文件同步后进备份区、幽灵目录消失
  - 两护栏触发时不删任何文件
  - 落盘集与镜像一致时零删除
constraints: >
  对齐 design Non-Goals：不动 apply_ops / daemon / CLI / 前端 / api-types；不做后台任务、UI 入口、migration。
verify:
  - backend pytest spec_workspace 模块全绿

---
