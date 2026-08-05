---
id: task-04
title: daemon backend schema/router add started_at field
title_zh: 后端 schema/router 加 started_at 字段
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
provides:
  - contract: DaemonRegisterRequest
    fields: [started_at]
  - contract: DaemonHeartbeatRequest
    fields: [started_at]
  - contract: DaemonMachineRead
    fields: [started_at]
expects_from:
  task-03:
    - contract: DaemonInstance
      needs: [started_at]
goal: >
  后端 schema/router 加 started_at 字段，machines 端点经 instance JOIN
  在 DaemonMachineRead 返回（runtime 级不加，YAGNI）。
implementation:
  - schema.py DaemonRegisterRequest（约 :112）加 started_at（datetime | None，Optional，仿 daemon_version 写法）
  - schema.py DaemonMachineRead（约 :283）加 started_at（datetime | None，仿 last_heartbeat_at/version 字段写法）
  - router.py DaemonHeartbeatRequest（约 :203）加 started_at（datetime | None，仿 daemon_version 写法）
  - router.py _build_machine_read（约 :466-502）填 started_at=instance.started_at（仿 version=instance.version / build_id=instance.build_id 填充模式，instance None 则 None）
  - _runtime_read 不加 started_at（DaemonRuntimeRead 不加，§3 YAGNI）
acceptance:
  - DaemonRegisterRequest / DaemonHeartbeatRequest / DaemonMachineRead 含 started_at 可选字段
  - _build_machine_read 从 instance JOIN 填 started_at（instance None 则 None）
  - _runtime_read 与 DaemonRuntimeRead 不含 started_at
  - OpenAPI schema 反映新字段
  - ruff / mypy 通过
verify:
  - cd backend && ruff check app/modules/daemon
  - cd backend && mypy app/modules/daemon
constraints:
  - started_at 全部 Optional/nullable（旧 daemon 不上报则 None，向后兼容）
  - 不改端点路径 / 方法 / response_model 结构（仅加字段，向后兼容）
  - _runtime_read 与 DaemonRuntimeRead 不加 started_at（runtime 级不展示，§3 YAGNI）
  - machines 响应仅加字段，不动其它行
  - endpoint（register_daemon/daemon_heartbeat）调 service 的 started_at 透传不在本 task，由 task-05 统一改 service 签名加透传（避免本 task 完成时 mypy 报 service 缺 started_at 参数）
---
