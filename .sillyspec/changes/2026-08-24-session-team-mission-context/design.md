---
author: qinyi
created_at: 2026-08-24 16:55:00
scale: large
tier: independent
risk_level: unit-sufficient
revision: 2
---

# 设计文档（Design）— 会话团队任务上下文贯通（主控简报+mission_status+非git直通+新会话派团队）

> v2（2026-08-24 Design Grill 修订）：采纳独立审查 UB-1/UB-2 两个 P1（E1 事务边界改 flush-only helper；C 层数据源锚点失实改后端统一探测端点）与 CC-03/05/06/08/10/11/12/13 及 E1 objective 回填等 P2 修正，见 §11 决策追踪与 §12 自审。

## 1. 背景

会话内派团队（2026-08-22-team-session-unify 落地）在生产使用中暴露**主控盲区**：预建 mission 后，主控轮（会话自身 inject 轮，D-009@前序 双标记）收到的 prompt 是裸用户文本——不知道 mission 的 scope 工作区、各工作区绑定的机器与在线状态，也没有任何工具可查。

实证（生产库 + 代码，2026-08-24）：
- 会话 `122a9e86`（origin=chat，workspace_id=NULL）预建 mission `0a095758`（scope=[sillyspec, multi-agent-platform]，项目维度），主控首轮 prompt=「帮我分析下这个项目是干什么的」原文；主控 cwd=daemon 默认沙箱 `C:\Users\qinyi\sillyhub_workspaces`（会话无工作区 → lease 无 cwd），靠翻 8-14 遗留 `.sillyspec-platform.json` 猜工作区；6 个 worker 全落锚点工作区，scope 第二工作区从未被使用。
- 根因：`orchestrator.py:278-283`（docstring）+ `:338-347`（实码提前 return）session 预建模式跳过 `render_orchestrator_prompt`（前序变更假设"常驻工具描述足够"，实际工具描述是静态的、无法携带 mission 上下文）；MCP 工具只有 dispatch/get_result/list/converge/report 五个，无 mission 状态查询。
- 另三个用户直接反馈的缺口：①新会话（预会话）派团队按钮硬编码置灰（`session-panel.tsx:1657-1669`，ql-20260823-008——预建 mission 需要会话 id，当时未做创建时预建）；②worker 派发强制 per-worker git worktree（`execution.py:250-330`），非 git 目录工作区派发直接 `worktree_create_failed`；③主 agent（项目经理）恒=当前会话的机器与智能体，无法选择 scope 内其它工作区承接。

现成可复用的机制（本设计的落点；Grill 已逐一核实）：
- **变更会话首轮前导先例**：`daemon/session/service.py:910-920` `build_change_context_preamble` —— dispatch prompt=前导+`\n\n---\n\n`+用户消息，AgentRunLog(user_input)/前端展示保持干净用户消息，零 daemon 改动。
- **scope+daemon 在线渲染**：`orchestrator.py:107-225` `render_orchestrator_prompt`（BE-P1-5 已修在线判定；patrol.py:622 仍在用，不可删）。
- **路径A 无 worktree_branch 先例**：`execution.py:238-243` caller worktree 直接作 root_path、`run.worktree_branch` 保持 None；`finalizer.py:290-297`（合并）与 `:470-477`（清理）均只选 `worktree_branch IS NOT NULL` → 无分支 worker 天然跳过。
- **三态探测零新增 daemon RPC**：`host_fs/delegate.py` 的 RPC 通道有两层——`_via_rpc_or_degrade`（:730，transport 失败静默降级，**不可用于探测**）与 `_via_rpc`（:657，transport 失败抛异常，可区分三态）；未绑 daemon 时抛 `HostFsDelegateUnavailable`（归 unknown）。注意 :126 的 `send_rpc` 是 `_WsRpcLike` Protocol 声明而非 HostFsDelegate 公开方法（Grill CC-05 修正）。
- **daemon host_fs stat 语义**：`host-fs-handler.ts:455-457` 先 `assertWithinAllowedRoots` 再 `pathResolve`——**相对路径会解析到 daemon 进程 cwd 而被拒**，探测必须传绝对路径（Grill CC-06 修正）；`.git` 为文件（worktree 检出）时 lstat 仍可用。
- **MCP 会话路由模式**：`mcp_tools.py:1342+` `_X_for_session` + `_resolve_session_mission`；注意无活跃 mission 时 `_resolve_session_mission` 抛 404（:455-458），status 端点不可直接复用（§5.B）。agent router 挂载无额外前缀（agent/router.py:940、main.py:739），既有会话路由实际路径为 `/api/sessions/...`，daemon 侧实际调 `/api/missions/{action}`（hub-client.ts:431）——新路由前缀 plan 期与 hub-client 形态对齐（Grill CC-10）。
- **前端在线聚合**：`workspace-daemon-status.ts` 实际导出 `aggregateDaemonStatus`（:59）/`useDaemonStatusMap`（:110）；`DaemonStatusEntry`（:39-43）**无机器名字段**、仅覆盖**本人** bindings（fetchMyBindings）——他人绑定的 scope 工作区会误显「未绑机器」（Grill CC-09/UB-2）。故 C 层机器状态改走后端统一探测端点（§5.C）。

