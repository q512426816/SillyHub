---
author: qinyi
created_at: 2026-06-09 23:01:00
---

# Requirements: Daemon Agent 检测体系扩展

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 本地安装多种 agent CLI，通过 daemon 注册到平台 |
| 平台 | 接收 daemon 注册，按 provider 类型管理 runtime |

## 功能需求

### FR-01: 多 Agent 二进制检测

Given 本地安装了 claude、codex、cursor 等 agent CLI
When daemon 启动并执行 agent 检测
Then 所有在 PATH 中可找到的 agent 都被识别，返回名称、路径、版本

Given 环境变量 `SILLYHUB_CLAUDE_PATH` 设置为自定义路径
When daemon 检测 claude agent
Then 使用环境变量指定的路径而非 PATH 查找

### FR-02: 版本校验

Given 本地 claude 版本为 1.9.0（低于 2.0.0 最低要求）
When daemon 检测并校验版本
Then 该 agent 被标记为可用但版本不合规，注册时上报版本警告

Given 本地 codex 版本为 0.200.0（高于 0.100.0 最低要求）
When daemon 检测并校验版本
Then 该 agent 正常通过版本校验

### FR-03: 多 Runtime 注册

Given 本地检测到 claude、codex、cursor 三种 agent
When daemon 向服务器注册
Then 服务器创建 3 条 daemon_runtime 记录，provider 分别为 "claude"、"codex"、"cursor"

### FR-04: 执行协议分类

Given 任务分配给 provider="claude" 的 runtime
When TaskRunner 执行任务
Then 使用 stream-json 协议解析输出

Given 任务分配给 provider="codex" 的 runtime
When TaskRunner 执行任务
Then 使用 JSON-RPC 2.0 协议通信

Given 任务分配给 provider="antigravity" 的 runtime
When TaskRunner 执行任务
Then 直接读取 stdout 纯文本

### FR-05: 前端展示

Given 服务器上注册了多个 daemon runtime
When 用户访问 /runtimes 页面
Then 表格中显示每个 runtime 的 provider 类型和版本

## 非功能需求

- **兼容性**：无 agent 安装时 daemon 正常启动（空列表），不崩溃
- **可扩展**：新增 agent 类型只需在 `AGENT_DEFS` 中添加一行配置
- **可回退**：无数据库迁移，旧 daemon 客户端仍可正常注册
- **可测试**：agent 检测逻辑支持 mock，不依赖真实 CLI 安装
