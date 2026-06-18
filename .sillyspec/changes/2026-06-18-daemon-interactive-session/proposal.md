---
author: qinyi
created_at: 2026-06-18 13:54:52
---

# Proposal — 交互式会话管控

## 动机

当前 daemon 是**批处理执行器**：派发 lease → spawn agent → 跑完 → 结束。参考 `happy` 项目的持久会话管理器模型，让 daemon 支持 happy 式交互式 agent 管控——服务端能直接操作正在跑的 claude code / codex（中途追问、权限批准往返、打断），并在服务端实时回显进度。

探索阶段已验证核心可行性：**agent 子进程本身即长驻会话载体**（claude 的 stream-json stdin 流 / codex 的 thread 复用），daemon 无需自建 worker 层，只需让 task-runner 的 result 不再触发 stdin.end + 提供 server→daemon 的 WS 控制注入通道。

## 关键问题（现有方案为什么不够）

1. **正在跑的 agent 收不到中途追问**：`task-runner.ts:721-751` 写一次 prompt 后 stdin 不再写入，`result` 后 `stdin.end`。用户只能在 agent 跑完一轮后才能继续——无法像终端里用 claude code 那样实时插话补充指令。

2. **多轮是"伪多轮"**：现有 quick-chat（`2026-06-11-quick-chat-multiturn`）每轮新建 AgentRun + 新进程，仅靠 `--resume <session_id>` 续上下文（`main.py:141-183`）。每轮重启开销大，且无法做到"agent 正在跑长任务时中途追问"。

3. **无实时权限往返与打断语义**：`stream-json.ts:writeControlResponse` 只做自动批准，无暂停等远程机制；无"中断本轮保留会话"概念——一旦 cancel 即结束整个进程。

## 变更范围

演进现有 quick-chat 为**交互式会话**（方案 A：WS 双向 + 复用 task-runner），按 Wave 分组：

- **Wave 1 核心交互**：`agent_sessions` 新表 + `lease.kind` + task-runner session 模式（result 不 end stdin）+ WS 控制消息（session_inject/interrupt/end）+ sessionStore + session 级 SSE 聚合。实现中途追问/多轮 stdin 注入（claude + codex）。
- **Wave 2 权限往返**：`manual_approval` 会话级开关 + WS permission_request/response + stream-json/json-rpc control_request 升级为暂停等远程。
- **Wave 3 resume**：daemon 磁盘持久化 sessionStore + 重启 `--resume`/`thread/resume` 重 attach + reconnecting 状态。
- **Wave 4 前端管控台**：runtimes 页 quick-chat 升级会话面板（输入框/打断/结束/权限弹窗/历史回看）。

## 不在范围内（显式清单）

- ❌ happy 式 E2E 加密中转（本项目是平台，需明文做业务）
- ❌ 自建 worker 进程 + 输入队列层（探索已否定，agent 子进程即载体）
- ❌ 多 agent 客户端铺通（gemini/cursor/copilot 等其余 10 provider 真实跑通）——聚焦 claude + codex
- ❌ 改批处理 lease 模型（workspace agent run 保持原生命周期）
- ❌ 多 daemon 跨主机负载均衡/亲和性
- ❌ Wave 1/2 崩溃恢复（崩溃=会话结束标 failed），resume 放 Wave 3

## 成功标准（可验证）

1. **[兼容] 旧配置默认行为不变**：`lease.kind` 默认 batch，现有批处理 lease 与 quick-chat resume 路径零变化。
2. **[Wave1-核心] 中途追问可用**：agent 跑完第一轮（出 result）后，注入新 prompt 能写入 stdin，看到第二轮响应（claude + codex 各验证一次）。
3. **[Wave1-打断] 分离生效**：打断本轮 = agent 停当前 turn、会话仍 active 可继续；结束会话 = kill 进程、status=ended。
4. **[Wave1-回显] 跨 turn SSE 连续**：一个 SSE 连接贯穿整个会话，多 turn 输出实时回显、历史可在 AgentRunLog 回看。
5. **[Wave2-权限] 默认自动批准不变**；`manual_approval=true` 时工具调用暂停、前端批准/拒绝后 agent 继续/中止。
6. **[Wave3-resume] daemon 重启恢复**：active 会话 reconnecting → 恢复，上下文不丢。
7. **[R-01 验证] 端到端铁证**：Wave1 首任务跑通 claude stream-json 两轮 result（补探索阶段被网关 529 阻断的铁证）。

详细设计与验收见 `design.md`，决策台账见 `decisions.md`。
