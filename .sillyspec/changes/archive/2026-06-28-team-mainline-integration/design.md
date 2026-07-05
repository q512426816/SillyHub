---
author: qinyi
created_at: 2026-06-28T02:55:42
status: design（brainstorm 产出 + Design Grill 修正，待 plan 拆解）
parent_change: 2026-06-19-multi-agent-orchestration
---

# Design：团队接入主流程（Team Mainline Integration）

> 本变更是 `2026-06-19-multi-agent-orchestration` 的续集：复用其锁定的架构（proposal §3 + brainstorm-decisions D1-D7）与已落地的 Wave1（领域模型）/Wave2（Coordinator 分派），执行其未完成的 Wave5/6 并修复核实发现的底层接线缺口。**本文已通过 Step 12 Design Grill 交叉审查并修正 3 个 P0 结构性漏洞（A2/A3/F1）**，详见各章「Grill 修复」标注与 §11/§12。

## 1. 背景

平台当前仍是「单 Agent 串行 + 零委派」模型。变更 `2026-06-19-multi-agent-orchestration` 已立项并部分落地：

- **Wave1（已落地）**：领域模型 `AgentMission` / `AgentRunDependency` / `AgentArtifact` 三表 + `AgentRun` 加 `mission_id`/`parent_run_id`/`role`/`objective`/`attempt` 字段 + migration `202607060900`（`backend/app/modules/agent/model.py:426/494/529/255-282`）。
- **Wave2（已落地）**：Coordinator 分派 `delegation.py`（backend 内嵌 GLM 直接 messages API，`trust_env=False`，规划委派清单）+ `mission.py`（`start_mission` 建 Worker AgentRun）。
- **Wave3/4（service 类已写，未接线）**：`execution.py`（dispatch_worker / collect_artifact）、`control.py`（cost_so_far / can_dispatch_worker / cancel）。
- **Wave5/6（未做）**：前端 Mission 树 / 三档路由 / bootstrap team / execute team。

**核实发现的底层缺口**（Design Grill 逐条核实，全部属实）：

1. **Finalizer 未实现**（proposal T3.4）：每个 Worker 各产自己的 summary Artifact，无合并步骤。整个 backend 代码库 grep `finalizer` 无实现，仅注释提及。
2. **Artifact 收集是死代码**：`collect_completed_artifacts()`（`execution.py:155`）生产代码无任何外部调用者（唯一引用是 `router.py:703` 注释），cancel 端点（`router.py:712-725`）也未调、complete_lease hook（`lease/service.py:278-496`）无 mission 分支——Worker 完成后产出永远不会回灌。
3. **治理门未挂载**：`can_dispatch_worker()`（`control.py:52`）函数完整（cost / max_workers=5 / cancelled），但 `router.py:680-687` 的 dispatch 循环直接同步 for-loop 派发、未调用它。
4. **工具治理不生效**：`worker_tool_config`（`execution.py:35`）生成 `{mode,allowed_tools,max_turns}`，但 daemon 不支持 `--allowedTools`（`execution.py:14-17` 注释），回退默认 policy。
5. **Worker flat 无 DAG**：v1 Worker Runs 不写 `AgentRunDependency` 边（`mission.py:62` 注释），Finalizer 在 flat 模式下=合并所有 Worker summary。

**动机**：让 team 功能从「能创建 Mission、看 worker 状态」的 demo，变成真正接入 bootstrap/execute 主流程、能产出合并结果的可用能力。

## 2. 设计目标

- **G1 底层修复**：接通 Finalizer 单点收敛 + Artifact 收集触发 + 治理门挂载，让现有 team 链路（含手动 Mission 创建路径）真正可用且**能收敛**（Grill A2/A3 修复后）。
- **G2 bootstrap team 闭环**：bootstrap 接入 team 档（并行只读 Worker + Finalizer 单点写 `.sillyspec/docs`）。
- **G3 auto 路由 + 前端可观测性**：single/team/auto 三档 + Mission 树 / Worker 日志 / 成本条。
- **G4 execute team**：execute stage 接 team 档（多 worktree patch + 受控 apply-back）。

