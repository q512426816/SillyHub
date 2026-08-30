---
plan_level: large
author: qinyi
created_at: 2026-07-12 03:05:00
---

# 计划（Plan）— team 模式平台级入口

> ⚠️ **标停（2026-07-12）**：本变更 Wave1+2（mode 选择 UI + mode/session_id/team_mode 透传链路）已 apply 进 main（commit a98de3ef），作为 v2 `2026-07-12-team-main-agent-orchestration` 复用基础。Wave3-5（verify team / 会话 team / e2e）转交 v2 接管（v2 改用主 agent 动态编排，非 v1 GLM 静态拆解）。v1 D-001（会话不做多 agent 轮转）/ D-006（共享 worktree）被 v2 推翻，D-002/003/004/005 沿用。v1 部分完成，不走完整 archive。
> **superseded-by**: 2026-07-12-team-main-agent-orchestration

> 基于 design.md 5 Phase + tasks.md，拆成 5 Wave。每 Wave 独立可交付 + 可验证。
> 依赖：W2 依赖 W1；W3 依赖 W2；W4 依赖 W1；W5 依赖 W1-4。
> 默认 single（D-003），team 全 opt-in，零回归（AC-5 守护）。

## 概述
方案 B 归一 mission（D-004）：三入口（mission/stage/会话）触发 team 都建一个 AgentMission，复用现成 mission→dispatch_worker→finalizer 链路。完整决策见 decisions.md（D-001~006）。

## Wave 1 — mission 入口优化（Phase 1，独立可交付）
**目标**：mission-console 能选 single/team，后端 mode 透传 route()。
**依赖**：无
- [x] task-01: 后端 `agent/schema.py` MissionCreateRequest 加 `mode: Literal["single","team"]|None=None` + `session_id: UUID|None=None`（实际文件 mission_schema.py）
- [x] task-02: 后端 `agent/router.py` create_mission 透传 mode 到 constraints['mode'] + session_id 绑定 mission
- [x] task-03: 前端 `lib/agent.ts` CreateMissionInput 加 mode/session_id 字段
- [x] task-04: 前端 `mission-console.tsx` 创建表单加 mode 双卡片选择（single 绿/team 紫）+ 角色预览 chips + 预算提示
- [x] task-05: 单测 `test_team_mode_dispatch.py`（mode 透传 route / single 零回归 / session_id 绑定）
**验收**：AC-1（mission 选 team → Coordinator 拆 worker 并行，Finalizer 合并可见；single 不变）

## Wave 2 — execute stage team 接通（Phase 2，复用 _dispatch_execute_team）
**目标**（D-002：stage team 只做 execute+verify，brainstorm/plan 保持 single）：变更 execute 阶段能勾「用团队执行」触发 team_mode dispatch。
**依赖**：W1（mission 模式确立）
- [x] task-06: 后端 `change/schema.py` stage dispatch 加 `team_mode: bool=False` 参数
- [x] task-07: 后端 execute team_mode 触发链路（dispatch.py :904 已就绪无需改；实际改 service.py transition_with_dispatch 写 stages + router.py 透传）
- [x] task-08: 前端 `changes/[cid]/page.tsx` execute 阶段加 team toggle（紫色开关）+ `lib/changes.ts` 透传
- [x] task-09: 单测 `test_dispatch_execute_team_mode.py`（6 case：team 触发 / single 零回归 / GLM 兜底 / 直测）
- [x] task-10: ⚠️ 风险标注（design §10 D-006，dispatch.py:806-812 + :910-916 注释已存留，无代码改动）
**验收**：AC-2（execute 勾团队 → 多 impl worker 并行写，Finalizer 合并 patch 人审 apply-back）

