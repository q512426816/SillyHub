---
author: Claude
created_at: "2026-06-09"
---

# 本地守护进程（Local Daemon）

## 文档导航

| 文档 | 说明 |
|------|------|
| [proposal.md](proposal.md) | 简洁的提案概述 |
| [design.md](design.md) | 详细的设计文档（已收紧关键设计点） |
| [tasks.md](tasks.md) | 实现任务清单（Wave 1-3 详细拆解） |

## 快速理解

### 参考项目

[multica](https://github.com/tmc/multica) - [How Multica works](https://github.com/tmc/multica/blob/main/docs/how_multica_works.md)、[CLI_AND_DAEMON.md](https://github.com/tmc/multica/blob/main/docs/cli_and_daemon.md)

### 核心理念

```
服务器 ←→ 本地守护进程 ←→ 本地 Agent CLI
```

### 通信方式

- **WebSocket**：唤醒信号 + 心跳
- **HTTP REST**：任务认领 + 状态更新

### 关键设计约束

1. **单一状态源**：daemon_task_leases 只做 dispatch/claim/lease envelope，最终状态、日志、tokens、cost 仍写回 AgentRun/AgentRunLog
2. **统一调度入口**：抽 RunPlacement 决策层，覆盖 start_run、start_stage_dispatch、start_scan_dispatch
3. **幂等和防双跑**：claim lease、heartbeat timeout、任务取消、attempt 编号
4. **本地工作目录隔离**：workspace 映射、路径注册、结果上传、密钥永不上传
5. **SSE 路径不变**：daemon 只负责写回服务器，由服务器发布 Redis/SSE

### 与现有架构的对比

| 维度 | 当前模式 | 守护进程模式 |
|------|---------|-------------|
| Agent 运行位置 | 服务器子进程 | 用户本地机器 |
| 资源利用 | 服务器集中 | 本地分布式 |
| 通信方式 | Redis Pub/Sub | WebSocket + HTTP |
| 本地上下文 | 有限 | 完整 |
| 离线支持 | 无 | 可扩展 |

## 当前状态

**阶段**：设计已收紧，待评审通过后进入 plan 阶段

**主要修正**：
- ✅ 明确 daemon_task_leases 非状态源，状态事实源仍是 AgentRun/AgentRunLog
- ✅ 设计 RunPlacement 统一决策层，覆盖三个调度入口
- ✅ 补充 lease 机制、幂等性、防双跑逻辑
- ✅ 明确本地工作目录策略（镜像工作区 + 直接映射）
- ✅ 修正 SSE 路径，保持前端无感知
- ✅ 补充 tasks.md，拆解 Wave 1-3 实现任务

## 下一步

文档已收紧，如需继续：
1. 评审 design.md 和 tasks.md
2. 通过后运行 sillyspec 进入 plan 阶段

