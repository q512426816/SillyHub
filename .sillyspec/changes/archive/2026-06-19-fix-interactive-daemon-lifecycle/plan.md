---
author: qinyi
created_at: 2026-06-19T05:20:00
plan_level: full
---

# 实现计划 — 修复 interactive session daemon 侧完整生命周期（4 gap）

> 设计依据：proposal.md + design.md（4 gap 诊断 + 修复方案 + REST 协议 + 端到端数据流）。

## Wave 1 — backend 侧基础 + daemon SessionState（并行）

- [ ] task-01: claimToken 传递链（gap-2）— backend lease metadata claim_token + SESSION_INJECT payload 加 claim_token + daemon SessionState/CreateSessionInput 加 claimToken
- [ ] task-02: run 终态 REST 协议（gap-3）— backend `POST /leases/{id}/runs/{run_id}/result` + service.close_interactive_run + daemon hubClient.notifyRunResult
- [ ] task-03: session end 反向通知（gap-4）— backend `POST /sessions/{id}/end` daemon 上行（api-key 鉴权）+ 复用 service.end_session + daemon hubClient.notifySessionEnd

## Wave 2 — daemon 生产注入（依赖 W1）

- [ ] task-04: cli.ts 注入 SessionManager + daemon onTurnResult/onTurnMessage/onSessionEnd 桥接（gap-1，循环引用用闭包延迟绑定；_startInteractiveSession 传 claimToken；onTurnMessage 用 submitMessages(currentRunId)）

## Wave 3 — 真实 daemon 集成（依赖 W2）

- [ ] task-05: 真实 daemon 端到端集成测试（启动真实 daemon → createSession → inject → result → run 关闭 → end → session ended）+ daemon rebuild dist + 重新部署 + verify 含真实集成

## 任务总表

| 编号 | 任务 | Wave | 依赖 | gap | allowed_paths 核心 |
|---|---|---|---|---|---|
| task-01 | claimToken 传递链 | W1 | - | gap-2 | backend agent/placement.py, daemon/protocol.py(payload), daemon/session-manager.ts, interactive/types.ts |
| task-02 | run 终态 REST 协议 | W1 | - | gap-3 | backend daemon/router.py, daemon/service.py, daemon/hub-client.ts, interactive/session-manager.ts(_onResult) |
| task-03 | session end 反向通知 | W1 | - | gap-4 | backend daemon/router.py, daemon/service.py, daemon/hub-client.ts, interactive/session-manager.ts(end/fail) |
| task-04 | cli.ts 注入 + daemon 桥接 | W2 | 01,02,03 | gap-1 | sillyhub-daemon/cli.ts, daemon.ts |
| task-05 | 真实 daemon 集成 + rebuild + 部署 | W3 | 04 | 验收 | sillyhub-daemon/tests/integration/*, 集成脚本 |

## 关键路径
task-01/02/03（W1 并行）→ task-04（W2）→ task-05（W3）。

## 验收（design §8）
1. createSession → daemon 走 SessionManager（非 task_runner），422 消除
2. SDK result → daemon notifyRunResult → backend close_interactive_run（不卡 running）
3. end/idle 30min → daemon notifySessionEnd → backend end_session（session/lease 同步 ended）
4. **真实 daemon 端到端集成测试全链路绿**（原变更 verify 遗漏，本补丁必做）
5. 单元测试 + 类型 + ruff 通过；batch 零回归（FR-09）

## 协作点
- task-01/02/03 共改 daemon/session-manager.ts + hub-client.ts：execute 时 W1 内同文件 task 串行（按 01→02→03）或合并为一个 daemon 子任务。
- task-04 改 cli.ts（task-04 allowed_paths）：gap-1 核心，依赖 W1 的 daemon SessionState/桥接方法就位。
- task-05 真实集成需系统 claude + 智谱中转 env（本地跑或 CI）。