## 2. 设计目标

1. **FR-01 主控首轮任务简报**：预建 mission 后的首个主控轮，prompt 前缀注入简报（mission_id、锚点工作区、scope 清单含各工作区绑定机器+在线状态+git 模式、dispatch_worker 用法、禁越权约束）；展示层保持干净用户消息；一次性语义含失败重注（§5.A）。
2. **FR-02 mission_status 常驻查询工具**：主 agent 随时可查当前 mission 概要/scope 工作区机器状态/workers 概要；无活跃 mission 优雅返回不报错。
3. **FR-03 弹层机器状态**：派团队弹层工作区行显示绑定机器名+在线徽标+git 模式标签（后端统一口径，含他人 binding）。
4. **FR-04 非 git 工作区直通**：worker 派发三态探测——git 仓库照旧 worktree 隔离；确证非 git 跳过 worktree 直通工作区目录（worktree_branch=None，直通约束 prompt 变体）；探测未知维持现状；converge/finalizer 零改动。
5. **FR-05 新会话派团队可用**：预会话解禁，首句创建请求携带团队配置，首轮派发前预建 mission（**flush-only 同事务**）→ 首句即主控首轮+简报。
6. **FR-06 主 agent 选择器（预会话）**：默认当前会话；可选 scope 内工作区 → 会话创建在该工作区绑定机器上（**取 (W, 创建者) binding**，缺失 422）、cwd=该工作区根、智能体=该工作区默认配置；既有会话不提供（进程 cwd/机器创建时钉定）。
7. **FR-07 存量零回归**：team 模式/external mission/patrol/懒建/无 mission 普通会话/worker 派发路由（WorkspaceMemberRuntime 唯一真理源）全部不变。

## 3. 非目标（Non-Goals）

- **C 层主体**：会话↔工作区集合模型（session 单 workspace_id → 多工作区上下文）、弹层非项目维度自由多选工作区、per-daemon SPEC_TRANSPORT 混部、既有会话跨机器主控迁移——全部拆独立变更，本变更仅在 §5.E 记录边界。
- 不增强懒建路径 dispatch_worker 响应（用户已澄清：靠 mission_status 工具）。
- 不做直通模式并发序列化机制（同目录并发写风险靠治理门上限+简报提示，见 R-03）。
- 不做 Codex 引擎的 MCP 工具注入（前序变更 D-003 遗留，不变）。
- 不改 converge 语义 / patrol 判定 / 派发路由 / 治理门规则。
- 不做历史 mission 数据迁移（未上线允许重置，CLAUDE.md 规则 11）。

## 4. 拆分判断

单一功能域（会话团队任务的上下文贯通），五层围绕一条链路（主控感知→派发模式→入口可用），backend/daemon/frontend 三端但无独立交付边界，plan 内分 Wave 推进，不拆多变更、非批量模式。

## 5. 总体方案

```
【入口】                                   【主控感知】                    【派发模式】
预会话弹层（解禁+主agent选择器）─┐
既有会话弹层（机器状态徽标）─────┼→ 预建 mission（含 create 时预建）→ 首个主控轮 prompt 前缀简报（A）
/team / 自然语言（不变）────────┘        │                          ↓
                                        └→ mission_status 工具随时查（B）→ dispatch_worker
                                                                        ├ git 仓库 → worktree 隔离（现状）
                                                                        └ 确证非 git → 直通（D）
```

### A. 主控首轮任务简报（backend）

