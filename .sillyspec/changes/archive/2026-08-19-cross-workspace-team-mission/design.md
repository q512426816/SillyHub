---
author: qinyi
created_at: 2026-08-19 09:20:00
scale: large
tier: independent
risk_level: standard
---

# 跨工作区团队执行 + 项目维度会话（cross-workspace-team-mission）

## 1. 背景与目标

### 背景

平台当前团队模式（team mission，2026-07-12-team-main-agent-orchestration）的 mission 钉死单个 workspace：`AgentMission.workspace_id NOT NULL`、5 个 MCP 接口 URL 结构即 `/workspaces/{id}/missions/...`、worker 的 worktree 建立与 converge merge 都落单 workspace root、dispatch 只查该 ws 的 member binding。

真实团队场景：同一 PPM 项目的不同工作区挂在**不同机器**的 daemon 上（前端工作区绑机器 A、后端工作区绑机器 B）。项目经理要在**项目维度**发起一次会话，agent 团队按任务性质把工作派到对应工作区/机器（前端任务→A 机前端工作区，后端任务→B 机后端工作区）。现状做不到。

地基已就绪：workspace-role-type（2026-08-19 归档）落了 8 值 type 词表 + description，可区分前端/后端工作区；`workspace_member_runtimes` 每成员×每工作区一行 binding，不同工作区绑不同 daemon 的数据结构今天已成立；`HostFsDelegate._via_rpc` 按 workspace→daemon 实例路由 RPC（merge/worktree 各 ws 自动路由到各自宿主机）；`ppm_project_workspace` M:N 关联表已上线。

### 设计目标

1. **跨工作区派 worker**：mission 的 worker 可指定目标工作区，按目标工作区的代表 binding 落到对应机器 daemon 执行。
2. **项目维度入口**：在 PPM 项目下发起 mission（圈选 scope 工作区集合），主 agent（orchestrator）拿到项目上下文自主调度。
3. **按工作区各自收敛**：worker 的代码 commit merge 回各自目标工作区 root，互不干扰，冲突按工作区独立处理。
4. **零回归**：存量单 workspace mission 全链路（创建/派发/收敛/MCP 工具）行为不变。

## 2. 非目标（Non-Goals）

- 不新建 ProjectSession / 项目任务组实体（用户已否决，D-002）——项目维度只是 mission 的一个创建入口 + 关联字段。
- 不做跨仓库统一 PR / 跨仓 diff 合并基础设施（v1 按工作区各自 merge，不发明项目级 PR）。
- 不改 PPM 侧任何 schema / 端点（ppm_project_workspace 关联表只读消费）。
- 不做 mission scope 的 per-workspace 元数据（角色分工、成本分摊——YAGNI，scope 是快照非关系实体）。
- 不改 shmcp_ token 绑定模型（token 仍绑单 workspace；跨 ws 驱动走平台 JWT/daemon apiKey 通道，见 §7 D-006）。
- 不做 mission 运行中动态增删 scope（scope 创建时冻结快照，后续 mission 不可变）。
- 不动 borrow（借用）语义——代表 binding 是新派发路由，与借用兜底（单 daemon 故障场景）语义不同，不混用。

## 3. 总体方案

方案 A（anchor + scope JSON 最小改造）：`AgentMission` 改造为「锚工作区（anchor）+ 项目关联（project_id）+ 派发范围快照（scope_workspace_ids JSON）」。worker 派发经新增 `target_workspace_id` 指定目标工作区，placement 按目标工作区解析**代表 binding**（owner 优先 → 任意在线 binding）选机器。converge 按工作区分组 merge。鉴权锚定 anchor。

### 3.1 方案示意图

#### 系统数据流

