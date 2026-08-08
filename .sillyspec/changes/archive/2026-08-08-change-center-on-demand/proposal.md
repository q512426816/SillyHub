---
author: qinyi
created_at: 2026-08-08 22:07:31
---

# 提案书（Proposal）— 变更中心按需触发（形态A 减负）

## 动机
变更中心整体流程跑不下去。根因：backend `auto_dispatch` 自动连轴（6 调用点跨 change+daemon 子域）+ sillyspec.db RPC 同步脆弱 + gate 硬阻塞（`sillyspec gate verify` 子命令未发版永久卡死）。

## 关键问题
1. `auto_dispatch_next_step`（dispatch.py:240 ~330行）自动连轴，6 调用点：①gate task(run_sync:1387) ②lease facade(:542) ③single callback(:1617) ④team advance(:1752) ⑤reconcile(dispatch:655) + 被调(dispatch:240)
2. sillyspec.db RPC 同步（latin-1 字节往返写临时文件再 sqlite 读）脆弱，任一环断 synced=False
3. gate verify 子命令未发版 → 永久 gate_blocked exit 2 卡死

## 变更范围
- 砍 auto_dispatch（6 调用点全改）+ sillyspec.db 自动同步 + gate 硬阻塞
- 补 4 个 mcp_gateway change 阶层 tool（按需触发入口）+ HTTP 端点
- team 推进重写（_advance_team_stage 保留 complete_stage 删 dispatch，下一 stage 交 tool）
- 前端复用 handleDispatch 接 change 阶层 HTTP 端点
- 保留阶段流程/文档产出/gate 核验价值（改触发方式，非砍）

## 不在范围内（Non-Goals）
- 不砍阶段流程（形态B，违反 CLAUDE.md 第 1 条文档驱动）
- 不改 SillySpec 工具本身（gate 子命令发版是工具侧事，本变更绕过）
- 不改 AgentRun/AgentMission 模型 / OrchestratorService.schedule_loop / converge_mission_for_completed_run（mission finalize 与 auto_dispatch 无关）
- 不改 dispatch-worker（2026-08-08-dispatch-worker-caller-worktree，执行层 MCP 派活，调研证实正交零影响）

## 成功标准（可验证）
- auto_dispatch_next_step 删除，6 调用点全改造，无运行时 ImportError/AttributeError
- change 阶层 4 MCP tool + HTTP 端点按需触发；team 模式 execute→verify→archive 流转通（_advance_team_stage 重写 + advance_change_stage 接 _dispatch_execute_team）
- gate 软调用（run_verify_gate）不硬阻塞，结果交决策
- single/team 模式零回归（除 stage 推进改按需）
- 既有测试不破坏（砍 auto_dispatch 的 test_auto_dispatch_gate/test_gate_retry/test_reconcile_gate 改写）
