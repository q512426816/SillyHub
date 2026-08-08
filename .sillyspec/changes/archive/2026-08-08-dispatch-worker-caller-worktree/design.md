---
author: qinyi
created_at: 2026-08-08 17:05:13
revised_at: 2026-08-08 17:55:00
scale: large
related_change: 2026-08-07-sillyhub-mcp-dispatch (跨仓 sillyspec)
review_round: 2 (Design Grill round-1 FAIL → 补 mission external mode 重审)
risk_level: contract-required
---

# 设计文档（Design）— dispatch_worker 支持 caller 提供自己的 worktree（路径A）

> **round-2 修订**：round-1 Design Grill FAIL，抓到两个 P0——① 主动写 `run.worktree_branch` 会在 worker 终态触发 `finalize_execute_mission` 的 `git merge --no-ff sillyspec/<change>`，污染 caller 主仓；② `create_mission` → `team_mission_entry` 强制 spawn 僵尸 orchestrator run + 占 lease。本版引入 **mission "external 模式"**（跳过 orchestrator spawn + converge 跳过 merge）一并解决，并改字段名对齐跨仓契约（`worktree_branch`→`branch`）。

## 1. 背景

SillySpec 的子代理派发抽象层（sillyspec 仓 change `2026-08-07-sillyhub-mcp-dispatch`）已落地：execute 经「双后端 + 能力探测」决定派本机 Agent tool 还是 SillyHub MCP worker。SillySpec 侧 client/probe/strategy/backends 全部就绪，但 SillyHub 后端 `dispatch_worker` 当前**强制为每个 worker 自建 worktree**（`execution.py:184-236`），`render_worker_prompt`（`execution.py:105-129`）硬编码 `git add -A && git commit`，且 `create_mission` → `team_mission_entry`（`orchestrator.py:130`）强制 spawn 一个 `role=orchestrator` 主 agent run + 占 daemon lease。

这导致 worker 进 SillyHub 自建 worktree、代码落点失控、commit 污染 sillyspec 分支；且 SillyHub mission = orchestrator+worker **team 模型**，与路径A（SillySpec 外部调度）架构不匹配——SillySpec 自己就是调度者，不需要 SillyHub 再 spawn 一个无人驱动的 orchestrator。

跨仓契约 `docs/sillyspec/sillyhub-path-a-contract.md`（sillyspec 仓）声明了「路径A」期望。本变更在 SillyHub 仓落地路径A（含 mission external 模式对齐）+ 跨仓登记 SillySpec 侧接通，让 SillySpec execute 端到端真实可用。

## 2. 设计目标

- SillySpec execute 经 SillyHub 公开 MCP gateway（链路B）调 `create_mission`(external) + `dispatch_worker`，把 worker 派到 **SillySpec 自己的 worktree**（`<repo>/.sillyspec/.runtime/worktrees/<change>/`）执行
- **不 spawn 僵尸 orchestrator**（external 模式跳过 team_mission_entry 的 orchestrator run/lease）
- worker 按 caller 的 `worker_prompt` 干活、**不 commit**，改动留工作区
- worker 终态后 SillyHub **不 converge merge / 不 cleanup caller worktree**（external 模式跳过 finalize）；SillySpec 轮询 `list_workers` 拿终态，自己 `git diff` + apply 回主干
- 端到端验证：某仓 SillySpec execute 一波 → SillyHub worker 在 worktree 写码 → SillySpec 回收 review.json + apply

## 3. 非目标

- 不改 SillyHub team 模式 mission worker 行为（`host_fs_delegate` 自建 worktree 路径，`orchestration_mode="team"` 默认，既有调用方零回归）
- 不新增 MCP tool（8 tool 不变；`create_mission` 仅加可选参）
- 不新增 DB 列（`worktree_path`/`orchestration_mode` 仅入参 + lease metadata + `AgentMission.constraints` JSON，不持久化新列）
- 不解决 external mission 在 SillyHub 侧的显式生命周期关闭（YAGNI——SillySpec 不依赖 mission 状态，每 Wave 新 mission；mission 残留不阻断）
- 不改 `placement.py`（已有 prompt/branch/root_path 形参）

## 4. 拆分判断

单一目标（caller-worktree 路径A + mission external 模式对齐）。改动围绕 dispatch_worker 参数链 + create_mission 模式分叉 + converge external 跳过，耦合度高。不拆分、不走批量。

## 5. 总体方案

### 5.1 数据流