## Wave 3 — verify stage team 新增（Phase 3）
**目标**：verify 阶段多角度并行核验 + gate 策略 A 合并。
**依赖**：W2（stage team 模式确立）
- [ ] task-11: 后端 `change/dispatch.py` 新增 `_dispatch_verify_team`（仿 execute，verify worker 并行核验）
- [ ] task-12: 后端 gate 合并 `merge_gate_results(workers) -> gate_result`（D-005 策略 A：全 exit=0 才过，任一非 0 取最严重，exit 2 优先 exit 1）+ 接入 verify stage gate
- [ ] task-13: 前端 verify 阶段加 team toggle
- [ ] task-14: 单测 `test_dispatch_verify_team.py` + `test_merge_gate_results.py`（全过/部分失败/exit2 优先/killed 各组合）
**验收**：AC-3（verify 勾团队 → 多 worker 并行核验，gate 按策略 A 合并；全过推进 archive，任一失败打回 execute）

## Wave 4 — 会话发起 team（Phase 4，D-001）
**目标**：会话面板「用团队分析」按钮建 mission 绑 session，内嵌进度 + 结果回传。
**依赖**：W1（mission 创建含 session_id，task-02 已铺）
- [ ] task-15: 后端确认 create_mission 绑 session_id 后 mission 与 session 关联（task-02 已加字段，本 task 接 session 展示查询）
- [ ] task-16: 前端 `interactive-session-panel.tsx` 加「💡 用团队分析」按钮 → 调 create_mission（绑当前 session_id）
- [ ] task-17: 前端新组件 `session-mission-progress.tsx`（会话内嵌 mission 进度，复用 mission-console 的 WorkerRow/CostBar/ArtifactCard 渲染逻辑，10s 轮询）
- [ ] task-18: 前端 mission 完成回传对话（对话流插「团队分析完成」消息 + 摘要 + 跳转 mission 详情链接）
- [ ] task-19: 单测 `test_session_team_mission.py`（session 绑定 + mission 创建 + 展示查询）
**验收**：AC-4（会话点用团队分析 → 建 mission 绑 session，内嵌进度可见，完成结果回传对话）

## Wave 5 — 端到端验证 + 文档（Phase 5）
**目标**：全量回归 + 四入口 e2e + 文档同步。
**依赖**：W1-W4 全完成
- [ ] task-20: backend pytest 全量 + frontend vitest 全量零回归
- [ ] task-21: mypy + ruff 全过
- [ ] task-22: e2e 四入口真跑（AC-6 运行时，需真 daemon + GLM 配置）：mission team / execute team / verify team / 会话 team
- [ ] task-23: 模块文档同步（backend.md / frontend.md 变更索引）
- [ ] task-24: ROADMAP 更新（活跃变更栏 + 已完成里程碑）
**验收**：AC-5（零回归）+ AC-6（e2e 四入口）+ AC-7（文档同步）

## 依赖图
```
W1 (mission入口) ──┬─→ W2 (execute team) ──→ W3 (verify team)
                   └─→ W4 (会话 team)
W5 (e2e+文档) 依赖 W1-W4 全完成
```

## 风险与遗留（同 design §10）
- 🟠 execute 写 team 共享 worktree 并发写（D-006 accepted，task-10 标注）
- 🟠 verify gate 策略 A 过严误打回（task-14 单测覆盖各组合 + plan 后续可加误判 worker 重跑）
- 🟡 会话内嵌组件 UX（task-17 复用 mission-console 组件降复杂度）
- 🟡 e2e 需真 daemon + GLM（task-22 列运行时，不阻塞单测交付）

## 自检
- ✅ 5 Wave 对应 design 5 Phase，依赖关系一致（W2←W1, W3←W2, W4←W1, W5←W1-4）
- ✅ 每 Wave 3-5 个 task，粒度均匀
- ✅ task 用 `- [ ] task-XX:` checkbox 格式（execute 解析依赖）
- ✅ 每 Wave 有验收（对应 AC）
- ✅ 复用清单明确（_dispatch_execute_team / mission-console 组件 / create_mission）
- ✅ 风险标注（D-006 worktree / gate 策略 / e2e）
- ⚠️ task-12 merge_gate_results 接入点（verify stage gate 现位置）待 execute 时核实
- ⚠️ task-15 会话绑 mission 的展示查询实现待 execute 时定（复用 mission API 或新查询）
