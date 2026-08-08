---
author: qinyi
created_at: 2026-08-08 21:30:00
revised_at: 2026-08-08 22:10:00
scale: large
risk_level: contract-required
review_round: 2 (Design Grill round-1 发现 3 P1:漏 daemon 子域/team 矛盾/tool 包装目标;round-2 据调研修订)
---

# 设计文档（Design）— 变更中心按需触发（形态A 减负）

> 形态A：减负 backend `auto_dispatch` 自动连轴（跑不下去的根因），保留 SillySpec 阶段流程 + 文档产出 + gate 核验价值，改 MCP/人按需触发 change 阶层。
> **round-2 修订**：round-1 Design Grill 抓到 3 P1——① 文件清单漏 daemon 子域（auto_dispatch 真正调用方在 daemon 不在 change）；② team 路径（_advance_team_stage）依赖 auto_dispatch 与"正交"非目标矛盾；③ MCP tool 包装的 ChangeService.review()/gate() 方法不存在。本版据 daemon 子域调研（6 调用点 + single/team 分流）修订。

## 1. 背景

变更中心（`backend/app/modules/change`）是"平台化 SillySpec"阶段状态机：brainstorm→plan→execute→verify→archive。用户反馈**整体流程跑不下去**。根因在 `auto_dispatch_next_step`（`change/dispatch.py:240`，~330 行）自动连轴 + 它依赖的两件脆弱事（sillyspec.db RPC 同步 + sillyspec gate verify 子命令未发版）。

**round-2 关键纠正（调研证实）**：`auto_dispatch_next_step` 的真正调用方在 **daemon 子域**，不在 change 子域。6 个调用点：
- ① `daemon/run_sync/service.py:1387`（`_run_gate_decision_task` verify gate 完成后推进）
- ② `daemon/lease/service.py:542`（`complete_lease` → facade）→ `daemon/service.py:458` facade → ③
- ③ `daemon/run_sync/service.py:1617`（`_trigger_stage_completion_callback` single 分支）
- ④ `daemon/run_sync/service.py:1752`（`_advance_team_stage` team 推进 execute→verify→archive）
- ⑤ `change/dispatch.py:655`（`reconcile_stale_runs` 恢复推进）
- 被调 `change/dispatch.py:240` auto_dispatch_next_step

stage 完成有**两个独立触发源**：gate task（`close_interactive_run` spawn，run_sync:1153）+ stage callback（`complete_lease` → facade，lease:542）。single 走 sillyspec.db sync，team 伪造 StageSyncResult 绕过 sync（`_advance_team_stage` :1743）。

## 2. 设计目标

- **砍 auto_dispatch 自动连轴 + sillyspec.db 自动同步 + gate 硬阻塞**（6 调用点全改）。
- **保留 SillySpec 价值**（CLAUDE.md 第 1 条）：阶段流程 + 文档产出 + gate 核验（改触发方式）。
- **改按需触发**：阶段完成后 change 停"待触发"，MCP/前端显式调 change 阶层 tool 推进。
- **team 模式不回归**：`_advance_team_stage` 保留 complete_stage 桥，删 dispatch；下一 stage team mission 交 advance_change_stage tool 显式触发 `_dispatch_execute_team`。
- **零回归**：dispatch-worker（2026-08-08）链路零影响（执行层，不碰 change.current_stage）；既有 HTTP 调用方不变。

## 3. 非目标

- **不砍阶段流程**（形态B，违反 CLAUDE.md 第 1 条）。
- **不改 SillySpec 工具**（gate 子命令发版是工具侧事，绕过）。
- **不改 AgentRun/AgentMission 模型 / OrchestratorService.schedule_loop / converge_mission_for_completed_run**（mission 内部 finalize 与 auto_dispatch 无关，保留）。
- **不改 dispatch-worker 链路**（2026-08-08 执行层 MCP 派活，正交，零影响——调研证实 dispatch_worker 不碰 change.current_stage）。
- **team stage 推进纳入范围**（round-2 修订：`_advance_team_stage` 重写，非"正交不动"）。

## 4. 总体方案

