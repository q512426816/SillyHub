---
author: qinyi
created_at: 2026-08-08 22:07:31
---

# 需求（Requirements）— 变更中心按需触发（形态A 减负）

## 功能需求

### FR-01 砍 auto_dispatch 自动连轴
`auto_dispatch_next_step`（dispatch.py:240）整函数删除；6 调用点全改造（①gate task run_sync:1387 ②lease facade:542 ③single callback:1617 ④team advance:1752 ⑤reconcile dispatch:655），无运行时 ImportError。覆盖 D-001。

### FR-02 sillyspec.db 自动同步废弃
`sync_stage_status` 自动同步改按需（get_change_stage tool）/废弃；不再 backend 自动 RPC 阻塞流转。覆盖 D-002。

### FR-03 gate 硬阻塞改软调用
`_run_gate_via_delegate` 硬阻塞下沉；`run_verify_gate` MCP tool 读 gate_result/gate cmd 软调用，不硬阻塞。覆盖 D-003。

### FR-04 补 4 个 change 阶层 MCP tool
advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage，包装 ChangeService 现有方法（transition_with_dispatch :721 / review 四方法 :1309+ / complete_stage :1540 / get :176）。覆盖 D-004。

### FR-05 team 推进重写
`_advance_team_stage`（run_sync:1685）保留 merge_gate_results + complete_stage，删 :1752 auto_dispatch；下一 stage team mission 交 advance_change_stage tool → dispatch_next_step team 分流 → _dispatch_execute_team。覆盖 D-006。

### FR-06 前端按需触发
handleDispatch/triggerDispatch 接 change 阶层 HTTP 端点（/advance-stage /run-verify-gate）。覆盖 D-005。

### FR-07 reconcile 剥离 auto_dispatch
reconcile_stale_runs（dispatch.py:589）剥离 :655 auto_dispatch 调用，保留 stale run 清理（释放 has_active_run）。覆盖 D-007。

### FR-08 gate fallback daemon 可达
run_verify_gate fallback 删 verify-result.md（daemon 模式容器够不到宿主机文件），改读 AgentRun.gate_result / 调 gate cmd。覆盖 D-008。

## 决策覆盖矩阵
D-001(FR-01) / D-002(FR-02) / D-003(FR-03) / D-004(FR-04) / D-005(FR-06) / D-006(FR-05) / D-007(FR-07) / D-008(FR-08)。D-001~D-008 全覆盖，无剩余风险。

## 非功能需求
- **零回归**：dispatch-worker（2026-08-08）零影响（执行层不碰 change.current_stage）；single/team 模式除 stage 推进改按需外行为不变
- **生产级**：6 调用点改造 + 逐测试改写 + 模块文档同步（change/daemon/mcp_gateway）
- **跨平台**：Windows/Linux/macOS（daemon RPC 路径正斜杠）
