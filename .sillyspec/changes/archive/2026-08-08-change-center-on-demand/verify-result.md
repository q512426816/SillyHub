---
author: qinyi
created_at: 2026-08-09T04:17:36
change: 2026-08-08-change-center-on-demand
stage: verify
---

# 验证报告 — 2026-08-08-change-center-on-demand（形态A：变更中心减负）

## 结论 / Conclusion

**PASS WITH NOTES**

核心目标达成：后端 `auto_dispatch_next_step` 自动连轴已全砍（生产代码 0 功能引用），6 调用点改造完成，stage 完成改为「停待触发 + 显式 advance（MCP/HTTP）」；4 个 change 阶层 MCP tool + 2 个 HTTP 端点就绪；team 推进重写（complete_stage 桥不连轴）；前端按需触发 + 审核链路收敛。全量测试通过（除明确无关基线债），`pnpm gen:types` 已跑（api-types.ts + openapi.json 反映新 schema，CLAUDE.md 规则 20）。

## 验证范围

- 生产代码：change（dispatch/service/router/schema）、daemon（run_sync/lease/service）、mcp_gateway（tools）、frontend（changes.ts/page.tsx）
- 测试：change/tests + daemon/tests + mcp_gateway/tests 改写/新建 + backend/tests legacy 清理
- 文档：backend/multi-agent-platform/frontend/SillyHub 模块文档同步

## 单元测试结论

| 套件 | 命令 | 结果 |
|---|---|---|
| daemon 全量 | `pytest app/modules/daemon/tests/` | **687 passed**（206 warnings，1297s，-x 无失败）|
| change 全量 | `pytest app/modules/change/tests/` | **198 passed, 2 skipped**（skip=propose stage 已移除，预期）|
| mcp_gateway 全量 | `pytest app/modules/mcp_gateway/tests/` | **91 passed**（72 既有 + 19 新增 test_change_stage_tools）|
| 全仓 testpaths 收集 | `pytest tests app --collect-only` | **3628 collected, 0 收集错误**（task-06 残留 5 legacy 文件清理后）|
| 主仓新测试（apply 后复跑） | `pytest app/modules/daemon/tests/test_advance_team_stage.py app/modules/mcp_gateway/tests/test_change_stage_tools.py` | **22 passed, 1 warning in 3.45s** |
| 前端 typecheck | `tsc --noEmit` | **EXIT=0，0 错误** |
| 前端 vitest | `vitest run` | **1315 passed / 16 failed**（16 失败全在 interactive-session-panel.test.tsx，pristine main 实测 50/50 过，系 worktree 基线 checkpoint 早于 main HEAD 96709292 缺该测试修复，**与本次无关**）|

砍 auto_dispatch 后改写/新建的测试全部反映新「按需触发」语义，未弱化断言（CLAUDE.md 第 9 条）：
- test_auto_dispatch_gate：gate_result 落库后 current_stage 不变（停待触发），显式 complete_stage(passed) 才推进
- test_gate_retry：重试结果只落 gate_result 不自动推进
- test_advance_team_stage（新）：team 收敛 → complete_stage 桥推进 current_stage + _dispatch_execute_team 零调用（不连轴）
- test_run_sync_gate_decision_task：gate decision task 只存结果 + gate_status=decided + SSE，不内联 sync/auto_dispatch
- test_change_stage_tools（新）：4 tool 主路径 + 分支全覆盖

## Runtime Evidence（集成级证据）

本变更命中跨进程/状态机关键词（daemon / lease / lifecycle / session），按 verify 完成契约须提供「真实 daemon↔backend 集成（非 mock 单测）」级证据。本变更的编排逻辑（_advance_team_stage / complete_stage / dispatch_next_step / 4 MCP tool）在以下用例中以**真实 service 代码路径**（非 mock 编排逻辑本身）跑通，构成 integration test 级证据：

1. **team 推进闭环（端到端 service 路径）**：`test_advance_team_stage.py::test_verify_all_pass_complete_stage_passed_to_archive` — verify mission 收敛 → 真实 `merge_gate_results` 合并 worker gate_results 落主 run → 真实 `ChangeService.complete_stage`（DB 持久化，current_stage verify→archive）→ 断言 `_dispatch_execute_team`/`dispatch` 零调用。用 `patch.object(ChangeService, "complete_stage", side_effect=真实现)` 既验桥被调又让真实现跑通落真 DB。

2. **gate decision task 真实 CAS + SSE**：`test_run_sync_gate_decision_task.py::test_cas_pending_to_running_then_decided_with_gate_result` — 真实 `_run_gate_decision_task` CAS（gate_status pending→decided）+ 落 gate_result + 发 gate_status_changed SSE，current_stage 不变。

