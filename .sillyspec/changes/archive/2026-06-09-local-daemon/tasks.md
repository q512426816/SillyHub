---
author: qinyi
created_at: 2026-06-09 11:30:00
---

# Tasks：本地守护进程

## Wave 1: 服务器基础设施

### 1.1 数据库迁移
**文件**：`backend/app/modules/daemon/migrations/versions/001_create_daemon_tables.py`
创建 `daemon_runtimes`, `daemon_task_leases` 表

### 1.2 创建 daemon 模块骨架
**文件**：`backend/app/modules/daemon/__init__.py`, `router.py`, `schema.py`, `service.py`, `model.py`, `protocol.py`

### 1.3 实现 HTTP API（register）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/register

### 1.4 实现 HTTP API（heartbeat）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/heartbeat

### 1.5 实现 HTTP API（claim）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/leases/{id}/claim

### 1.6 实现 HTTP API（start）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/leases/{id}/start

### 1.7 实现 HTTP API（heartbeat + messages）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/leases/{id}/heartbeat
POST /api/daemon/leases/{id}/messages

### 1.8 实现 HTTP API（complete）
**文件**：`backend/app/modules/daemon/router.py`
POST /api/daemon/leases/{id}/complete

### 1.9 实现 RunPlacementService
**文件**：`backend/app/modules/agent/placement.py`
统一决策层

### 1.10 修改 AgentService 三个入口
**文件**：`backend/app/modules/agent/service.py`
start_run(), start_stage_dispatch(), start_scan_dispatch()

### 1.11 实现 DaemonLeaseService
**文件**：`backend/app/modules/daemon/service.py`
lease 管理、过期检测

### 1.12 单元测试（幂等性）
**文件**：`backend/app/modules/daemon/tests/test_leases.py`

## Wave 2: WebSocket Hub

### 2.1 实现 WebSocket 路由
**文件**：`backend/app/modules/daemon/ws_router.py`
/ws 路由

### 2.2 实现 DaemonWsHub
**文件**：`backend/app/modules/daemon/ws_hub.py`
连接管理、唤醒信号分发、心跳确认

### 2.3 集成测试
**文件**：`backend/app/modules/daemon/tests/test_ws_hub.py`
离线重连、唤醒延迟

## Wave 3: 本地守护进程（核心循环）

### 3.1 创建 sillyhub-daemon 包
**文件**：`sillyhub-daemon/pyproject.toml`

### 3.2 实现 Config
**文件**：`sillyhub-daemon/sillyhub_daemon/config.py`
配置文件读写

### 3.3 实现 DaemonClient
**文件**：`sillyhub-daemon/sillyhub_daemon/client.py`
HTTP + WebSocket 客户端

### 3.4 实现 AgentDetector
**文件**：`sillyhub-daemon/sillyhub_daemon/agent_detector.py`
检测本地 claude/sillyspec

### 3.5 实现 Daemon 核心循环
**文件**：`sillyhub-daemon/sillyhub_daemon/daemon.py`
启动、轮询、心跳、唤醒处理

### 3.6 CLI 命令
**文件**：`sillyhub-daemon/sillyhub_daemon/__main__.py`
daemon start/stop/status/logs

## Wave 4: 任务执行器

### 4.1 实现 WorkspaceManager
**文件**：`sillyhub-daemon/sillyhub_daemon/workspace_manager.py`
镜像工作区策略

### 4.2 实现 CredentialManager
**文件**：`sillyhub-daemon/sillyhub_daemon/credential_manager.py`
密钥管理

### 4.3 实现 TaskRunner
**文件**：`sillyhub-daemon/sillyhub_daemon/task_runner.py`
Agent 执行、进度报告、patch 收集

## Wave 5: 服务器端结果处理

### 5.1 实现 _apply_patch_to_worktree
**文件**：`backend/app/modules/daemon/service.py`
patch 应用、冲突检测

### 5.2 AgentRun 状态同步
**文件**：`backend/app/modules/daemon/service.py`
从 daemon 消息更新

### 5.3 任务回退流程
**文件**：`backend/app/modules/daemon/service.py`
lease 过期 → server 子进程

## Wave 6: 前端集成

### 6.1 运行时管理页面
**文件**：`frontend/src/app/(dashboard)/runtimes/page.tsx`

### 6.2 Agent Run 创建 UI
**文件**：`frontend/src/app/(dashboard)/workspaces/[id]/agent/runs/new/page.tsx`

## Wave 7: 高级特性

### 7.1 多配置文件支持
--profile <name>

### 7.2 自动更新机制
守护进程自更新

### 7.3 离线队列
网络断开时本地排队

### 7.4 资源监控
CPU/内存上报
