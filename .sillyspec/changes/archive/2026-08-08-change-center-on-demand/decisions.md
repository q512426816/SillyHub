---
author: qinyi
created_at: 2026-08-08 21:30:00
---

# 决策台账（Decisions）— 变更中心按需触发（形态A 减负）

## D-001@v1 — 砍 auto_dispatch_next_step 自动连轴

- **type**: architecture
- **status**: decided
- **source**: 用户反馈"整体流程跑不下去" + 根因定位（dispatch.py:240 auto_dispatch_next_step ~330行自动连轴）
- **question**: 阶段完成后是否继续由 backend 自动决定派下一阶段？
- **answer**: 否。砍 auto_dispatch_next_step，阶段完成后 change 停在"待触发"，由 MCP/前端显式推进。
- **normalized_requirement**: 阶段流转从"backend 自动连轴"改"按需显式触发"
- **impacts**: dispatch.py（砍 ~330 行）、service.py（complete_stage 不触发 auto_dispatch）、test_auto_dispatch_gate/test_gate_retry/test_reconcile_gate（失效/改写）
- **evidence**: dispatch.py:240（auto_dispatch_next_step）+ 用户影响面对比（形态A C 类）
- **priority**: P0

## D-002@v1 — sillyspec.db 自动 RPC 同步改按需/废弃

- **type**: architecture
- **status**: decided
- **source**: sillyspec.db RPC 同步脆弱（latin-1 字节往返，任一环断 synced=False）
- **question**: 阶段状态是否继续由 backend 自动从 sillyspec.db 同步？
- **answer**: 否。砍自动同步（_sync_stage_status_daemon_client），改 get_change_stage MCP tool 按需查 change 状态（current_stage + stages JSON）。
- **normalized_requirement**: 阶段状态查询从"自动同步"改"按需查"
- **impacts**: dispatch.py（砍 _sync_stage_status_daemon_client）、mcp_gateway/tools.py（get_change_stage tool）
- **evidence**: dispatch.py:1926（_sync_stage_status_daemon_client）+ 用户影响面对比
- **priority**: P0

## D-003@v1 — gate 硬阻塞改 MCP tool 软调用

- **type**: architecture
- **status**: decided
- **source**: verify 阶段强依赖 sillyspec gate verify 子命令（未发版永久 gate_blocked exit 2 卡死）
- **question**: gate 核验是否继续硬阻塞流程？
- **answer**: 否。砍硬阻塞（_run_gate_via_delegate 自动卡死），改 run_verify_gate MCP tool 软调用（调 gate 命令或读 verify-result.md fallback，返回 exit_code/errors 交决策，不阻塞）。
- **normalized_requirement**: gate 核验从"硬阻塞"改"软调用结果交决策"
- **impacts**: dispatch.py（砍 _run_gate_via_delegate 硬阻塞 + gate 三态决策）、mcp_gateway/tools.py（run_verify_gate tool）
- **evidence**: dispatch.py:1404（_run_gate_via_delegate）+ 用户影响面对比
- **priority**: P0

## D-004@v1 — 补 4 个 mcp_gateway change 阶层 tool

- **type**: feature
- **status**: decided
- **source**: 形态A 需要统一按需触发入口
- **question**: change 阶层流转的触发入口？
- **answer**: 补 4 个 mcp_gateway change 阶层 tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage），包装 ChangeService，与现有 8 个 mission 层 tool 并列。
- **normalized_requirement**: change 阶层 MCP tool 作统一按需触发入口
- **impacts**: mcp_gateway/tools.py（4 新 tool）、mcp_gateway/tests（test_change_stage_tools）
- **evidence**: mcp_gateway/tools.py 现有 8 tool 模式 + design §6.1
- **priority**: P0

## D-005@v1 — 前端复用现有按需触发按钮

- **type**: ui
- **status**: decided
- **source**: 前端已有 handleDispatch/triggerDispatch 按需触发雏形（用户影响面调研发现）
- **question**: 前端阶段触发按钮改法？
- **answer**: 复用现有 handleDispatch/triggerDispatch（config_enabled && !has_active_run 时显示），接 change 阶层（HTTP 端点或 MCP tool，P3 定）。
- **normalized_requirement**: 前端复用按需触发按钮，不重写阶段 UI
- **impacts**: frontend changes/[cid]/page.tsx（handleDispatch 接 change 阶层）
- **evidence**: 前端影响面调研（handleDispatch/triggerDispatch）+ design §4.2 P3
- **priority**: P1