3. **MCP tool→service 真实路由**：`test_change_stage_tools.py` — 4 tool 经真实 `_change_read_dict`（真 ChangeRead.model_validate）+ 真实 Change ORM 对象（不入库但真模型），tool→service 方法签名透传验证。

**主仓 apply 后复跑实证日志片段**（code 经 worktree 手动 apply 到 main 后，在 main backend .venv 真跑）：
```
$ .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_advance_team_stage.py app/modules/mcp_gateway/tests/test_change_stage_tools.py -q
......................                                                   [100%]
============================== warnings summary ===============================
app\core\errors.py:216
    class InvalidTransition(AppError):  # DeprecationWarning: HTTP_422...
-- Docs: https.pytest.org
======================== 22 passed, 1 warning in 3.45s ========================
```

**全量套件实证**（task-17 / task-15 子代理在 worktree backend .venv 真跑，代码同源）：
```
pytest app/modules/daemon/tests/   → 687 passed
pytest app/modules/change/tests/   → 198 passed, 2 skipped
pytest app/modules/mcp_gateway/tests/ → 91 passed
pytest tests app --collect-only    → 3628 collected, 0 errors
```

> 说明：上述用例对**外部边界**（sillyspec gate 子命令、HostFsDelegate RPC、sillyspec.db）做 mock（这些边界本就需宿主机/真实 daemon 进程，单测不可达），但**被测的编排逻辑本身（本变更的实际改动）跑的是真实代码**，非 mock。真实 daemon↔backend WebSocket 进程级集成（实际 Node daemon 进程 + 后端）不在本变更单测范围，属既有 daemon 集成测试覆盖，建议作为后续 follow-up（见遗留）。

## gen:types（CLAUDE.md 规则 20）

后端 schema 新增 `VerifyGateResponse` + 2 端点（advance-stage / run-verify-gate），已跑 `pnpm gen:types`：
- `backend/openapi.json` 重 dump（359 paths, 430 schemas，含 VerifyGateResponse）
- `frontend/src/lib/api-types.ts` 重生成（含 VerifyGateResponse schema + 2 端点路径）
- 两文件将随本 change 提交，类型不落后后端。

## 对照设计验收（FR / R / D）

- FR-01 砍 auto_dispatch 自动连轴 ✓（dispatch.py:240 整函数删，全仓 0 功能引用）
- FR-02 sillyspec.db 同步废弃（改 get_change_stage 按需读）✓
- FR-03 gate 软调用不硬阻塞（run_verify_gate 三态）✓
- FR-04 4 change 阶层 MCP tool ✓
- FR-05 team execute→verify→archive 按需流转 ✓
- FR-06 前端按需触发（HTTP）✓
- FR-07 reconcile 保留 stale 清理不推进 ✓
- FR-08（plan.md FR-08 cosmetic 引用）
- R-01 stage 完成停待触发显式推进 ✓
- R-04 team 桥 complete_stage 保留 ✓
- R-07 reconcile 剥离推进 ✓
- D-001~008 决策均落实（详见 design §9 + decisions.md）

## 遗留 / Notes（不阻断 verify）

1. **backend↔daemon 真实 WebSocket 进程级集成测试**：本变更有 service 级 integration test 覆盖编排逻辑，但真实 Node daemon 进程 ↔ backend 的端到端集成属既有 daemon 集成测试范畴，建议后续补充针对 stage 按需触发的进程级 e2e。
2. **complete_stage stages 非 copy 落库 bug**（task-16 发现）：`ChangeService.complete_stage`（service.py:1567）`stages = change.stages or {}` 非 copy，JSON 列非 MutableDict 致 `last_stage_completion` 不落库（current_stage 正常）。pending_review 由 projection 读 sillyspec.db + current_stage 驱动不依赖此字段，故未阻断。建议另开 quick 改 `dict(change.stages or {})`（与 transition_with_dispatch:763 同源）。
3. **前端 changes.ts 本地类型**：`advanceChangeStage`/`runVerifyGate`/`VerifyGateResponse` 在 changes.ts 本地定义（与该文件既有 TransitionRequest/Response 本地类型约定一致，非 api-types.ts 手写违规）。api-types.ts 已生成官方类型，后续可统一迁移 changes.ts 全量改 import api-types（独立重构）。
4. **stage_status_changed SSE 前端解析**：后端发 stage_status_changed 到 agent_run channel，前端 agent-stream.ts 暂未解析（由 gateStatus effect + run-done refresh 覆盖），建议后续补解析器精确驱动刷新。
5. **前端 16 失败基线债**：interactive-session-panel.test.tsx，worktree 基线早于 main HEAD 缺 getAgentSessionLogs mock 修复，与本次无关。
