---
author: qinyi
created_at: 2026-08-22 03:10:07
scale: large
tier: independent
revision: 2
---

# 设计文档（Design）— 会话内团队操作（团队并入统一会话页）

> v2（2026-08-22 Design Grill 修订）：采纳独立审查 B1/B2/B3 阻塞项与 CC-01~CC-13 gap 修复，见 §11 决策追踪与 §12 自审。

## 1. 背景

现状：团队任务（AgentMission）是独立于会话（AgentSession）的实体——用户在工作区/项目维度的独立页面（mission-console）创建任务，backend 另起一个主控 AgentRun + 专属会话 + 一次性渲染的指令 prompt（含 mission_id 等工具调用所需 id），前端只能 10s 轮询围观、无输入框、无多轮沟通；普通会话面板的「用团队分析」按钮创建的任务与原会话断联（constraints.session_id 死参数无人消费）。

用户诉求（原型 v2 已评审通过，`prototype-team-session-unify.html`）：团队是**当前会话内 agent 的一种能力**——像子代理一样，当前对话的 agent（主控）随时通过 MCP 工具派分身（worker，跨机器/跨工作区真任务），分身进度与结果直接回到当前消息流，全程不离开对话。

关键查证结论（2026-08-22 brainstorm step3 + step7 独立审查复核）：
- turn 级注入现状不存在：SESSION_INJECT 只推 prompt 文本，claim payload（含 stage）仅在 lease 首次 claim 时构建一次（`backend/app/modules/daemon/lease/context.py:415`、`sillyhub-daemon/src/daemon.ts:4095-4145`）。
- 团队 5 工具注入仅 Claude SDK 生效：codex driver 不消费 mcpServers（`sillyhub-daemon/src/interactive/driver.ts:139` 注释）。
- AgentMission 无 session_id 列；objective 列 NOT NULL（`backend/app/modules/agent/model.py:630-742`）。
- worker run = 独立 lease + 独立 AgentSession + 独立 worktree（`backend/app/modules/agent/execution.py:153-349`）。
- 现有 5 工具 schema 强制要求 mission_id/workspace_id（report_progress 还要 run_id），id 靠一次性 prompt 烤入（`sillyhub-daemon/src/mcp-server.ts:169-210`、`orchestrator.py:107-113`）——prompt 下线后必须改为参数可选 + 会话上下文定位（审查 B1）。
- converge 链路锚定 `role='orchestrator'` 的主控 run（`mcp_tools.py:363-374 _get_main_run` 404 语义、finalizer 以 main_run.id 为锚）——主控 run 模型改变后锚点必须重定义（审查 B2）。
- 治理门/成本/workers 列表按 `mission_id` 全量查询（`control.py:39-87`，MAX_WORKERS=5）——主控轮 run 回填 mission_id 后必须加判别（审查 B3）。

## 2. 设计目标

1. 会话中随时触发团队：按钮/弹层、/team 指令、自然语言（AskUser 选择为其变体：agent 反问、用户口头确认派团队，走同一条链路）四路等价（D-004）。
2. Claude 会话常驻团队工具（分身会话除外，D-002@v2），agent 自主编排，无切换机制。
3. 分身进度/日志/产物嵌入当前会话消息流（TeamTaskBlock + 进度视图分身段块）。
4. 追问排队转主控、动态加派、叫停（复用 useMessageQueue / inject 链路；TeamTaskBlock 提供取消）。
5. 收敛结论回流消息流，会话内可反复触发多场团队任务。
6. 删除独立 missions 创建页面/路由/菜单，入口归一到会话（D-011 精确范围）。

## 3. 非目标（Non-Goals）

- 不做 Codex 引擎的 MCP 工具注入（另立后续变更，D-003）。
- 不做团队任务块的 SSE 实时推送（一期 5s 轮询；mcp_gateway 事件流接入留二期）。
- 不做历史 mission 数据迁移（项目未上线允许重置，CLAUDE.md 规则 11）。
- 不改 worker 派发链路本身：worktree 隔离、scope 校验、治理门规则、预算扣减全部复用（D-007@v2：仅治理门/workers 查询加主控轮判别）。
- 不做多会话并发共享一场团队任务；不改 team-progress.tsx 在 change 详情页的既有用法（其依赖的 getMission/cancel 端点保留）。