```mermaid
flowchart TB
    subgraph Project["PPM 项目"]
        P[项目经理]
        PJ[(ppm_project_maintenance)]
        PWJ[(ppm_project_workspace<br/>项目↔工作区 M:N)]
    end

    subgraph Frontend["前端 /projects/{id}/missions"]
        F[项目团队会话页]
    end

    subgraph Backend["Backend"]
        R[POST /api/projects/{pid}/missions]
        M[(AgentMission<br/>anchor + scope JSON)]
        O[OrchestratorService]
        D[dispatch_worker]
        PL[placement.py<br/>representative_fallback]
        C[converge / finalizer.py]
    end

    subgraph AnchorWS["Anchor 工作区（机器 A）"]
        DA[daemon A]
        MA[主 agent run]
    end

    subgraph TargetWS["Target 工作区（机器 B）"]
        DB[daemon B]
        WB[worker run<br/>.worktrees/<run8>/]
    end

    P -->|圈选 scope + anchor| F
    F --> R
    R -->|校验 scope⊆项目<br/>anchor∈scope| M
    M -->|派发主 agent| O
    O -->|target=anchor<br/>borrow 兜底| DA
    DA --> MA
    MA -->|MCP dispatch_worker<br/>target_workspace_id=B| D
    D -->|effective_target=B<br/>representative=True| PL
    PL -->|owner/任意在线 binding| DB
    DB --> WB
    MA -->|converge| C
    C -->|按 target ws 分组 merge| DB
    C -->|cleanup 同样分组| DB
```

#### 核心概念映射

| 概念 | 落点 | 说明 |
|---|---|---|
| anchor | `AgentMission.workspace_id` | 主 agent 运行的工作区；鉴权锚；单 ws mission 时即原 workspace_id |
| scope | `AgentMission.scope_workspace_ids` | 本次 mission 可派发的工作区快照，创建时冻结 |
| target | `AgentRun.target_workspace_id` | 某个 worker 实际落地的工作区；缺省 = anchor |
| representative binding | `placement.py` 新增分支 | worker target≠anchor 且本人在 target 无 binding 时，按 owner→任意在线选机器 |

#### 前端项目团队会话页线框

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 项目：multi-agent-platform                              [发起团队会话]        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ▼ 新会话                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 目标项目      multi-agent-platform                         (只读)   │   │
│  │                                                                      │   │
│  │ 主工作区(anchor)  ○ frontend-A  [前端]  在线                         │   │
│  │                   ● backend-B  [后端]  在线   ← 默认 type=backend   │   │
│  │                                                                      │   │
│  │ 派发范围(scope)  ☑ frontend-A  [前端]  在线   机器 A                 │   │
│  │                  ☑ backend-B   [后端]  在线   机器 B                 │   │
│  │                  ☐ docs-C      [文档]  离线                          │   │
│  │                                                                      │   │
│  │ 会话目标        __设计并落地跨工作区团队执行能力___________________  │   │
│  │                                                                      │   │
│  │ Worker 预设     [快速原型 ▼]  预算: [10 ▼] USD                       │   │
│  │                                                                      │   │
│  │ [取消]                              [确认创建]                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  会话列表                                                                    │
│  ┌──────────┬─────────────────────────┬────────────┬───────────┬────────┐  │
│  │ 状态     │ 目标                    │ anchor     │ scope     │ 操作   │  │
│  ├──────────┼─────────────────────────┼────────────┼───────────┼────────┤  │
│  │ running  │ 跨工作区团队执行          │ backend-B  │ 2 个工作区 │ 详情   │  │
│  │ completed│ 优化前端构建流水线        │ frontend-A │ 1 个工作区 │ 详情   │  │
│  └──────────┴─────────────────────────┴────────────┴───────────┴────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4. 架构设计

### 4.1 数据模型（backend/app/modules/agent/model.py + migration 20260819100000）

```
agent_missions 表（单 migration，未上线无存量兼容负担）：
  workspace_id        保持 NOT NULL 不动列 —— 语义收窄为 anchor（主工作区）：
                      主 agent 跑在 anchor（本人 binding 或借用）；单 ws mission
                      anchor = 原 workspace_id（Grill B-03：nullable 空态不可达
                      且全链路断链——MissionResponse/MCP URL/派发均假设非空，
                      故不改列约束，只改语义文档）
  project_id          新增 uuid FK→ppm_project_maintenance ON DELETE SET NULL
                      ← 跨 ws mission 必填；单 ws mission 可空（不强制挂项目）
  scope_workspace_ids 新增 JSON NULL（list[str(uuid-hex)]）
                      ← 派发范围快照：跨 ws mission 必填、⊇ anchor（anchor 必在）、
                        ⊆ project 关联的工作区集合；NULL 或缺省 = [anchor]（单 ws）
  service 层不变式（B-03 修订）：anchor 恒必填（列约束即保证）；跨 ws 校验
    scope ⊇ {anchor} 且 scope ⊆ ppm_project_workspace(project_id)（project_id
    此时必填）；违者 422

agent_runs 表：
  target_workspace_id 新增 uuid FK→workspaces ON DELETE SET NULL
                      ← worker run 落哪个工作区派发/收敛；NULL = anchor（存量行为）
```