### 4.1 调用链与改造点（round-2 据调研重画）

```
现在（auto_dispatch 自动连轴，6 调用点）:
  AgentRun 完成
    ├ close_interactive_run(:1153) spawn gate task → _run_gate_decision_task(:1266)
    │   → _run_gate_via_delegate 跑 gate(:1349) → 【①:1387】auto_dispatch 推进 verify
    └ complete_lease(:287)
        → 【②:542facade→:458】_trigger_stage_completion_callback(:1550)
            ├ single(:1617)【③】sync_stage_status + auto_dispatch
            └ team(:1630 _handle_team_run_completion → :1685 _advance_team_stage)
                → merge_gate_results + 伪造 StageSyncResult → 【④:1752】auto_dispatch 推进 team stage
        → converge_mission_for_completed_run(:619)【保留,mission finalize 与 auto_dispatch 无关】
  reconcile_stale_runs(:589) → 【⑤:655】auto_dispatch 恢复推进

形态A（砍 auto_dispatch，每点改造）:
  ① gate task(:1266): 只存 gate_result + gate_status=decided + 发 SSE; 删 :1387 sync+auto_dispatch 块
  ② complete_lease(:542) facade: 保留调用(callback 行为变轻)
  ③ single callback(:1617): 删 auto_dispatch; 只 sync_stage_status(或标记 stage_completed 待触发)+发 SSE
  ④ _advance_team_stage(:1685): 保留 merge_gate_results + complete_stage(推进 current_stage); 删 :1752 auto_dispatch; 发 SSE 留痕
  ⑤ reconcile_stale_runs(:589): 剥离 :655 auto_dispatch; 保留 stale run 清理(释放 has_active_run)
  被调 auto_dispatch_next_step(:240): 整函数删除(complete_stage/gate 决策/dispatch 下沉到 MCP tool)

按需触发（新）:
  用户/Agent 调 advance_change_stage(change_id, target_stage) MCP tool
    → ChangeService.transition_with_dispatch(:721)
    → SillySpecStageDispatchService.dispatch_next_step(:1626)
    → team_mode=True 分流 → _dispatch_execute_team(:1130,建 team mission)
    或 single → AgentService.start_stage_dispatch
```

### 4.2 Phase 划分

- **P1 砍 auto_dispatch + daemon 子域改造**：删 `auto_dispatch_next_step`(:240)；改 6 调用点（gate task/single callback/team advance/reconcile）；补 daemon/run_sync + daemon/service + daemon/lease 文件。
- **P2 补 mcp_gateway change 阶层 tool**：4 tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage），明确实现路径（§6.1）。
- **P3 前端按需触发**：handleDispatch/triggerDispatch 接 change 阶层（HTTP 端点，§6.1 补端点契约）。
- **P4 测试 + 文档**：砍 auto_dispatch 回归（test_auto_dispatch_gate/test_gate_retry/test_reconcile_gate 改写）+ change 阶层 tool 测试 + team 推进重写测试 + 模块文档。

### 4.3 team 推进重写（核心，round-2 新增）

`_advance_team_stage`(:1685) 不能整个删——它是 team mission 收敛→change.current_stage 推进的唯一桥。改造：
- **保留**：`merge_gate_results`（verify 合并 worker gate，:1720）+ `ChangeService.complete_stage(team_stage)`（推进 current_stage + 落 pending_review）。
- **删**：`:1752` auto_dispatch（不再自动 dispatch 下一 stage）。
- **下一 stage team mission**：用户/Agent 调 `advance_change_stage(change_id, "verify"/"archive")` MCP tool → `transition_with_dispatch` → `dispatch_next_step` team 分流 → `_dispatch_execute_team` 建 verify/archive mission。
- `schedule_loop`（orchestrator:263）+ `converge_mission_for_completed_run`（lease:619）完全保留（mission finalize，与 auto_dispatch 无关）。

