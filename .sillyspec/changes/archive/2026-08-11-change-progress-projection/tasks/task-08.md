---
id: task-08
title: ChangeService enrich join projection current_stage with fallback no status
title_zh: change service enrich 实时 join platform_change_progress 投影 current_stage 加 fallback 不投 status
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-02, task-06]
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1, D-004@v2]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/conftest.py
provides: []
expects_from:
  task-02:
    - contract: PlatformChangeProgressORM
      needs: [workspace_id, change_name]
  task-06:
    - contract: list_lightweight
      needs: [workspace_id]
    - contract: get_progress
      needs: [workspace_id, change_name]
related_tests:
  - path: backend/tests/modules/change/test_router_transition.py
    reason: 第126/177/203行经 detail 端点断言 change.current_stage 为 plan，走 enrich_with_workspace_ids 投影，须 join 不命中 fallback 保留现有值断言才仍绿
  - path: backend/tests/modules/change/test_dispatch.py
    reason: 多处断言 current_stage（725/734/904/1085/1204）经 enrich 投影须 fallback 保留，且 join 目标表 platform_change_progress 须在 change 测试 fixture 注册否则根 conftest 未注册致 join 抛表不存在
goal: >
  change service 的 enrich_summaries 与 enrich_with_workspace_ids 实时 read-only join platform_change_progress 覆盖 current_stage，join 不命中 fallback 现有值，不投 status，禁 N+1，对齐 design §5.1/§6/§9 与 D-002/D-003/D-004@v2。
implementation:
  - enrich_with_workspace_ids 加单行等值投影，按 change.workspace_id 与 change.change_name 查 PlatformChangeProgressORM，命中且 latest_progress 解析出 current_stage 则覆盖 ChangeRead.current_stage 否则保留
  - enrich_summaries 改批量 IN join，从 changes 列表收集 workspace_id 与 change_name 集合一次 select 查询禁逐行，构建 change_name 到 current_stage 映射逐条覆盖 ChangeSummary.current_stage
  - 抽取 latest_progress 内 changes 数组首元素 current_stage 字段为独立解析方法，结构缺失或类型异常一律回退现有值不抛
  - 全程不写 changes 表，status 字段维持 model_validate 派生不从同步层读
acceptance:
  - enrich_summaries 对 N 条 change 仅发一次 IN 查询非 N 次，单测可断言 SQL 次数
  - enrich_with_workspace_ids 命中 platform_change_progress 行时 current_stage 被工具上行值覆盖，未命中时保留 Change 现有 current_stage
  - enrich 全程不修改 Change ORM 行也不写库，status 字段前后相等
  - latest_progress 缺 changes 键或类型异常时 enrich 不崩回退现有值
verify:
  - cd backend && uv run pytest tests/modules/change -q
  - cd backend && uv run ruff format --check app/modules/change/service.py && uv run ruff check app/modules/change/service.py
  - cd backend && uv run mypy app/modules/change/service.py
constraints:
  - read-only join 禁写 changes 表（D-002），仅覆盖展示 DTO 的 current_stage 字段
  - enrich_summaries 批量 IN join 禁 N+1（R-03），workspace_id 取自 changes 列表且 list 端点已 workspace 作用域，同名异 workspace 不串值
  - 仅投 current_stage 不投 status（D-004@v2），status 维持现有派生
  - join 不命中 fallback 现有值不崩（D-003），含工具未上行 quick-uuid8 与 workspace_id 为 NULL 三种场景均回退
  - 新建 change/tests/conftest.py 参照 platform_sync/tests/conftest.py:20-29 模式 import 注册 PlatformChangeProgressORM 表并单独 create（根 conftest db_engine 不含该 model 故根 create_all 不建表），否则 enrich join 抛表不存在
---
