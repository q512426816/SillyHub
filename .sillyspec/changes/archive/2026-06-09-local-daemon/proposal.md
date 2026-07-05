---
author: qinyi
created_at: 2026-06-09 11:30:00
---

# Proposal：本地守护进程（Local Daemon）

## 动机

当前 SillyHub 的 Agent 执行模式是：服务器通过子进程运行 Claude Code CLI。这种方式的缺点是：

1. **服务器负载集中**：所有 Agent 在服务器执行，资源成本高，扩展困难
2. **本地资源未利用**：用户本地机器的 CPU/GPU 空闲，无法利用
3. **本地上下文不完整**：服务器无法访问用户本地开发环境的完整上下文（依赖、配置、本地服务）

参考 [multica](https://github.com/tmc/multica) 项目（[How Multica works](https://github.com/tmc/multica/blob/main/docs/how_multica_works.md)、[CLI_AND_DAEMON.md](https://github.com/tmc/multica/blob/main/docs/cli_and_daemon.md)）的成熟设计，实现本地守护进程功能。

## 关键问题

**现有方案为什么不够**：

1. **资源瓶颈**：服务器集中执行导致资源瓶颈，无法横向扩展。增加 Agent 数量需要增加服务器，成本高。

2. **网络延迟**：Agent 需要访问远程代码仓库，网络延迟影响执行效率。本地执行可以零延迟访问代码。

3. **安全风险**：用户密钥（API Token）需要在服务器端存储和使用，增加泄露风险。本地守护进程可以让密钥永不上传。

4. **灵活性不足**：用户无法在本地环境中执行 Agent，无法利用本地工具和服务（如本地数据库、Docker 容器）。

## 变更范围

本次变更做什么：

1. **服务器端基础设施**：
   - 新增 `modules/daemon/` 模块（HTTP API + WebSocket Hub）
   - 新增 `modules/agent/placement.py`（统一调度入口）
   - 数据库迁移：`daemon_runtimes`, `daemon_task_leases`

2. **本地守护进程**：
   - 独立 Python 包 `sillyhub-daemon`
   - CLI 命令：`sillyhub daemon start/stop/status/logs`
   - 核心循环：注册、轮询、心跳、任务执行

3. **前端集成（可选）**：
   - 运行时管理页面（`/runtimes`）
   - Agent Run 创建时选择运行位置（服务器/本地）

## 不在范围内（显式清单）

- **不做分布式任务队列**：守护进程是单机模式，不跨机器调度
- **不做任务优先级**：先到先得（FIFO），不实现优先级队列
- **不做任务依赖**：不支持任务间的依赖关系和 DAG 调度
- **不做实时监控仪表板**：基础的运行时状态列表即可
- **不做多租户隔离**：守护进程绑定用户，不做跨用户的任务隔离
- **不做离线执行队列**：网络断开时暂不支持本地排队执行（留待 Wave 7）
- **不做本地模型支持**：先支持 Claude Code CLI，本地模型是未来方向

## 成功标准（可验证）

- **向后兼容**：无守护进程时，Agent 仍在服务器子进程运行，行为不变
- **优雅降级**：守护进程离线时，任务自动切换到服务器执行，用户无感知
- **前端无感知**：SSE 路径不变，前端订阅逻辑无需修改
- **防双跑**：daemon claim 后断线，不会同时在本机和服务器执行同一任务
- **密钥隔离**：用户密钥存储在本地 `~/.sillyhub/daemon/credentials.json`（权限 0600），永不上传服务器
- **可测试**：提供集成测试验证守护进程注册、任务认领、进度报告、任务完成流程
