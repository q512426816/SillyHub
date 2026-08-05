---
author: WhaleFall
created_at: 2026-08-05 10:25:00
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 开发者 | 改 daemon / backend / 前端 |
| daemon 客户端 | 上报 started_at |
| 平台调用方 | GET machines 读 started_at |

## 功能需求

### FR-01: daemon 上报 started_at（覆盖 D-001@v1）
**Given** daemon 进程启动（cli.ts 入口取 processStartTime）
**When** register + heartbeat
**Then** body 含 `started_at`（ISO 8601，进程启动时间，恒定）

**Given** 旧 daemon（不上报）
**When** register/heartbeat
**Then** `started_at` 缺失/None（兼容）

### FR-02: backend 存储 + machines 返回 started_at（覆盖 D-001@v1, D-002@v1）
**Given** daemon 上报 started_at
**When** register/heartbeat
**Then** `daemon_instances.started_at` 写（幂等覆盖）

**Given** `GET /api/daemon/machines`
**When** instance 有 started_at
**Then** `DaemonMachineRead.started_at` 非 null（instance None 则 null）

### FR-03: 前端机器头显示 started_at
**Given** machines 返回 `started_at` 非 null
**When** 机器头渲染
**Then** 显示相对（「2 小时前」）+ 绝对（「2026-08-05 08:52」）

**Given** `started_at` null（旧 daemon）
**When** 渲染
**Then** 显示「—」或隐藏

## 非功能需求
- **兼容性**：旧 daemon None + migration nullable + downgrade drop_column；项目未上线不要求历史兼容（规则 11）。
- **跨平台**：daemon `Date.now()`（node 跨平台）。
- **可回退**：migration downgrade `drop_column`。
- **可测试**：register→machines 断言 started_at + 前端格式化冒烟。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | register+heartbeat 幂等上报 started_at |
| D-002@v1 | FR-02 | 存 daemon_instances，仅 DaemonMachineRead 返回（runtime 不加） |