## 3. 非目标

- ❌ 不重新设计已锁定架构（Coordinator=backend 内嵌 GLM API、Worker=daemon Run 只回 Artifact、Finalizer 单点收敛、三档路由、Mission 派生状态）。
- ❌ 第一版不支持 Worker 递归委派（一层）。
- ❌ 不做多 provider 团队（聚焦 claude/GLM）。
- ❌ 不替换 task-runner（现有批处理 lease 路径零改动）。
- ❌ 不改 sillyhub-daemon（工具治理降级，不增 `--allowedTools`、不增 batch canUseTool 注入）。
- ❌ Worker 不回灌原始日志到 Coordinator（只回 Artifact，原 D4）。
- ❌ **v1 不做工具层强制审批**（Grill F1：batch 路径无 canUseTool，强制需改 daemon；v1 靠 patch 人审 apply-back 兜底，工具级强制列后续）。
- ❌ execute team 不自动提交（受控 apply-back 人审）。

## 4. 拆分判断

- **为何独立变更**：原 `2026-06-19` 已完成 Wave1-2 并落地代码，其 brainstorm/proposal/plan 已固化。本变更是其续集，专注 Wave5/6 执行 + 底层修复，边界清晰，便于独立追踪、验证与回滚。
- **为何不批量一次做完**：4 个 Wave 严格依赖链（底层修复 → bootstrap team → auto+前端 → execute team）且风险递增。按风险分层推进，每 Wave 独立交付 + 可验证 + 可上生产。execute team 风险最高，排最后且可独立交付（D-006）。

## 5. 总体方案（4 Wave）

### 架构总览（沿用原变更锁定 + Grill 修正触发链）

```
   AgentMission (聚合根, 派生状态不独立持久化)
        │
        ▼
   Coordinator (backend 内嵌 GLM messages API, 不占 lease) plan() → delegations[]
        ▼
   start_mission: persist N 个 Worker AgentRun(pending) + 派 lease
   [can_dispatch_worker 治理门: dispatch 循环内每次前查 预算/≤5并发/取消]
        ├──── 拒绝的 pending Run → 立即标 killed(Grill A3 修复,否则 Mission 永不收敛)
        ▼
   Worker Run (daemon CLI 进程, 只回 Artifact)
        │ lease complete
        ▼
   complete_lease (lease/service.py:278, batch+interactive 唯一收口点)
        ├─ 开头: run.mission_id 非空 → collect_completed_artifacts 回灌 (与 session end 解耦, Grill C2)
        └─ 末尾: run.mission_id 非空 且 该 mission 全 worker 终态(derive_status=done/degraded) → 触发 Finalizer (Grill A2 修复触发锚点)
                ▼
            Finalizer 单点收敛
            ├─ bootstrap: backend 内嵌 GLM 合并 summary → 写 .sillyspec/docs
            └─ execute: 特殊 Worker Run 合并 patch → 人审 apply-back
```

### Wave 1 — 底层修复（前置，让现有 team 链路可用且能收敛）

- **Finalizer 单点收敛**（proposal T3.4）：新增 `finalizer.py`。
  - bootstrap 场景：backend 内嵌 GLM 合并（读所有 Worker summary Artifact → 生成最终文档），确定性高、无需 daemon lease。
  - execute 场景：特殊 Worker Run 合并 patch（Wave 4 用）。
  - **触发锚点（Grill A2 修复）**：Finalizer 不是被动等调用，而是在 `complete_lease`（`lease/service.py:278`，batch+interactive 唯一 lease 收口点）**末尾的 mission 分支主动触发**——当完成的 run 满足 `run.mission_id 非空` 且该 mission 所有 worker 进入终态（`derive_status` 返回 `done`/`degraded`，**非**原误写的 `all_workers_done`——mission.py:29-54 实际只返回 `planning/running/degraded/done/failed/cancelled`）时，调 `FinalizerService`。`derive_status` 是被 `get_mission`（router.py:641）现调的纯函数、无副作用，**不能**作触发器。
