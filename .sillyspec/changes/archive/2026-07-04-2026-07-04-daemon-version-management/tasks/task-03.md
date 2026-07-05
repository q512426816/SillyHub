---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-03
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
---

# task-03: backend schema 接收版本

## 所属 Wave
Wave 1

## 文件
- 修改 `backend/app/modules/daemon/schema.py`：`DaemonRegisterRequest`（L70-87）加 `daemon_version: str | None = None` + `daemon_build_id: str | None = None`
- 修改 `backend/app/modules/daemon/router.py`：`DaemonHeartbeatRequest`（**生效版 L152**，非 schema.py L216 旧残留）加两 Optional 字段；schema.py 旧残留同步加字段或注释标注废弃

## 验收标准
- [ ] DaemonRegisterRequest 含 daemon_version/daemon_build_id（Optional）
- [ ] router.py:152 DaemonHeartbeatRequest（生效版）含两 Optional 字段
- [ ] 旧 daemon 不带字段时 pydantic 不报错（422 不触发）
- [ ] 现有 test_router 不回归

## 依赖
- task-01（model 列存在，service 才能写）

## 覆盖
- FR-01, FR-02, D-008@V1

## 风险防范
- R-01（DaemonHeartbeatRequest 命名冲突）：版本字段必须加到 router.py:152 生效版，schema.py L216 是旧残留不生效
- 参见 memory: 改 router 跑 test_router