- **共享渲染**：从 `render_orchestrator_prompt`（orchestrator.py:107-225）抽 scope 渲染段为共享函数 `render_scope_brief(mission, session, *, git_probe=None) -> str`（每工作区一行：`- <name>（id=<id>, type=..., 机器=<alias|hostname>, daemon=在线|离线, 模式=git隔离|直通）`；在线判定沿用 BE-P1-5 修正后的 `query_daemon_online_by_id` + binding 属主 user_id；git 模式经可选注入的探测回调——**patrol 旧调用不传探测回调，模式字段省略**，输出与现状结构等价+新增机器名字段（CC-08 口径））。`render_orchestrator_prompt` 本体改为调用共享函数。
- **新函数** `render_session_orchestrator_briefing(mission, session) -> str`：简报=角色说明+关键 id（mission_id/锚点工作区）+目标+scope 清单+dispatch_worker 用法（target_workspace_id）+mission_status 工具提示+禁越权约束（复用 render_orchestrator_prompt:215-224 文案段）。
- **inject 路径**（`_inject_into_session`，双标记处 service.py:1685-1712 旁）：活跃 mission 存在 **且** 本轮 prompt 非空（纯配置切换轮不注入不消耗一次性名额，CC-12） **且** 该 mission 尚无"已消耗"的 orchestrator run → SESSION_INJECT payload 的 `prompt` 组装为 `简报 + "\n\n---\n\n" + 用户消息`（service.py:1953-1969）。**已消耗定义**：存在 status ∈ {pending, running, completed} 的 orchestrator run；**failed 轮不烧断一次性**——首轮派发失败（run→failed，:1977-1979）后下一条带文本消息重新注入简报（CC-12）。`AgentRunLog(user_input)`（:1759-1774）与前端展示保持干净用户消息。懒建 mission 回填的 orchestrator run 使判定天然短路（懒建轮已在跑，不补简报）。并发安全：inject 持会话行 FOR UPDATE（inject_session→_get_owned_session_for_update）+ turn 冲突守卫（`_inject_into_session` :1507-1515 `DaemonSessionTurnConflict`，CC-03 修正锚点）保证单活跃轮。
- **create 路径**（联动 §E1）：`create_session` 请求携带 team_mission 时，session 行落库后、首 run 创建前**预建 mission（flush-only，同事务，见 E1）**；首 run 创建处补双标记；首轮 prompt 组装点（service.py:919-920 变更前导旁）追加简报前缀。**前导叠加顺序**：变更上下文前导（既有）在前、团队简报在后、`\n\n---\n\n`、用户消息。
- **仅一次**：已消耗（见上定义）后不再注入；后续在线状态时效靠 §B 工具（用户已澄清 D-002）。

### B. mission_status 常驻 MCP 工具（backend + daemon）

- **backend**：新会话路由 `GET .../sessions/{session_id}/missions/status`（实际前缀以 agent router 挂载为准，plan 期与 hub-client 现有 `/api/missions/{action}` 形态对齐，CC-10；鉴权沿用 SessionMcpUser=WORKSPACE_WRITE + 会话归属校验，与既有会话路由一致）。**定位不走 `_resolve_session_mission`**（其对无活跃 mission 抛 404，:455-458，CC-11）——直接 `get_active_mission_for_session`（mission.py:82）：无活跃 mission → `{"active": false, "hint": "..."}` 200；有 → 组装响应。scope 探测复用 §D helper（每次调用探测——N 小、调用频率低，不做缓存 YAGNI）。
- **daemon**：`mcp-server.ts` 注册第 6 个常驻工具 `mission_status`（inputSchema：workspace_id/mission_id 可选，会话上下文定位，同现有 5 工具模式）；`hub-client.ts` 加 `getMissionStatus`。
- **工具描述**（能力说明书口径）：无活跃任务返回 active=false；派团队前可先查 scope 与机器状态。

### C. 弹层工作区探测（frontend + 后端统一探测端点）

- **后端统一端点** `POST /api/workspaces/probe`（body `{workspace_ids: [...]}` → `[{workspace_id, git_mode, daemon_name, daemon_online}]`，权限 WORKSPACE_WRITE）：后端按「任一成员 binding」解析机器（与 `render_scope_brief` 同一共享查询与口径，消除本人/他人 binding 展示不一致，UB-2 修正）+ 复用 §D 探测 helper。**弹层机器状态与 git 模式统一走此端点**（弹层打开时调用一次——弹层生命周期短暂，静态快照可接受；在线判定后端为准，与简报/mission_status 完全同源）。前端不再用 `useDaemonStatusMap`（其无机器名字段且仅覆盖本人 bindings，Grill CC-09）。
- `team-trigger-popover.tsx`：项目 scope 工作区行 + 当前工作区行显示 `机器名（display_alias||hostname）+ 在线 dot（绿/灰）+ git 模式标签`；未绑定显示「未绑机器」。页面骨架不变（原型场景①②：组件级变化）。

### D. 非 git 工作区直通（backend）

