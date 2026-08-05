---
id: task-05
title: runtime/service + facade service + router 透传写 instance.started_at
title_zh: service 链（runtime+facade）写 started_at + endpoint 透传
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/router.py
provides: []
expects_from:
  task-03:
    - contract: DaemonInstance
      needs: [started_at]
  task-04:
    - contract: DaemonRegisterRequest
      needs: [started_at]
    - contract: DaemonHeartbeatRequest
      needs: [started_at]
goal: >
  endpoint 把上报的 started_at 经 facade DaemonService 透传到 RuntimeService，
  RuntimeService 写 instance.started_at（register 写 + heartbeat 幂等覆盖恒定值）。
  execute 符号影响面检查发现 facade service.py 是 router→runtime 中间转发层，必须同步透传。
implementation:
  - runtime/service.py RuntimeService.register_daemon 签名加 started_at 可选参数（仿 daemon_version 位置），方法体内 instance 新建分支与 else 分支均写 instance.started_at（找写 instance.version 处追加）
  - runtime/service.py RuntimeService.heartbeat_daemon 签名加 started_at 可选参数，方法体内仿 daemon_version 非空判断写 instance.started_at（幂等覆盖同值无副作用，D-001@v1）
  - facade service.py DaemonService.register_daemon 签名加 started_at 可选参数，转发 self._rt.register_daemon 处透传 started_at=started_at
  - facade service.py DaemonService.heartbeat_daemon 签名加 started_at 可选参数，转发 self._rt.heartbeat_daemon 处透传 started_at=started_at
  - router.py register_daemon endpoint 调 svc.register_daemon（facade DaemonService）处加 started_at=data.started_at 透传
  - router.py daemon_heartbeat endpoint 调 svc.heartbeat_daemon（facade DaemonService）处加 started_at=data.started_at 透传
acceptance:
  - RuntimeService.register_daemon/heartbeat_daemon 接收 started_at 并写 instance.started_at（new/else 两分支 + 幂等覆盖）
  - facade DaemonService.register_daemon/heartbeat_daemon 透传 started_at 到 self._rt
  - register 与 heartbeat endpoint 透传 started_at=data.started_at 到 facade
  - heartbeat 幂等覆盖恒定值无副作用（D-001@v1）
  - register 后 instance.started_at 等于上报值
  - ruff/mypy 通过
verify:
  - cd backend && ruff check app/modules/daemon
  - cd backend && mypy app/modules/daemon
constraints:
  - started_at 可空，None 不写或写 None，兼容旧 daemon（不上报则保持 NULL）
  - heartbeat 幂等覆盖同值无副作用（D-001@v1）
  - 三层透传链 router endpoint → facade DaemonService → runtime RuntimeService 必须全通，任一层漏透传则 started_at 断链
  - 不改 DTO 定义（task-04 已做），不改 model/migration（task-03 已做）
  - 不动 daemon 生命周期（register/heartbeat/session/lease/state 不变）
---
