---
author: qinyi
created_at: 2026-08-08 22:07:31
---

# 任务清单（Tasks）— 变更中心按需触发（形态A 减负）

> 细节在 plan 阶段展开（Wave 分组 + task 卡片）。本清单列任务名 + Phase。

## P1 砍 auto_dispatch + daemon 子域改造

- [ ] task: 删 `auto_dispatch_next_step`（change/dispatch.py:240 ~330行）
- [ ] task: 改 `_run_gate_decision_task`（run_sync:1266）只存 gate_result + 发 SSE，删 :1387 auto_dispatch 块
- [ ] task: 改 single callback（run_sync:1617 `_trigger_stage_completion_callback` single 分支）删 auto_dispatch，停在"阶段完成待触发"
- [ ] task: 重写 `_advance_team_stage`（run_sync:1685）保留 merge_gate_results + complete_stage，删 :1752 auto_dispatch
- [ ] task: 剥离 `reconcile_stale_runs`（dispatch.py:589）:655 auto_dispatch，保留 stale 清理
- [ ] task: facade（daemon/service.py:458）+ lease（:542）callback 行为改轻（留痕/发 SSE）
- [ ] task: 改 `_cleanup_before_dispatch`（dispatch.py:772）确认不依赖被删 auto_dispatch

## P2 补 mcp_gateway change 阶层 tool + HTTP 端点

- [ ] task: advance_change_stage tool（包装 transition_with_dispatch :721，team 分流 _dispatch_execute_team）
- [ ] task: submit_stage_review tool（包装 review 四方法 :1309+）
- [ ] task: run_verify_gate tool（读 AgentRun.gate_result / 调 gate cmd，软调用不阻塞）
- [ ] task: get_change_stage tool（只读 ChangeService.get + stages + pending_review）
- [ ] task: HTTP 端点（POST /changes/{id}/advance-stage + /run-verify-gate，前端走 HTTP）

## P3 前端按需触发

- [ ] task: handleDispatch/triggerDispatch（changes/[cid]/page.tsx）接 change 阶层 HTTP 端点
- [ ] task: 收敛三条并存审核链路（gate 面板/transition/旧 approval）

## P4 测试 + 文档

- [ ] task: 砍 auto_dispatch 回归测试改写（test_auto_dispatch_gate / test_gate_retry / test_reconcile_gate）
- [ ] task: change 阶层 4 tool 测试（test_change_stage_tools.py）
- [ ] task: team 推进重写测试（_advance_team_stage complete_stage + 不 dispatch + advance_change_stage 接 _dispatch_execute_team）
- [ ] task: single/team 零回归（既有 change/daemon 测试套件）
- [ ] task: 模块文档同步（change/daemon/mcp_gateway _module-map + 卡片）