- **Artifact 收集触发**：把 `collect_completed_artifacts()`（`execution.py:155`）挂到 `complete_lease` **开头**——基于 `lease.agent_run_id` 判 `run.mission_id` 非空则回灌 AgentArtifact 行，**与 session end 解耦**（Grill C2：interactive 多轮不 end session，collect 不能依赖 session end，必须按 run 维度在 complete_lease 开头触发）。
- **治理门挂载**：把 `can_dispatch_worker()`（`control.py:52`）插入 `router.py:680-687` 的 dispatch 循环（同步 for-loop，已确认），每次 dispatch 前检查预算/上限/取消。
- **超预算/超并发 Run 收尾（Grill A3 修复）**：`start_mission`（`mission.py:106-117`）一次性 persist N 个 pending Run，dispatch 循环若中途 `can_dispatch_worker` 拒绝（budget_exceeded/max_workers_reached），剩余未 dispatch 的 pending Run **必须立即标记终态（killed）**而非悬挂——否则 `derive_status` 永远算出 `running`（mission.py:46-47）、Mission 永不收敛、Finalizer（A2 修复后）也永不触发。治理门拒绝时同步把未 dispatch pending Run 标 killed。
- **工具治理降级（Grill F1/F2 修正原 D-004）**：核实 `canUseTool` 仅 interactive session 注入（`permission_service.py:75` manual_approval），Worker 走 batch lease（`execution.py:105` dispatch_to_daemon）**不触发 canUseTool**；`worker_tool_config` 白名单因 daemon 不支持 `--allowedTools` 也不生效（`execution.py:14-17`）。**v1 现实约束**：read-only 与写类 Worker 工具层均不强制（batch 路径，靠 prompt 约束 + daemon 默认 policy），安全收敛点放 Finalizer patch 人审 apply-back（execute，D-006）；`--allowedTools` 白名单 + batch canUseTool 注入作为后续增强（需 daemon 支持）。即 v1 工具治理=不强制、patch 人审兜底，**非原 D-004「写类走 canUseTool」**——此为代码现实修正（D-004@v2）。
- **验收**：给定 objective 创建 Mission → Worker 完成 lease complete 时 Artifact 自动入库（complete_lease 开头）→ 全 worker 终态时 Finalizer 自动触发（complete_lease 末尾）→ 合并出统一产物；超预算/超并发时未 dispatch Run 标 killed、Mission 仍能收敛；现有手动单 Worker Mission 行为不变。

### Wave 2 — bootstrap team 闭环（第一个真实场景，只读并行，风险最低）

- `SpecBootstrapService`（`backend/app/modules/spec_workspace/bootstrap.py`）新增 team 模式：**single 保持默认**（不破坏生产路径，D-001），team 为新增可选档。
  - **single 档语义澄清（Grill E 修复）**：现状 bootstrap 是单 interactive AgentRun + scan bundle（`bootstrap.py:346` `prepare_scan_interactive_dispatch`），非早期假设的 batch 形态。single 档=保持现状 interactive bootstrap（默认、零变化）；team 档=新增并行路径（确定性扫描→Coordinator 拆→并行 Worker→Finalizer）。team 与 interactive 并存，不替换。
- team 流程：平台确定性扫描（复用现有 `WorkspaceService.scan` `service.py:105` dry-run FS 校验拿目录结构）→ Coordinator 据清单拆任务（架构/规范/测试/集成/风险）→ 并行只读 Worker 分析 → 各回 summary Artifact → Finalizer 单点写 `.sillyspec/docs`（避免多 Agent 并发改文档冲突，proposal §9 上半）。
- scan 与 bootstrap 合一为只读场景（D-003）。
- 成本观测：记录 team 档 bootstrap token/USD 分布，回填默认预算（原 plan T6.2）。
- **验收**：team 档 bootstrap 产出文档质量 ≥ 单 Agent 且 Coordinator 上下文占用更低、成本在预算内；single 档 bootstrap 行为与现状（interactive）完全一致。

### Wave 3 — auto 路由 + 前端 Mission 可观测性

