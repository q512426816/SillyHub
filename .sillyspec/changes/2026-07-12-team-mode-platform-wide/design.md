---
author: qinyi
created_at: 2026-07-12 02:45:00
status: brainstorm（方案 B 已确认，待 plan 拆 Wave）
---

# 设计文档（Design）— team 模式平台级入口

> 变更：`2026-07-12-team-mode-platform-wide`
> 依据：`docs/agent-platform-deep-audit-2026-07-12.md` P1-1 + 第 3 节发现 3
> 方案：B（归一 mission）· 默认 single · team 全 opt-in

## 1. 背景

审计（`docs/agent-platform-deep-audit-2026-07-12.md` 第 3 节发现 3）核实：**只读 team mission 链路已端到端打通，差最后一公里（入口 + 验证）**。

已就位（无需重写）：
- 后端 `POST /workspaces/{id}/missions`（`agent/router.py:728` create_mission）：GLM 规划 → 建 Worker Run → 治理门 → dispatch_worker → complete_lease 回灌 → FinalizerService GLM 合并（`finalizer.py:122`）→ 前端可读
- `route()` 三档 single/team/auto（`delegation.py:39-53`），team 关键词触发
- 前端 `mission-console.tsx` 能创建 mission（objective + budget_usd）
- execute stage 已有 `_dispatch_execute_team`（`change/dispatch.py:904`），team_mode=True 触发

断点：
- `spec_workspace/router.py:273` bootstrap 硬 single，没透传 mode
- `mission-console` 无 mode 选择，前端无法显式触发 team/single
- verify stage 无 team 分流
- 会话无 team 入口
- execute/verify stage 前端无 team 开关

用户决策：把 team 模式做成**整个平台三个入口**（mission / 变更各阶段 / 会话）的可选执行方式，默认 single，全 opt-in。

## 2. 设计目标

- 三入口触发 team 统一归一为「建一个 mission」，最大化复用已验证的 mission 链路
- 默认 single，零回归（不勾选 team 则行为完全不变）
- 用户（不懂代码）能直观选择 team，并看到成本/进度
- 单测覆盖每个 Phase 的分流逻辑；端到端 e2e 留运行时验证（R-03）

## 3. 非目标（防止 scope creep）

- **不做**会话内多 agent 轮转（D-001：会话 team = 发起 mission，非 driver 层多 agent 协调）
- **不做** brainstorm/plan stage 的 team（D-002：探索/结构化任务单 agent 足够，多 agent 难收敛）
- **不做**写代码 team 的 per-worker worktree 隔离（D-006 延后项，v1 共享 worktree 靠 Coordinator 拆 task 分工避免并发写冲突；列风险标注）
- **不做** Coordinator/Finalizer 模型可配置（独立 P2-3 任务）
- **不做**预算硬门 kill（独立 P2-1 任务，依赖 P0-1 已修）

## 4. 拆分判断

中等偏大复杂度。不满足拆分条件（功能模块 3 个入口但归一为 mission 一个机制；1 种角色 workspace owner；无跨页面状态流转）。不满足批量条件（任务 <10，非模板×数据）。

按 **5 Phase 顺序推进**，每 Phase 独立可交付 + 可验证。Phase 间有依赖（Phase 3 verify 依赖 Phase 2 execute 的 stage team 模式确立；Phase 4 会话依赖 mission 入口）。

## 5. 总体方案

### 核心思路（方案 B 归一 mission）

三入口触发 team 都 = 建一个 AgentMission，复用现成 `MissionService.start_mission` + `MissionExecutionService.dispatch_worker` + `FinalizerService` 链路。差异仅在「触发源」和「结果回传位置」：

| 入口 | 触发源 | mission 绑定 | 结果展示位置 |
|---|---|---|---|
| ① mission 页 | mission-console 创建表单 | change_id 可空 | mission 详情页 |
| ② execute/verify stage | 变更详情页 stage 开关 | change_id 必填 | 变更详情页 + mission 页 |
| ③ 会话 | 会话面板「用团队分析」按钮 | session_id 必填 | 会话内嵌组件 + mission 页 |

### Phase 1 — mission 入口优化（最小，前端为主）

**后端**：
- `MissionCreateRequest`（`agent/schema.py`）加 `mode: Literal["single","team"] | None = None` 字段
- `create_mission`（`router.py:728`）把 mode 传入 `constraints`，`route()`（`delegation.py:39`）已支持 constraints['mode'] 优先 → single/team/auto 路由生效
- mode=None 或 single 时走原路径（零回归）

**前端**：
- `mission-console.tsx` 创建表单加 mode 单选（single 默认 / team）+ 示例 objective placeholder + team 选中时提示「拆 1-5 worker，建议设预算」
- `CreateMissionInput`（`lib/agent.ts`）加 mode 字段