### 4.2 派发路由（execution.py + placement.py）

```
MissionExecutionService.dispatch_worker(run, workspace_id=anchor, target_workspace_id=X)：
  effective_target = X or anchor（回退，零回归）
  ├─ worktree 自建：ws = load(effective_target)（不是 anchor！）
  │    → .worktrees/<run_id 短8>/ 落在目标 ws root（路径A caller worktree 不变）
  ├─ provider/model：target_ws.default_agent / default_model（各工作区各自默认）
  └─ placement.dispatch_to_daemon(workspace_id=effective_target, user=主agent daemon 属主)
```

**代表 binding 的精确边界（Grill B-04 修订，选项 a）**：

- **worker 的 target≠anchor 派发**走代表 binding：`_resolve_dispatch_runtime` 新增
  `representative_fallback: bool = False` 旗标（execution 在 target≠anchor 时传 True；
  placement 自身无 mission 上下文，靠 caller 旗标判定——P2-5）。分支顺序：
  ① 本人 binding 命中 → 原路径（不变）；② 旗标开 + 本人无 binding →
  `resolve_representative_binding(target)`：owner 的在线 binding 优先 → 该 ws 任意
  在线 binding（daemon 最近心跳排序）→ 都没有 NoOnlineDaemonError
  （worker failed + error_code=no_binding_for_workspace）；③ 旗标关 + 本人无 binding →
  **维持现状 borrow 兜底链不动**（代表 binding 不插入 borrow 之前，零借用回归）。
- **主 agent（target=anchor）派发维持现状**：本人 binding → borrow 兜底，
  **不走代表 binding**（Grill B-04：语义干净且零回归；跨 ws mission 亦然）。

### 4.3 收敛（finalizer.py）

```
execute 收敛（merge worker 分支 + worktree 副本清理）按工作区分组（Grill B-02 补）：
  workers 的 (target_workspace_id or anchor, worktree_branch) 二元组
  ├─ 按 target workspace 分组 → 每组 resolve Workspace
  │    → delegate.git_merge(ws_target, worker_branch)
  ├─ HostFsDelegate._via_rpc 按 workspace→daemon_instance 路由（现有机制零改动）：
  │    前端 ws 的 merge RPC 到 A 机、后端 ws 的到 B 机
  ├─ 冲突按组独立：A 仓冲突不挡 B 仓合并；needs_manual 报告按工作区分组列出
  └─ cleanup_mission（worktree 副本删除）同公式分组：git_worktree_remove 按
     run.target_workspace_id resolve ws 再 remove——否则 RPC 发到 anchor 机删
     不存在的路径，target 机副本永久残留（Grill B-02 实锤缺陷）
summary 合并（GLM/concat）不变——artifact 维度与工作区无关
```

### 4.4 主 agent 上下文（orchestrator.py render_orchestrator_prompt）

```
prompt 注入项目上下文：
  - 项目名（project_id → PpmProjectMaintenance.name）
  - scope 各工作区清单：id / name / type（8 值词表徽标）/ description / 绑定机器在线状态
  - dispatch_worker 用法补 target_workspace_id 参数说明：
    "按任务性质选工作区——前端任务传前端工作区 id，后端任务传后端工作区 id"
```
## 5. 生命周期契约表

