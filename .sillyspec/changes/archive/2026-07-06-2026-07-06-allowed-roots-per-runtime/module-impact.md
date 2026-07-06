---
author: WhaleFall
created_at: 2026-07-06 14:35:00
change: 2026-07-06-allowed-roots-per-runtime
stage: archive
---

# Module Impact: allowed_roots per-runtime 隔离恢复

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend/daemon | 逻辑变更 | model.py, router.py, schema.py, runtime/service.py, runtime/tests/ | DaemonRuntime 加回 allowed_roots 列。register copy instance.default；update_allowed_roots 写 runtime 级（不写 instance）。_runtime_read 读 runtime 级。heartbeat 响应改 per-runtime runtimes[] map。WS push roots 来源改 runtime 级。register 响应带 runtime.allowed_roots。 | no |
| backend/daemon/runtime | 逻辑变更 | runtime/service.py | register_daemon 新建 runtime copy instance.default（已存在不覆盖）。update_allowed_roots 读写 runtime.allowed_roots 而非 instance。 | no |
| backend/daemon/migration | 新增 | migrations/versions/20260706_runtime_allowed_roots.py | 加列 + copy instance→runtime 一次性迁移。 | no |
| daemon | 逻辑变更 | daemon.ts | _syncAllowedRoots per-runtime（从 hbResp.runtimes map 同步 PolicyCache.set，兼容旧单值）。register 响应初始化 PolicyCache（关闭首次写 fail-closed 窗口）。 | no |
| backend/daemon/schema | 接口变更 | schema.py | DaemonHeartbeatResponse.runtimes map + DaemonRegisterRuntimeItem.allowed_roots + DaemonRuntimeRead field_validator（None→[]） | no |
| backend/daemon/tests | 新增 | tests/ | register copy default / update 写 runtime / 心跳 map / _runtime_read 读 runtime / 空 fail-closed 测试 | no |
| daemon/tests | 新增 | shoft tests/ | _syncAllowedRoots per-runtime / register 初始化 PolicyCache 测试 | no |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| .sillyspec/** | 规范文档/quicklog，非业务代码 |
