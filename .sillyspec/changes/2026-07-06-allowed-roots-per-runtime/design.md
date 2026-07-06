---
author: WhaleFall
created_at: 2026-07-06T11:28:33
change: 2026-07-06-allowed-roots-per-runtime
stage: design
---

# Design: allowed_roots per-runtime 隔离恢复

## 1. 背景

### 1.1 历史脉络

| 变更 | allowed_roots 粒度 | 关键决策 |
|---|---|---|
| 2026-06-29-runtime-allowed-roots-config | per-runtime（DaemonRuntime.allowed_roots） | 引入 |
| 2026-07-02-daemon-filesystem-policy | per-runtime 隔离（PolicyEngine per-runtime） | D-002 per-runtime 隔离；line 34 批评"取并集违背 per-runtime 隔离意图" |
| 2026-07-03-daemon-entity-binding | **上提到机器级 per-instance**（DaemonInstance.allowed_roots） | D-006 注册/心跳 per-daemon；line 65「机器级沙箱」+ line 76「移除迁移到 daemon_instances」 |

### 1.2 问题

daemon-entity-binding 上提后，同一 daemon 的所有 provider runtime（如 CC `780cae63` + Hermes `23bab2e2` 都绑定 instance `4f24728c`）**共享同一份 allowed_roots**。用户配 CC 的可写目录 → 写 instance → Hermes 跟着变；删除也同步。违背了 daemon-filesystem-policy 的 per-runtime 隔离初衷（D-002），也违背用户期望（"只配 CC，Hermes 别变"）。

## 2. 范围

### 2.1 变更范围

- DaemonRuntime 加回 allowed_roots 列（per-runtime 持久化）
- DaemonInstance.allowed_roots **保留**作机器级 default
- 注册：新 runtime copy instance.default；register/heartbeat 响应返 per-runtime allowed_roots
- backend：update_allowed_roots 写 runtime 级；_runtime_read 读 runtime 级
- daemon：_syncAllowedRoots per-runtime；PolicyCache 已 per-runtime（不变）
- WS push：roots 来源改 runtime 级（payload_runtime_id 已支持）
- 迁移：加列 + copy instance→runtime

### 2.2 不在范围内

- 前端 UI 改动（runtimes 页已是 per-runtime 入口）
- daemon-entity-binding 的 per-daemon 架构（注册/心跳/WS 路由不变）
- PolicyEngine 内部逻辑（已 per-runtime）
- 审计落库（已 per-runtime runtimeId）

## 3. 总体方案

**DaemonRuntime 表加回 allowed_roots 列（per-runtime 持久化），DaemonInstance.allowed_roots 保留作机器级 default**。新 runtime 注册时 copy instance.default 作初始值；admin PUT 写 runtime.allowed_roots（不再写 instance），CC/Hermes 互不影响。WS POLICY_UPDATE（已 per-runtime，payload_runtime_id）下发 runtime 级 allowed_roots；心跳响应改 per-runtime map 兜底；register 响应带 allowed_roots 消除首次写 fail-closed 窗口。daemon PolicyCache 已 per-runtime（task-13 + ql-002），本变更只改其**数据来源**（instance → runtime）。前端无需改（已是 per-runtime 入口）。

否决方案 B（废弃机器级，丢失 daemon 本机配置能力）和方案 C（运行时合并，语义是覆盖非独立演化）。

## 4. 详细设计

### 4.1 数据模型

#### 4.1.1 DaemonRuntime 加回 allowed_roots

```python
# backend/app/modules/daemon/model.py — DaemonRuntime
allowed_roots: list[str] = Field(default_factory=list, sa_column=Column(JSON, default=[]))
```

per-runtime 持久化（恢复 2026-06-29 的列，daemon-entity-binding 曾移除）。

#### 4.1.2 DaemonInstance.allowed_roots 保留

机器级 default（daemon 上报），**不变**。作新 runtime 注册时的初始值来源。

#### 4.1.3 迁移（项目允许重置测试数据）

```python
def upgrade():
    op.add_column('daemon_runtimes', sa.Column('allowed_roots', sa.JSON, nullable=True))
    # copy 当前 instance 值到所有 runtime（继承 default）
    op.execute("""
        UPDATE daemon_runtimes r
        SET allowed_roots = (SELECT allowed_roots FROM daemon_instances i WHERE i.id = r.daemon_instance_id)
    """)
```

### 4.2 backend 改动