### Phase 2 — execute stage team 接通（复用已有基础）

**后端**：`_dispatch_execute_team`（`change/dispatch.py:904`）已存在，只差触发入口。
- `change.stages.team_mode` 的设置入口：变更 stage 配置 API 加 team_mode 字段（或 dispatch 时传 team_mode 参数）
- ⚠️ 共享 worktree 风险：v1 多 impl worker 并行写同一工作目录，靠 Coordinator 按 plan task 分工避免同文件冲突；per-worker worktree 隔离留 D-006 后续

**前端**：变更详情页（`changes/[cid]/page.tsx`）execute 阶段加「用团队执行」复选框，勾选触发 team_mode dispatch

### Phase 3 — verify stage team 新增

**后端**：
- 仿 `_dispatch_execute_team` 加 `_dispatch_verify_team`（`change/dispatch.py`）：Coordinator 拆 verify worker（不同核验角度：正确性/边界/性能/安全）→ 并行核验 → Finalizer 合并核验结论
- `collect_completed_artifacts` 已能把 worker 输出落 artifact（复用）
- **R-02 gate 收敛**（见 §7）：多 worker gate_result 合并为 stage 单一 gate

**前端**：verify 阶段加「用团队核验」复选框

### Phase 4 — 会话发起 team（D-001）

**后端**：
- 会话发起 mission：`POST /workspaces/{id}/missions` 支持 `session_id` 参数（mission 绑会话）
- 或新端点 `POST /daemon/sessions/{id}/team-analysis`：内部调 create_mission（绑 session_id）+ 返回 mission_id

**前端**：
- `interactive-session-panel.tsx` 加「用团队分析」按钮 → 调创建 mission（绑当前 session_id）
- **R-01** 新组件 `session-mission-progress.tsx`：会话内嵌展示 mission 进度（复用 mission-console 的 WorkerRow/CostBar/ArtifactCard 渲染逻辑），完成后结果摘要回传对话 + 「查看完整 mission」跳转

### Phase 5 — 端到端验证 + 文档

- 每 Phase 单测：route 路由 / bootstrap 分流 / stage team_mode 触发 / verify gate 收敛 / 会话绑 mission
- 真 daemon e2e：每入口真跑一次 team（需 GLM 配置 ANTHROPIC_BASE_URL/AUTH_TOKEN + 真 daemon 在线）
- 模块文档同步：`docs/multi-agent-platform/modules/backend.md` / `frontend.md` 变更索引

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/schema.py | MissionCreateRequest 加 mode 字段 + session_id 可选 |
| 修改 | backend/app/modules/agent/router.py | create_mission 透传 mode/session_id |
| 修改 | backend/app/modules/change/dispatch.py | execute team_mode 触发入口 + 新增 _dispatch_verify_team |
| 修改 | backend/app/modules/change/schema.py | stage dispatch 加 team_mode 参数 |
| 修改 | backend/app/modules/daemon/session/service.py | 会话绑 mission（session_id 透传 create_mission） |
| 修改 | frontend/src/components/mission-console.tsx | 创建表单加 mode 选择 + 示例 |
| 修改 | frontend/src/lib/agent.ts | CreateMissionInput 加 mode/session_id |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | execute/verify stage 加 team 开关 |
| 修改 | frontend/src/components/daemon/interactive-session-panel.tsx | 「用团队分析」按钮 |
| 新增 | frontend/src/components/daemon/session-mission-progress.tsx | 会话内嵌 mission 进度组件（R-01） |
| 新增 | backend/app/modules/agent/tests/test_team_mode_dispatch.py | route/stage team_mode 单测 |
| 新增 | backend/app/modules/change/tests/test_dispatch_verify_team.py | verify team 分流单测 |

## 7. 关键设计点

### R-01 会话内嵌 mission 组件
会话面板发起 team 后，mission 在后台跑（独立页可查），但会话内要能看进度。新组件 `session-mission-progress.tsx`：订阅 mission 状态（轮询 getMission 10s，复用 mission-console 模式）+ 展示 Coordinator 拆解/worker 进度/cost bar。完成后在对话流插一条「团队分析完成」消息（摘要 + 跳转链接）。**不**在会话里复用 SSE（mission 进度走轮询，与 mission-console 一致）。

