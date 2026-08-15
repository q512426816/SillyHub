---
id: task-03
title: batch progress writeback + apply_ops IN prefetch
title_zh: 批量化——_bump_files_processed 批量回写（50 文件/500ms）+ apply_ops 循环前 IN 预取
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: [task-02]
blocks: [task-10]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/tests/modules/spec_workspace/
  - backend/app/modules/spec_workspace/tests/
goal: >
  消除每文件一次独立 session+commit 的进度回写（改内存计数 + 50 文件或
  500ms 先到者单次 UPDATE + finally 终态回写），消除 apply_ops per-op
  SELECT（循环前按 path ∪ new_path 一次 IN 预取）。终态准确、语义不变。
implementation:
  - spec_workspace/service.py:732-754 _bump_files_processed 改内存计数：apply 循环内只累加计数器；每 50 文件或距上次回写 500ms（先到者）时单次 UPDATE files_processed = files_processed + batch；同步结束 finally 终态回写兜底（R-02）
  - 保留 status=='claimed' 守卫语义（BL-3 对齐）与 best-effort 失败仅 warn；签名不变（调用点无感，design 接口定义）
  - apply_ops（:965-978 per-op SELECT、:1048-1059 rename 目标查询）循环前按所有 op 的 path ∪ new_path（new_path 非 None）一次 IN 预取 SpecFileManifest 成 dict——照抄同文件 :610-621 既有 IN 预取范式（含注释说明 identity map 保证同一 Python 对象原地改写）
  - 循环体内 row / target_row 改 dict 取值（.get），miss 即 None，分支逻辑零改动
  - 连带测试债：tests/modules/spec_workspace/test_per_file_progress.py:94 断言 bump_spy.call_count == 3（每文件一次）——批量后按 design 目标 5 授权调整该断言（允许断言调用次数上限或终态 files_processed 数值），业务语义（3 文件终态准确、change_write_id 传递、非 claimed no-op）不动
  - 新增单测：批量回写终态准确（中途值允许 50 文件粒度）+ apply_ops 语义等价（既有 apply_ops 测试作锚点）
acceptance:
  - 3 文件场景终态 files_processed == 3（数值最终准确，design 兼容策略）
  - status != 'claimed' → 终态 no-op（守卫保留，既有测试继续过或等价调整）
  - apply_ops 冲突/乐观锁/软删/rename 语义与改前等价（server_versions / new_versions / conflict 布尔逐项对齐既有断言）
verify:
  - cd backend && uv run pytest tests/modules/spec_workspace/ app/modules/spec_workspace/tests/ -q --no-cov
  - cd backend && uv run pytest tests/modules/spec_workspace/test_apply_sync.py -q --no-cov
  - cd backend && uv run ruff format --check app/modules/spec_workspace/service.py
  - cd backend && uv run mypy app/modules/spec_workspace/service.py
constraints: 仅在 task-02 之后动 spec_workspace/service.py（共享文件串行）；NFR-04 不动 schema；进度条粒度容忍 50 文件/500ms（design 兼容策略已授权）。
related_tests:
  - backend/tests/modules/spec_workspace/test_per_file_progress.py:94（call_count==3 断言按批量目标调整，业务断言不动）
---