- **auto 路由**（原 T5.3）：`single`（现状）/ `team`（bootstrap/大 scan/多模块 execute/复杂 verify）/ `auto`（按任务数·模块跨度·风险·预计上下文自动选）。第一版接 bootstrap+execute 入口（D-002），其他 stage 保持 single。
  - ⚠️ auto 四因子（任务数/模块跨度/风险/预计上下文）量化阈值待 plan 阶段定义（Grill 定义层）。
- **前端 Wave5**（原 T5.1/T5.2）：现有 `frontend/src/components/mission-console.tsx`（扁平 list + 10s 轮询 + 成本文字）升级为：Mission 树（Worker 层级）；Worker 日志分层回看（复用 `agent-log-viewer.tsx:584` 按 run_id）；成本/预算进度条可视化（超预算告警色）；bootstrap team 进度。样式遵循 CLAUDE.md 规则 15。
- 后端 `mission_schema.py:18-27` `MissionWorkerRunResponse` + 前端 `agent.ts:189-197` `MissionWorkerRun` 补 artifact 字段（前后端当前都无）。
- **验收**：Mission 树正确渲染；Worker 日志按 run_id 回看；成本/预算条可视化；三档可选。

### Wave 4 — execute team（最后，可独立交付，风险最高）

- `change/dispatch.py` EXECUTE stage 新增 team 可选路径：**single 默认**（D-001），team 新增。Grill D2：需在 dispatch 入口分流 single→`start_stage_dispatch`（service.py:931）/ team→`start_mission`，挂载点待 plan 明确。
- **Task↔Worker↔worktree 映射（Grill D1，待 plan 定义）**：plan.md Wave/Task 分给 Worker，每 Worker 独立 worktree 写不同 task → 出 patch Artifact（kind=patch）。但 Task 模型（`task/model.py:17-70`）无 worktree_id/worker_run_id 字段，映射机制待 plan 设计（新增字段或复用 constraints/depends_on）。
- Finalizer（特殊 Worker Run）受控 apply-back：人审 patch 后合并，不自动提交（proposal §9 下半）。**v1 写类 Worker 工具层不强制**（Wave 1 F1），安全靠 patch 人审兜底。
- **风险隔离**（D-006）：排最后且可独立交付，前置 Wave 1/2/3 跑通后再做，风险过高可延后不阻塞主变更。

### 跨 Wave — 成本机制（原 brainstorm 坑4）

- 每 Mission 设 token + USD 双预算（auto 按规模估算 / team 可手填）。
- 每次 Worker dispatch 前由 `can_dispatch_worker` 查累计成本，**超预算 = 收敛信号**（非错误，Coordinator 用已有 Artifact 出最终结果）。
- 默认值保守（建议 single 档成本的 4×，待 baseline），Wave 2 观测后回填。
- ⚠️ single 成本基线无现成数据来源，4× 为估算，Wave 2 观测回填（接受）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/agent/finalizer.py | Finalizer 服务：bootstrap 内嵌合并 + execute patch 合并入口 |
| 修改 | backend/app/modules/agent/execution.py | collect_completed_artifacts 接 complete_lease 触发；worker_tool_config v1 降级（不强制，注释说明） |
| 修改 | backend/app/modules/agent/control.py | can_dispatch_worker 治理门挂载 + 拒绝时未 dispatch Run 标 killed（Grill A3） |
| 修改 | backend/app/modules/agent/router.py | dispatch 循环（:680-687）插入 can_dispatch_worker；Mission 响应补 artifact |
| 修改 | backend/app/modules/daemon/lease/service.py | complete_lease（:278）开头加 collect_completed_artifacts（run.mission_id 分支）+ 末尾加 Finalizer 触发（Grill A2/C2 核心修复点） |
| 修改 | backend/app/modules/agent/mission_schema.py | MissionWorkerRunResponse 补 artifact 字段（:18-27） |
| 修改 | backend/app/modules/agent/delegation.py | 新增 route() → single/team/auto（auto 路由 T5.3） |
| 修改 | backend/app/modules/spec_workspace/bootstrap.py | SpecBootstrapService 新增 team 模式（single=现状 interactive 默认，Grill E） |
| 修改 | backend/app/modules/change/dispatch.py | EXECUTE stage team 分流（single→start_stage_dispatch / team→start_mission，Grill D2） |
| 修改 | frontend/src/components/mission-console.tsx | 扁平 list → Mission 树；接 agent-log-viewer；成本预算条 |
| 修改 | frontend/src/lib/agent.ts | MissionWorkerRun 补 artifact 字段（:189-197） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx | 三档路由选择 UI |

