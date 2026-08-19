---
change: 2026-08-19-spec-mirror-tombstone-sync
title: 实现计划（Plan）
author: qinyi
created_at: 2026-08-19 22:25:00
plan_level: light
status: draft
---

# 实现计划（Plan）

> plan_level: light —— 4 文件、2 模块、无 schema 变更、6 task、5 Wave。
> 依据：design.md v2（Grill pass，docHash 0fc1c409）+ 子代理计划审查（2 处修正已并入）。

## Wave 1：核心机制（task-01 与 task-04 文件不相交，可并行）

- [x] task-01: `_write_spec_root` 对账删除阶段

文件：`backend/app/modules/spec_workspace/service.py`

步骤：
1. merge 循环内收集 `landed_paths: set[str]`（实际落盘的 rel_path，含同内容
   skip 分支——hash 相同 continue 的文件也在落盘集里，因为镜像里已有且内容一致；
   收集点：`_load_member` 成功且 `.runtime` 过滤**之后**加入（review 修正：不能在
   循环入口加——local.yaml / staging 缺失成员走 FileNotFoundError continue 分支，
   入口加入会让 local.yaml 永不删除，与 task-05 用例冲突）。
2. merge 循环后、`pending_conflicts/pending_new_docs` 入 session 前，插入
   `_converge_stale_files(spec_root, landed_paths, backup_root)`（整体
   `asyncio.to_thread`，对齐 ql-20260818-009 范式）：
   - 护栏①：`landed_paths` 为空 → return 空集；
   - 护栏②：`len(disk_files) > 2 * max(len(landed_paths), 200)` → warn 日志
     `spec_workspace.converge_aborted_ratio`（含两方向计数）→ return 空集；
   - walk `spec_root.rglob("*")` 收集文件（排除任何 `.runtime` 路径段）；
   - 对每个 `disk_file ∉ landed_paths`：`shutil.move` 到
     `backup_root/{ts}/{rel}`（同批一个 ts），计入集合；
   - 自底向上 `os.walk(topdown=False)` rmdir 空目录（跳过 spec_root 本身），
     计数；
   - 调 `_prune_spec_backups(backup_root)`（service.py:1115 复用）；
   - 返回 `(converged_rel_paths: set[str], converged_dirs: int)`
     （review 修正：返回路径集合而非文件计数——task-02 墓碑对齐需要被删文件的
     rel_path 集；文件计数 = len(converged_rel_paths)）。
3. 返回值透传到 `_write_spec_root` 调用方（SSE 478-483 done 事件 / apply_sync /
   import_from_repo 三调用点，review 备注）供事件与日志。

完成标准：镜像独有文件同步后进备份区、幽灵目录消失；两护栏单测覆盖。

- [x] task-04: 占位行保护 7 天时效窗

文件：`backend/app/modules/change/service.py`

步骤：`_progress_reported_active_keys`（service.py:1249）查询后过滤——
`row.updated_at`（timezone-aware；naive 归一化 UTC）`< now - 7d` 的行不计入
保护集。常量 `PLACEHOLDER_PROTECT_WINDOW_DAYS = 7`（模块级）。

完成标准：6 天保护 / 8 天不保护两分支单测。

## Wave 2：manifest 墓碑对齐（依赖 task-01，service.py 串行）

- [x] task-02: manifest 逐行对齐（墓碑替代 wipe）

文件：`backend/app/modules/spec_workspace/service.py`

步骤：
1. 删除现有 922-930 的全表 `DELETE SpecFileManifest` 块。
2. 在同位置（最终 commit 后）改为逐行对齐（独立短事务）：
   - IN 预取该 workspace 全部 manifest 行；
   - 对 `landed_paths`：有行 → 更新 hash（复用 merge 循环已算的 ch——merge
     循环把 (rel_path → ch) 存入 dict 传入）/ version+1 / exists=True；
     无行 → 插 version=1；
   - 对对账删除的文件（task-01 返回的 converged 集）：有行 → exists=False +
     version+1；无行不动；
   - 单 commit。
3. 保持「apply_sync 落地后失效增量清单」的原意（Q7/R-01）——逐行对齐后 daemon
   拉新 manifest 的效果等价（version 全体推进），语义注释同步改写。

完成标准：无全表 DELETE；被删文件行 exists=False；命中文件 version 递增；单测覆盖。

## Wave 3：事件与日志（依赖 task-01/02，service.py 串行）

- [x] task-03: SSE done 事件 + 日志（并入 01/02 顺带）

文件：`backend/app/modules/spec_workspace/service.py`

- `_write_spec_root` 返回值 / SSE done 事件（`import_from_repo_sse` 478-483）加
  `converged_files` / `converged_dirs` 字段；`apply_sync` / SSE 路径记结构化日志
  `spec_workspace.converged`。

完成标准：SSE done 事件含两字段；日志含两字段与护栏跳过 / 中止记录。

## Wave 4：测试（依赖 W1-W3 + task-04）

- [x] task-05: 新增测试

文件：
- `backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`（新建）
  - 镜像多 3 文件 → 全 move 备份区 + 空目录清理 + manifest 墓碑；
  - 落盘集与镜像一致 → 零删除零墓碑；
  - 空 tar → 跳过对账；
  - 比例护栏 → 中止 + 镜像不动；
  - 镜像存量 local.yaml 整包覆盖后消失（SERVER_EXCLUDED 语义）；
  - manifest 无全表 DELETE（对齐前后行数断言）。
- `backend/app/modules/change/tests/test_reparse_guard.py`（追加）
  - 占位保护 updated_at 6 天 → 保护；8 天 → 不保护（changes 行删除）。

完成标准：新增用例全绿。

## Wave 5：回归收尾（依赖 task-05）

- [x] task-06: 全量回归

- `cd backend && .venv/Scripts/python.exe -m pytest app/modules/spec_workspace app/modules/change -q`
- ruff format + lint（pre-commit 会跑）；
- gen:types 不适用确认：无 API 契约变化（SSE 事件是流文本非 OpenAPI schema），
  openapi.json 不变。

完成标准：两模块测试全绿 + ruff 干净。

## Wave 依赖

- Wave 1（task-01 + task-04，文件不相交并行）→ Wave 2（task-02，service.py 串行）
  → Wave 3（task-03，service.py 串行）→ Wave 4（task-05 测试）→ Wave 5（task-06 回归）。
  service.py 被 01/02/03/06 触达但分属不同 Wave，串行安全。

## 明确不做（对齐 design Non-Goals）

- 不动 apply_ops / daemon / CLI / 前端 / api-types。
- 不做后台任务、UI 入口、migration。
