---
author: WhaleFall
created_at: 2026-07-06 11:31:58
change: 2026-07-06-allowed-roots-per-runtime
stage: requirements
---

# Requirements: allowed_roots per-runtime 隔离

## 角色

| 角色 | 权限 |
|---|---|
| 平台管理员（admin） | 配置任意 runtime 的可写目录（PUT /runtimes/{rid}/allowed-roots） |
| daemon | 上报机器级 allowed_roots（作 default）；持有 per-runtime PolicyCache |

## 功能需求

### FR-01 per-runtime 持久化
DaemonRuntime 表加 allowed_roots 列（JSON list），每个 runtime 独立持久化。
- Given CC runtime 和 Hermes runtime 绑定同一 instance
- When admin PUT CC 的 allowed_roots=['D:/proj']
- Then DB daemon_runtimes 中 CC 行 allowed_roots=['D:/proj']，Hermes 行不变

### FR-02 机器级 default 保留 + 新注册继承
DaemonInstance.allowed_roots 保留（daemon 上报）。新 runtime 注册时 copy instance.default → runtime.allowed_roots。
- Given daemon 本机 config.allowed_roots=['~/.sillyhub', 'D:/']
- When 新 provider runtime 首次注册
- Then runtime.allowed_roots 初始 = ['~/.sillyhub', 'D:/']（copy instance.default）

### FR-03 独立演化（daemon 重配不覆盖）
- Given CC runtime 已独立配 allowed_roots=['D:/cc']
- When daemon 本机重配 instance.default=['E:/']
- Then CC.allowed_roots 仍是 ['D:/cc']（不覆盖）；只新注册的 runtime 继承 ['E:/']

### FR-04 per-runtime 下发（WS）
- Given CC/Hermes 同 daemon
- When admin PUT CC allowed_roots
- Then WS POLICY_UPDATE 仅 push CC 的（payload_runtime_id=CC_rid）；daemon PolicyCache 仅 CC_rid 变，Hermes_rid 不变

### FR-05 心跳 per-runtime 兜底
心跳响应返 per-runtime allowed_roots map（runtimes: [{runtime_id, allowed_roots}]），daemon _syncAllowedRoots per-runtime 同步。

### FR-06 空 allowed_roots fail-closed
runtime.allowed_roots=[] → 写拦截 fail-closed deny（ql-008 保持）。

### FR-07 register 响应初始化 PolicyCache
DaemonRegisterResponse.runtimes 项带 allowed_roots，daemon 注册即 PolicyCache.set，消除首次写 fail-closed 窗口。

## 非功能需求

- 兼容 Windows/Linux/macOS（路径处理复用现有 path-utils）
- schema breaking：心跳响应改 map + register 响应加字段，backend+daemon 同步部署（D-006 / daemon-entity-binding D-007 机制）
- 数据迁移：copy instance→runtime，项目允许重置测试数据

## 决策覆盖

| 决策 | 覆盖 FR |
|---|---|
| D-001 机器级 default 保留 | FR-02 |
| D-002 runtime 独立演化 | FR-01, FR-03, FR-04 |
| D-003 新注册 copy default | FR-02 |
| D-004 daemon 重配不覆盖 | FR-03 |
| D-005 空 fail-closed | FR-06 |
| D-006 schema breaking 同步部署 | NFR |