### R-02 verify gate 收敛（设计决策点）
gate 现状是单 AgentRun 级（`AgentRun.gate_result`，P3 driver gate）。verify team 多 worker 各产 gate_result，需合并为 stage 单一 gate。合并策略候选：
- **策略 A（保守，推荐）**：全 worker gate exit=0 才算 stage gate 过；任一非 0 则 stage gate 取最严重值（exit 2 优先于 exit 1）。简单、fail-safe。
- 策略 B：多数决（≥半数 exit=0 则过）。容忍个别 worker 误判，但有风险。
- 策略 C：Finalizer GLM 裁决（合并 gate_result 让 GLM 判断）。灵活但增加 GLM 依赖。

→ design 采 A，plan 阶段定细节（merge_gate_results helper）。

### R-03 端到端验证
单测层覆盖：route 三档路由 / mode 透传 / stage team_mode 触发 _dispatch_*_team / verify gate 合并 / 会话绑 mission。e2e（真 daemon + GLM）留运行时，每入口至少跑一次：mission 单入口 / execute team / verify team / 会话 team。e2e 在 AC 里列为 R-02 运行时项（非单测阻塞）。

### R-04 成本控制
team 多 worker 烧 token。mode=team 选中时前端提示「建议设预算」；budget_usd 默认 4.0（沿用 bootstrap/dispatch 硬编码值）；mission CostBar 已展示超预算（control.py 软门）。**不**在本变更做硬门 kill（P2-1 独立任务，依赖 P0-1 已修）。

## 8. 决策记录

- **D-001@v1**：会话 team = 对话中发起 mission（复用 create_mission），非会话内多 agent 轮转。理由：后者需 driver 层全新多 agent 协调（高风险高成本），前者价值相近成本低 5x。
- **D-002@v1**：stage team 只做 execute + verify。brainstorm/plan 保持 single（YAGNI：探索/结构化任务单 agent 足够，多 agent 难收敛易冲突）。
- **D-003@v1**：默认 single，所有 team 入口 opt-in，零回归。
- **D-004@v1**：方案 B 归一 mission（三入口都建 mission 复用现成链路），非方案 A 统一抽象 / 方案 C 各自独立。
- **D-005@v1**：verify gate 收敛采策略 A（全过才过，fail-safe），留 plan 细化。
- **D-006（延后）**：execute 写 team 的 per-worker worktree 隔离不做，v1 共享 worktree 靠 Coordinator 拆 task 分工。列风险。

## 9. 验收标准

- **AC-1**（Phase 1）：mission-console 选 team + objective → 创建 mission，Coordinator 拆 worker 并行，Finalizer 合并结果可见；选 single 行为不变
- **AC-2**（Phase 2）：变更 execute 阶段勾「用团队执行」→ 触发 _dispatch_execute_team，多 impl worker 并行写，Finalizer 合并 patch（人审 apply-back）
- **AC-3**（Phase 3）：变更 verify 阶段勾「用团队核验」→ 多 verify worker 并行核验，gate 按策略 A 合并
- **AC-4**（Phase 4）：会话点「用团队分析」→ 创建 mission 绑 session，会话内嵌进度组件可见，完成后结果摘要回传对话
- **AC-5**（默认）：不勾 team 的所有入口行为零回归（单测守护）
- **AC-6**（e2e，R-03 运行时）：四入口各真跑一次 team 成功（需真 daemon + GLM）
- **AC-7**：模块文档 backend.md/frontend.md 变更索引同步

## 10. 风险与遗留

| 风险 | 严重度 | 缓解 |
|---|---|---|
| execute 写 team 共享 worktree 并发写冲突 | 🟠 P1 | v1 靠 Coordinator 按 plan task 分工避免同文件；per-worker 隔离留 D-006 |
| verify gate 合并策略选错（误放行/误拦截） | 🟠 P1 | 采策略 A fail-safe + 单测覆盖各组合 |
| 会话内嵌组件 UX 复杂 | 🟡 P2 | 复用 mission-console 组件，轮询非 SSE |
| GLM 配置缺失 team 不可用 | 🟡 P2 | create_mission 已有 503 兜底（router.py:736） |
| 端到端验证需真环境 | 🟡 P2 | AC-6 列运行时项，不阻塞单测交付 |

## 自审

- ✅ 覆盖用户确认的 5 Phase + 决策 D-001~005
- ✅ 非目标明确（会话多 agent / brainstorm-plan team / worktree 隔离 / 模型配置 / 预算硬门 都排除）
- ✅ 文件变更清单具体到文件 + 方法
- ✅ 复用清单（mission 链路 / route() / _dispatch_execute_team / mission-console 组件）明确
- ✅ 风险标注（worktree / gate 策略 / e2e）
- ⚠️ R-02 gate 合并策略 A 待 plan 细化（merge_gate_results 实现细节）
- ⚠️ Phase 4 会话发起 mission 的端点形式（复用 create_mission + session_id vs 新端点）待 plan 定