```
SillySpec execute (在自己 worktree <repo>/.sillyspec/.runtime/worktrees/<change>/)
  │ ① create_mission(objective, change_id, orchestration_mode="external")  ← 跳过 orchestrator spawn
  │   经 SillyHub 公开 MCP gateway (链路B, token-scoped)
  ▼
mcp_gateway/tools.py create_mission → team_mission_entry(mode="external")
  │ mode="external" → 不建 orchestrator run / 不派 orchestrator lease
  │ constraints = {"orchestration_mode": "external"}  (AgentMission.constraints JSON，不加列)
  ▼
SillySpec ② dispatch_worker(mission_id, objective, worktree_path=<该worktree>,
  │                          branch="sillyspec/<change>", worker_prompt=<不commit覆写>, read_only=false)
  ▼
mcp_gateway/tools.py dispatch_worker → execution.dispatch_worker
  │ worktree_path 非空 → 跳过 git_worktree_add；root_path=worktree_path
  │ ⚠️ 路径A 不写 run.worktree_branch（保持 None，避免 finalize merge 触发，双保险）
  │ prompt = worker_prompt if worker_prompt else render_worker_prompt(run)
  │ placement.dispatch_to_daemon(prompt=..., root_path=worktree_path, branch="sillyspec/<change>")
  ▼
daemon 在 caller worktree 起 worker (cwd=root_path)，按 worker_prompt 干活不 commit
  │ worker 终态 (completed/failed) → complete_lease → converge_mission_for_completed_run
  ▼
converge_mission_for_completed_run 检测 mission.constraints.orchestration_mode=="external"
  │ → 跳过 finalize_execute_mission / cleanup_mission（不 merge 不清 caller worktree）
  ▼
SillySpec 轮询 list_workers 拿终态 → 自己 git diff worktree → 写 review.json → apply 回主干
```

### 5.2 Phase 划分（plan 阶段细化 Wave）

- **Phase 1 mission external 模式**（P0-2）：create_mission 加 `orchestration_mode` + team_mission_entry external 跳过 orchestrator
- **Phase 2 dispatch_worker 路径A 核心**（P0-1）：dispatch_worker 加 worktree 参数 + 自建短路 + 路径A 不写 worktree_branch + worker_prompt 覆写
- **Phase 3 converge external 跳过**（P0-1 根解）：converge_mission_for_completed_run 检测 external 跳过 finalize/cleanup
- **Phase 4 两条 MCP 入口 + daemon schema 透传**：链路B（mcp_gateway）+ 链路A（mcp_tools + daemon mcp-server/hub-client）的 create_mission + dispatch_worker 参数
- **Phase 5 daemon allowed_roots 文档/校验**：workspace root_path=仓根前缀放行 + smoke 前置校验
- **Phase 6 跨仓 SillySpec 接通**：isPathASupported 探测 + createMission 传 external + probe rootPath + smoke + 跨仓契约更新
- **Phase 7 测试**：external mode + caller-worktree + converge 跳过单测 + 全套零回归

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/execution.py | dispatch_worker(:153) 加 `worktree_path`/`branch`/`worker_prompt` 三可选参；:190 自建 if 加 `and not worktree_path` 短路 + root_path 赋值；路径A **不写 run.worktree_branch**；:245 prompt 覆写 |
| 修改 | backend/app/modules/agent/orchestrator.py | team_mission_entry(:130) 支持 `orchestration_mode="external"`：跳过 orchestrator run/lease，constraints 存 mode |
| 修改 | backend/app/modules/agent/finalizer.py | converge_mission_for_completed_run(:470) 检测 mission.constraints.orchestration_mode=="external" → 跳过 finalize/cleanup（不 merge caller worktree） |
| 修改 | backend/app/modules/mcp_gateway/tools.py | create_mission(:743) 加 `orchestration_mode` 参 + 传 team_mission_entry；dispatch_worker(:335) 加3参透传（链路B） |
| 修改 | backend/app/modules/agent/mcp_tools.py | DispatchWorkerRequest(:56) 加 worktree_path/branch/worker_prompt + dispatch_worker HTTP 端点透传 execution（链路A；P2 校正：create_mission HTTP 实际在 router.py:847 非 mcp_tools.py） |
| 修改 | backend/app/modules/agent/router.py | create_mission HTTP(:847) orchestration_mode 并入 constraints + team 门控扩展（external 也进 team_mission_entry，不落 GLM planner）+ team_mission_entry 透传（链路A；P2 校正补登） |
| 修改 | backend/app/modules/agent/mission_schema.py | MissionCreateRequest 加 orchestration_mode: Literal["team","external"]\|None=None（链路A；P2 校正补登，沿用 mode 字段 Literal 风格） |
| 修改 | sillyhub-daemon/src/mcp-server.ts | **仅 dispatch_worker** inputSchema/handler 加 worktree_path/branch/worker_prompt（链路A daemon stdio）。★execute task-06 订正：daemon stdio 仅 5 tool（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress），**无 createMission**（grep 全 sillyhub-daemon/src 确认，仅 api-types.ts 自动生成类型提到 create_mission）；create_mission external 仅链路B（task-04），§3 非目标"不新增 tool"不容许凭空加 createMission |
| 修改 | sillyhub-daemon/src/hub-client.ts | dispatchWorker body 加 worktree_path/branch/worker_prompt（snake_case；createMission 同不存在于 daemon stdio，故无对应改动） |
| 新增 | backend/app/modules/agent/tests/test_dispatch_worker_caller_worktree.py | caller-worktree 分支单测（传 worktree_path → 不调 git_worktree_add + root_path 透传 + 不写 worktree_branch + worker_prompt 进 prompt） |
| 新增 | backend/app/modules/agent/tests/test_mission_external_mode.py | external mode 单测（create_mission external → 无 orchestrator run；converge external → 跳过 finalize） |
| 修改（跨仓 sillyspec） | sillyspec/src/dispatch/backends/sillyhub-mcp.js | isPathASupported() 探测 MCP tools/list dispatch_worker schema 含 worktree_path |
| 修改（跨仓 sillyspec） | sillyspec/src/sillyhub-mcp/client.js | createMission 加 orchestration_mode="external"；dispatchWorker 传 branch（对齐字段名） |
| 修改（跨仓 sillyspec） | sillyspec/src/dispatch/probe.js | rootPath 拿取 + worktree 越界校验 |
| 修改（跨仓 sillyspec） | sillyspec/docs/sillyspec/sillyhub-path-a-contract.md | 路径A 落地状态 + 字段名 branch + external mode + 校验清单打勾 |
| 新增 | docs/integrations/sillyspec-dispatch.md | 路径A 部署集成指引：workspace root_path=仓根 + daemon allowed_roots 两源（本地 config assertWithinAllowedRoots / backend runtime overlay PolicyEngine）+ 配置 JSON 示例 + 守卫触发点排查（task-10，R-03） |
| 新增 | scripts/check-dispatch-allowed-roots.mjs | smoke 前置硬校验脚本：仓根不在 daemon allowed_roots → EXIT 1 + 中文引导（fail-closed，复刻 file-rpc.ts under 语义，task-10） |
| 修改 | sillyhub-daemon/tests/protocol-session-contract.test.ts | 附载预存陈旧测试 bug 修复：MSG 总数断言 18→19（db90fa17 加 PROVIDER_CONFIG_CHANGED 未更新计数测试，阻塞 verify daemon 套件；与本变更 dispatch_worker logic 无关，protocol.ts 不在本变更 diff，用户授权修 2026-08-08） |