## 5. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/dispatch.py | **删** `auto_dispatch_next_step`(:240 ~330行) + `_run_gate_via_delegate` 硬阻塞逻辑下沉；**剥离** `reconcile_stale_runs`(:589) 的 :655 auto_dispatch 调用（保留 stale 清理）；**留** `dispatch()`(:819) + `dispatch_next_step`(:1626) + `_dispatch_execute_team`(:1130) + `_cleanup_before_dispatch`(:772) |
| 修改 | backend/app/modules/daemon/run_sync/service.py | **删** :1387（gate task auto_dispatch 块）+ :1617（single callback auto_dispatch）+ :1752（team advance auto_dispatch）；`_advance_team_stage`(:1685) 重写（保留 merge_gate_results + complete_stage，删 dispatch）；gate task(:1266) 只存结果 |
| 修改 | backend/app/modules/daemon/service.py | :458 facade 保留委托骨架（被委托方法行为变轻） |
| 修改 | backend/app/modules/daemon/lease/service.py | :542 `_trigger_stage_completion_callback` 保留（callback 改轻）；:619 `converge_mission_for_completed_run` 完全保留 |
| 修改 | backend/app/modules/change/service.py | `complete_stage`/`transition_with_dispatch` 保留（按需触发用）；移除 auto_dispatch 调用 |
| 新增 | backend/app/modules/mcp_gateway/tools.py | 4 change 阶层 tool（§6.1），包装 ChangeService 现有方法（complete_stage/transition_with_dispatch/rerun_stage）+ gate 结果读取 |
| 修改 | backend/app/modules/change/router.py | review gate 端点保留；补 change 阶层 HTTP 端点（POST /advance-stage + /run-verify-gate，与 MCP tool 对齐，前端走 HTTP） |
| 修改 | backend/app/modules/change/schema.py | 新增 `VerifyGateResponse` DTO（exit_code/errors/source 三态，task-11） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | handleDispatch（保留调 triggerDispatch 重派当前阶段）+ 新增 handleAdvance/handleRunVerifyGate 接 change 阶层 HTTP + 审核链路收敛到 submitStageReview（task-12/13） |
| 修改 | frontend/src/lib/changes.ts | advanceChangeStage/runVerifyGate/submitStageReview 客户端方法（task-12/13） |
| 新增 | backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py | 4 change 阶层 tool 测试（task-15） |
| 新增 | backend/app/modules/daemon/tests/test_advance_team_stage.py | team 推进重写测试（_advance_team_stage complete_stage 桥不连轴，task-16） |
| 修改 | backend/app/modules/change/tests/test_auto_dispatch_gate.py | 砍 auto_dispatch 回归改写（按需触发语义，task-14） |
| 修改 | backend/app/modules/change/tests/test_gate_retry.py | gate 重试改写（结果只落 gate_result 不推进，task-14） |
| 修改 | backend/app/modules/change/tests/test_complete_stage.py | complete_stage 持久化契约 + 不自动 dispatch（task-16） |
| 修改 | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | dispatch_next_step team 分流 _dispatch_execute_team（task-16） |
| 修改 | backend/app/modules/daemon/tests/test_run_sync_gate_decision_task.py | gate decision task 新语义改写（只存结果+SSE，task-17） |
| 修改 | backend/app/modules/daemon/tests/test_team_change_lifecycle.py | team lifecycle 精简（删 TestAdvanceTeamStage 已被 task-16 覆盖，task-17） |
| 修改 | backend/app/modules/daemon/tests/test_lease_service.py | lease 测试基线修复（import LlmProvider，task-17） |
| 删除 | backend/tests/modules/change/test_auto_dispatch.py | legacy 旧测试根引用已删 auto_dispatch_next_step，被 app/modules/change/tests/ 新版本替代（task-06 残留清理） |
| 删除 | backend/tests/modules/change/test_dispatch_chain.py | 同上 |
| 删除 | backend/tests/modules/change/test_e2e_stage_dispatch.py | 同上 |
| 删除 | backend/tests/test_gate_e2e.py | 同上（被 test_run_sync_gate_decision_task 替代） |
| 修改 | backend/tests/modules/change/test_dispatch.py | 删 test_dispatch_sync_auto_dispatch_chain 用例（同上） |
| 修改 | .sillyspec/docs/backend/modules/{_module-map.yaml,change.md,daemon.md,mcp_gateway.md} + multi-agent-platform/flows/{change-lifecycle.md,sillyspec-workflow.md} + frontend/modules/lib-changes.md + SillyHub/{glossary.md,modules/change.md} | 模块文档同步：砍 auto_dispatch + 4 tool + 2 HTTP 端点 + team 重写 + 前端按需触发（task-18） |