- **探测 helper** `probe_workspace_git_mode(delegate, ws) -> "git" | "direct" | "unknown"`（host_fs/delegate.py 新增方法）：走**非降级 RPC 通道**（`_via_rpc` 语义：transport 失败抛异常；未绑 daemon 抛 `HostFsDelegateUnavailable`）发 `host_fs.stat`，**path 必须为绝对路径** `resolve_root_path_for_daemon(ws.root_path) + "/.git"`（daemon 侧 assertWithinAllowedRoots 先于 pathResolve，相对路径必被拒，CC-06）。daemon 真答 `exists=True`（.git 目录或文件——worktree 检出为文件，lstat 可用）→ git；真答 `exists=False` → direct；transport 异常 / `HostFsDelegateUnavailable` / 超时 → unknown。
- **execution.py dispatch_worker 分流**（worktree 块 :256-330 前探测）：
  - `git` → 现状照旧（per-worker worktree 隔离）。
  - `direct` → 跳过 worktree：`root_path=resolve_root_path_for_daemon(ws.root_path)`、`run.worktree_branch` 保持 None（路径A 语义）、lease metadata 不写 branch、worker prompt 用**直通约束变体**（替代 render_worker_prompt 的「worktree 协作约束」块：无 commit 指令，改为"你直接在工作区目录内工作，改动立即生效、无隔离副本；同目录可能有其它分身，避免并行写同一文件"）。
  - `unknown` → 维持现状（尝试 worktree，失败按 `worktree_create_failed` 既有语义，**不**降级直通——防 RPC 故障误判）。
- **finalizer/converge 零改动**：合并（:290-297）/清理（:470-477）只选 `worktree_branch IS NOT NULL`，直通 worker 天然跳过；产物（summary 等 artifacts）照常收集。
- 简报（§A）与 mission_status（§B）scope 条目带 `模式=git隔离|直通|未知`。

### E. 新会话派团队 + 主 agent 选择器

- **E1 预会话解禁**：
  - `SessionCreateRequest`（daemon/schema.py:86-115）新增可选 `team_mission: TeamMissionCreateBlock | None`（字段：objective?/scope_workspace_ids?/project_id?/budget_usd?/worker_preset?/main_agent_config?/orchestrator_workspace_id?；校验复用 trigger 端点既有逻辑，抽共享校验函数）。
  - **预建入口重构（UB-1 修正）**：从 `team_mission_entry` 抽 **flush-only 预建 helper**（`add + flush`，不 commit；orchestrator.py:330-332 现状内部 `commit()+refresh()` 会使 session+mission 提前提交、脱离 create 单 commit 事务（:1008 commit / :1011 rollback），产生孤儿数据）。`create_session` 在首 run 创建前调用 helper，共用 create 唯一 commit——失败整体回滚，无孤儿 session/mission；`team_mission_entry` 本体改为 helper+commit（既有 trigger 端点调用方零回归）。
  - **objective 回填（CC 补）**：create 路径不经 `_inject_into_session` 的占位回填（:1690-1696）——预建时 objective 优先取 `TeamMissionCreateBlock.objective`，为空则**直接用首句 prompt** 回填（create 路径持有 prompt）。
  - 首 run 补双标记 + 首 prompt 简报前缀（见 §A create 路径）。
  - 前端：预会话 `TeamTriggerRow` 解禁（门控=claude 引擎+所选机器在线，与既有会话同构）；弹层确认后 payload 暂存 state，`handlePreSessionSend` 随 createSession 请求上送 `team_mission`。
- **E2 主 agent 选择器**（仅预会话弹层渲染）：
  - 选择项：`当前会话（默认）` + scope 内各工作区（显示 机器名+在线状态，离线禁选）；落 `team_mission.orchestrator_workspace_id`（null=默认）。
  - 后端 create 语义（orchestrator_workspace_id=W 非空时，校验 W ∈ scope）：`session.workspace_id = W`（顺带补齐懒建 scope=[W]/cwd 解析/工作区维度会话列表）；机器钉定=**(W, 创建者) 的 `WorkspaceMemberRuntime` binding**（pinned runtime 校验要求属主=创建者，placement.py:651-652；**缺失 → 422**「该工作区未绑定你的机器」，CC-13 修正——不借用他人 binding 钉定）；cwd=W.root_path；智能体=W.default_agent/default_model（仅当用户未显式选 agent_profile_id/llm_provider_id 时应用；**用户显式传 `runtime_id` 时显式优先**，W 仅决定 workspace_id/cwd/默认配置，R-09）。
  - 既有会话弹层不渲染选择器（主 agent 恒=当前会话，tooltip 说明；进程 cwd/机器创建时钉定，跨机器迁移属 C 层）。

### Phase/Wave 划分（plan 细化）