本变更涉及 mission/agent_run/lease/daemon 派发链路。事件矩阵如下（**新增/变更**加粗，其余为既有行为不变）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| mission 创建（单 ws） | 前端/外部 MCP | backend agent router | objective, workspace_id | mission planning；scope=[ws] |
| **mission 创建（项目维度）** | **前端项目页** | **backend /projects/{pid}/missions** | **objective, project_id, scope_workspace_ids, anchor_workspace_id** | **mission planning；校验 scope⊆项目关联集** |
| 主 agent run 派发 | backend orchestrator | anchor 代表 binding 的 daemon | lease.metadata{stage=orchestrator, prompt} | run pending→running |
| **worker dispatch（跨 ws）** | **主 agent（MCP）** | **target 代表 binding 的 daemon** | **payload{target_workspace_id}；lease.metadata{root_path=target root}** | **run pending；worktree 落 target root** |
| worker dispatch（单 ws） | 主 agent/external | anchor 本机 daemon | 原字段不变 | 不变 |
| worker 完成 | daemon | backend run_sync | claim_token | run completed |
| **converge（跨 ws）** | 主 agent/backend 巡检 | **各 target daemon（分组）** | worktree_branch per ws | **merge 按 ws 分组；冲突按 ws 独立** |
| converge（单 ws） | 同上 | anchor daemon | 不变 | 不变 |
| kill/cancel | 用户/backend | 各 worker 所在 daemon | 不变（cancel_lease 逐 lease） | 不变 |
| lease claim/heartbeat/expire | daemon | backend lease service | 不变 | 不变（lease 与 ws 无关，按 runtime 走） |

生命周期契约要点：lease 本身不感知工作区（runtime_id 锚定），工作区语义只存在于派发时的 root_path/scope 校验与收敛时的分组——**不新增 lease 状态机**。
## 6. 决策追踪

| 决策 ID | 标题 | 状态 | 覆盖 |
|---|---|---|---|
| D-001@v1 | worker 派发按目标工作区代表 binding（owner 优先，服务身份） | accepted | §4.2、FR-02 |
| D-002@v1 | 载体 = AgentMission 多工作区化（不新建 ProjectSession） | accepted | §4.1、FR-01 |
| D-003@v1 | 产物按工作区各自收敛（finalizer 分组 merge） | accepted | §4.3、FR-03 |
| D-004@v1 | 主 agent 跑主工作区（anchor）代表 binding | accepted | §4.2、FR-01 |
| D-005@v1 | mission 钉 project_id + URL 兼容扩展 | accepted | §7、FR-04 |
| D-006@v1 | 鉴权锚 = anchor（否决 token 项目化：项目↔ws 是 M:N，token 无法承载） | accepted | §7.2、FR-05 |
| D-007@v1 | 方案 A：anchor + scope JSON（否决中间表/新实体） | accepted | §4.1 |
| D-008@v1 | v1 不挂 change_id（项目会话与 sillyspec change 解耦，scope 治理锚 PPM 项目） | accepted | §7.1 |
| D-009@v1 | workspace_id 保持 NOT NULL（anchor 恒必填；Grill B-03） | accepted | §4.1 |
| D-010@v1 | 链路B mcp_gateway 同款对齐（Grill B-01） | accepted | §7.2、§8 |
| D-011@v1 | cleanup_mission 按工作区分组（Grill B-02） | accepted | §4.3、验收 5 |

### D-006@v1 鉴权推导（用户否决 token 项目化后重推）

主 agent 的 MCP 工具注入链路（sillyhub-daemon/src/cli.ts:684-739 + mcp-server.ts）用 **daemon apiKey（X-API-Key）**→ backend `get_current_principal` 解析成 daemon 属主用户 → `require_permission(WORKSPACE_WRITE)` 按**路径 workspace_id** 校验（auth_deps.py:99 + rbac.py:107，平台级权限或该 ws 成员角色）——**根本不涉及 shmcp_ token**。因此跨 ws 驱动的鉴权锚天然是 URL 路径上的 anchor：daemon 属主用户对 anchor 有 WORKSPACE_WRITE 即可驱动整个 mission 的 5 个工具；`dispatch_worker` 的 target_workspace_id 由服务端 scope 校验兜住（越界 400）。shmcp_ 外部编排通道：v1 仍绑单 workspace（token 绑定 ws = anchor 时可驱动跨 ws mission 的工具，target 派发经 scope 校验放行——服务端校验是安全边界，凭证绑哪个 ws 不是）。

