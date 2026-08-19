---
author: qinyi
created_at: 2026-08-19T23:05:00
---

# 符号影响面报告（Symbol Impact）

> 「加载上下文」步产物：逐 task 符号级影响扫描结论。修改集中在
> `backend/app/modules/spec_workspace/service.py` 与
> `backend/app/modules/change/service.py`，无对外签名变更。

| task | 触达符号 | 影响面结论 |
|------|----------|-----------|
| task-01 | `_write_spec_root`（service.py:720，私有函数）、新增私有静态 helper `_converge_stale_files` | 无签名级变更对外可见：`_write_spec_root` 为模块内私有协程，仅被 `import_from_repo` / `import_from_repo_sse` / `apply_sync` 三处调用，返回值扩展需同步适配调用点（task-03 范围）。新增 helper 为纯新增符号，零既有引用。 |
| task-02 | `_write_spec_root` 内 manifest 持久段（922-930 全表 DELETE 块）、`SpecFileManifest` ORM 行操作 | 无签名级变更：改动为函数内部逻辑，ORM 模型不动；`SpecFileManifest` 的 exists/version 字段既有（增量路径 apply_ops 已用墓碑语义），无 schema 变化。 |
| task-03 | `import_from_repo_sse` done 事件（478-483）、`apply_sync`、`import_from_repo` 调用点 | SSE 事件加法字段 `converged_files` / `converged_dirs`：SSE 是流文本事件，非 OpenAPI schema 契约，前端不消费新字段不破坏（design §5 已确认）。`_write_spec_root` 返回值扩展只影响三处内部调用点，同批适配。 |
| task-04 | `_progress_reported_active_keys`（change/service.py:1249，私有函数）+ 新常量 `PLACEHOLDER_PROTECT_WINDOW_DAYS` | 无签名级变更：函数签名不变，仅查询后过滤逻辑收窄返回集。调用方 `_reparse_changes` 删除环行为按设计收窄（>7 天占位行可删），正是 FR-03 目标。`PlatformChangeProgressORM.updated_at` 为 tz-aware DateTime（platform_sync/model.py:105），字段既有。 |
| task-05 | 新测试文件 + test_reparse_guard.py 追加 | 纯新增测试，零生产符号影响。 |
| task-06 | 无源码改动（回归验证） | 无。 |

**跨模块符号引用**：无。daemon / CLI / 前端不引用上述私有符号（已 grep 确认
`_write_spec_root`、`_converge_stale_files`、`_progress_reported_active_keys`
仅模块内使用）。

**结论**：全部 6 task 无签名级（对外契约）变更；私有函数内部改造 + 事件加法字段 +
纯新增符号。
