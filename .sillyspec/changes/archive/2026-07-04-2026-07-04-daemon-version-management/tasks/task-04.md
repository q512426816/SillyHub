---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-04
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
---

# task-04: backend service 写入版本

## 所属 Wave
Wave 1

## 文件
- 修改 `backend/app/modules/daemon/runtime/service.py`：`register_daemon`（L153-272）与 `heartbeat_daemon`（L324+）upsert `DaemonInstance` 时写入 `version` + `build_id`（来自 schema 接收值）

## 验收标准
- [ ] register_daemon upsert 时写 instance.version/build_id
- [ ] heartbeat_daemon 刷新时写 instance.version/build_id
- [ ] 上报值为 None 时保持 NULL（不报错）
- [ ] 现有 service 测试不回归

## 依赖
- task-01（model 列存在）
- task-03（schema 接收字段）

## 覆盖
- FR-03, D-003@V1

## 风险防范
- 仅在 daemon_instances 实体级 upsert 写入，不误写 daemon_runtimes（runtime.version 是 provider 版本，语义不同）
- 参见 memory: backend 测试 SQLite vs PG（date_trunc 等方言，本任务不涉及但需注意）
