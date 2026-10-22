---
author: flow-machine-draft
created_at: 2026-10-21T12:57:03.654Z
---
# 任务注册表（Tasks）— 2026-10-21-spec-manifest-incremental

- [x] task-01: 模型加 landing_version 列与 (workspace_id, landing_version) 索引 + alembic 迁移 20261021130000（upgrade/downgrade 对称、存量不回填）——跑 alembic upgrade/downgrade/upgrade 验证幂等
- [x] task-02: spec_workspace/service.py 三写点盖章（apply_ops 各分支 / _write_spec_root 对齐 / soft_delete_change_dir）+ rename 旧行硬删改软删、移除 pending_deletes——单测验证 rename 后旧行 exists=false 且印章=新 spec_version
- [x] task-03: get_manifest(since=None) 增量过滤 + platform_sync service/router/schema 透传 since 与顶层 spec_version——无 since 全量回归 + 带过滤路径单测
- [x] task-04: test_spec_sync.py 新增用例（增量主路径/无变化空响应/NULL 行排除/since 非法 422/rename 墓碑可见/apply_ops 后恰含变化行）+ soft_delete_change_dir 印章断言——模块测试全绿
- [x] task-05: spec_workspace + platform_sync 两模块既有测试全量回归零红（rename 波及断言按新语义修正）——pytest 两模块通过