## 4. 拆分判断

单一功能域（会话内团队能力），backend/daemon/frontend 三端改动但围绕一条链路，plan 内分 Wave 推进，不拆多变更、非批量模式。

## 5. 总体方案

```
你（输入框 / 派团队按钮 / /team / 自然语言·含 AskUser 确认）
 │
 ▼
当前 Claude 会话的 agent ←—— 常驻注入 5 个团队 MCP 工具（分身会话不注入，D-002@v2）
 │
 ├─ mcp: dispatch_worker ──► backend 按 X-Session-Id 懒建/复用 mission → worker run
 │                            （独立 lease + worktree，可跨机器/跨工作区）
 ├─ 你随时插话（inject 排队 → 本轮完成自动送达）──► 主控动态调整：加派 / 改需求 / 收敛
 │
 └─ mcp: converge ──► 主控汇总回流消息流 ──► 继续对话（可再派任务 #2、#3…）
```

### 核心机制：主控轮双标记（D-009）

会话存在活跃 mission 时，inject 产生的当轮 AgentRun 回填 **`mission_id` + `role='orchestrator'`**（双标记）。该 run 即"主控 run"，统一解决三个依赖点：
- `_get_main_run`（converge/finalize 锚点）按 `mission_id + role='orchestrator'` 取**最新一个**——存量 external mission 链路同规则命中，天然兼容。
- 治理门/workers 列表/成本统计（`control.py` 等）查询条件从 `mission_id=X` 收窄为 `mission_id=X AND role!='orchestrator'`——主控轮不计入 MAX_WORKERS=5 并发额度与分身成本。
- `derive_status` 判别：主控轮 run 与分身 run 同表可区分。

### Phase 1 · backend：数据模型与 mission 接线

- `agent_missions` 新增 `session_id` 列（FK `agent_sessions.id`，索引，`NOT NULL`）+ alembic migration（D-006；存量行允许清库重建，不做回填）。
- **objective 落库策略**（CC-09）：列保持 NOT NULL；预建时 objective 可空则落占位 `（由会话首条团队指令定义）`，首次 inject 后以该消息文本回填；懒建时以 dispatch 上下文填。
- 新端点 `POST /api/daemon/sessions/{session_id}/team-mission`：预建 mission（scope_workspace_ids/project_id 冻结快照、budget_usd、worker_preset、main_agent_config）。项目维度校验（仅项目经理、scope ⊆ 项目关联工作区、anchor 规则）自旧 `POST /api/projects/{id}/missions` 迁移复用。**会话已有活跃 mission（未终态）时返回 409 + 提示**（R-07 单活跃约束）。
- 新端点 `GET /api/daemon/sessions/{session_id}/team-missions`：会话关联 mission 列表 + 分身 run 概要（TeamTaskBlock 数据源）。
- inject 链路：会话存在活跃 mission 时，当轮 AgentRun 回填 `mission_id` + `role='orchestrator'`（D-009；turn 冲突守卫保证单活跃轮，时序安全）。
- `dispatch_worker` 懒建兜底：按 `X-Session-Id`（见 Phase 2）查活跃 mission；无则懒建——会话绑定了 workspace 时 scope=该工作区，**未绑定则 422 提示「该会话未绑定工作区，请用派团队弹层显式选择范围」**（CC-10）；懒建默认预算上限取 daemon 配置（防 R-02 失控）。**懒建时按 X-Session-Id 将会话当前活跃 run 补回填双标记（mission_id+role='orchestrator'，与 inject 同语义——保证懒建 mission 也有主控轮锚点，Grill NEW-1）**。**并发守卫（Grill NEW-3）**：懒建对会话行 SELECT...FOR UPDATE + 数据库活跃态部分唯一索引（见 §8），防同 turn 并发 dispatch 双懒建。
- **`derive_status` 兼容扩展**（CC-01，Grill NEW-4）：签名扩展（新增 mission.session 维度入参），判据矩阵更新为：