> **无需新 migration（Grill G1/G2）**：`AgentArtifact.kind`（model.py:529 自由 String(30)）已含 summary/patch，`AgentRun.role`（model.py:271 自由 String(30)）可写 `finalizer`，完全复用 Wave1，不加新表/字段，避免 R-04 撞 migration 链。

## 7. 接口定义

```python
# backend/app/modules/agent/finalizer.py（新增）
class FinalizerService:
    async def finalize_bootstrap_mission(self, mission_id: str) -> AgentArtifact:
        """bootstrap：backend 内嵌 GLM 合并所有 Worker summary → 写最终文档。返回 kind=summary 合并 Artifact。"""
    async def finalize_execute_mission(self, mission_id: str) -> list[AgentArtifact]:
        """execute：调度特殊 Worker Run 合并各 worktree patch → 返回待人审 apply-back 的 patch Artifact。"""
# 注入点：complete_lease（lease/service.py:278）末尾 mission 分支（Grill A2）

# backend/app/modules/daemon/lease/service.py（修改 complete_lease）
async def complete_lease(...):
    # 开头（Grill C2）：run.mission_id 非空 → collect_completed_artifacts(run.mission_id)
    # 末尾（Grill A2）：run.mission_id 非空 且 derive_status(mission) in (done,degraded) → FinalizerService.finalize_*()

# backend/app/modules/agent/control.py（已存在 can_dispatch_worker:52，扩展拒绝处理）
# can_dispatch_worker 拒绝时，调用方(router dispatch 循环)把未 dispatch pending Run 标 killed（Grill A3）

# backend/app/modules/agent/delegation.py（新增）
class RouterService:
    def route(self, objective: str, constraints: dict) -> str:  # → "single"|"team"|"auto"
        """auto 按任务数/模块跨度/风险/预计上下文自动选。第一版仅 bootstrap+execute 入口(D-002)。"""
```

## 7.5. 生命周期契约表（必填：涉及 agent_run / lease / daemon / complete / heartbeat）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| Worker dispatch（带治理门） | backend router | daemon | mission_id, run_id, role, objective, lease_id | mission running；dispatch 前 can_dispatch_worker 校验 |
| 治理门拒绝 | backend can_dispatch_worker | router | mission_id, reason(budget/max/cancelled) | 未 dispatch pending Run → killed（Grill A3） |
| lease complete（Worker 完成） | daemon | backend complete_lease | lease_id, claim_token, agent_run_id, output_text | worker run: running → completed |
| Artifact 回灌 | complete_lease 开头 | DB | run.agent_run_id→mission_id, kind=summary, content_ref | 写 AgentArtifact（修复死代码，与 session end 解耦 Grill C2） |
| Mission 收敛判定 | complete_lease 末尾 mission 分支 | FinalizerService | run.mission_id，该 mission 全 worker 终态 | derive_status=done/degraded → 触发 Finalizer（Grill A1/A2：`all_workers_done` 非合法值，实际 done/degraded；锚点在 complete_lease 而非 derive_status 纯函数） |
| Finalizer 收敛（bootstrap） | FinalizerService | DB / .sillyspec/docs | mission_id, merged_summary | mission: → done；写最终文档 |
| Finalizer 收敛（execute） | FinalizerService → 特殊 Worker Run | DB | mission_id, patches[] | mission: → done；patch 待人审 apply-back |
| 超预算收敛信号 | can_dispatch_worker | Finalizer | mission_id, reason=budget_exceeded | 拒绝新 Worker + 未 dispatch Run killed + 已有 Artifact 收敛 |
| Mission 取消 | backend | daemon | mission_id, cancelled_at | active 子 Run → killed（control.py:69 已实现） |
| heartbeat | daemon | backend | runtime_id, lease_id | lease 保活（现有，零改动） |

