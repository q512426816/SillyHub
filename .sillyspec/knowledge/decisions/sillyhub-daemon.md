# 决策知识 — sillyhub-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-002@v1 : 采用方案 A 复用现有 SSE 事件通道
状态：implemented
锚点：`backend/app/modules/daemon/run_sync/service.py`
最近确认：04bb45fe
理由：方案 A，复用现有 Redis `agent_session:{id}` 频道，新增 `plan_mode_entered` / `bash_status` / `bash_chunk` 事件类型。