#### 4.2.1 register_daemon（runtime/service.py）

upsert runtime 时：
- **新建** runtime：copy `instance.allowed_roots → runtime.allowed_roots`（继承机器级 default）
- **已存在** runtime：不覆盖（保留独立演化值）

#### 4.2.2 update_allowed_roots（service）

改写 `runtime.allowed_roots`（**不再写 instance**）。instance.allowed_roots 仍由 daemon 心跳上报刷新（机器级 default 语义不变）。

#### 4.2.3 _runtime_read（router.py）

读 `runtime.allowed_roots`（**改回 runtime 级**——ql-20260706-003 刚把 instance 填充加进来，本次因 runtime 重新有自己的列而回退；instance 填充行删除）。

#### 4.2.4 heartbeat 响应（router.py + schema.py）

`DaemonHeartbeatResponse` 返回 **per-runtime allowed_roots map**，替代单一 `allowed_roots: list[str]`：

```python
class DaemonHeartbeatRuntimePolicy(BaseModel):
    runtime_id: uuid.UUID
    allowed_roots: list[str]

class DaemonHeartbeatResponse(BaseModel):
    daemon_instance_id: uuid.UUID
    status: str
    runtimes: list[DaemonHeartbeatRuntimePolicy]  # 替代 allowed_roots: list[str]
```

#### 4.2.5 register 响应（消除首次写窗口）

daemon 注册后到首次心跳前，PolicyCache 空 → fail-closed deny 窗口。`DaemonRegisterResponse.runtimes` 项加 `allowed_roots`，daemon 注册成功立即 `PolicyCache.set`：

```python
class DaemonRegisterRuntimeItem(BaseModel):
    provider: str
    runtime_id: uuid.UUID
    allowed_roots: list[str]  # 新增 = runtime.allowed_roots（新建时 = instance.default copy 值）
```

### 4.3 daemon 改动

#### 4.3.1 _syncAllowedRoots（daemon.ts:1783）

改 per-runtime——从心跳响应的 `runtimes` map 同步：

```ts
for (const rt of hbResp.runtimes ?? []) {
  if (rt.runtime_id) this._policyCache.set(rt.runtime_id, rt.allowed_roots);
}
```

兼容旧响应（`hbResp.allowed_roots` 单值 → 同步到所有 runtime，过渡期）。

#### 4.3.2 WS POLICY_UPDATE（不变）

已 per-runtime（task-13 + ql-20260703-002 resolveRuntimeId）。`payload_runtime_id` 标识具体 runtime，`PolicyCache.set(runtimeId, roots)`。

#### 4.3.3 register 响应初始化 PolicyCache

daemon 处理 register 响应时，对 `runtimes[].allowed_roots` 调 `PolicyCache.set(runtime_id, roots)`，消除首次写窗口。

#### 4.3.4 daemon 本机 config.allowed_roots

继续上报作机器级 default（不变）。注册时 backend 据此初始化新 runtime。

### 4.4 WS push（backend ws_hub.py）

PUT 后 `send_policy_update(daemon_id, runtime.allowed_roots, payload_runtime_id=rid)`。已支持（ws_hub.py:174 `payload_runtime_id`），**roots 来源从 instance 改为 runtime 级**。

### 4.5 前端

runtimes 页可写目录编辑已是 per-runtime 入口（用户点具体 runtime 编辑，PUT `/runtimes/{rid}/allowed-roots`）。backend 数据 per-runtime 后**自动对齐，无需前端改**。

### 4.6 数据流（ASCII）

```
[web UI: admin 配 CC 可写目录]
    │ PUT /api/daemon/runtimes/{CC_rid}/allowed-roots  (body: {allowed_roots: [...]})
    ▼
[backend update_allowed_roots]
    写 daemon_runtimes.allowed_roots（仅 CC 行）  ← Hermes 行不动
    │ WS POLICY_UPDATE(daemon_id, CC.allowed_roots, payload_runtime_id=CC_rid)
    ▼
[daemon ws-client] → daemon.handlePolicyUpdate
    PolicyCache.set(CC_rid, CC.allowed_roots)   ← 仅 CC 缓存变
    （Hermes_rid 缓存不动）
    │
    ▼
[CC session write-guard]      canWrite(CC_rid, path) → PolicyCache.get(CC_rid)
[Hermes session write-guard]  canWrite(Hermes_rid, path) → PolicyCache.get(Hermes_rid)  ← 不受 CC 配置影响
```

