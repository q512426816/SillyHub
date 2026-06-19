---
author: qinyi
created_at: 2026-06-19T05:20:00
---

# 任务列表 — 修复 interactive session daemon 侧 4 gap

> 详细技术设计见 design.md（§2 cli.ts 注入 / §3 claimToken 链 / §4 run 终态 REST / §5 session end / §6 端到端数据流 / §7 文件清单 / §8 验收）。每个 task 实现 strict 按 design 对应章节。

## W1（并行，backend 侧基础 + daemon SessionState）
- **task-01 claimToken 传递链（gap-2）**：design §3。backend placement lease metadata claim_token + SESSION_INJECT payload；daemon SessionState/CreateSessionInput 加 claimToken；_startInteractiveSession 取 claim_token。
- **task-02 run 终态 REST 协议（gap-3）**：design §4。backend POST /leases/{id}/runs/{run_id}/result + close_interactive_run（success→completed / error_during_execution→failed interrupted / error→failed）；daemon hubClient.notifyRunResult；SessionManager._onResult 桥接。
- **task-03 session end 反向通知（gap-4）**：design §5。backend POST /sessions/{id}/end daemon 上行（api-key 鉴权）复用 service.end_session；daemon hubClient.notifySessionEnd；SessionManager.end/fail → onSessionEnd 桥接。

## W2（依赖 W1）
- **task-04 cli.ts 注入 SessionManager + daemon 桥接（gap-1）**：design §2。cli.ts 实例化 SessionManager（deps）+ 传 Daemon options.sessionManager；daemon.ts onTurnResult/onTurnMessage/onSessionEnd 调 hubClient；循环引用用闭包延迟绑定；onTurnMessage 用 submitMessages(leaseId, claimToken, currentRunId)。

## W3（依赖 W2）
- **task-05 真实 daemon 集成测试 + rebuild + 部署**：design §8。启动真实 daemon → createSession → inject → result → run 关闭 → end → session ended 全链路；daemon pnpm build dist + Docker 重新部署 backend/frontend + daemon 重启；verify 含真实集成（教训：mock 不替代集成）。

## 共改文件协调
- daemon `session-manager.ts`（task-01 SessionState + task-02 _onResult + task-03 end/fail）+ `hub-client.ts`（task-02 notifyRunResult + task-03 notifySessionEnd）：W1 内串行（01→02→03）或合并。
- backend `router.py`/`service.py`（task-02/03 端点）：W1 内串行。
