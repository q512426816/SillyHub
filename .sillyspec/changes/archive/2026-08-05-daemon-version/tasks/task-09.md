---
id: task-09
title: backend runtime endpoints version visibility test
title_zh: backend runtime 端点版本可见测试
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on:
  - task-07
  - task-08
blocks:
  - task-10
requirement_ids:
  - FR-01
decision_ids:
  - D-004@v1
allowed_paths:
  - backend/app/modules/daemon/tests/
---

# TaskCard — task-09 backend runtime 端点版本可见测试

> 验证 task-07/08 已让 6 个 runtime 端点的 daemon_version / daemon_build_id 非 null，并覆盖旧 daemon NULL 兼容路径。

## expects_from
- task-07: runtime/service.py 已 JOIN DaemonInstance，list/单读/改/禁/启/下线 service 查询返回带 instance。
- task-08: router.py 6 个 runtime 端点已调 _runtime_read 填充 daemon_version/daemon_build_id。

## goal
> 用例 1：register 上报 version/build_id 后，GET /api/daemon/runtimes + 5 个单 runtime 端点（read/update/disable/enable/offline）返回的 daemon_version / daemon_build_id 非 null。用例 2：旧 daemon（instance.version=None）断言两个字段为 null 且端点不报错（兼容）。

## implementation
- 新增 backend/app/modules/daemon/tests/test_runtime_version_visibility.py。
- 用例 A（fr-01-happy）：参照 test_register_heartbeat_daemon 的 _seed_user + _providers helper 构造已注册 daemon_instance（version=0.1.0, build_id=<sha>-<ts>）+ N 条 runtime；通过 httpx AsyncClient 带 token 调：
  - GET /api/daemon/runtimes（list）断言每行 daemon_version == "0.1.0"、daemon_build_id 非 null。
  - GET /api/daemon/runtimes/{id}（read）、PUT /api/daemon/runtimes/{id}（update）、POST .../disable、.../enable、.../offline 各断言响应 daemon_version/daemon_build_id 非 null。
- 用例 B（legacy-null-compat）：构造 instance.version=None / build_id=None（旧 daemon 不上报），同样调 6 端点，断言 daemon_version is None、daemon_build_id is None，且 HTTP 状态码正常不 500（design §9 + plan 全局验收「旧 daemon 兼容」）。
- helper 风格对齐 test_machines_router.py 的 _create_user / _seed runtime 模式，不新建 conftest。

## 验收标准
- pytest backend/app/modules/daemon/tests/test_runtime_version_visibility.py 全绿。
- 既有 daemon 测试套（test_register_heartbeat_daemon / test_machines_router / test_runtime_admin_management）不回归。

## verify
- pnpm --filter backend test -- -k runtime_version_visibility（或对应 pytest 命令）通过。
- 对照 design §5.B + §9 兼容策略逐条核对断言覆盖。

## constraints
- 禁止改非 tests/ 下源码（allowed_paths 仅 tests/）；若发现 task-07/08 缺陷，回写 task-07/08 修，不在本 task 改源码。
- 测试数据可用 SQLite in-memory，行为对齐生产 PG（不绑死方言）。
- 不修改既有测试以「凑通过」。
