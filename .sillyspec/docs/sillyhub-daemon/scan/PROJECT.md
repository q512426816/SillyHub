---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 项目概览

## 项目简介

**sillyhub-daemon** 是 SillyHub 多 Agent 平台的本地守护进程 / CLI 工具。它运行在开发者本机，负责：

1. **检测本地已安装的 AI 编码 Agent**（支持 12 种 provider）
2. **向 SillyHub Server 注册**为可用的 runtime
3. **接收并执行服务器分派的任务**：克隆仓库、运行 Agent、收集 diff、上报结果
4. **实时流式转发 Agent 执行事件**

用户通过 `sillyhub-daemon start` 命令启动守护进程，之后守护进程在后台与服务器保持 WebSocket 连接，等待任务通知并自动执行。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | Python 3.12+ |
| 异步框架 | asyncio |
| HTTP 客户端 | httpx >=0.27 |
| WebSocket | websockets >=12.0 |
| CLI 框架 | Click >=8.0 |
| 构建 | hatchling |
| 测试 | pytest >=9.0 |
| 包管理 | pip / pyproject.toml |

## 项目规模

| 指标 | 数量 |
|------|------|
| 源码模块 | 12 个 Python 文件 |
| Backend 实现 | 5 种协议 |
| 支持的 Agent Provider | 12 种 |
| 测试文件 | 16 个 |
| 外部依赖 | 3 个 (httpx, websockets, click) |
| 代码总行数 | ~1500 行 |

## 核心特性

### 多 Agent 支持
- 支持 12 种 AI 编码 Agent：claude、codex、copilot、gemini、cursor、hermes、kimi、kiro、opencode、openclaw、pi、antigravity
- 自动检测本机已安装的 Agent（环境变量覆盖 + PATH 查找）
- 版本检测和最低版本校验
- 每个 Agent 注册为独立的 runtime

### 策略模式 Backend 架构
- 抽象基类 `AgentBackend(ABC)` 统一接口
- 5 种协议实现：stream-json、json-rpc、jsonl、ndjson、text
- 懒加载工厂避免循环依赖

### 完整的 Lease 生命周期
- WebSocket 实时任务通知
- claim -> start -> execute -> complete 完整流程
- 事件流式转发（submit_messages）
- 自动收集 git diff 上报

### 本地安全
- 凭证本地存储，文件权限 0600
- `{{USER_*}}` 占位符在本地解析，秘密不上传服务器
- Bearer Token 认证

## 运行方式

```bash
# 启动守护进程
sillyhub-daemon start --server http://localhost:8000 --token <TOKEN>

# 查看状态
sillyhub-daemon status

# 查看日志
sillyhub-daemon logs

# 停止守护进程
sillyhub-daemon stop
```

## 配置与数据

所有本地数据存储在 `~/.sillyhub/daemon/` 目录下：

- `config.json` -- 守护进程配置
- `credentials.json` -- 用户凭证
- `daemon.pid` -- 进程 PID
- `daemon.log` -- 运行日志
- `workspaces/` -- 任务工作空间

## 关键设计决策

1. **Mirror Workspace 策略**：每个任务 clone 完整仓库，执行后收集 diff，不直接操作源仓库
2. **多 Runtime 注册**：一个 daemon 实例为每个检测到的 Agent 注册独立 runtime_id
3. **trust_env=False**：HTTP 客户端绕过系统代理，因为通常与本地服务器通信
4. **延迟导入**：CLI start 命令内部 import 各模块，减少启动时间