- Wave1（backend 主控感知）：A + B backend 侧 + D 探测 helper + E1 flush-only 重构。
- Wave2（派发模式 + 入口）：D execution 分流 + E1 create 预建接线 + E2 create 解析。
- Wave3（daemon + frontend）：B daemon 工具 + C probe 端点与弹层 + E1 前端 + E2 选择器。
- Wave4（回归 + 类型同步 + 文档）：gen:types、模块文档。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/orchestrator.py | 抽 `render_scope_brief`（git_probe 可选回调，patrol 不传）+ `render_session_orchestrator_briefing`；`team_mission_entry` 重构为 flush-only helper + commit（既有调用方零回归） |
| 修改 | backend/app/modules/daemon/session/service.py | inject 首主控轮简报前缀（:1953 prompt 组装）；create 路径 team_mission 预建（flush-only helper）+ objective 直取首句 + 首 run 双标记 + 首 prompt 简报前缀（:919 组装点、:870-908 run 创建处）+ E2 create 解析（workspace_id/钉定 binding/cwd/默认配置，显式选择优先） |
| 新增 | backend/app/modules/agent/mission_context.py（或并入 orchestrator.py，plan 定） | 首主控轮判定（已消耗定义/空 prompt 排除/failed 重注）+ 简报组装 helper（inject/create 两路径共用） |
| 修改 | backend/app/modules/agent/mcp_tools.py | 新增 `GET .../sessions/{session_id}/missions/status` 会话路由（直接 get_active_mission_for_session，不走 _resolve_session_mission）+ `MissionStatusResponse` 组装（scope 探测复用 D helper） |
| 修改 | backend/app/modules/agent/schema.py | `MissionStatusResponse`/`ScopeWorkspaceStatus` DTO。数据流：producer=mcp_tools 组装（Workspace+任一成员 binding+daemon 实例+探测 helper）→ consumer=daemon mcp-server 转发 MCP 工具响应 → 主控 agent |
| 修改 | backend/app/modules/daemon/host_fs/delegate.py | 新增 `probe_workspace_git_mode`（非降级通道 stat 绝对路径 `.git`，三态；HostFsDelegateUnavailable→unknown） |
| 修改 | backend/app/modules/agent/execution.py | dispatch_worker worktree 块前三态探测分流（direct→跳过 worktree/root_path=工作区根/worktree_branch 保持 None/prompt 直通变体）；render_worker_prompt 直通约束变体 |
| 修改 | backend/app/modules/daemon/schema.py | `SessionCreateRequest` 新增 `team_mission: TeamMissionCreateBlock \| None` + DTO。数据流：producer=前端预会话弹层（payload 暂存→createSession 请求）→ consumer=create_session 预建 mission（scope/orchestrator_workspace_id 校验与落库） |
| 修改 | backend/app/modules/daemon/router.py | trigger 端点校验逻辑抽共享函数供 create 路径复用 |
| 修改 | backend/app/modules/workspace/router.py（或 agent 域，plan 定） | `POST /api/workspaces/probe` 批量端点。数据流：producer=前端弹层打开时一次性请求 → backend（任一成员 binding 解析机器+D helper 探测）→ consumer=弹层机器名/在线 dot/git 模式标签 |
| 修改 | sillyhub-daemon/src/mcp-server.ts | 注册第 6 个常驻工具 `mission_status`（参数可选+会话上下文定位，同 5 工具模式）+ 能力说明书描述 |
| 修改 | sillyhub-daemon/src/hub-client.ts | `getMissionStatus` 方法（X-Session-Id 透传）。数据流：mcp-server 工具 handler → hub-client → backend status 路由 |
| 修改 | frontend/src/components/daemon/team-trigger-popover.tsx | 机器名+在线 dot+git 模式标签（统一走 POST /workspaces/probe 打开时一次）+ 主 agent 选择器（仅预会话实例） |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 预会话 TeamTriggerRow 解禁（门控=引擎+机器在线）+ payload 暂存 + handlePreSessionSend 携带 team_mission + 弹层 preSession 实例传参 |
| 修改 | frontend/src/lib/daemon.ts | createSession 请求体扩展 team_mission；probeWorkspaces API client |
| 再生成 | frontend/src/lib/api-types.ts + backend/openapi.json | pnpm gen:types（CLAUDE.md 规则 21） |
| 再生成 | sillyhub-daemon/src/api-types.ts | daemon 侧 openapi 类型同步 |
| 新增 | backend/app/modules/agent/tests/test_mission_context.py 等 | 见 §10 测试映射（plan 细化） |

不动：finalizer.py（合并/清理天然跳过无分支 worker）、patrol.py（render_orchestrator_prompt 保留，探测回调不传入）、control.py、placement.py 路由、mcp_tools 既有 5 工具、workspace-daemon-status.ts（既有消费方不动，弹层不再引用）。

