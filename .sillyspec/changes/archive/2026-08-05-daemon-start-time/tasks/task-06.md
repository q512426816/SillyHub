---
id: task-06
title: Backend tests for daemon started_at end-to-end + migration reversibility
title_zh: 后端测试 started_at 上报→machines 返回链路 + 旧 daemon None 兼容 + migration 可逆
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_register_heartbeat_daemon.py
  - backend/app/modules/daemon/tests/test_machines_router.py
  - backend/app/modules/daemon/tests/test_daemon_started_at.py
provides: []
expects_from:
  task-04:
    - contract: DaemonMachineRead
      needs: [started_at]
goal: >
  验证 started_at 从 register/heartbeat 上报 → daemon_instances 存储 →
  GET /api/daemon/machines 返回的完整链路 + 旧 daemon None 兼容 + migration 可逆。
implementation:
  - 扩展 test_register_heartbeat_daemon.py 加用例：register 传 started_at 后 instance.started_at 等于上报值；heartbeat 传 started_at 幂等覆盖同值不漂移；register/heartbeat 不传 started_at（旧 daemon）instance.started_at 为 None
  - 扩展 test_machines_router.py 加用例：register 带 started_at 后 GET machines 返回非 null 等于上报值；旧 daemon（不上报）machines 返回 None
  - 新建 test_daemon_started_at.py 加 migration 用例：upgrade head 后 daemon_instances.started_at 列存在，downgrade -1 后列消失，再 upgrade head 恢复
  - gen:types 暴露旧 mock 缺 started_at 字段则顺手补（CLAUDE.md 规则 20 惯例）
acceptance:
  - register 带 started_at 时 GET machines 返回非 null 等于上报值
  - heartbeat 幂等覆盖后 machines 仍返回该 started_at（恒定值无副作用）
  - 旧 daemon（不上报）machines 返回 None
  - migration upgrade head 后列存在，downgrade -1 后列消失，再 upgrade head 恢复
  - 全部测试通过
verify:
  - cd backend && pytest app/modules/daemon -k "started_at or machine or register or heartbeat"
  - cd backend && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
constraints:
  - 单测用 SQLite（aiosqlite in-memory），断言不绑死 PG 方言函数名
  - SQLite 与 PG datetime 方言差异注意（按 ISO 字符串或 datetime 对象一致比较）
  - migration 测试用 alembic 子进程命令或查 inspector 列结构
  - 不改被测源码（仅加测试），扩展现有测试文件优先，migration 用例可独立新建文件
  - 不改 daemon 生命周期 / daemon_runtimes 表 / DaemonRuntimeRead（design §3 非目标边界）
---