> 每个事件在 plan 阶段需有对应代码任务 + 接口任务 + 测试任务；必需字段需出现在相关 DTO/interface。complete_lease 已有 5 个 try/except 分支（patch/stage-callback/post-scan/end-session 等），新增 mission 分支需注意复杂度。

## 8. 数据模型（Grill G1/G2 已确认）

- **复用原 Wave1 模型，不加新表/字段**：`AgentArtifact.kind`（model.py:529，自由 String(30) 无 DB 枚举约束）已含 `summary/patch/test_result/evidence`，Finalizer 合并产物用 `kind=summary`（bootstrap）/ `kind=patch`（execute），无需扩。
- `AgentRun.role`（model.py:271，自由 String(30) 无枚举约束）可直接写 `role="finalizer"` 标记 Finalizer Run，无需 migration、无需扩枚举。
- ⚠️ Wave4 Task↔worktree 映射（Grill D1）：若需 Task 绑 worktree，可能需 task 表加字段——待 plan 阶段定，届时按 R-04 唯一 revision 处理。

## 9. 兼容策略（brownfield）

- **single 档默认**：现有 bootstrap（interactive，`bootstrap.py:346`）、execute（`change/dispatch.py` start_stage_dispatch）流程零行为变化，team/auto 为新增可选路径（D-001）。
- **现有 AgentRun / DaemonLease 行为不变**：complete_lease 新增 mission 分支仅在 `run.mission_id 非空` 时生效，非 mission Run（绝大多数）零影响。
- **治理门对单 Worker Mission 透明放行**（不触发拒绝）。
- **回退路径**：team 档出问题切回 single 即恢复（路由默认值）。
- **不改变的 API/表结构**：现有 `/missions` 端点向后兼容（仅扩展响应字段 artifact，非破坏性）；不加 migration。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | execute team 多 worktree 并行写代码 → patch 合并冲突 | P0 | Wave4 排最后且可独立交付（D-006）；每 Worker 独立 worktree 基于主分支；apply-back 人审不自动提交 |
| R-02 | daemon 不支持 `--allowedTools`，工具治理无法 CLI 强制 | P1 | v1 工具层不强制、patch 人审兜底（D-004@v2，Grill F1）；`--allowedTools`+batch canUseTool 列后续增强 |
| R-03 | team 档成本失控（一次 bootstrap 7-8 Run，5-10×） | P1 | can_dispatch_worker 治理门 + 双预算 + 超预算=收敛信号；默认 single 4×，Wave2 观测回填 |
| R-04 | 新增 migration 撞 revision id / 多 head | P1 | Wave1-3 不加 migration（Grill G1/G2）；Wave4 Task-worktree 字段若加，唯一 revision + down 接真实 head |
| R-05 | bootstrap 生产关键路径，team 档 bug 破坏初始化 | P1 | single=现状 interactive 默认（Grill E）；team 可选；先测试 workspace 验证质量 ≥ single 再放开 |
| R-06 | Artifact 回灌触发覆盖（interactive 不 end session） | P1（Grill C2 升级） | collect 挂 complete_lease 开头按 run.agent_run_id 触发，与 session end 解耦；幂等 collect 兜底；complete_lease 是 batch+interactive 唯一收口点 |
| R-07 | Coordinator GLM 分派质量 | P2 | 原 spike 04 验证路径 B H1/H2=100%；复用其 prompt + 解析 |
| R-08 | complete_lease 分支复杂度上升（已有 5 分支 + 新增 mission） | P2 | mission 分支用 `if run.mission_id` 早返回隔离；充分测试 complete_lease 回归 |

## 11. 决策追踪