## 7. 接口定义

```python
# backend daemon/schema.py
class TeamMissionCreateBlock(BaseModel):
    objective: str | None = None
    scope_workspace_ids: list[str] | None = None
    project_id: str | None = None
    budget_usd: float | None = None
    worker_preset: list[WorkerPresetItem] | None = None
    main_agent_config: MainAgentConfig | None = None
    orchestrator_workspace_id: str | None = None   # 主 agent 工作区（∈ scope；null=当前会话默认）

# SessionCreateRequest 增：
#   team_mission: TeamMissionCreateBlock | None = None

# backend agent/schema.py
class ScopeWorkspaceStatus(BaseModel):
    id: str; name: str; type: str | None; description: str | None
    daemon_online: bool; daemon_name: str | None      # display_alias||hostname（任一成员 binding）
    git_mode: str                                       # "git"|"direct"|"unknown"

class MissionStatusResponse(BaseModel):
    active: bool
    hint: str | None = None                             # active=false 时引导文案
    mission_id: str | None = None
    status: str | None = None                           # 派生状态
    objective: str | None = None
    anchor_workspace: ScopeWorkspaceStatus | None = None
    scope_workspaces: list[ScopeWorkspaceStatus] = []
    workers: list[WorkerListItem] = []                  # 复用 _list_workers_core
    budget_usd: float | None = None

# 路由（status 实际前缀以 agent router 挂载为准，plan 与 hub-client /api/missions/{action} 形态对齐）
GET  .../sessions/{session_id}/missions/status → MissionStatusResponse
POST /api/workspaces/probe  body {workspace_ids: list[str]}
      → list[{workspace_id, git_mode, daemon_name: str | None, daemon_online: bool}]

# daemon mcp-server.ts 第 6 工具
mission_status(workspace_id?, mission_id?) → MissionStatusResponse JSON 文本
```

简报格式（§A，token 精简，每工作区一行）：

```
【团队任务简报（系统注入，仅此一次）】
你是本会话团队任务的主控（orchestrator/项目经理）。
- mission_id: <id>
- 目标: <objective（占位时=本条消息）>
- 锚点工作区: <name>（<id>）
- 派发范围:
  - sillyspec（id=..., type=..., 机器=牛逼的电脑💻, daemon=在线, 模式=git隔离）
  - 设计稿共享盘（id=..., 机器=..., daemon=离线, 模式=直通·非git）
派发: dispatch_worker(objective, role?, target_workspace_id=…)；跨工作区必传 target_workspace_id。
最新机器状态随时可查: mission_status 工具。
【硬性约束】（复用 render_orchestrator_prompt 既有禁越权文案段）
```

## 7.5 生命周期契约表

本变更**不改任何既有状态转移**（inject 时序、双标记、converge 语义、lease claim/heartbeat/complete、worker 独立存活全部不变）；新增/受影响事件如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session + team_mission | 前端（预会话弹层） | backend | prompt, runtime_id/provider, team_mission{scope?, orchestrator_workspace_id?} | session 创建即预建 mission（planning，flush-only 同事务，失败整体回滚）；objective=block.objective‖首句 prompt；首 run 回填 mission_id+role=orchestrator；首轮 SESSION_INJECT prompt 携简报前缀（字段不变，仅内容） |
| inject（活跃 mission 首个主控轮） | 前端 | backend → daemon | session_id, prompt（非空） | run 双标记（既有不变）；SESSION_INJECT prompt=简报+---+用户消息（协议字段不变）；无状态转移；failed 主控轮后下条消息可重注 |
| mission_status 查询 | 主控 agent(MCP) | backend | X-Session-Id（或 path session_id） | 只读，无状态变化 |
| workspaces/probe 查询 | 前端弹层 | backend | workspace_ids[] | 只读，无状态变化 |
| dispatch_worker（直通模式） | 主控 agent(MCP) | backend | X-Session-Id, objective, role?, target_workspace_id? | worker run pending→running→终态（不变）；worktree_branch=None → 无 worktree 创建/合并/清理生命周期 |
| 预建 mission（既有会话，不变列出备查） | 前端弹层 | backend | session_id, scope... | mission→planning（现状不变） |

契约事件与 §6 文件清单/测试任务映射：create+team_mission→schema/service/session-panel 任务；inject 简报→service inject 任务；直通 dispatch→execution 任务；两个只读查询→各自路由任务（plan 落测试）。

## 8. 数据模型