| 条件（按序判） | 派生状态 |
|---|---|
| cancelled_at 置位 | cancelled |
| 无子 run（role!='orchestrator'）且无主控轮回填 | planning |
| 任一 run（主控轮或分身）pending/running | running |
| 主控轮 + 分身全终态、未 converge、无会话活跃 turn、**且 mission.session_id IS NOT NULL** | **awaiting_input**（新档；**存量 external/bootstrap mission（session_id 为 NULL）不进此档**，保持原 done/degraded/failed 判定——complete_lease 自动收敛依赖 derive∈{done,degraded}，必须不回归） |
| 全终态有 completed 有 failed | degraded |
| 全终态有 completed 无 failed | done |
| 全终态无 completed | failed |

- **converge 语义重定义**（D-010，审查 B2）：converge_mission 按 `X-Session-Id` 解析 mission；**分身 run 未全终态时返回引导信息**（status=busy，agent 收到后等待）；分身全终态时置位 `converged_at`（不依赖主控 run 状态）→ finalize/合并链路锚点=该 mission 最新 `role='orchestrator'` run（存量链路同规则）；mission 派生状态因 converge 置位进入终态判定。
- patrol 适配（CC-08）：僵尸判定=「分身有非终态 + 主控会话无活跃 turn + 超时」；`awaiting_input` 超时（默认 30 分钟）自动 converge；`orchestrator.py schedule_loop` 三重收敛信号改为按 session 维度判定主控存续；`redispatch_pending_main_runs` 对新链路 no-op（新链路无 pending 主控 run，保留存量行为）。
- 旧端点删除范围（D-011，审查 CC-07）：删 `POST /api/workspaces/{id}/missions`、`POST /api/projects/{id}/missions`、`GET /api/workspaces/{id}/missions`、`GET /api/projects/{id}/missions`（create+list）；**保留** `GET /api/missions/{id}`（TeamTaskBlock 详情 + change 详情 team-progress 在用）、`POST /api/missions/{id}/cancel`、全部 MCP 端点。
- `render_orchestrator_prompt` 下线；`team_mission_entry` 重构为预建入口（不再建主控 AgentRun/lease）。

### Phase 2 · daemon：注入放宽与会话上下文

- `isMainAgentSession` 谓词（D-002@v2，Grill NEW-2 可判定化）：**分身派发的 lease stage 常量化为 `'mission_worker'`**（`execution.py` dispatch 时 stage 固定该值，run.role 移入 lease metadata 保留语义）；谓词 = `provider==='claude'` 且 `stage ∈ {空, 'orchestrator'}` → 注入；`stage='mission_worker'` → **不注入**（防 worker 递归派发与 converge 干扰，审查 CC-12）。存量 external 主控 stage='orchestrator' 照常注入。
- MCP server spawn env 注入 `MCP_SESSION_ID`：`buildDaemonMcpServerConfig` 增加 env 参数（`cli.ts:720-754` provider 现收 ctx 含 sessionId，架构可行——审查 CC-06 已核），session-manager create 时传 `state.id`；claude-sdk-driver spawn 透传 env（execute 首任务实测，fallback=工具参数显式传 session_id）。
- `mcp-server.ts` 5 工具**参数可选化**（审查 B1）：`mission_id`/`workspace_id`/`run_id` 全部可选；请求统一携带 `X-Session-Id` header（env MCP_SESSION_ID → hub-client 请求头）；backend 优先按 session 解析活跃 mission，显式参数仅作越权校验锚。
- 工具描述重写为"能力说明书"：如何拆解、仅用户明确要求时派团队、何时 converge、预算提示。
- `hub-client.ts`：MCP 端点请求新增 `X-Session-Id` header 透传。

### Phase 3 · frontend：会话内团队 UI

- SessionPanel 输入区：新增「派团队」按钮（Claude 会话可用，Codex 置灰 tooltip「团队需要 Claude 引擎」）+ 触发配置弹层（范围：当前工作区/项目+scope 多选+anchor；预算；分身预设折叠）+ 就绪/进行中状态 chip。
- `/team` 指令前缀拦截：输入框检测前缀 → 等价按钮路径（弹层确认后发送）。
- AskUser 第四路（CC-11）：agent 反问「派团队还是我自己做」→ 用户选「派团队」→ 消息文本进入会话 → 走自然语言/懒建链路，**无需额外接线**（常驻工具下 agent 收到确认即调 dispatch_worker）。
- 新组件 `TeamTaskBlock`：嵌入消息流（概要行常驻：状态徽标/N 分身成功失败/花费；展开：主控行+分身行+日志/产物入口+**取消任务**按钮→cancel 端点）；数据源 `GET /sessions/{id}/team-missions`（活跃 5s 轮询）+ `GET /missions/{id}`（详情）。
- 进度视图：分身段块（violet：角色/目标工作区徽标/状态/耗时/日志/产物）+ dispatch_worker 等 MCP 工具卡（ToolEventCard 泛化渲染微调）。
- 追问排队复用 useMessageQueue（投递目标即主控会话，零改动）；「用团队分析」改造覆盖**两处**：session-panel.tsx（page/dialog 共用）与 interactive-session-panel.tsx 透传层（审查 CC-07）。
- team-progress.tsx 及 change 详情用法**不动**（依赖端点已保留）。

