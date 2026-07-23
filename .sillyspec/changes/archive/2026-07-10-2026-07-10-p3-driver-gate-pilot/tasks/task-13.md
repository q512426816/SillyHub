---
id: task-13
title: verify 试点端到端验收 AC-1~AC-9（多 turn verify 三态 + 重启 reconcile + double-fire cas + 命令白名单注入 + 前端 SSE）
title_zh: P3 verify 试点端到端验收
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-08, task-09, task-10, task-12]
blocks: []
requirement_ids: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9]
decision_ids: []
allowed_paths:
  - backend/tests/
  - sillyhub-daemon/tests/
  - frontend/src/  # 前端测试与 src 同级（__tests__/ 子目录 + *.test.tsx）
provides: []
expects_from: {}
---

# task-13 · P3 verify 试点端到端验收

## 目标
串起 close→gate 后台任务→auto_dispatch 决策全链路，演示并测全 AC-1~AC-9。本 task 只加测试与（必要时的）测试夹具，不改非测试源码。全部前置 task 的真实行为在此被消费核验。

## 对照
- design §2 三态 / §5.1–5.7 / §7.5 生命周期契约表 / §10 R1/R3/R10/R12
- plan「全局验收标准」AC-1~AC-9（plan.md:127-134）
- AC 映射：AC-1 exit0 推进｜AC-2 exit1 打回+errors｜AC-3 三次升级 exit2｜AC-4 gate 异常/未发版 exit2 阻断｜AC-5 close<30s 不重试｜AC-6 重启 reconcile｜AC-7 double-fire cas｜AC-8 命令白名单拒注入｜AC-9 前端 SSE 实时

## 实现要点
1. **集成测试 `backend/tests/test_gate_e2e.py`**（新建）：用真实 close_interactive_run + mock HostFsDelegate.run_command 返回各态 gate JSON，断言：
   - AC-1：exit 0 → gate_status pending→running→decided → auto_dispatch 推进下一 stage（stage_completed 被消费）
   - AC-2：exit 1 → 打回同 stage，gate_last_errors 落 change.stages，前端可读
   - AC-3：连续 3 次 exit 1 → gate_retry_count>=3 升级 exit 2，不再 dispatch（报警人工）
   - AC-4：run_command 抛超时/连接异常或 Z1 探测 gate 子命令缺失 → gate_status=failed + gate_result.exit_code=2，verify 阻断 fail-loud
   - AC-5：断言 close_interactive_run 在 gate 耗时（mock sleep 30s+）下仍 <30s 返回；gate_status=pending 随 commit；后台任务异步完成
   - AC-6：模拟重启——置一 AgentRun gate_status=running 后调 reconcile_pending_gate_decisions → 重置 pending + 重 enqueue → 最终推进
   - AC-7：double-fire——同一 run 同时 fire 原任务 + reconcile 触发 → R3 cas rowcount 断言只有一个真正执行 gate（run_command 调用计数==1）
2. **命令白名单注入测试**（AC-8）：backend `tests/` 与 daemon `tests/host-fs-handler.test.ts` 各补 case，断言 run_command 拒绝非 gate 模板命令（如 `rm -rf` / `cat /etc/passwd` / 篡改 args 注入），返回明确错误不 exec。
3. **前端 SSE 测试**（AC-9，frontend src 同级 `__tests__/`）：mock `gate_status_changed` SSE 事件推入 agent_run channel，断言徽标 客观核验中→已通过/失败 切换 + 失败摘要读 gate_last_errors 展示。
4. **AC-4 未发版场景**：靠 task-06 的 Z1 探测模拟（mock run_command 输出 gate 子命令缺失诊断），不强制真未发版 npm。
5. 集成测试 mock daemon 侧 run_command（不连真 daemon）；用 in-memory SQLite + gate_result/gate_status 列（task-04 migration 在 apply 前测试库自动建表）。

## AC 演示映射
| AC | 测试位置 | 关键断言 |
|---|---|---|
| AC-1 | test_gate_e2e.py::test_exit0_advances | stage 推进，gate_result.exit_code==0 |
| AC-2 | test_gate_e2e.py::test_exit1_kicks_back | 同 stage 重 dispatch，gate_last_errors 非空 |
| AC-3 | test_gate_e2e.py::test_three_failures_escalate | 第3次 exit2，无新 dispatch |
| AC-4 | test_gate_e2e.py::test_gate_exception_blocks | gate_status=failed, exit_code=2 |
| AC-5 | test_gate_e2e.py::test_close_returns_fast | close 耗时<30s（gate mock 30s+） |
| AC-6 | test_gate_e2e.py::test_reconcile_after_restart | running→pending→重 enqueue→推进 |
| AC-7 | test_gate_e2e.py::test_double_fire_cas | run_command 调用计数==1 |
| AC-8 | backend+daemon 白名单测试 | 非 gate 命令被拒 |
| AC-9 | frontend __tests__ | SSE 推送后徽标切换 |

## 验收
AC-1~AC-9 全部可演示/可测；三端全量测试零回归。

## 约束
- 不修改非测试源码（若发现实现缺陷，记录并回退对应 task 修，不在本 task 改）。
- AC-4 sillyspec 未发版靠 Z1 探测模拟，不强制真未发版。
- 集成测试 mock daemon 侧 run_command，不连真 daemon / 不真跑 27s gate。
- migration（task-04）apply 前用测试库建表；PG 迁移部署验证留变更收尾非本 task。

## verify
```
cd backend && uv run pytest -q
cd sillyhub-daemon && pnpm test
cd frontend && pnpm test
```