**零表结构变更、零 alembic 迁移**：
- E2 复用 `agent_sessions.workspace_id` 既有列（model.py:568-577；现有消费方——cwd 解析 service.py:1192-1197、懒建 scope mcp_tools.py:460/485、触发兜底 daemon/router.py:2469-2470——与 E2 语义自洽，Grill CC-13 核实）。
- mission 无新列（主 agent 工作区=session.workspace_id 可推导，简报/mission_status 展示时读 session）。
- `AgentRun.worktree_branch` 既有列，直通 worker 保持 None（路径A 先例语义）。
- 变更仅在 API DTO 层（SessionCreateRequest.team_mission / MissionStatusResponse / workspaces/probe）。

## 9. 兼容策略

- **无 mission 普通会话**：inject/create 路径活跃 mission 查询为空 → 行为逐字节不变（仅多一次存在性查询）；mission_status 工具返回 active=false。
- **既有会话派团队**（现状已可用路径）：预建→下一条消息=首主控轮+简报，其余不变。
- **懒建路径**：dispatch_worker 懒建回填 orchestrator run 使简报判定短路，行为不变（不补简报、不增强响应）。
- **git 工作区 worker**：探测=git → worktree 隔离链路逐字节不变；探测=unknown（RPC 故障/未绑 daemon）→ 走现状 worktree 尝试（宁可 failed 不误直通）。
- **存量 external/team mission + patrol**：`render_orchestrator_prompt` 改调 `render_scope_brief`（不传探测回调）——输出**结构等价 + 新增机器名字段**（在线判定逻辑不变；Grill CC-08 修正原「逐字节等价」措辞）；patrol.py:622 重派链路不引入探测 RPC。
- **旧 daemon（未升级）与新 backend**：mission_status 工具是 daemon 侧注册的——旧 daemon 不注册新工具，主控查不到但简报（backend 侧注入，仅用既有协议字段 SESSION_INJECT payload/create dispatch_prompt，Grill CC-14 核实）与 E1/D 层（纯 backend）仍生效；反向（新 daemon 旧 backend）：status 路由 404，工具报错文案友好。项目未上线，不做协议版本协商（CLAUDE.md 规则 11）。
- **回退路径**：未上线，revert + 重置开发数据。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 简报 token 增量（scope 大时长前导） | P2 | 每工作区单行精简格式；测试量化（scope=5 工作区 ≤1.5k token 目标）；仅首轮一次 |
| R-02 | mission_status/probe 每次调用 N 工作区探测 RPC 放大 | P2 | N≤scope 规模（个位数）；agent 调用频率低；弹层 probe 打开时一次不轮询；后续需要再加缓存（YAGNI） |
| R-03 | 直通 worker 无隔离，同目录并发写互相覆盖 | P1 | 治理门 MAX_WORKERS 上限仍在；直通约束 prompt 明示并发风险+避免并行写同一文件；简报「模式=直通」提示主控；文档记录 |
| R-04 | E1 create 携 mission 的中途失败态 | P1 | **已闭案（Grill UB-1）**：flush-only 预建 helper + create 单 commit（:1008）——失败整体回滚无孤儿 session/mission；SESSION_INJECT best-effort 失败语义与现状 inject 一致（run failed 可重试，mission 存活；简报 failed 重注见 §5.A） |
| R-05 | stat 探测路径语义 | P2 | **已闭案（Grill CC-06）**：必须绝对路径 `resolve_root_path_for_daemon(ws.root_path)+"/.git"`（daemon assertWithinAllowedRoots 先于 pathResolve）；.git-as-file 由 lstat 覆盖；其余异常一律归 unknown（fail-safe 现状路径）；单测覆盖三态 |
| R-06 | 双前导叠加（change 前导+团队简报）超长 | P2 | 顺序定死（变更前导→团队简报→---→用户消息）；截断口径沿用既有 5000 字符（AgentRunLog）；集成测试一例 |
| R-07 | 前端类型同步遗漏（team_mission 块/新端点） | P2 | gen:types 强制（CLAUDE.md 规则 21）+ tsc 门禁 |
| R-08 | 首 main agent 轮判定竞态（并发 inject 双首轮） | P2 | inject 持会话行 FOR UPDATE + turn 冲突守卫（`_inject_into_session` :1507-1515，Grill CC-03 修正锚点）保证单活跃轮 |
| R-09 | E2 显式 runtime_id 与 orchestrator_workspace 机器不一致（用户手改机器） | P2 | 显式优先+前端弹层选 W 时自动带出机器（用户再改=显式意志）；后端不 422，mission/简报如实展示 session 实际机器 |
| R-10 | 旧 daemon 不注册 mission_status 工具 | P2 | 简报/A/D/E 层不依赖 daemon 升级；工具缺失仅损失按需查询能力（§9 兼容策略） |
| R-11 | E2 钉定 binding 归属（他人绑定不可钉） | P2 | 取 (W, 创建者) binding（pinned runtime 属主校验 placement.py:651-652）；缺失 422 明确报错（CC-13） |