未解决风险：见 §9 R-03（发起人对 anchor 的权限 ≠ 对 target 的权限，信任链经服务端 scope 校验闭合）。
## 7. 接口定义

### 7.1 新增端点（backend/app/modules/agent/router.py）

```
POST /api/projects/{project_id}/missions
  body: MissionCreateRequest 扩展 {
    objective: str
    anchor_workspace_id: uuid | None   # 缺省 = scope 第一个（或 type=backend 优先）
    scope_workspace_ids: list[uuid]    # 必填，≥1，去重
    worker_preset / main_agent_config / budget_usd / mode / orchestration_mode  # 原样
  }
  鉴权：PPM 项目经理（复用 ppm/project/router.py _require_project_manager）或超管
  校验：scope ⊆ ppm_project_workspace(project_id)；anchor ∈ scope；
        scope 内各 ws 至少有一条带 daemon_id 的 member binding（预检，缺的报清单）
  行为：mode 强制 team（项目维度无 single 语义）；落 project_id + scope JSON

GET /api/projects/{project_id}/missions
  鉴权：同上（项目经理/超管）；返回 MissionResponse 列表（复用 _mission_to_response，
  附 project_id / scope_workspace_ids / 各 ws name+type 概要）
```

### 7.2 既有端点改造

```
MCP 5 工具 URL 全部不动 /workspaces/{ws}/missions/{mid}/...（链路A mcp_tools.py
+ 链路B mcp_gateway/tools.py 双通道同步对齐，Grill B-01）：

链路A（agent/mcp_tools.py，daemon apiKey 驱动主 agent）：
  _get_mission 校验放宽：mission.workspace_id == ws 或 ws ∈ scope
    （scope_workspace_ids 为 NULL 的行按 [workspace_id] 处理——P2-2）
  dispatch_worker payload 新增 target_workspace_id: str | None
    缺省 = anchor（零回归）；服务端校验 target ∈ scope，否则 400
    mission_target_out_of_scope
  _resolve_dispatch_agent_profile 的 workspace 级 profile 校验放宽：
    profile.workspace_id ∈ {anchor} ∪ scope（P2-1；原 == mission.workspace_id
    在跨 ws worker 绑 target ws profile 时误判 400）

链路B（mcp_gateway/tools.py，shmcp_ token 外部编排）同款对齐：
  _get_mission 同步放宽 scope；dispatch_worker 同步加 target_workspace_id 参
  + scope 校验（能力对齐，避免两通道访问面分叉）
  链路B converge 的 worker 失败兜底派发路由：user=token.created_by 经
    representative 旗标逻辑同链路A（target≠anchor 走代表 binding）

MissionCreateRequest（mission_schema.py）：
  新增 anchor_workspace_id / scope_workspace_ids（可选，缺省单 ws 行为）
MissionResponse：新增 project_id / scope_workspace_ids / workspace_name / workspace_type
MissionWorkerRunResponse：新增 target_workspace_id / target_workspace_name

创建入口统一：router.create_mission / OrchestratorService.team_mission_entry
  增 scope_workspace_ids 形参（缺省 [workspace_id]），落库
```

### 7.3 前端

```
新页面 frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx：
  发起表单：anchor 单选（scope 内，默认 type=backend 优先否则第一个）
            scope 多选（项目关联 ws，显示 type 徽标 + description + 机器在线状态）
            objective / worker_preset / main_agent_config 复用 MissionConsole 表单逻辑
  mission 列表/详情：复用 MissionConsole 组件（props 扩展 project 维度），
    worker 行新增「目标工作区」徽标列（type 词表徽标复用 workspace-role-type 组件）
lib：frontend/src/lib/agent.ts 增 createProjectMission/listProjectMissions + 类型
类型：pnpm gen:types 重新生成（openapi 变更后同 change 内提交 api-types.ts + openapi.json）
不修改：frontend/src/components/sessions/new-session-form.tsx 保持不动（会话门户保持机器视角，项目维度是 mission 入口非 AgentSession 入口）；sillyhub-daemon/src/cli.ts 不修改（D-006 仅引用其 MCP 注入链路证据，apiKey 通道零改动）
原型：见同目录 `prototype-cross-workspace-team-mission.html`（项目维度 Mission 入口 / Scope 多选 / Anchor 单选 / 跨 ws 派发与收敛流程）
```