不改：AgentRun/AgentMission 模型、OrchestratorService.schedule_loop、converge_mission_for_completed_run、placement.py、dispatch-worker（2026-08-08）。

## 6. 接口定义

### 6.1 MCP change 阶层 tool（4 个，实现路径明确）

| Tool | 输入 | 实现路径（包装的现有方法） | scope |
|---|---|---|---|
| `advance_change_stage` | change_id, target_stage, provider?, model?, team_mode? | `ChangeService.transition_with_dispatch`(:721) → `dispatch_next_step`(:1626) → single/team 分流 | dispatch |
| `submit_stage_review` | change_id, stage, decision, comment? | review 现有逻辑（`proposal_review`/`plan_review`/`human_test`/`archive_confirm` service.py:1309+，调 `rerun_stage`/`transition_with_dispatch`） | dispatch |
| `run_verify_gate` | change_id | 读 `_read_latest_gate_result`（AgentRun.gate_result，dispatch.py:148）或调 gate cmd（§6.2）；**不调** _run_gate_via_delegate（已下沉） | read |
| `get_change_stage` | change_id | `ChangeService.get` + stages JSON + `StageProjectionService.compute_pending_review`（只读，替代 sillyspec.db 自动同步） | read |

注：round-1 误以为 ChangeService 有 review()/gate() 方法——实际 review 走 service.py:1309+ 四个方法，gate 结果存 AgentRun.gate_result。本版据实修正。

### 6.2 gate 软调用语义（run_verify_gate，round-2 修 daemon 可达）

1. **优先**读 `AgentRun.gate_result`（gate task :1266 已跑过并存库，run_sync:1364）→ `{exit_code, errors}`（source=gate_result）。
2. gate_result 缺（gate 未跑）→ 调 `sillyspec gate verify` 经 HostFsDelegate.run_command（白名单 + 12min timeout，复用 _run_gate_via_delegate 的 RPC 骨架但作 tool 显式调，不自动阻塞）→ source=gate_cmd。
3. 都不可用 → source=unavailable，exit_code=null（交调用方决策）。
4. **删 round-1 的 verify-result.md fallback**（daemon 模式容器够不到宿主机文件，host_fs/delegate.py:14 明示；现有 read_verify_result 在 daemon 部署下本就是死的）。

### 6.3 HTTP 端点（前端走 HTTP，与 MCP tool 对齐）

补 `POST /changes/{id}/advance-stage` + `POST /changes/{id}/run-verify-gate`（与 MCP tool 同 service 方法），前端 handleDispatch 调。

## 7. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| advance_change_stage | MCP/前端 | ChangeService.transition_with_dispatch | change_id, target_stage | current_stage → target_stage（不自动连轴） |
| submit_stage_review | MCP/前端 | ChangeService.review(proposal/plan/human_test/archive_confirm) | change_id, stage, decision | 推进/打回（单步） |
| run_verify_gate | MCP/前端 | 读 gate_result / gate cmd（软） | change_id | 无状态变化（结果交决策） |
| get_change_stage | MCP/前端 | ChangeService.get（只读） | change_id | 无（替代 sillyspec.db 自动同步） |
| team mission 收敛 | _advance_team_stage | ChangeService.complete_stage | team_stage | current_stage 推进 + pending_review（不自动 dispatch 下一 stage） |
| gate task 完成 | _run_gate_decision_task | 落 AgentRun.gate_result | gate_result | 无（只存结果，不推进） |

**不再有**：auto_dispatch 自动连轴（6 调用点全删/改）、sillyspec.db 自动 RPC 同步、gate 硬阻塞 exit 2 卡死、reconcile 恢复推进。