心跳兜底（R-07）：daemon 心跳响应返 `runtimes: [{CC_rid, CC.roots}, {Hermes_rid, Hermes.roots}]`，daemon `_syncAllowedRoots` per-runtime 同步。

## 5. 决策

| ID | 决策 | 理由 |
|---|---|---|
| D-001 | 机器级 default 保留（instance.allowed_roots） | daemon 本机配置能力不丢；作新 runtime 初始值 |
| D-002 | runtime 独立演化（PUT 写 runtime） | 用户核心诉求：CC/Hermes 互不影响 |
| D-003 | 新 runtime 注册 copy instance.default | 新 agent 有合理初始值，无需手配 |
| D-004 | daemon 本机重配不覆盖已演化 runtime | 独立演化保证；只影响新注册 |
| D-005 | 空 allowed_roots fail-closed deny | ql-008 行为保持，安全优先 |
| D-006 | schema breaking 同步部署（心跳 map + register 加字段） | daemon-entity-binding D-007 机制；项目未上线允许同步重启 |

## 6. 验收

1. 配 CC 可写目录 → Hermes `runtime.allowed_roots` 不变（DB + 审计页验证）
2. 删 CC 某目录 → Hermes 不变
3. 新 daemon 注册 → runtime 继承 instance default
4. WS sub-second 下发 per-runtime（配 CC 秒级生效，Hermes PolicyCache 不受影响）
5. 审计页 per-runtime 记录（CC 的 ALLOW/DENY 按其独立配置）
6. 心跳后 PolicyCache 各 runtime 独立同步

## 7. 风险登记

- **WS breaking（心跳响应格式变）**：新 backend 响应改 map（`runtimes`），旧 daemon 期望单值 `allowed_roots`。需 backend + daemon 同步部署（D-006 / daemon-entity-binding D-007 已建立 breaking 机制）。项目未上线，允许同步重启。
- **迁移**：copy instance→runtime 一次性，项目可重置测试数据。
- **ql-003 回退**：ql-20260706-003 给 `_runtime_read` 加的 instance.allowed_roots 填充，本次因 runtime 重新有列而回退（读 runtime 级）。instance 填充逻辑删除（runtime 有自己的列后不再需要 instance 兜底读）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/model.py` | DaemonRuntime 加 allowed_roots 列 |
| 修改 | `backend/app/modules/daemon/runtime/service.py` | register copy default + update_allowed_roots 写 runtime |
| 修改 | `backend/app/modules/daemon/router.py` | _runtime_read 读 runtime + heartbeat map + PUT + WS push roots |
| 修改 | `backend/app/modules/daemon/schema.py` | DaemonHeartbeatResponse map + DaemonRegisterResponse 加字段 |
| 新增 | `backend/migrations/versions/20260706_runtime_allowed_roots.py` | 加列 + copy 迁移 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | _syncAllowedRoots per-runtime + register 初始化 PolicyCache |

## 9. 生命周期契约声明

**本变更不涉及生命周期契约**（session / lease / agent_run / daemon 实体的状态转换矩阵不变）。理由：

- 本变更只改 allowed_roots 的**存储粒度**（instance → runtime）+ **同步协议**（WS/心跳 per-runtime），不改任何实体的状态机
- daemon 注册 / 心跳 / session / lease 的状态转换沿用 daemon-entity-binding D-006 per-daemon 架构，未新增/删除/改变状态或转换
- PolicyCache 已 per-runtime（2026-07-02-daemon-filesystem-policy task-13），本变更只改其**数据来源**（从 instance 改为 runtime），PolicyCache 本身的 set/get 生命周期不变
- runtime 的注册（online）/心跳刷新/stale 清理（offline→删除）流程不变；allowed_roots 作为 runtime 的普通属性随 runtime 生命周期存在，不引入新的状态

因此无需生命周期契约表（事件 × 状态转换矩阵）。

## 10. 自审

- 数据模型清晰（runtime 列 + instance default 保留 + 迁移 copy）✅
- 决策附理由 + 否决方案 B/C ✅
- 数据流闭环（PUT→WS→PolicyCache per-runtime + 心跳兜底 + register 初始化）✅
- 验收 6 条可测 ✅
- 风险识别（breaking + 迁移 + ql-003 回退）✅
- 影响模块列全（backend 5 文件 + daemon 1 文件 + 前端无改）✅
- 不涉及实体状态机（§9 豁免）✅
