---
author: qinyi
created_at: 2026-07-12 02:55:00
---

# 任务列表（Tasks）

> brainstorm 阶段的 Phase 级粗粒度 task。plan 阶段（`sillyspec run plan`）将细化为 Wave + 具体 task card。
> 依赖：Phase 3 依赖 Phase 2（stage team 模式确立）；Phase 4 依赖 Phase 1（mission 入口）。

## Phase 1 — mission 入口优化（最小，可独立交付）
- T1.1 后端 `agent/schema.py`：MissionCreateRequest 加 `mode` 字段（Literal["single","team"]|None=None）+ `session_id` 可选
- T1.2 后端 `agent/router.py`：create_mission 透传 mode 到 constraints + session_id 绑定
- T1.3 前端 `lib/agent.ts`：CreateMissionInput 加 mode/session_id
- T1.4 前端 `mission-console.tsx`：创建表单加 mode 双卡片选择 + 角色预览 + 预算提示
- T1.5 单测：test_team_mode_dispatch.py（mode 透传 route / single 零回归）

## Phase 2 — execute stage team 接通（复用已有基础）
- T2.1 后端 `change/schema.py`：stage dispatch 加 team_mode 参数
- T2.2 后端 `change/dispatch.py`：execute team_mode 触发入口接 _dispatch_execute_team（已存在 :904）
- T2.3 前端 `changes/[cid]/page.tsx`：execute 阶段加 team toggle（紫色开关）
- T2.4 单测：test_dispatch_execute_team_mode.py（team_mode 触发 + worker 派发）
- T2.5 ⚠️ 风险标注：共享 worktree 并发写（D-006 accepted risk）

## Phase 3 — verify stage team 新增
- T3.1 后端 `change/dispatch.py`：新增 _dispatch_verify_team（仿 execute，verify worker 并行核验）
- T3.2 后端 gate 合并：merge_gate_results helper（策略 A，D-005）+ 接入 verify stage gate
- T3.3 前端 verify 阶段加 team toggle
- T3.4 单测：test_dispatch_verify_team.py + test_merge_gate_results.py（全过/部分失败/exit2 优先 各组合）

## Phase 4 — 会话发起 team（D-001）
- T4.1 后端：create_mission 支持 session_id 绑定（mission 关联 session）
- T4.2 前端 `interactive-session-panel.tsx`：加「💡 用团队分析」按钮
- T4.3 前端新组件 `session-mission-progress.tsx`：会话内嵌 mission 进度（复用 mission-console 的 WorkerRow/CostBar）
- T4.4 前端：mission 完成回传对话（对话流插完成消息 + 摘要）
- T4.5 单测：test_session_team_mission.py（session 绑定 + mission 创建）

## Phase 5 — 端到端验证 + 文档
- T5.1 单测全量回归（backend pytest + frontend vitest）
- T5.2 e2e 四入口真跑（AC-6）：mission team / execute team / verify team / 会话 team（需真 daemon + GLM 配置）
- T5.3 模块文档同步：backend.md / frontend.md 变更索引
- T5.4 ROADMAP 更新

## 依赖图
```
P1 (mission入口) ──┬─→ P2 (execute team) ──→ P3 (verify team)
                   └─→ P4 (会话 team)
P5 (e2e+文档) 依赖 P1-P4 全完成
```

## 待 plan 细化
- T3.2 gate 合并的 merge_gate_results 具体签名 + 接入点（verify stage gate 现位于何处）
- T4.1 会话绑 mission 的端点形式（复用 create_mission + session_id vs 新端点）— design §10 倾向复用
- Wave 划分 + 每 Wave task card（plan 阶段产 plan.md）