## 11. 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 五层方案（前导简报+常驻工具+弹层探测+非git直通+新会话/主agent选择器；方案二 daemon 每轮注入/方案三纯工具被否） | accepted | FR-01~06、§5 |
| D-002@v1 简报仅首个主控轮一次，时效靠工具 | accepted | FR-01/FR-02、§5.A |
| D-003@v1 懒建路径不补简报、不增强 dispatch 响应 | accepted | §3、§5.A |
| D-004@v1 简报=SESSION_INJECT/create prompt 前缀（复用变更前导先例，展示层干净，零 daemon 改动） | accepted | FR-01、§5.A |
| D-005@v1 mission_status 无活跃 mission 优雅返回 active=false | accepted | FR-02、§5.B |
| D-006@v2 非 git 探测三态（supersedes v1：send_rpc 表述失准） | accepted（Grill CC-05/CC-06） | FR-04、§5.D |
| D-007@v1 直通 worker 复用路径A 语义（worktree_branch=None，finalizer 零改动） | accepted | FR-04、§5.D |
| D-008@v2 弹层机器状态/git 模式统一走后端 POST /workspaces/probe（supersedes v1：useWorkspaceDaemonStatus 锚点不存在+本人 binding 口径缺口） | accepted（Grill UB-2） | FR-03、§5.C |
| D-009@v2 E1 预建=flush-only helper + create 单 commit；objective 直取首句（supersedes v1：team_mission_entry 内部 commit 断言失实） | accepted（Grill UB-1） | FR-05、§5.E1 |
| D-010@v1 主 agent 选择器仅预会话；选工作区=钉机器+cwd+默认智能体+session.workspace_id；显式选择优先；既有会话不提供 | accepted | FR-06、§5.E2 |
| D-011@v1 C 层主体（session↔workspace 集合/自由多选/per-daemon transport/跨机器主控迁移）拆独立变更 | accepted | §3 |
| D-012@v1 status 路由定位不走 _resolve_session_mission（404 语义不符），直接 get_active_mission_for_session | accepted（Grill CC-11） | FR-02、§5.B |
| D-013@v1 简报一次性判定：空 prompt 切换轮不注入不消耗；failed 主控轮后重注 | accepted（Grill CC-12） | FR-01、§5.A |
| D-014@v1 E2 钉定 binding 归属=(工作区, 创建者)，缺失 422 | accepted（Grill CC-13） | FR-06、§5.E2 |

未解决决策：无（R-01 token 量级为执行期实测项）。

## 12. 自审（Self-Review）— v2

- 章节齐全：背景/目标/非目标/拆分/总体方案（A-E 五层+Wave）/文件变更清单（含 DTO 数据流标注）/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审 ✓
- 生命周期契约表：6 事件（4 新增/受影响 + 2 只读），明确「不改任何既有状态转移」；事件↔任务映射 ✓
- 文件清单数据流：team_mission（前端→DTO→create 预建）、MissionStatusResponse（backend→daemon→agent）、workspaces/probe（前端→端点→弹层）三链均标 producer→consumer ✓
- 零迁移声明（§8）与 E2 复用 session.workspace_id 一致性（含现有消费方核实）✓
- 兼容六场景（无 mission/既有会话/懒建/git 工作区/存量 patrol 措辞修正/旧 daemon 双向）✓
- **Grill 闭环**：UB-1（E1 flush-only 重构，§5.E1/R-04/D-009@v2）✓；UB-2（C 层后端统一 probe 端点，§5.C/D-008@v2）✓；CC-03 锚点修正（§5.A/R-08）✓；CC-05/06 探测通道与绝对路径（§5.D/D-006@v2/R-05 闭案）✓；CC-08 patrol 等价措辞（§9）✓；CC-10 路由前缀（§5.B，plan 对齐）✓；CC-11 status 定位（D-012）✓；CC-12 简报边界（D-013）✓；CC-13 binding 归属（D-014/R-11）✓；E1 objective 回填（§5.E1）✓
- 用户澄清决策（D-001/002/003/008@v1→v2/010）与 AskUserQuestion 实答及追加反馈一致 ✓
- ⚠️ 自审存疑（执行期实测）：R-01 token 量级；status 路由最终前缀（plan 定）。
- 原型：prototype-team-mission-context.html 三场景（项目模式/当前工作区模式/预会话+主 agent 选择器）已评审确认 ✓
- frontmatter：author/created_at/scale=large/tier=independent/revision=2 ✓
