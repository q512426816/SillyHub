---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Proposal

## 动机

平台需要先打通 Local Runner，而不是一开始做云端全自动。Local Runner 能利用用户本机已登录的 Claude/Codex CLI、已有 SSH/Git 凭据和本地开发环境，同时让 server 保持任务编排、日志、审计和 review gate。

本变更参考 `C:\Users\qinyi\IdeaProjects\multica` 的 local daemon/runtime/task loop，抽取模式，不照搬 Go 实现。

## 关键问题

### 1. Agent 执行不能只停留在服务端记录

当前 AgentRun、日志和 worktree lease 需要形成真实执行闭环：claim task、准备上下文、调用 CLI、流式上报、收集结果。

### 2. 本地 CLI 运行需要 runtime 生命周期

server 必须知道哪些 workspace/provider runtime 在线，不能向离线本机派发任务。

### 3. 消息流和会话需要可恢复

执行中断、daemon 重启、CLI session id 出现较晚等情况都需要明确恢复策略。

## 变更范围

- 新增 Local daemon/runtime 注册、heartbeat、deregister。
- server 提供 claim/start/progress/messages/complete/fail 协议。
- runner 为每个任务准备隔离 workdir/output/logs。
- Agent backend 统一封装 Claude/Codex CLI。
- SSE 和 DB 保存完整执行日志。
- 执行结束收集 diff/test/artifact，进入 review gate。

## 不在范围内（显式清单）

- 不做云端 Server Sandbox Runner。
- 不做多租户容器隔离。
- 不做 Knowledge Candidate 审核。
- 不直接暴露 Claude/Codex HTTP 服务给用户。

## 成功标准（可验证）

- Local daemon 能注册 runtime 并保持 heartbeat。
- server 只向 online runtime 派发任务。
- runner 能 claim 一个 ready task 并完成一次 CLI 执行。
- 前端能实时看到执行日志。
- DB 保留完整 AgentRun 日志。
- 执行后能看到 diff、test result、artifact 摘要。
