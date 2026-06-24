---
author: qinyi
created_at: 2026-06-24 14:30:00
---

# Proposal — daemon 网络层可靠性 + 进程保活增强

## 动机

daemon（sillyhub-daemon）连接远程 backend（`https://crrcdt.ppdmq.top`，阿里云）时，公网链路瞬时抖动会直接导致**服务中断与数据丢失**，对生产系统不可接受。一次真实抖动期间，daemon 因 timeout 累积自行终止进程、一个 interactive turn 的 12 条流式消息全部丢失、AgentRun 在 backend 侧内容残缺。根本缺陷不在网络本身（backend 经外部验证健康稳定），而在 daemon 自身的网络健壮性设计。

## 关键问题（现有方案为何不够）

1. **进程自杀**：`cli.ts:710-720` 注释自承——三循环（heartbeat/poll/ws）fire-and-forget 的 async 若抛未捕获 rejection，Node 默认 `--unhandled-rejections=throw` 会让 daemon **静默 exit 1**。现有 handler 只写 stderr，不重启循环、不保证进程不死。后果：daemon 因 timeout 累积自行终止，进程退出、runtime 离线、服务中断。
2. **消息零容忍丢失**：`HubClient` 是无重试瘦客户端（蓝图 N-2），`submitMessages` 单次失败即丢弃。interactive（`daemon.ts:1287`）与 batch（`task-runner.ts:1147`）两条路径都是 fire-and-forget，抖动即丢流式消息，AgentRun 内容/token 残缺。
3. **补发不幂等**：backend `submit_messages` 写 AgentRunLog（append-only），仅"单次调用内按 thinking segment 去重"，注释明说"跨调用去重交前端 normalize"。daemon 若重发已成功的消息会**重复写库**，补发机制无从建立在可靠基础上。

## 变更范围

- **①日志可定位**：`fetch failed` 透传 `cause`（底层 code），两处 warn 展开。
- **②submitMessages 重试**：错误分类 + 3 次指数退避（1/2/4s ±20%）。范围 B：interactive + batch 两条路径全覆盖；notifyRunResult/completeLease/notifySessionEnd 终态轻量重试（不暂存）。
- **③失败暂存补发**：落盘 JSONL outbox（`~/.sillyhub/daemon/outbox/<runId>.jsonl`）+ 重启恢复 + ws onConnected/heartbeat healthy 触发 drain + lease/session 终态校验 + claim_token 422 容忍 + 容量上限。
- **④daemon 保活**：unhandledRejection/uncaughtException handler 强化（不退进程）+ `_fire` 循环自愈重启 + 断连 FATAL 计数。
- **幂等根治（D-001@v2）**：backend `AgentRunLog` 加 `dedup_key` 列 + 部分唯一索引 + `INSERT ON CONFLICT DO NOTHING`；daemon 生成稳定 dedup_key；protocol 透传。

## 不在范围内（显式清单）

- 不改 daemon 与 LLM 子进程（codex/claude）的代理交互（`all_proxy` 影响 LLM API 是另一回事）。
- 不做 runtime 健康状态的前端展示（另一变更）。
- 不为终态上报（result/complete/end）做暂存补发（靠轻量重试 + backend lease 超时 + daemon recover 兜底）。
- 不改 WS 协议本身（仅 REST submit_messages 加可选字段）。
- 不处理同机多 daemon 实例 ownership（已有 ql-006 runtime lock）。
- 不主动上报 runtime degraded（复用 backend 45s 心跳超时自然 offline，daemon 保活恢复后重新上线）。

## 成功标准（可验证）

- daemon 进程在持续网络故障（模拟 fetch failed/timeout）下**不退出**，三循环异常后能自愈重启。
- submit 失败的流式消息落盘暂存，backend 连通后**按序补发成功**；daemon 重启后恢复未补发项。
- 重复 submit 同一 `(run_id, dedup_key)` 的 message，backend **仅落库一行**（幂等）。
- `fetch failed` 日志暴露底层 cause code（如 `ECONNREFUSED`）。
- 旧配置（未设 retry/outbox config）下行为不变；ResilienceService 未注入时 onTurnMessage/task-runner 回退直接调 HubClient。
- `cd sillyhub-daemon && pnpm test` + `cd backend && uv run pytest`（daemon 与 backend 相关测试）通过。
