---
author: qinyi
created_at: 2026-07-04 17:35:00
plan_level: full
---

# 计划：daemon 版本可见 + 远程升级入口

## 来源
brainstorm 四件套（proposal/design/requirements/tasks + decisions D-001~D-009@V1 + prototype）。design §5 已分 3 Wave，本计划细化任务依赖与完成标准。task 编号与 `tasks/task-01~11.md` TaskCard 一一对应。

## 范围
- 14 文件，跨 3 模块（backend daemon module / sillyhub-daemon / frontend runtimes）
- schema 变更：daemon_instances 新增 build_id 列（migration down=b16bf63a5d05）
- 复用现有 self-update 后端链路，仅补版本上报 4 处断点 + 前端入口

## Wave 分组与依赖

依赖图：`Wave 1（数据通路）→ Wave 2（读侧+latest）→ Wave 3（前端）→ Wave 4（端到端）`

Wave 1 内 backend 列（task-01）最先，daemon 侧（task-02/05）可与 backend 并行。

---

### Wave 1：daemon 上报 + backend 持久化（数据通路）

- [x] task-01: backend model + migration（build_id 列）
  - 文件：`backend/app/modules/daemon/model.py`、新增 `backend/migrations/versions/<rev>_daemon_instance_build_id.py`
  - 覆盖：FR-03, D-003@V1；防范：R-02（alembic 单 head）
  - 无依赖（Wave 1 起点）

- [x] task-02: daemon 上报版本字段
  - 文件：`sillyhub-daemon/src/hub-client.ts`
  - 覆盖：FR-01, FR-02, D-001@V1, D-002@V1
  - 与 task-01 并行

- [x] task-03: backend schema 接收版本
  - 文件：`backend/app/modules/daemon/schema.py`、`backend/app/modules/daemon/router.py`（DaemonHeartbeatRequest 生效版 L152）
  - 覆盖：FR-01, FR-02, D-008@V1；防范：R-01（命名冲突加生效版）
  - 依赖：task-01

- [x] task-04: backend service 写入版本
  - 文件：`backend/app/modules/daemon/runtime/service.py`
  - 覆盖：FR-03, D-003@V1
  - 依赖：task-01, task-03

- [x] task-05: daemon 上报测试
  - 文件：`sillyhub-daemon/src/__tests__/hub-client.test.ts`
  - 覆盖：FR-01, FR-02, D-001@V1
  - 依赖：task-02

---

### Wave 2：backend 读侧 + latest 分发

- [x] task-06: backend DTO 返回版本
  - 文件：`backend/app/modules/daemon/schema.py`、`runtime/service.py`（JOIN 带出）
  - 覆盖：FR-04, D-005@V1
  - 依赖：Wave 1

- [x] task-07: backend GET /version 扩展
  - 文件：`backend/app/modules/daemon/router.py`（_compute 双提取 + get_daemon_latest_semver，**get_daemon_latest_version 不变**）
  - 覆盖：FR-05, D-004@V1, D-009@V1；防范：D-009/R-07
  - 依赖：Wave 1

---

### Wave 3：前端展示 + 升级入口

- [x] task-08: 前端类型重生成 + 升级 hook
  - 文件：`frontend/src/lib/api-types.ts`（OpenAPI 重生成）、`frontend/src/lib/daemon.ts`
  - 覆盖：FR-06, FR-07, D-005@V1；防范：R-05
  - 依赖：Wave 2

- [x] task-09: 前端 runtimes 页版本展示 + 升级按钮
  - 文件：`frontend/src/app/(dashboard)/runtimes/page.tsx`
  - 覆盖：FR-06, FR-07, FR-08, D-005@V1, D-006@V1
  - 依赖：task-08

- [x] task-10: 前端测试
  - 文件：`frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx`
  - 覆盖：FR-06, FR-07, FR-08, D-006@V1
  - 依赖：task-09

---

### Wave 4：端到端 + 兼容回归

- [x] task-11: 端到端 + 兼容回归（含 backend service/router/migration 测试）
  - 文件：`backend/tests/modules/daemon/test_service.py`、`test_router.py`、新增 `test_migration_build_id.py` + 手动端到端
  - 覆盖：全 FR, D-008@V1
  - 依赖：Wave 1-3
  - 注意：改 router 必跑 test_router（memory: backend-router-change-run-router-tests）

---

## 验收

- AC-01: daemon register/heartbeat 后 daemon_instances.version/build_id 非 NULL（release 构建）— task-04
- AC-02: GET /api/daemon/version 返回 latest_version + latest_build_id，旧字段保留 — task-07
- AC-03: GET /runtimes/page + /instances 返回 daemon 版本 — task-06
- AC-04: 前端 runtime 行显示版本 + 徽标正确（最新/可升级/未知/dev）— task-09/10
- AC-05: 升级按钮调 self-update，toast 提示，offline 禁用 — task-09/10
- AC-06: 旧 daemon 不上报不报错，前端显示「未知」— task-11
- AC-07: self-update 端点 get_daemon_latest_version 仍返回 SHA，preflight 比对正常 — task-07
- AC-08: 三子项目测试全绿零回归 — task-11

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1 | task-02, task-05 | AC-01 |
| D-002@V1 | task-02, task-05 | AC-01 |
| D-003@V1 | task-01, task-04 | AC-01 |
| D-004@V1 | task-07 | AC-02 |
| D-005@V1 | task-06, task-08, task-09 | AC-03, AC-04, AC-05 |
| D-006@V1 | task-09, task-10 | AC-05 |
| D-007@V1 | task-08, task-09 | AC-05 |
| D-008@V1 | task-03, task-11 | AC-06 |
| D-009@V1 | task-07 | AC-02, AC-07 |

## 自检

| 检查项 | 结果 |
|---|---|
| task id 连续（task-01~11） | ✅ 与 TaskCard 一一对应，无跳号 |
| 任务粒度均匀 | ✅ 每 task 1-3 文件 |
| 依赖明确 | ✅ Wave 1→2→3→4，task-01 先；并行点标注（task-02‖task-01） |
| 完成标准可验 | ✅ AC-01~08 |
| decisions 全覆盖 | ✅ D-001~D-009 全在覆盖矩阵 |
| FR 全覆盖 | ✅ FR-01~FR-09 |
| 风险防范 | ✅ R-01（task-03）、R-02（task-01）、R-05（task-08）、D-009/R-07（task-07） |
| checkbox 格式 | ✅ `- [x] task-XX:` |
| 无 P0/P1 unresolved | ✅ decisions 全 accepted |