不改：placement.py（已有 prompt/branch/root_path 形参）、AgentMission 模型（constraints JSON 复用，不加列）、derive_status（不区分 role，external mission worker 全终态自然 done）。

## 7. 接口定义

### 7.1 create_mission 新增可选参（external 模式，P0-2）

```python
@mcp.tool()
async def create_mission(
    objective: str,
    worker_preset: list[dict] | None = None,
    main_agent_config: dict | None = None,
    budget_usd: float | None = None,
    change_id: uuid.UUID | None = None,
    orchestration_mode: str = "team",   # "team"(默认,零回归) | "external"(路径A,SillySpec 外部调度)
    ctx: Context | None = None,
) -> dict
```

`orchestration_mode="external"` → team_mission_entry 跳过 orchestrator run/lease，`AgentMission.constraints = {"orchestration_mode": "external"}`。返回 `{mission_id, status, main_run_id: null, workers: []}`（external 无 main_run）。

### 7.2 MissionExecutionService.dispatch_worker 新签名（execution.py:153）

```python
async def dispatch_worker(
    self, run: AgentRun, *,
    workspace_id: uuid.UUID, user_id: uuid.UUID, read_only: bool,
    # 路径A 新增（caller SillySpec 提供自己的 worktree；默认 None 走原自建逻辑）
    worktree_path: str | None = None,   # caller worktree 绝对路径，作 daemon root_path
    branch: str | None = None,          # caller worktree 分支（如 sillyspec/<change>），作 lease metadata 记录
    worker_prompt: str | None = None,   # caller 覆写 worker prompt（含"不 commit/不越界"指令）
) -> uuid.UUID | None
```

