---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-06
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/runtime/service.py
---

# task-06: backend DTO 返回版本

## 所属 Wave
Wave 2（读侧）

## 文件
- 修改 `backend/app/modules/daemon/schema.py`：
  - `DaemonRuntimeRead`（L120-150）加 `daemon_version: str | None = None` + `daemon_build_id: str | None = None`
  - `DaemonInstanceRead`（L198-210）加 `version: str | None = None` + `build_id: str | None = None`
- 修改 `backend/app/modules/daemon/runtime/service.py`：runtime 列表查询 JOIN `daemon_instances` 带出 version/build_id；instance 列表查询带出 version/build_id

## 验收标准
- [ ] GET /api/daemon/runtimes/page 每行含 daemon_version/daemon_build_id
- [ ] GET /api/daemon/instances 每行含 version/build_id
- [ ] 字段为 NULL 时返回 None（旧 daemon 兼容）
- [ ] 现有 DTO 测试不回归

## 依赖
- Wave 1 完成（列存在 + 写入）

## 覆盖
- FR-04, D-005@V1

## 风险防范
- JOIN 性能（runtime 列表已 JOIN daemon_instances for owner/alias，复用即可）
- model_config from_attributes 确保 ORM 映射正确
