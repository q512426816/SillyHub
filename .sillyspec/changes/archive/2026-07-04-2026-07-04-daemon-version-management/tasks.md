---
author: qinyi
created_at: 2026-07-04 17:29:25
---

# Tasks — daemon 版本可见 + 远程升级入口

任务列表（名称 + 文件路径 + 覆盖 FR/D）。细节（Wave 分组、依赖、步骤）在 plan 阶段展开。

| Task | 名称 | 主要文件 | 覆盖 FR | 覆盖 D |
|---|---|---|---|---|
| task-01 | daemon 上报版本字段 | `sillyhub-daemon/src/hub-client.ts`（RegisterBody/HeartbeatBody + register/heartbeat 实现） | FR-01, FR-02 | D-001, D-002 |
| task-02 | daemon 上报测试 | `sillyhub-daemon/src/__tests__/hub-client.test.ts` | FR-01, FR-02 | D-001 |
| task-03 | backend schema 接收版本 | `backend/app/modules/daemon/schema.py`（DaemonRegisterRequest）、`backend/app/modules/daemon/router.py`（DaemonHeartbeatRequest 生效版 L152） | FR-01, FR-02 | D-008 |
| task-04 | backend model + migration | `backend/app/modules/daemon/model.py`（build_id 列）、`backend/migrations/versions/<rev>_daemon_instance_build_id.py`（down=b16bf63a5d05） | FR-03 | D-003 |
| task-05 | backend service 写入版本 | `backend/app/modules/daemon/runtime/service.py`（register_daemon/heartbeat_daemon upsert 写 version+build_id） | FR-03 | D-003 |
| task-06 | backend DTO 返回版本 | `backend/app/modules/daemon/schema.py`（DaemonRuntimeRead/DaemonInstanceRead 加字段）、`runtime/service.py`（查询 JOIN daemon_instances 带出） | FR-04 | D-005 |
| task-07 | backend GET /version 扩展 | `backend/app/modules/daemon/router.py`（_compute 双提取、get_daemon_latest_semver、DaemonVersionResponse 加 latest_version/latest_build_id） | FR-05 | D-004, D-009 |
| task-08 | backend 测试 | `backend/tests/modules/daemon/test_service.py`、`test_router.py`、新增 `test_migration_build_id.py` | FR-03, FR-04, FR-05 | D-003, D-009 |
| task-09 | 前端类型重生成 + 升级 hook | `frontend/src/lib/api-types.ts`（OpenAPI 重生成）、`frontend/src/lib/daemon.ts`（triggerDaemonSelfUpdate） | FR-06, FR-07 | D-005 |
| task-10 | 前端 runtimes 页版本展示 + 升级按钮 | `frontend/src/app/(dashboard)/runtimes/page.tsx`（版本号+SHA+徽标+升级按钮+toast+offline 禁用） | FR-06, FR-07, FR-08 | D-005, D-006 |
| task-11 | 前端测试 | `frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx` | FR-06, FR-07, FR-08 | D-006 |
| task-12 | 端到端验证 + 兼容回归 | 手动/集成：daemon 注册→版本可见→升级→刷新；旧 daemon 不报错 | 全 FR | D-008 |

## 关键依赖与约束（plan 阶段细化）

- task-04 migration 必须先确认 alembic 单 head（R-02），down_revision 严格 = `b16bf63a5d05`。
- task-03 heartbeat 字段加到 **router.py:152 生效版**（R-01 命名冲突），schema.py 旧残留同步。
- task-07 get_daemon_latest_version **不变**（D-009，self-update 契约），新增 get_daemon_latest_semver。
- task-09 api-types 重生成基于 task-03~07 完成后的 backend openapi.json。
- task-10 升级按钮按 RUNTIME_ADMIN 权限 + runtime online 状态渲染。