⚠️ **路径A 不写 `run.worktree_branch`**（DB 列保持 None）——该列是 team 模式 converge finalize 查 merge 的触发字段（finalizer.py:255），路径A SillySpec 自己 apply 不需要 SillyHub merge，写它会触发 `git merge --no-ff <branch>` 污染 caller 主仓（P0-1）。`branch` 入参仅作 lease metadata 记录，不落 `run.worktree_branch` 列。

### 7.3 MCP dispatch_worker 入参增量（两条入口同构，字段名 branch 对齐跨仓契约）

链路B（mcp_gateway/tools.py:335）+ 链路A（mcp_tools.py DispatchWorkerRequest:56 + daemon mcp-server.ts:163）：

```python
worktree_path: str | None = None
branch: str | None = None        # 对齐跨仓契约 + sillyspec client.js（round-1 用 worktree_branch 漂移，已统一）
worker_prompt: str | None = None
```

snake_case；不传 → None → execution.py 走原逻辑。

### 7.4 worker_prompt 覆写语义（execution.py:245）

```python
prompt = worker_prompt if worker_prompt is not None else render_worker_prompt(run)
```

caller 传 → 完全替代 render_worker_prompt（SillySpec 侧已有"绝不 commit/不越界 allowedPaths"覆写文本）。不传 → 原 render（team 模式不变）。

## 7.5 生命周期契约表

本变更涉及 lease / daemon / agent_run / mission / orchestrator / worker 终态，必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create_mission（external）| SillySpec | SillyHub MCP (链路B) | objective, change_id, orchestration_mode="external" | mission created；**不 spawn orchestrator run** |
| dispatch_worker（路径A）| SillySpec | SillyHub MCP (链路B) | mission_id, objective, worktree_path, branch, worker_prompt, read_only | worker run: → pending |
| claim lease | daemon | backend | leaseId, agentRunId | worker run: pending → running |
| worker turn result | daemon | backend | runId, status, output | worker run: running → completed/failed |
| converge_mission_for_completed_run（external 短路）| backend(complete_lease) | finalizer | mission_id | **检测 external → 跳过 finalize/cleanup**，不 merge 不清 |
| list_workers 查询 | SillySpec | SillyHub MCP (链路B) | mission_id | （只读）SillySpec 读各 worker 终态 |
| 回收 review.json | SillySpec | 本地 worktree（不经 SillyHub） | git diff worktree → review.json | SillySpec 自己 apply |

缺失事件说明：
- **路径A 不 spawn orchestrator**（external 模式跳过 team_mission_entry 的 orchestrator run/lease），故无 orchestrator 生命周期事件。
- **路径A 不触发 converge finalize/cleanup**：converge_mission_for_completed_run 检测 `mission.constraints.orchestration_mode=="external"` → 跳过 finalize_execute_mission（不 merge）+ cleanup_mission（不清）。双保险：路径A worker 不写 `run.worktree_branch`，即使 external 检测失效，finalize 查空也跳过 merge（finalizer.py:255）。
- external mission 收尾：无 orchestrator，worker 全终态 → `derive_status` 返回 done/degraded → converge 检测 external 短路返回。mission 在 SillyHub DB 残留（不阻断 SillySpec，每 Wave 新 mission；显式关闭 YAGNI）。

## 8. 数据模型

**不新增列、不改表结构**。
- `worktree_path`/`branch`/`worker_prompt`：仅作 dispatch_worker 入参 + lease metadata（`daemon_task_leases.metadata` JSON）传递，不持久化为 AgentRun 列。
- `orchestration_mode`：存 `AgentMission.constraints`（model.py:601，JSON nullable，已存在）`{"orchestration_mode": "external"}`，不加列。
- `AgentRun.worktree_branch`（model.py:332）：路径A **不写**（保持 None）；team 模式不变。

## 9. 兼容策略（brownfield）