| 决策 ID | 标题 | 覆盖章节 | 状态 |
|---|---|---|---|
| D-001@v1 | team 档可选 / single 默认 | §5 Wave2/4, §9 | accepted |
| D-002@v1 | auto/team 第一版仅 bootstrap+execute 入口 | §5 Wave3 | accepted |
| D-003@v1 | scan 与 bootstrap team 合一 | §5 Wave2 | accepted |
| D-004@v2 | 工具治理降级：v1 不强制、patch 人审兜底（supersedes D-004@v1） | §5 Wave1, §3, R-02 | accepted（Grill F1/F2 修正） |
| D-005@v1 | Finalizer 分场景 | §5 Wave1/4, §7 | accepted |
| D-006@v1 | execute team 排最后且可独立交付 | §4, §5 Wave4, R-01 | accepted |
| D-007@v1 | Finalizer 触发锚点=complete_lease 末尾 mission 分支（Grill A2 修复） | §5 Wave1, §7.5 | accepted（Grill 新增） |
| D-008@v1 | 治理门拒绝的未 dispatch pending Run 标 killed（Grill A3 修复） | §5 Wave1, §7.5 | accepted（Grill 新增） |

> 详见 `decisions.md`。原 `2026-06-19` D1-D7（路径 B / 分阶段 batch / 编排混合 / 只回 Artifact / 审批粒度 / 部分失败降级 / DAG 派生状态）全部沿用。

## 12. 自审（含 Design Grill 交叉审查）

### 初版自审 + Grill 交叉审查结果

| 检查项 | 结果 |
|---|---|
| 需求覆盖（全做 Wave5+6+底层修复） | ✅ §5 四 Wave 覆盖 G1-G4 |
| Grill 覆盖（引用所有 D-xxx） | ✅ §11 D-001~D-008（含 Grill 新增 D-007/D-008、D-004@v2） |
| 约束一致性 | ✅ single 默认不破坏现有；Grill 修正 complete_lease 分支仅 mission_id 生效 |
| 真实性 | ✅ Grill 逐条核实行号；Finalizer 触发/状态名/工具通道均按代码事实修正 |
| YAGNI | ✅ 工具治理降级、execute 可延后、不加 migration 均为收敛 |
| 验收标准 | ✅ 每 Wave 有验收段 |
| 非目标清晰 | ✅ §3 含 v1 不做工具强制（Grill F1） |
| 兼容策略 | ✅ §9 |
| 风险识别 | ✅ §10 R-01~R-08（含 Grill 新增 R-08） |
| 生命周期契约表 | ✅ §7.5 十个事件，状态名/触发锚点按 Grill 修正 |

### Cross-Check Matrix（Grill 关键项）

| ID | 层级 | 结论 | 处理 |
|---|---|---|---|
| A1/A2 | 一致性+可行性 | Finalizer 触发链无锚点（状态名虚构+纯函数无 watcher） | ✅ 修正：complete_lease 末尾 mission 分支触发（D-007） |
| A3 | 一致性 | 超预算未 dispatch Run 悬挂致永不收敛 | ✅ 修正：标 killed（D-008） |
| F1/F2 | 可行性 | 写类 canUseTool 在 batch 不存在 | ✅ 修正：v1 不强制、patch 人审兜底（D-004@v2） |
| C2 | 可行性 | collect 依赖 session end 漏触发 | ✅ 修正：挂 complete_lease 开头按 run 解耦（R-06 升 P1） |
| E | 一致性 | bootstrap single 语义不明 | ✅ 修正：single=现状 interactive（§5 Wave2） |
| G1/G2/G3 | 一致性 | 无需 migration | ✅ 删 migration 行（§6/§8） |
| D1/D2 | 可行性 | Task-worktree 映射 / execute 分流挂载点 | ⚠️ 留 plan 定义（非阻塞，Wave4 细节） |

**自审结论**：**passed**。3 个 P0 结构性漏洞（A2/A3/F1）已修正并写入决策（D-007/D-008/D-004@v2）；2 个 P1（E/C2）已修正；D1/D2 留 plan（Wave4 细节，非 brainstorm 阻塞项）。
