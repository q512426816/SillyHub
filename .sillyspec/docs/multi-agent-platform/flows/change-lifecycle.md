---
author: qinyi
created_at: 2026-06-24T01:50:01
source_commit: ba87eec
---

# change-lifecycle

## 目标
管理 SillySpec 变更从草稿到归档的完整生命周期，驱动文档与代码一致演进。

## 参与模块
- **backend/change**：变更主实体、阶段枚举、状态转换表（`app/modules/change/model.py` 的 `StageEnum` / 转换 map）
- **backend/workflow**：转换校验、`spec_guardian` 文档完整性检查、审计日志
- **backend/task**：变更下任务（Wave/Task）追踪
- **backend/agent**：各阶段 AgentRun 调度（brainstorm/plan/execute/verify/archive），由 change 阶层按需触发（2026-08-08-change-center-on-demand 起砍掉自动连轴）
- **backend/daemon**：AgentRun 完成 / gate task 完成的 stage 完成留痕（6 调用点：gate task / complete_lease facade / single callback / _advance_team_stage / reconcile；只落结果 + 发 SSE，不自动推进）
- **backend/mcp_gateway**：4 个 change 阶层 MCP tool（advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage），统一按需触发入口
- **backend/change_writer**：Agent 驱动的文档/代码写入
- **frontend**：变更详情页、阶段按钮、进度展示；阶段推进按钮接 advance-stage / run-verify-gate HTTP 端点（handleDispatch / handleAdvance）
- **sillyspec**：CLI 触发、进度按需查询（get_change_stage）、知识库沉淀

## 流程摘要
```text
用户创建变更 (status=DRAFT)
  [backend/change]
        │ transition: DRAFT → SCAN / BRAINSTORM (agent)
        ▼
  SCAN          ← 扫描项目生成架构文档
  BRAINSTORM    ← Agent 生成 proposal.md
  PROPOSE       ← reviewer/agent 审核；不通过回 BRAINSTORM
  PLAN          ← Agent 生成 plan.md（Wave+Task）
  EXECUTE       ← Agent 按 plan 写代码，task: pending→in_progress→completed
  VERIFY        ← 对照 design/plan 验收
        │ 通过: → ARCHIVE   不通过: → BLOCKED (回 PROPOSE/PLAN/EXECUTE)
        ▼
  ARCHIVE       ← reviewer/agent 触发；模块影响分析 + 知识库沉淀
        │ system
        ▼
  ARCHIVED (终态)
```
> 转换表见 `change/model.py:85` 的 `TRANSITION`；`QUICK` 是 SillySpec 快速通道入口（VERIFY ↔ QUICK/BLOCKED）。
> `BLOCKED` 可被 reviewer 解封到 PROPOSE/PLAN/EXECUTE。

## 按需触发（形态A，2026-08-08-change-center-on-demand）

2026-08-08 起砍掉 backend `auto_dispatch_next_step` 自动连轴（D-001），stage 完成改「停待触发 + 显式 advance 才推进」：
- **推进**：AgentRun 跑完 / gate task 跑完只落结果 + 发 SSE，current_stage 不自动推进；由 MCP `advance_change_stage` 或前端 `POST /changes/{id}/advance-stage`（handleDispatch）显式触发 `transition_with_dispatch` → `dispatch_next_step` single/team 分流（D-005）。
- **gate**：`run_verify_gate` MCP tool / `POST /changes/{id}/run-verify-gate` 软调用三态（gate_result / gate_cmd / unavailable），exit_code/errors 交调用方决策，**不硬阻塞**流程（D-003/D-008）。
- **状态查询**：sillyspec.db 自动 RPC 同步改按需——`get_change_stage` MCP tool 只读组合 `ChangeService.get` + stages JSON + `StageProjectionService.compute_pending_review`（D-002）。lease 路径走 daemon `_sync_stage_status_from_run`（不读 sillyspec.db），single 路径 `sync_stage_status` 仅作 sillyspec.db 视图同步、不驱动推进。
- **审核**：`submit_stage_review` 统一入口分发到 proposal/plan/human_test/archive_confirm 四节点，前置 `StageProjectionService.compute_pending_review` 校验（D-004）。
- **不再有**：auto_dispatch 自动连轴（6 调用点全删/改）、sillyspec.db 自动 RPC 同步驱动推进、gate 硬阻塞 exit 2 卡死、reconcile 恢复推进。

## 失败回滚
| 失败点 | 处理 |
|--------|------|
| brainstorm/plan 文档缺失 | workflow.spec_guardian 拦截，阻断转换 |
| propose 审核 (need_plan_review) 不通过 | reviewer 回退到 BRAINSTORM |
| execute 任务失败 | task 标记 failed，保留已完成项 |
| verify 不通过 | VERIFY → BLOCKED，reviewer 决定回退阶段 |
| Agent 执行崩溃 | AgentRun failed，可重新调度 |