## 8. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 砍 auto_dispatch 后阶段流转需显式触发，忘了推进则 change 停滞 | P2 | 文档 + 前端按钮提示 + get_change_stage 查 pending_review |
| R-02 | gate 软调用（run_verify_gate）不硬阻塞，可能跳过核验 | P2 | tool 返回 exit_code/errors 交决策；核验纪律靠调用方 |
| R-03 | sillyspec.db 同步改按需后 change 状态滞后 | P2 | get_change_stage 按需查；推进前显式 refresh |
| R-04 | **team 推进重写**（_advance_team_stage 砍 auto_dispatch，下一 stage 交 tool） | P1 | §4.3 重写方案 + team 推进重写测试（P4）；advance_change_stage tool 必须能触发 _dispatch_execute_team |
| R-05 | 砍 dispatch.py + daemon 子域 ~600 行，回归面大（6 调用点 + test_auto_dispatch_gate 等） | P1 | 逐调用点改 + 逐测试改写；single/team 分流分别测 |
| R-06 | gate task(:1266) 改只存结果后，verify 推进靠 advance_change_stage 读 gate_result——gate_result 落库时序 | P2 | gate task 落 gate_result 后发 gate_status_changed SSE，前端/agent 据此调 advance |
| R-07 | reconcile 剥离 auto_dispatch 后，stale run 清理仍需（释放 has_active_run） | P2 | 保留 reconcile 的 stale 清理（:619-634），只删 :655 推进 |

## 9. 决策追踪

| 决策 | 内容 | 章节 |
|---|---|---|
| D-001@v1 | 砍 auto_dispatch_next_step 自动连轴（6 调用点全改） | §4.1/§5 |
| D-002@v1 | sillyspec.db 自动同步改按需（get_change_stage tool）/废弃 | §4.2 P1/§6.1 |
| D-003@v1 | gate 硬阻塞改 run_verify_gate MCP tool 软调用（读 gate_result/gate cmd，不阻塞） | §4.3/§6.2 |
| D-004@v1 | 补 4 个 mcp_gateway change 阶层 tool（包装现有 service 方法，非新方法） | §4.2 P2/§6.1 |
| D-005@v1 | 前端复用 handleDispatch/triggerDispatch 接 change 阶层 HTTP 端点 | §4.2 P3/§6.3 |
| D-006@v1 | **team 推进重写**（_advance_team_stage 保留 complete_stage 删 dispatch，下一 stage 交 advance_change_stage tool）【round-2 新增，解 P1 X-003】 | §4.3/§5/R-04 |
| D-007@v1 | reconcile_stale_runs 剥离 auto_dispatch，保留 stale 清理【round-2 新增，解 P2 X-006】 | §5/R-07 |
| D-008@v1 | gate fallback 删 verify-result.md（daemon 不可达），改读 gate_result/gate cmd【round-2 修订，解 P2 X-005】 | §6.2 |

## 10. 自审（Self-Review，round-2）

- ✅ 必填章节齐全 + 生命周期契约表（§7，标注不再有的 6 调用点事件）。
- ✅ **round-1 P1 全解**：§5 补 daemon 子域 3 文件（run_sync/service.py + daemon/service.py + lease/service.py）；§3 team 路径纳入范围（D-006 重写）；§6.1 tool 实现路径据实（包装现有 service 方法，非不存在的 review()/gate()）。
- ✅ **round-1 P2 全解**：§6.2 删 verify-result.md fallback（D-008，daemon 不可达）；§5 reconcile 剥离 auto_dispatch（D-007）。
- ✅ 调研证实：dispatch-worker（2026-08-08）零影响（不碰 change.current_stage）；schedule_loop + converge_mission_for_completed_run 保留。
- ⚠️ 自审存疑（交 plan/Grill round-3）：① gate_result 落库时序（R-06，gate task 完成后 advance 读）；② team 推进重写的测试覆盖（R-04，P4）；③ 6 调用点改造的回归面（R-05，plan 细化测试）；④ frontend HTTP vs MCP（D-005 选 HTTP，§6.3 补端点）。
- scale: large（跨 change/daemon/mcp_gateway/前端 + 状态机砍除 + team 重写）；tier=independent（跨子域架构）。
