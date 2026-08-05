---
author: qinyi
created_at: 2026-08-05 16:57:16
---

# 提案 — daemon kill 通道统一

## 背景

interactive 会话（Claude/Codex）与 batch lease 在用户主动终止时，存在"backend 已标记终态、daemon 侧子进程未必真停"的缺口。原 P0-1/P0-2（backend→WS 信号层）已于 2026-07 修复（`_send_interactive_cancel` + `MissionControl.cancel` 委托 `cancel_lease`）；但下一层"daemon 物理杀进程"+ budget 强制点 + 终态可见性仍是黑洞。

经 explore + spike 核实 4 个活隐患：Claude END 没接通 SDK 的 `query.close()` kill 链（P0，烧 token）；Codex END 不主动调 `_close`；batch kill 只靠心跳轮询；budget_tokens 全链路零强制点。

详细设计与文件清单见 `design.md`；决策见 `decisions.md`；可视化见 `prototype-kill-channel.html`。

## 目标

1. interactive（Claude/Codex）END/fail 在当前 turn 卡死场景下可靠终止子进程（接通 SDK 已有 kill 链，不造轮子）。
2. batch lease 取消走 WS 即时通道（`LEASE_CANCEL`），不再依赖心跳周期。
3. budget_tokens 有运行期检查点，超阈值软停（与 backend `can_dispatch_worker` 语义一致）。
4. 引入轻量终态确认（`terminating_at` + ACK + 30s 告警），让"backend 标记终止但 daemon 没回传"可观测。
5. 全程向后兼容，PPM 已上线零回归，Windows/Linux/macOS 跨平台。

## Non-Goals（不在范围内）

- 不改 daemon-entity-binding / WorkspaceMemberRuntime 绑定结构（D-002）。
- 不改 `lease.status`/`AgentSession.status`/`AgentRun.status` 状态机取值集合（D-007）。
- 不引入 provider-neutral "TerminationController" 大抽象（方案 B 已否决）。
- 不引入 outbox / report-with-retry 重试组件（D-007）。
- 不把 INTERRUPT 改成硬杀（D-001）；不做 budget 硬切断（D-006）。
- 不做 budget 计费/配额/跨 workspace 统计。
- 不做前端 budget 进度条完整可视化（后置）。
- 不修复"原 P0-1/P0-2"（已于 2026-07 修复，本次仅更新过期文档）。

## 方案选择

采用方案 C（分层渐进）：切断通道用最小补丁接通（close 契约 + 复用 `_killChild` + batch WS + budget 软切断），补轻量终态 ACK + 超时告警（落地 multica "执行端确认"可见性，不搞 outbox 重试）。详见 design.md §5。
