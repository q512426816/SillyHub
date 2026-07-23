---
author: qinyi
created_at: 2026-07-12 12:38:20
---

# 任务列表（Tasks）— team 主 agent 动态编排（v2）

> brainstorm 阶段的 Phase 级粗粒度。plan 阶段（`sillyspec run plan`）细化为 Wave + task card。
> 依赖：Phase 2 ← Phase 1；Phase 3 ← 1/2；Phase 4 ← 1-3；Phase 5 ← 1-4；Phase 6 ← 1-5。

## Phase 1 — 主 agent 编排引擎（核心）
- T1.1 backend `agent/model.py`：AgentRun 加 `role='orchestrator'` + `worktree_branch`；AgentMission 加 `worker_preset`（JSON）+ `main_agent_config` + migration
- T1.2 backend `agent/orchestrator.py`（新）：OrchestratorService（调度循环 + 三重收敛）
- T1.3 backend `agent/mcp_tools.py`（新）：MCP endpoint（dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress）
- T1.4 daemon `interactive/driver`：MCP tool 转发（主 agent tool_call → backend）
- T1.5 daemon→backend 反向通道（HTTP + auth token + 权限校验）
- T1.6 主 agent lease 长生命周期（超时配置 + 心跳续期）
- T1.7 单测：orchestrator 调度循环 + MCP tool + lease 续期

## Phase 2 — per-worker worktree + provider/model
- T2.1 backend `agent/execution.py`：dispatch_worker per-worker worktree（git worktree add）+ per-worker provider/model 读取
- T2.2 backend `agent/finalizer.py`：合并多 worker patch（git merge）+ converge_mission 入口
- T2.3 修 v1 断点：`finalize_execute_mission` patch → AgentArtifact 采集（v1 全代码无调用点）
- T2.4 worktree 生命周期（创建/清理 via daemon HostFsDelegate）
- T2.5 单测：per-worker worktree + patch 合并 + worktree 清理

## Phase 3 — UI 配置面板
- T3.1 frontend `mission-console.tsx`：team 配置面板（主 agent 类型/模型 + worker 列表[类型/模型/任务]）
- T3.2 frontend `lib/agent.ts`：CreateMissionInput 加 `worker_preset` + `main_agent_config`
- T3.3 frontend `changes/[cid]/page.tsx`：stage team 配置（worker 预设）
- T3.4 frontend `interactive-session-panel.tsx`：「用团队分析」+ 主 agent 绑 session
- T3.5 frontend team 进度组件（主 agent 决策日志 + worker 进度 + cost bar）

## Phase 4 — 三入口接通 + v1 演进
- T4.1 mission 页入口（配 worker 列表 → 主 agent team）
- T4.2 execute stage 入口（stage team toggle → worker 预设）
- T4.3 verify stage 入口
- T4.4 会话入口（绑 session，主 agent + 默认 worker 模板）
- T4.5 v1 演进：mode 分流（single→v1, team→v2 主 agent）+ GLM fallback（主 agent 不可用降级）

## Phase 5 — 收敛 + 成本控制
- T5.1 三重收敛逻辑（worker 全完 / 主 agent 判断 / 预算超时）
- T5.2 budget_usd 硬截断（mission 级监控 + 强制 converge）
- T5.3 CostBar 展示（主 agent + worker cost 实时）

## Phase 6 — 端到端 + 文档
- T6.1 backend pytest 全量 + frontend vitest 全量零回归
- T6.2 mypy + ruff 全过
- T6.3 e2e 三入口真跑（AC-9，需真 daemon + 多 provider 配置）
- T6.4 模块文档同步（backend.md / frontend.md 变更索引）
- T6.5 ROADMAP 更新

## 依赖图
```
P1 (编排引擎) ──→ P2 (worktree+provider) ──→ P3 (UI 面板) ──→ P4 (三入口+v1演进)
                                                                ↓
                                                           P5 (收敛+成本) ──→ P6 (e2e+文档)
```

## 待 plan 细化（Design Grill P1 待定）
- MCP tool 协议（传输层：HTTP / WS / stdio）
- 主 agent lease 续期机制（daemon 现有 lease 超时配置 + 心跳）
- worker_preset JSON schema（字段 + 校验）
- daemon→backend 反向通道实现（URL 发现 + auth）
- 主 agent 决策循环机制（轮询 vs 事件唤醒）
- 跟 v1 Wave 3-5（未做）的关系（v2 接管 team 范畴，v1 Wave 3-5 合并进 v2 或废弃由 plan 定）