## 8. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | AgentMission.project_id + scope_workspace_ids（workspace_id 列不动）；AgentRun.target_workspace_id |
| 新增 | `backend/migrations/versions/20260819100000_mission_cross_workspace.py` | 新 migration |
| 修改 | `backend/app/modules/agent/mission_schema.py` | Create/Response schema 扩展 |
| 修改 | `backend/app/modules/agent/router.py` | /projects/{pid}/missions 两端点 + create_mission scope 形参 + list_missions 补 project 维度过滤（可选） |
| 修改 | `backend/app/modules/agent/orchestrator.py` | team_mission_entry scope 形参 + render_orchestrator_prompt 项目上下文（主 agent 派发维持现状 borrow，B-04） |
| 修改 | `backend/app/modules/agent/placement.py` | _resolve_dispatch_runtime 增 representative_fallback 旗标分支（旗标关维持 borrow 零回归） |
| 修改 | `backend/app/modules/workspace/member_runtimes/queries.py` | 新增 resolve_representative_binding 查询（owner 优先 + 任意在线） |
| 修改 | `backend/app/modules/agent/execution.py` | dispatch_worker target_workspace_id 路由（worktree/provider/placement 全按 target；target≠anchor 传 representative 旗标） |
| 修改 | `backend/app/modules/agent/finalizer.py` | execute 收敛 merge + cleanup_mission 均按工作区分组（B-02）+ 冲突分组 |
| 修改 | `backend/app/modules/agent/mcp_tools.py` | _get_mission scope 放宽（NULL scope 按 [workspace_id]）+ dispatch_worker target 参数 + scope 校验 + profile 归属校验放宽（P2-1） |
| 修改 | `backend/app/modules/mcp_gateway/tools.py` | 链路B 同款对齐：_get_mission 放宽 + dispatch_worker target 参 + converge 兜底路由（B-01） |
| 新增 | `backend/app/modules/agent/tests/*` | 新增测试（见 §10 验收） |
| 修改 | `backend/openapi.json` | regen |
| 修改 | `sillyhub-daemon/src/mcp-server.ts` | dispatch_worker schema 加 target_workspace_id 可选参（透传 backend） |
| 修改 | `sillyhub-daemon/src/api-types.ts` | regen（openapi 同步） |
| 新增 | `frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx` | 新页面 |
| 修改 | `frontend/src/components/mission-console.tsx` | props 扩展（project 维度 + worker 目标工作区列） |
| 修改 | `frontend/src/lib/agent.ts` | createProjectMission / listProjectMissions + 类型 |
| 修改 | `frontend/src/lib/api-types.ts` | regen |
## 9. 风险登记（Risk）

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | 代表 binding 让「别人的 daemon」执行派发——owner 未授权自己的机器跑项目任务 | 高 | scope 圈选仅 PPM 项目经理可做（圈选即授权语义）；worktree 隔离（worker 只在 .worktrees/ 副本写）；审计落 created_by + target ws。v1 不做 per-binding 显式授权开关，验收记录此边界 |
| R-02 | 主 agent 越界派发（target ∉ scope） | 中 | 服务端硬校验 400 mission_target_out_of_scope；MCP schema 约束文档化 |
| R-03 | 权限语义：daemon 属主对 anchor 有 WRITE 但对 target 无任何权限 | 中 | 信任链闭合点=服务端 scope 校验（scope 圈选权=项目经理）；文档明示「scope 圈选即代表项目授权这些工作区接受派发」 |
| R-04 | scope 内某 ws 的 binding 全离线 → worker failed no_binding_for_workspace | 中 | 创建时预检（缺 binding 的 ws 报清单，可仍强制创建）；主 agent prompt 提示离线状态可跳过该 ws |
| R-05 | scope 悬挂：非 anchor ws 删除后 JSON 残留 / **anchor 删除级联删整个 mission**（target 机运行中 worker 变僵尸，Grill P2-3） | 低 | dispatch/converge 时 load 失败按 failed 处理；anchor 级联路径登记为已知边界（未上线数据可控，不做级联改型） |
| R-06 | 跨 ws mission 的 derive_status/schedule_loop 逻辑遗漏（按 run 聚合不感知 ws） | 低 | 状态聚合本来就在 run 维度（与 ws 无关），天然兼容——测试覆盖确认 |
| R-07 | PPM 项目解绑工作区后 scope 仍含它 | 低 | scope 是创建时冻结快照（D-007 明确不可变），运行中 mission 不受解绑影响；新 mission 受 ⊆ 校验约束 |
| R-08 | worker 终态 webhook 的 workspace_id 取 anchor，target ws 订阅方收不到通知（Grill P2-4） | 低 | v1 登记边界：webhook 面向 anchor 维度订阅；target 维度通知留后续需求 |

