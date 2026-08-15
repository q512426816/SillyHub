---
id: task-02
title: spec write path to_thread (_write_spec_root + change_writer)
title_zh: spec 写入链路线程化——_write_spec_root 循环体 FS 操作入线程 + change_writer 写文件 to_thread 补漏
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-03, task-10]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/change_writer/service.py
  - backend/tests/modules/spec_workspace/
  - backend/app/modules/change_writer/tests/
goal: >
  _write_spec_root per-file 循环体内的同步 FS 操作（read_bytes / sha256 /
  shutil.move / mkdir）与 change_writer 两处 write_text+stat 全部移出事件循环，
  落盘语义（mtime 归一化、冲突归档顺序、NUL strip）零变更。
implementation:
  - spec_workspace/service.py:622-702（tf.getmembers 循环体）重构：把纯 FS 段抽成同步内函数（read_bytes → sha256 → mtime 计算 → shutil.move 落盘），循环内 await asyncio.to_thread(...) 调用；DB 相关段（ScanDocument 原地改写、conflict_svc.archive_conflict、session.add）留在事件循环——与现有 :606-621 IN 预取结构最小改，不整段搬线程
  - 拆分注意：cur.content 等对象改写依赖 content/ch 变量——线程内只产出（content、ch、src_mtime、落盘完成）三元组回 loop 再改对象；shutil.move 与 doc 行写入的相对顺序保持（先落盘后写行语义不变）
  - spec_workspace/service.py:897 附近 _prune_spec_backups 为同步 def——其调用点（apply_ops delete 分支 :1039）包 await asyncio.to_thread(self._prune_spec_backups, backup_root)
  - change_writer/service.py:264-265（generate_template：write_text + stat）与 :349-350（batch_generate_templates 循环内同对）各包 await asyncio.to_thread，size 取回后照旧打日志
  - staging rmtree 已在 to_thread（:706），不动
acceptance:
  - spec_workspace 既有测试（tests/ 模块内 + tests/modules/spec_workspace/ 集成）全绿，断言零修改
  - change_writer 既有测试全绿；写盘后 size / rel_path / frontmatter 语义不变
verify:
  - cd backend && uv run pytest tests/modules/spec_workspace/ app/modules/spec_workspace/tests/ -q --no-cov
  - cd backend && uv run pytest tests/modules/change_writer/ -q --no-cov
  - cd backend && uv run ruff format --check app/modules/spec_workspace/service.py app/modules/change_writer/service.py
  - cd backend && uv run mypy app/modules/spec_workspace/service.py app/modules/change_writer/service.py
constraints: 不动 _bump_files_processed（task-03 领地）；不动 apply_ops 的 per-op SELECT（task-03）；NFR-04 不加依赖；并发语义不新增风险。
---
