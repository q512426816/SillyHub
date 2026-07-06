---
author: WhaleFall
created_at: 2026-07-06 11:31:58
change: 2026-07-06-allowed-roots-per-runtime
stage: tasks
---

# Tasks: allowed_roots per-runtime 隔离

> 细节在 plan 阶段展开。这里只列任务名称、文件、覆盖 FR/决策。

- [x] task-01 数据模型 + 迁移：DaemonRuntime 加 allowed_roots 列 + copy instance→runtime 迁移（model.py + migrations/）— FR-01, D-002
- [x] task-02 register copy default + 响应带 allowed_roots：register_daemon 新建 runtime copy instance.default；DaemonRegisterResponse.runtimes 加 allowed_roots（runtime/service.py + schema.py）— FR-02, FR-07, D-003
- [x] task-03 update_allowed_roots 写 runtime 级：service 改写 runtime.allowed_roots（不写 instance）（runtime/service.py）— FR-01, D-002
- [x] task-04 _runtime_read 读 runtime 级 + 回退 ql-003：读 runtime.allowed_roots，删 instance 兜底填充（router.py）— FR-01
- [x] task-05 心跳响应改 per-runtime map：DaemonHeartbeatResponse.runtimes + 端点返 per-runtime（router.py + schema.py）— FR-05
- [x] task-06 WS push roots 来源改 runtime：PUT 后 send_policy_update 用 runtime.allowed_roots（router.py）— FR-04
- [x] task-07 daemon _syncAllowedRoots per-runtime：从 hbResp.runtimes map 同步 PolicyCache.set + 兼容旧单值 + register 响应初始化 PolicyCache（daemon.ts）— FR-05, FR-07
- [x] task-08 backend 测试：register copy default / update 写 runtime / 心跳 map / _runtime_read 读 runtime / 空 fail-closed（backend/app/modules/daemon/tests/）— FR-01~FR-07
- [x] task-09 daemon 测试：_syncAllowedRoots per-runtime / register 初始化 PolicyCache（sillyhub-daemon/tests/）— FR-05, FR-07
- [ ] task-10 端到端验证：配 CC Hermes 不变 + 删 CC Hermes 不变 + 新注册继承 default + WS sub-second（真机）— 全 FR
