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

## W4（gap-8 接通 daemon 重启 session 恢复，依赖 W1-W3）
- **task-06 backend recovery HTTP 端点（gap-8.1，design §11）**：router 加 POST /sessions/{id}/recover | /confirm-reconnected | /mark-recovery-failed；service 补 confirm_reconnected/mark_recovery_failed 若缺；get_current_principal 鉴权。
  <!-- 2026-06-22-daemon-service-split task-05 通知（design §10 R3 协调）：recover_session_after_daemon_restart / confirm_session_reconnected / mark_session_recovery_failed 已从 service.py 迁至 backend/app/modules/daemon/session/service.py（SessionService.recover_* / confirm_session_reconnected / mark_session_recovery_failed）。facade DaemonService 保留同名委托，router 仍调 DaemonService.recover_*，W4 router 改动零调整；三个方法实现已存在于 session/service.py，W4 无需在 service.py 重新补实现，直接经 facade 委托使用即可。 -->
- **task-07 daemon hub-client recovery 方法（gap-8.2，design §11）**：hub-client.ts 加 recoverSession/confirmReconnected/markRecoveryFailed，实现 RecoveryClient 接口(daemon.ts:266)。
- **task-08 cli.ts 装配 persistence + recoveryClient（gap-8.3，design §11）**：JsonSessionPersistence + RecoveryClient 实现 + 传 Daemon/SessionManager；验证 _recoverSessionsOnBoot 生效。
- **task-09 claim_token rotate 回流（gap-8.4，design §11）**：SESSION_INJECT 后 SessionState.claimToken 用 rotated token（session-manager.ts:761）。
- **task-10 真实重启恢复集成测试**：daemon 跑 active session → 重启 daemon → 验证 session 恢复 + turn 不卡（对齐 9s）；restoreAndReconnect 失败收敛。
