---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 在本机启动 Local Runner |
| Agent | 通过本机 CLI 执行任务 |
| 平台 | 分配任务、接收日志、维护状态 |
| Reviewer | 审查执行结果 |

## 功能需求

### FR-01: runtime 注册

Given 本机安装 Codex CLI
When Local daemon 启动
Then daemon 向 server 注册 provider=codex 的 runtime

### FR-02: heartbeat

Given runtime 已注册
When daemon 定期发送 heartbeat
Then server 将 runtime 视为 online

### FR-03: claim task

Given Task 已 ready 且绑定 online runtime
When daemon claim task
Then server 原子分配任务给该 runtime

### FR-04: 隔离执行环境

Given daemon 已 claim task
When 准备执行
Then 创建独立 workdir/output/logs 并写入 AgentSpecBundle

### FR-05: 消息流上报

Given CLI 正在执行
When 产生 stdout、tool call、thinking 或 result message
Then daemon 批量上报到 server
And 前端通过 SSE 看到实时日志

### FR-06: 执行完成

Given CLI 返回成功
When runner 收集结果
Then server 保存 diff/test/artifact 并推进到 review gate

## 非功能需求

- 可恢复：daemon 重启后能恢复或标记 orphan task。
- 安全性：runner 不绕过 Tool/Git Gateway 的审计边界。
- 可观测：daemon 有 status/logs 命令。
- 可测试：server 协议、adapter、任务状态流转都有测试。