## 10. 验收要点（verify 对照）

1. 单 ws mission 全链路零回归（创建/主 agent 派发/worker dispatch/converge/MCP 工具）。
2. 项目维度创建：scope 越界（⊆ 校验）422；anchor ∉ scope 422；非项目经理 403。
3. 跨 ws dispatch_worker：target ∈ scope 放行且 worktree 落 target root；target ∉ scope 400；target 无在线 binding → worker failed no_binding_for_workspace 不崩 mission。
4. 代表 binding 解析：owner 优先 → 任意在线 → 报错，三分支单测。
5. converge 分组：两 ws 各一 worker，merge RPC 各到各 daemon（mock delegate 断言调用分组）；A 冲突不挡 B 合并；**cleanup_mission 同样分组（副本删除 RPC 到各 target 机，B-02）**。
6. 主 agent prompt 含项目名 + scope 清单（type 徽标语义）。
7. daemon mcp-server.ts schema 新参透传（daemon 侧 vitest）。
8. 链路B（mcp_gateway）对齐：shmcp_ dispatch_worker 带 target_workspace_id 跨 ws 派发可达 + scope 越界 400 + _get_mission 放宽（B-01）。
9. 借用零回归：representative 旗标关（单 ws / 主 agent anchor 派发）时 binding-None 仍走 borrow（B-04）。
10. gen:types 同 change 内提交。

## 11. 自审（Self-Review）

- [x] 六段设计均经用户确认（数据模型/派发路由/收敛/鉴权/API/前端）。
- [x] Design Grill 独立审查 4 P1 全部按用户确认修正：B-01 链路B（mcp_gateway）对齐矩阵落 §7.2/§8；B-02 cleanup 分组落 §4.3/验收 5；B-03 workspace_id 保持 NOT NULL（§4.1 重写不变式）；B-04 主 agent 维持 borrow、代表 binding 仅 worker target≠anchor 且靠 caller 旗标（§4.2 重写）。5 条 P2 全部落文（P2-1 profile 校验放宽 §7.2 / P2-2 NULL scope 处理 §7.2 / P2-3 anchor 级联 R-05 / P2-4 webhook R-08 / P2-5 placement 旗标 §4.2）。
- [x] D-001~D-008 全部落到具体章节与 FR；D-006 含否决后重推过程（apiKey 链路证据 cli.ts:684-739 / mcp-server.ts:25-63 / auth_deps.py:99 / rbac.py:107）。
- [x] 零回归边界显式：URL 不动、payload 新参可选、单 ws 缺省路径逐一列出、borrow 链不动（B-04 选项 a）。
- [x] 生命周期契约表含 mission/lease/daemon 关键词（契约表 §5）。
- [x] 未上线无存量迁移负担（migration 只做结构变更 + 不写数据回填）。
- [x] ⚠️ 自审存疑 1 已由 Grill B-04 闭合（代表 binding 边界重定义）。
- [x] ⚠️ 自审存疑 2 已闭合（anchor fail-loud + 创建预检，D-004；主 agent 维持 borrow 后该存疑的「anchor 不可达」仍走既有 pending 待重派语义）。
- [x] 规模评估：large（跨 agent/workspace/ppm/mcp_gateway/daemon/frontend 六模块 + schema 变更 + 新端点）→ tier=independent，走完整四件套 + plan。
