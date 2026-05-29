# Ref 05：Claude Code 云端部署与 HTTP/SSE Server Runner

## 文章核心观点

这篇文章介绍如何把 Claude Code 从本地 CLI 变成云端可调用的 HTTP/SSE 服务。

核心方案：

```text
Application Layer
  ↓ HTTP + SSE
Sandbox Control Plane
  ↓
每个用户一个 Sandbox
  ↓
Sandbox 内运行 Claude Code CLI + HTTP Service
  ↓
~/.claude/ 和 workspace 独立持久化
```

它主要解决三个问题：

1. Claude Code 如何离线部署到云端。
2. 如何把 CLI/SDK 封装成 HTTP + SSE 流式接口。
3. 多用户场景下如何避免记忆、配置、文件串扰。

## 对 SillyHub 的价值

这篇文章适合参考为 SillyHub 的 `Server Sandbox Runner` 方案。

SillyHub 之前需要考虑两类执行器：

```text
Local CLI Runner：运行在用户本地开发机
Server Sandbox Runner：运行在平台托管沙箱
```

这篇文章补全的是 Server Runner 思路。

## 可采纳设计

### 1. Agent 服务化

CLI 不适合直接给平台调用，因为：

- 输出不结构化。
- 不适合 Web 流式展示。
- 不好做多用户路由。
- 不好做统一审计。

推荐封装为：

```text
Claude Code / SDK
  ↓
FastAPI / HTTP Service
  ↓
SSE / WebSocket
  ↓
SillyHub Server / Web Console
```

### 2. HTTP + SSE 流式返回

AI 编码任务会持续输出：

```text
系统初始化
助手文本
工具调用
文件读取
代码修改
测试执行
最终结果
```

SSE 或 WebSocket 都适合展示给 Web 控制台。

### 3. 沙箱隔离

Claude Code 的状态文件很多：

```text
~/.claude/
CLAUDE.md
settings.json
sessions/
projects/
MCP 配置
工作目录
```

多用户共享实例容易发生：

```text
记忆串扰
配置串扰
会话串扰
文件串扰
权限串扰
```

所以云端 Runner 必须沙箱隔离。

### 4. 文件快照版本化

沙箱销毁前保存快照，有助于：

- 可恢复。
- 可回滚。
- 沙箱无状态。
- 用户状态不丢。
- Agent 写坏代码可回到历史版本。

## 需要警惕的问题

### 1. 默认 bypassPermissions 很危险

文章中为了无人值守，默认 `bypassPermissions`。这在实验环境方便，但 SillyHub 平台不应这么设计。

SillyHub 应默认最小权限：

```text
默认禁止写文件
默认禁止执行 Shell
默认禁止 Git push
默认禁止读取敏感文件
按任务阶段逐步放权
高风险操作必须审批
```

### 2. 一用户一沙箱不够

仅 `user_id → sandbox` 不能解决：

- 同一用户多个项目串扰。
- 同一项目多个任务串扰。
- 不同客户项目串扰。
- 同一任务多次执行状态混乱。

SillyHub 更适合：

```text
tenant_id + user_id + project_id + task_id → workspace / sandbox
```

建议：

```text
一个任务一个 workspace
高风险任务一个独立 sandbox
用户级记忆、项目级知识、任务级状态分层隔离
```

### 3. 文件快照必须排除敏感内容

不能随便保存：

```text
.env
SSH Key
API Token
credentials.json
私有证书
数据库连接配置
客户敏感数据
node_modules / target / dist 等大目录
```

需要：

```text
快照白名单
敏感文件黑名单
脱敏策略
加密存储
访问审计
保留周期
```

### 4. Claude Code HTTP Service 不能直接开放给用户

不能让用户直接传：

```json
{
  "permission_mode": "bypassPermissions",
  "tools": ["Write", "Bash", "Edit"],
  "mcpServers": {}
}
```

正确做法：

```text
用户请求
  ↓
SillyHub Workflow Engine
  ↓
Policy Engine 校验
  ↓
生成受控 Agent Request
  ↓
Server Runner 调 Claude Code HTTP Service
```

Claude Code HTTP Service 应只是内部执行能力。

## 与 Local CLI Runner 的关系

这篇文章不应替代本地 CLI Runner。

### Local CLI Runner 适合

```text
用户本地有代码
需要本地 Git 凭证
需要本地依赖环境
代码不方便上传服务器
需要和 IDE 配合
内网资源只能本地访问
```

### Server Sandbox Runner 适合

```text
服务端统一执行
后台长任务
Web 远程触发
轻量代码修改
文档分析
知识库任务
统一 CI 环境
用户不想安装 Agent
```

最佳方案是混合执行：

```text
方案分析：服务端可跑
知识检索：服务端可跑
代码修改：本地或云端都可
测试验证：本地 / CI / 云端沙箱
PR 创建：服务端统一管控
```

## 推荐写入设计文档的表述

```text
SillyHub 支持 Local CLI Runner 与 Server Sandbox Runner 两种执行模式。

Local CLI Runner 运行在用户本地开发环境中，适合需要访问本地代码、依赖、Git 凭证和内网资源的任务。

Server Sandbox Runner 运行在平台托管的隔离容器中，适合后台执行、远程调用、Web 流式展示和统一环境验证。Server Runner 内部可以通过 Claude Code、Codex 等 Agent Adapter 调用不同 AI 编码引擎，并通过 HTTP/SSE 或 WebSocket 将执行过程实时回传平台。

无论使用本地 Runner 还是服务端 Runner，Agent 都不能绕过平台直接操作项目资源。所有文件读写、命令执行、MCP 调用、Git 操作和权限模式都必须经过 Policy Engine、Tool Gateway、Workspace Sandbox 和 Audit Log 控制。
```