- **orchestration_mode 默认 "team"** → team_mission_entry 走原逻辑（spawn orchestrator），既有 create_mission 调用方零回归
- **dispatch_worker 三参默认 None** → execution.py 走原自建 worktree 逻辑，team 模式 mission worker / 既有 MCP 调用方字节不变
- **worker_prompt 默认 None** → render_worker_prompt 原输出（含 commit），team 模式不变
- **converge external 检测默认不命中**（team mission constraints 无 orchestration_mode 或 ="team"）→ finalize 走原 merge 逻辑，team 模式 converge 不变
- **路径A 不写 worktree_branch** → 不影响 team 模式（team 模式 dispatch 仍写该列）
- **不改 API/表结构**：create_mission + dispatch_worker 入参仅增量可选，OpenAPI 向后兼容

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | worker 终态触发 converge finalize merge 污染 caller 主仓（round-1 P0-1）| P0 | 三重防御：① external mode → converge 检测跳过 finalize；② 路径A 不写 run.worktree_branch → finalize 查空跳过；③ worker_prompt 覆写不 commit。execute 实测三层任一生效 |
| R-02 | create_mission external 仍 spawn orchestrator 或 constraints 未落（round-1 P0-2）| P0 | team_mission_entry external 分支单测（无 orchestrator run + constraints 含 mode）；converge external 短路单测 |
| R-03 | caller worktree_path 不在 daemon allowed_roots → assertWithinAllowedRoots 拒 | P0 | 约定 workspace root_path=SillySpec 仓根（worktree 在 .sillyspec/.runtime/worktrees/ 前缀放行）；smoke 前置硬校验 allowed_roots 含仓根；deploy 文档 |
| R-04 | SillySpec isPathASupported 探测依赖 MCP tools/list + McpToken 鉴权 | P1 | 确认 FastMCP(@mcp.tool) 暴露 tools/list + sillyspec client.js 持 token 调通；探测保守 fallback Local；plan 阶段补鉴权证据 + smoke 验 optional 字段入 schema |
| R-05 | 路径A worker 越界改其他 task 文件 | P1 | worker_prompt 覆写含"不超出 allowedPaths" + SillySpec 侧 assess/apply 既有门控 |
| R-06 | 链路A(daemon stdio) 与链路B(public) create_mission/dispatch_worker schema 双写漂移 | P1 | 两入口同构增量 + 字段名统一 branch；测试覆盖两入口；OpenAPI 单一真相 |
| R-07 | external mission 在 SillyHub 残留（无显式关闭）| P2 | YAGNI——SillySpec 不依赖 mission 状态，每 Wave 新 mission；残留不阻断。后续可加 mission TTL/显式 close（非本次） |
| R-08 | 跨仓时序：SillyHub 落地前 SillySpec 探测恒 false | P2 | 两仓解耦，SillyHub 先落地，SillySpec 探测随后翻真 |

## 11. 决策追踪

- **D-001@v1 方案A caller 全权控制 worker_prompt**：覆盖 FR-02；否决方案B/C
- **D-002@v1 不新增 DB 列**：worktree_path/branch/worker_prompt 入参 + lease metadata；orchestration_mode 存 AgentMission.constraints JSON；覆盖 §8
- **D-003@v2 finalizer 改（检测 external 跳过）**【round-2 修订，round-1 v1"不改"被 Grill 证伪】：converge_mission_for_completed_run 加 external 检测跳过 finalize/cleanup；覆盖 §7.5；R-01 根解
- **D-004@v1 路径A 不 converge/cleanup**：SillySpec 自己 apply（跨仓契约 D-004 同源）；覆盖 §7.5
- **D-005@v1 SillySpec 探测 tools/list**：isPathASupported 查 dispatch_worker schema 含 worktree_path；覆盖 FR-04；R-04
- **D-006@v1 范围含跨仓 SillySpec 接通**：覆盖 FR-04/FR-07
- **D-007@v1 mission external 模式**【round-2 新增，解 P0-2】：create_mission 加 orchestration_mode，external 跳过 orchestrator spawn + constraints 标记；converge 检测 external 跳过；覆盖 FR-08/FR-09；R-02
- **D-008@v1 路径A 不写 run.worktree_branch**【round-2 新增，解 P0-1 双保险】：该列是 team converge merge 触发字段，路径A 不需要；覆盖 §7.2；R-01 防御层②
- **D-009@v1 字段名统一 branch**【round-2 修订，round-1 worktree_branch 与跨仓契约漂移】：对齐 sillyhub-path-a-contract.md + sillyspec client.js（已传 branch）；覆盖 §7.3；R-06

## 12. 自审（round-2）

- ✅ P0-1（merge 污染）三重防御：external converge 跳过 + 不写 worktree_branch + worker_prompt 不 commit（R-01）
- ✅ P0-2（僵尸 orchestrator）external 模式跳过 spawn（R-02，D-007）
- ✅ 字段名 branch 对齐跨仓契约 + client.js（D-009，R-06）
- ✅ 零回归：orchestration_mode 默认 team + 三参默认 None + converge external 默认不命中（§9）
- ✅ 不新增列（constraints JSON 复用）
- ✅ 生命周期契约表覆盖路径A 全事件，orchestrator/converge 缺失有 external 说明
- ⚠️ R-01/R-02 是方案成立的关键，execute 必须实测三重防御 + external 短路
- scale: large（跨模块 + 跨仓 + mission 架构对齐）；tier: independent（跨模块架构，独立 Grill）
