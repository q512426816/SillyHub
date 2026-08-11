---
id: task-06
title: PlatformSyncService 三方法加 workspace_id 过滤与 upsert 复合键
title_zh: 收件箱 service 层 workspace 隔离
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-02, task-05]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
provides:
  - contract: upsert_progress
    fields: [workspace_id, change_name]
  - contract: list_lightweight
    fields: [workspace_id]
  - contract: get_progress
    fields: [workspace_id, change_name]
expects_from:
  task-02:
    - contract: PlatformChangeProgressORM
      needs: [workspace_id, change_name]
  task-05:
    - contract: require_platform_sync
      needs: [user, workspace_id]
goal: >
  upsert/list/get 三方法加 workspace_id 参数并按其过滤，upsert 读写键改复合
  (workspace_id, change_name)，实现收件箱 workspace 隔离（设计 §6/§7 P3）。
implementation:
  - upsert_progress 首位加 workspace_id 参数，按复合键取行读写，_apply 构造与重查行均带上，并发自愈 IntegrityError 回退保留
  - 取行一律用复合主键，workspace_id 为 None 时用 is_(None) 过滤而非等号比较
  - list_lightweight 与 get_progress 各加 workspace_id 参数，列表按值过滤、详情按复合键取行
acceptance:
  - 落库行带 workspace_id，复合键可被 get_progress 命中
  - workspace A 数据不进 workspace B 的列表与详情，跨 workspace 同名 get 返 None 走 404
  - workspace_id 为 None 时行为与旧版等价，shk_live_ 过渡路径可写可读
  - base_ts 冲突算法与返回形态不变，仅作用域收窄；并发自愈在复合键下仍正确
verify:
  - cd backend 后跑 uv run ruff format --check app/modules/platform_sync 与 uv run ruff check app/modules/platform_sync 及 uv run mypy app/modules/platform_sync/service.py；隔离行为由 task-07/08 用例覆盖
constraints:
  - workspace_id 由 router 从 require_platform_sync 派生注入，service 内不猜测，禁止跨 workspace 读写
  - workspace_id 为 None 时用 is_(None) 过滤，shk_live_ 过渡期数据可查、行为与旧版等价
  - 仅改 service.py，router 适配交给 task-07（allowed_paths 已限 scope）
  - base_ts 字典序与不 auto-merge 语义保持，latest_progress 仍裸 dict 透传
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py 的 test_apply_catches_integrity_error_falls_back_to_update 直接调 _apply 并构造 PlatformChangeProgressORM，复合键与 workspace_id 参数变化使其失效，需随签名同步补参
---
