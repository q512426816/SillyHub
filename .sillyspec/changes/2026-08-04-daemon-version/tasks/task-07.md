---
id: task-07
title: "Daemon runtime service JOIN DaemonInstance (6 sites)"
title_zh: "daemon runtime service 6 处 JOIN DaemonInstance（含 version/build_id）"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on: []
blocks:
  - task-08
requirement_ids:
  - FR-01
decision_ids:
  - D-004@v1
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
related_tests:
  - backend/tests/modules/daemon/test_runtime_service.py
  - backend/tests/modules/daemon/test_runtime_router.py
provides:
  - contract: RuntimeWithInstance
    fields:
      - runtime
      - daemon_instance
    consumer: task-08
goal: >
  让 daemon runtime service 的 6 个查询/读取方法统一 JOIN DaemonInstance，
  返回 (runtime, instance) tuple，使上层（task-08 序列化层）能直接拿到
  version / build_id 而无需二次查询；schema 不变（FK 已存在），向后兼容
  instance=None（迁移期 daemon_instance_id 可空）。
implementation: |
  照搬 list_runtimes_page（service.py:522-536）的 JOIN 先例：
    select(DaemonRuntime, DaemonInstance)
      .outerjoin(DaemonInstance, DaemonRuntime.daemon_instance_id == DaemonInstance.id)
  覆盖以下 6 处方法（统一改返回 tuple）：
    1. get_runtime（:400-413）            -> (runtime, instance) | None
    2. list_runtimes（:415-422）           -> list[tuple[DaemonRuntime, DaemonInstance | None]]
    3. _get_runtimes_by_instance（:424-431） -> list[tuple[...]]
    4. _get_runtimes_by_instances（:433-454） -> dict[instance_id, list[tuple[...]]]
    5. list_runtimes_page（:473-536）      -> 已是 tuple，补 instance 列（已有，确认含 version/build_id）
    6. update_runtime / 单 runtime 写后回读 -> 回读时一并 JOIN 返回 instance
  约束：
    - outerjoin 保留迁移期 instance=None；不引入 inner join 以免漏旧行。
    - 不改 ORM schema（DaemonRuntime.daemon_instance_id FK 已在 model.py:136-143）。
    - version / build_id 字段已存在于 DaemonInstance（model.py:64-67 / 71-74），无需新增列。
    - 调用方（router / WS / lease）若解构老返回值需同步调整，列入 verify 检查。
acceptance: |
  - 6 处方法均返回 (runtime, instance) tuple，instance 可为 None。
  - list_runtimes_page 返回元组第二/三位语义不变（owner, instance 顺序保留）。
  - 既有调用方未因签名变化崩（router/WS/lease 已同步解构）。
  - 无新增 schema / 迁移文件。
verify: |
  - 跑 daemon runtime 相关单测：pytest backend/tests/modules/daemon/test_runtime_service.py
  - 跑 router 层：pytest backend/tests/modules/daemon/test_runtime_router.py
  - grep 全仓 DaemonRuntimeService 调用点，确认解构签名一致。
  - 校验 outerjoin 后 instance.version / build_id 在序列化样例中可见。
constraints: |
  - 仅改 service.py；schema / migration / router 实现归 task-08。
  - Windows / Linux / macOS 行为一致（纯 ORM 查询，无平台相关代码）。
  - instance=None 必须向后兼容（迁移期 daemon_instance_id 仍可空）。
---

# task-07 — daemon runtime service JOIN DaemonInstance

## 依据
- design.md §5.B（runtime ↔ instance 绑定与 JOIN 策略）、§8 数据模型。
- plan.md 任务总表 task-07 行（6 处 JOIN，覆盖 FR-01 / D-004@v1）。
- 先例代码：service.py:522-536 `list_runtimes_page` 已用
  `outerjoin(DaemonInstance, DaemonRuntime.daemon_instance_id == DaemonInstance.id)`，
  本 task 把同样模式铺到其余 5 处。
- model.py:136-143 `DaemonRuntime.daemon_instance_id` FK 已存在；
  model.py:64-67/71-74 `DaemonInstance.version` / `build_id` 已存在。

## 范围（6 处）
1. `get_runtime` — 单 runtime 读，附 instance。
2. `list_runtimes` — 用户级列表，每行带 instance。
3. `_get_runtimes_by_instance` — 按 instance 反查 runtimes（仍 JOIN，便于上层复用）。
4. `_get_runtimes_by_instances` — 批量版，分组值改 tuple。
5. `list_runtimes_page` — 已是 tuple，核对 instance 列存在且含 version/build_id。
6. `update_runtime` 写后回读路径 — 回读时一并 JOIN instance。

## 向后兼容
- 全部 `outerjoin`，迁移期 `daemon_instance_id IS NULL` 的旧行返回 instance=None。
- 返回签名由 `DaemonRuntime` 改为 `tuple[DaemonRuntime, DaemonInstance | None]`；
  调用方解构点（router / WS / lease）需同步——列入 verify。