### Phase 4 · 清理收尾

- 删 `mission-console.tsx`、两个页面路由、菜单项「Agent 团队」；`lib/agent.ts` 删 createMission/listMissions/createProjectMission/listProjectMissions，保留 getMission/cancelMission（team-progress 在用）。
- `pnpm gen:types` 同步 api-types.ts + openapi.json。
- 模块文档更新（agent/daemon 模块文档、FRONTEND_PAGE_STYLE 如涉及）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | AgentMission 新增 session_id 列（FK agent_sessions.id，indexed，NOT NULL） |
| 新增 | backend/migrations/versions/*_mission_session_id.py | alembic：agent_missions 加 session_id 列（存量清库，无回填） |
| 修改 | backend/app/modules/agent/mission.py | derive_status 判据矩阵更新 + awaiting_input 档；get_active_mission_for_session 辅助查询 |
| 修改 | backend/app/modules/agent/router.py | 删 create+list 端点（workspace/project 四个），保留 GET /missions/{id} 与 cancel |
| 修改 | backend/app/modules/agent/control.py | 治理门/workers 列表/成本统计查询加 role!='orchestrator' 判别（D-009） |
| 修改 | backend/app/modules/daemon/router.py | 新增 POST /daemon/sessions/{id}/team-mission（预建，活跃冲突 409）+ GET /daemon/sessions/{id}/team-missions。数据流：producer=前端 team-trigger-popover（scope/budget/preset）→ DTO TeamMissionTriggerRequest → mission service 落库（scope 冻结快照+objective 占位）→ consumer=响应 TeamMissionSummary → 前端 TeamTaskBlock 轮询 |
| 修改 | backend/app/modules/daemon/schema.py | TeamMissionTriggerRequest/TeamMissionSummary DTO（scope_workspace_ids/budget_usd/worker_preset/main_agent_config/session_id 透传链） |
| 修改 | backend/app/modules/daemon/session/service.py | inject 当轮 AgentRun 回填 mission_id+role='orchestrator'（双标记，D-009）；数据流：inject → 活跃 mission 查询 → run 双标记 → mcp_tools/finalizer 按此锚定 |
| 修改 | backend/app/modules/agent/mcp_tools.py | 5 工具按 X-Session-Id 解析活跃 mission（懒建兜底+无工作区 422）；converge 语义重定义（D-010：分身未全终态返回 busy；全终态置 converged_at）；_get_main_run 取最新 orchestrator run |
| 修改 | backend/app/modules/agent/orchestrator.py | render_orchestrator_prompt 下线；team_mission_entry 重构为预建入口；schedule_loop 三重收敛信号按 session 维度判定；redispatch 保留存量 no-op |
| 修改 | backend/app/modules/agent/patrol.py | 僵尸判定/自动 converge 适配 awaiting_input（D-008） |
| 修改 | backend/app/modules/agent/execution.py | 分身派发 stage 常量化 'mission_worker'（run.role 移 lease metadata，Grill NEW-2 可判定谓词） |
| 修改 | backend/app/modules/agent/finalizer.py | 合并锚点从 mission 专属 main_run 改为最新 orchestrator run（兼容存量） |
| 修改 | sillyhub-daemon/src/cli.ts | isMainAgentSession 谓词：claude 且 stage 非 worker（D-002@v2） |
| 修改 | sillyhub-daemon/src/mcp-config.ts | buildDaemonMcpServerConfig env 注入 MCP_SESSION_ID。数据流：producer=session-manager create(state.id) → mergeMcpConfigs → claude-sdk-driver spawn env → consumer=mcp-server.ts 读 env |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | create/_resolveMainAgentMcp 传会话 id 进 MCP config |
| 修改 | sillyhub-daemon/src/mcp-server.ts | 5 工具参数可选化（mission_id/workspace_id/run_id）+ 描述重写 + X-Session-Id |
| 修改 | sillyhub-daemon/src/hub-client.ts | MCP 端点请求新增 X-Session-Id header。数据流：mcp-server env → hub-client header → backend mcp_tools 解析 |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 派团队按钮+chip；TeamTaskBlock 挂载；「用团队分析」改触发弹层；Codex 置灰 |
| 新增 | frontend/src/components/daemon/team-task-block.tsx | 消息流团队任务块（概要+分身明细+日志/产物+取消） |
| 新增 | frontend/src/components/daemon/team-trigger-popover.tsx | 触发配置弹层（范围/预算/分身预设，项目 scope+anchor 复用现有逻辑） |
| 修改 | frontend/src/components/daemon/interactive-session-panel.tsx | 透传「用团队分析」新行为（审查 CC-07 补） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 进度视图分身段块 + MCP 工具卡微调 |
| 修改 | frontend/src/lib/daemon.ts | triggerSessionTeamMission / listSessionTeamMissions API client |
| 修改 | frontend/src/lib/agent.ts | 删 create/list×4 client，保留 getMission/cancelMission（team-progress 在用） |
| 删除 | frontend/src/components/mission-console.tsx | 被 TeamTaskBlock + 触发弹层替代（D-011） |
| 删除 | frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx | 独立页面下线 |
| 删除 | frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx | 独立页面下线 |
| 修改 | frontend/src/lib/menu-permissions.ts | 删「Agent 团队」菜单项 |
| 再生成 | frontend/src/lib/api-types.ts | pnpm gen:types 产物（CLAUDE.md 规则 21） |
| 再生成 | backend/openapi.json | pnpm gen:types 同步导出 |
| 再生成 | sillyhub-daemon/src/api-types.ts | daemon 侧 openapi 类型同步（Grill P2 补） |

不动：team-progress.tsx、change-agent-run-log.tsx（change 详情既有用法，依赖端点保留）。

## 7. 接口定义

```python
# backend daemon/schema.py 新增
class TeamMissionTriggerRequest(BaseModel):
    objective: str | None = None            # 可空：落库占位，首条 inject 回填
    scope_workspace_ids: list[str] | None = None  # None=会话绑定工作区；会话无工作区且未传 → 422
    project_id: str | None = None           # 项目维度（仅项目经理）
    budget_usd: float | None = None
    worker_preset: list[WorkerPresetItem] | None = None
    main_agent_config: MainAgentConfig | None = None

class TeamMissionSummary(BaseModel):
    mission_id: str
    status: str          # planning|running|awaiting_input|done|degraded|failed|cancelled
    objective: str | None
    scope_workspace_ids: list[str]
    budget_usd: float | None
    workers: list[WorkerSummary]   # role!='orchestrator' 的分身 run 概要

# daemon/router.py
POST /api/daemon/sessions/{session_id}/team-mission  → TeamMissionSummary（活跃冲突 409）
GET  /api/daemon/sessions/{session_id}/team-missions → list[TeamMissionSummary]
```

```typescript
// frontend lib/daemon.ts
triggerSessionTeamMission(sessionId: string, req: TeamMissionTriggerRequest): Promise<TeamMissionSummary>
listSessionTeamMissions(sessionId: string): Promise<TeamMissionSummary[]>
```

MCP 工具（daemon mcp-server.ts）：`dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress` —— **参数 mission_id/workspace_id/run_id 全部可选化**（B1 修复），请求统一携带 `X-Session-Id` header；backend 解析优先级：X-Session-Id → 活跃 mission →（dispatch 无则懒建）；显式参数仅作越权校验锚。converge 响应新增 `status: "converged" | "busy" | "conflict" | "needs_manual"`（busy=分身未全终态，引导 agent 等待）。

## 7.5 生命周期契约表

本变更涉及 session / lease / agent_run / mission 生命周期，契约如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| trigger team mission | 前端（按钮/‌/team） | backend | session_id, scope_workspace_ids?, budget_usd? | mission → planning（活跃冲突 409） |
| inject（带活跃 mission） | 前端 | backend → daemon | session_id, prompt | 当轮 run 回填 mission_id+role=orchestrator；mission → running；objective 占位首条回填 |
| dispatch_worker（懒建） | 主控 agent(MCP) | backend | X-Session-Id, role, objective | 无活跃 mission → 懒建（有工作区）→ running；无工作区 → 422 |
| dispatch_worker（常规） | 主控 agent(MCP) | backend | X-Session-Id, role, objective | worker AgentRun → pending（独立 lease，claim/heartbeat/complete 链路不变） |
| worker claim/heartbeat/complete | daemon(worker) | backend | leaseId, claimToken, agentRunId | worker run pending→running→终态（不变） |
| converge | 主控 agent(MCP) | backend | X-Session-Id | 分身未全终态 → busy（状态不变）；全终态 → converged_at 置位 → mission done/degraded（finalize 锚=最新 orchestrator run） |
| mission cancel（叫停） | 前端（TeamTaskBlock） | backend | mission_id | mission → cancelled；分身按现有 cancel 级联（cancel 端点行为不变） |
| turn 完成（主控轮） | daemon | backend | runId, status, output | 主控轮 run 终态；分身全终态且未 converge → awaiting_input |
| patrol auto-converge | backend | backend | mission_id | awaiting_input 超时 → done/degraded |
| session end | 前端/daemon | backend | session_id, reason | session → ended；mission 不取消（worker 独立存活，D-008） |

契约事件与 tasks.md 任务映射：trigger→预建端点任务、inject→双标记任务、dispatch→懒建任务、converge→语义重定义任务、cancel→TeamTaskBlock 任务、patrol→适配任务，均有对应测试任务（见 tasks.md）。`session end 不触发 mission 取消` 为 FR-05 验收项。

## 8. 数据模型

```sql
ALTER TABLE agent_missions
  ADD COLUMN session_id VARCHAR(36) NOT NULL REFERENCES agent_sessions(id),
  CREATE INDEX ix_agent_missions_session_id ON agent_missions(session_id);
-- 活跃态部分唯一索引（Grill NEW-3 并发守卫）：一个会话同时至多一个未收敛未取消的 mission
CREATE UNIQUE INDEX uq_agent_missions_session_active
  ON agent_missions(session_id) WHERE converged_at IS NULL AND cancelled_at IS NULL;
-- derive_status 派生值新增 'awaiting_input'（不落库；仅 session_id 非 NULL 的会话 mission 进入）
-- objective 列保持 NOT NULL：空值落占位「（由会话首条团队指令定义）」，首条 inject 回填
-- constraints JSON 中的 session_id 死参数废弃（不再写入，读取方为零）
-- AgentRun.role 复用 'orchestrator' 标记主控轮（存量语义一致，无 schema 变化）
```

不改变的表：agent_sessions / agent_runs / daemontaskleases / worker worktree 结构全部不变。

## 9. 兼容策略

- 未触发团队的普通会话：工具常驻但 agent 不调用时行为与现状一致（仅系统提示多 5 个工具 schema，R-01 监控）。
- Codex 会话与分身会话：不注入工具，行为不变（D-002@v2/D-003）。
- worker 派发链路（worktree/scope 校验/治理门规则/预算扣减）：复用，仅治理门/workers 查询加 role 判别（D-007@v2/D-009）。
- 存量 external mission（change 阶段执行链路）：`role='orchestrator'` 主控 run 模型不变，converge/finalize 锚点规则统一后天然兼容；team-progress.tsx 用法不动。
- 旧 create/list 端点删除：前端消费方（mission-console、lib/agent.ts 对应 client）同批删除；GET/cancel 保留。
- 回退路径：未上线，revert + 重置开发数据（CLAUDE.md 规则 11）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 常驻注入使 Claude 会话系统提示变长（5 工具 schema） | P1 | 实测 token 增量；工具描述精简；必要时 daemon 配置开关降级 |
| R-02 | agent 未要求时自主派团队 / 懒建失控 | P1 | 工具描述强约束 + 懒建默认预算上限（daemon 配置）+ 测试覆盖 |
| R-03 | mission 跨 turn 状态矩阵错误（awaiting_input 误判/漏判、patrol 误收敛） | P0 | §5 Phase1 判据矩阵全格单元测试（主控轮×分身×converge×cancel×**session_id NULL 存量组合**组合）；patrol 超时配置化 |
| R-04 | mcp-server env 注入 MCP_SESSION_ID 的 SDK 透传待实测 | P1 | execute 首任务验证 claude-sdk-driver spawn 传参；fallback=工具参数显式 session_id |
| R-05 | worker 独立 AgentSession 出现在 /sessions 列表（现状已如此） | P2 | 一期不动（非目标）；二期列表过滤 |
| R-06 | 删除旧端点/组件的引用清理遗漏 | P2 | 全仓 grep 清零 + tsc/lint 门禁 |
| R-07 | 会话并发多活跃 mission 边界 | P1 | 预建 409 拒绝 + 前端提示；inject 恒取唯一活跃；测试覆盖 |
| R-08 | role='orchestrator' 复用对存量 external mission 的查询回归 | P1 | 治理门判别条件对存量链路同步生效（规则统一）；agent 模块全量 pytest 回归（local.yaml agent 子模块命令） |

## 11. 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 会话内能力 | accepted | FR-01、§5 |
| D-002@v2 常驻注入（v2 补分身会话排除） | accepted（supersedes v1） | FR-02、§5 Phase 2 |
| D-003@v1 一期 Claude 专属 | accepted | FR-02 |
| D-004@v1 触发四路等价（AskUser=自然语言变体） | accepted | FR-03 |
| D-005@v1 删独立页面 | accepted | FR-06 |
| D-006@v1 session_id 新列 | accepted | FR-01、§8 |
| D-007@v2 worker 派发链路复用（v2 收窄：治理门查询加判别） | accepted（supersedes v1） | FR-01、§5 Phase 1 |
| D-008@v1 会话结束并存 | accepted | FR-05、§7.5 |
| D-009@v1 主控轮双标记 + 治理门判别 | accepted（Grill B2/B3 修复） | §5 核心机制、§6 |
| D-010@v1 converge 语义重定义 | accepted（Grill B2 修复） | §5 Phase 1、§7.5 |
| D-011@v1 删除范围精确化（保留 get/cancel） | accepted（Grill CC-07 修复） | §5 Phase 4、§6 |

未解决决策：无（R-04 为执行期验证项，fallback 已定）。

## 12. 自审（Self-Review）— v2

- 章节齐全：背景/目标/非目标/拆分判断/总体方案（含核心机制）/文件变更清单（29 项含数据流标注）/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪 ✓
- Grill 阻塞项闭环：B1（参数可选化+X-Session-Id 定位，§7）✓；B2（converge 语义+锚点重定义，§5/§7.5）✓；B3（双标记+治理门判别，§5 核心机制/control.py 入清单）✓
- Grill 复审 NEW 项闭环（v3 小修）：NEW-4 awaiting_input 加 session_id IS NOT NULL 守卫（存量 external 不进新档，complete_lease 自动收敛不回归，§5 矩阵+R-03）✓；NEW-1 懒建补回填双标记（§5 Phase 1）✓；NEW-2 stage 常量化 'mission_worker' 可判定谓词（§5 Phase 2 + execution.py 入清单）✓；NEW-3 懒建并发守卫（FOR UPDATE + 部分唯一索引，§5/§8）✓
- P2 残留移交 plan：无 id 请求路由形态、list_workers 多轮 orchestrator 噪音、awaiting_input 超时时钟、僵尸判定存量分流
- Grill gap 闭环：CC-01 判据矩阵 ✓、CC-02/07/11 引用面与四路 ✓、CC-08 patrol/schedule_loop 入清单 ✓、CC-09 objective 占位策略 ✓、CC-10 无工作区 422 ✓、CC-12 分身排除（D-002@v2）✓、CC-13 叫停契约行 ✓、CC-06 hub-client.ts 入清单 ✓
- 生命周期契约表：9+1 事件（含新增 mission cancel 行），每个事件映射任务与验收 ✓
- 决策一致性：D-001~D-011 全映射；v2 修订按版本规则 supersedes ✓
- ⚠️ 自审存疑（执行期验证）：R-04 SDK env 透传（有 fallback）；R-01 提示词增量实测。
- UI 原型：prototype-team-session-unify.html v2 已评审通过 ✓
- frontmatter：author/created_at/scale=large/tier=independent/revision=2 ✓
