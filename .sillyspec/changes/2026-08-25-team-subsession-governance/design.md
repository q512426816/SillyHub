---
author: qinyi
created_at: 2026-08-25 19:40:00
scale: large
tier: independent
---

# 设计文档（Design）— 团队分身子会话化 P1 治理地基（会话树）

> v2（Design Grill 后修订）：修 P0-1 分身工具注入不可达（daemon 需新增分身受限
> MCP server）、P1-2 derive_status 接口矛盾（虚拟 run 映射方案 + 补全 4 消费点）、
> P1-3 summary artifact 挂载点（首 run 锚）、P1-4 跨 ws 代表机器钉定（placement
> 增代表模式）、P1-5 成本聚合；采纳全部 P2 备注。

## 1. 背景

团队派发的分身在运行形态上已是 SDK 交互会话（`placement.py` D-002@v3 统一插
`kind='interactive'` lease + AgentSession 行），但治理仍按"一次性 batch run"旧语义：

1. **挂载链断裂**：mission 归属只认第 0 层主控会话（`get_active_mission_for_session`
   按 `mission.session_id` 匹配），分身子会话的轮次 run 挂不上 mission → 治理门、
   成本、kill 名单漏算；`list_workers` 混入主控轮。
2. **完成判据错位**：busy 判定 / converge 前置 / patrol 超时 / worktree 清理全部建立在
   「run 终态 = 分身完结」上——子会话 turn 结束只是"当前轮说完话"，等追问的 idle 间隙
   被误判"全部完成"，converge 会合法删掉还开着的子会话的 worktree cwd。
3. **生命周期孤儿**：converge 不关任何会话；interactive lease 永不过期 → converge 后
   子会话 100% 成孤儿烧 token。
4. **归属错位**：分身会话 owner = apiKey/daemon 属主（跨 ws 代表机器场景是第三方），
   追问 owner-only、权限卡片 owner-only、门户可见性、审计全落错人。
5. **成本漏算**：`cost_so_far` 按 mission run 求和，分身子会话轮次成本进不来。

前置 P0（已落地）：`ql-20260825-012-89d6`（commit 91227636）修 daemon 重启丢 stage；
`ql-20260825-013-c299`（commit 6e0b6396）修 cancel_lease SESSION_END 盲区。

用户决策（2026-08-25 拍板）：架构选 **方案 B 会话树**（`parent_session_id`）；
归属 = **mission 创建者**；完成信号 = **显式收尾标记 worker_done**；P1 含
**最小 UI 入口**。

## 2. 设计目标

1. 分身子会话在数据模型上显式表达会话父子结构（会话树），mission 归属可解析。
2. 「分身干完了」有显式信号（worker_done），**全部**收敛/状态判据迁移到新信号。
3. converge / cancel 沿树批量关闭子会话，零孤儿。
4. 子会话 owner = mission 创建者：追问、权限卡片、可见性、审计对齐发起人。
5. 团队任务块分身行可点击打开子会话面板（实时流 + 追问），复用 session-panel。
6. 分身工具可达：分身会话注入**仅含 worker_done 的受限 MCP server**（不含派发
   工具，递归闸保持关闭）。

## 3. 非目标（Non-Goals）

- **不做递归派发**：分身受限 server 只含 worker_done，**不含** dispatch_worker /
  converge 等工具——递归开闸（深度上限、层 0 converge、预算树聚合、派发工具下放）
  是 P2 独立变更。
- **不做门户分组 / 按需开流等完整 UI**：留 P3；P1 只做分身行点击入口。
- **不做预算树上聚合 / daemon 级会话总数上限**：留 P2（P1 只做成本口径合并，
  见 5.C.6）。
- **不迁移存量分身形态**：存量 mission 的 batch 分身双判据兼容（本项目未上线，
  存量少、衰减快），不回填 parent_session_id。
- **不改 worktree 隔离机制**：副本创建 / 合并 / 清理引擎不动，只改清理触发时机。

## 4. 拆分判断

单一变更（不拆多 change）：五个问题（挂载链 / 完成信号 / 生命周期 / 归属 / 工具
可达）在收敛判据处强耦合——判据替换同时牵动 busy / converge / patrol / cleanup /
状态摘要五处，拆开会导致中间态更糟。UI 入口依附归属决策，随本变更交付最小闭环。

## 5. 总体方案

### 5.A 数据模型（Wave 1）

`agent_sessions` 新增两列（alembic 迁移）：

- `parent_session_id uuid NULL`：自引用 FK → `agent_sessions.id`，索引
  `ix_agent_sessions_parent`。团队场景根 = 主控会话；P1 树深 2（主控→分身），
  P2 递归时树深即深度治理载体。
- `worker_done_at timestamptz NULL`：分身完成信号落点。可重复置位（追问后再
  干活再置位，取最新时间）；非分身会话恒 NULL。

**mission↔分身枚举**（单一真相源 `mission_worker_sessions(mission_id)`）：
按 `mission.session_id`（根=主控会话）查 `parent_session_id = 根` 的直接子会话
（P1 深度 2 只查一层；P2 放开深度时改递归 CTE + 树深上限）。

mission 归属解析 `resolve_mission_for_session(session_id)`：沿 parent 链爬到根
（visited 集合环检测，脏数据 parent 指向后代时截断返 None）→ 根会话按既有
`mission.session_id` 命中 mission。

**分身首 run 锚**：派发建三元组时，首 run 写 `mission_id` + `role=<分身角色>`
（对齐主控首 run 双标记模式）。后续追问轮次 run **不写** mission_id（归会话管），
mission 视角的分身产物 / 状态全部经首 run 或子会话行读取。

### 5.B 派发链路：分身 = 子会话三元组（Wave 2）

`dispatch_worker` MCP 端点（`mcp_tools._dispatch_worker_core`）改造：

- 保留：scope 校验、越权校验（BE-P0-2）、治理门 `can_dispatch_worker`、在线
  预检、worktree（抽取 `execution.py` worktree 块为共享 helper——git 模式探测 +
  direct 旁路 + `git_worktree_add`，新旧派发路径同源复用）、`AgentRunWorkspace`
  关联行。
- 替换执行段：不再建 batch AgentRun + `placement.dispatch_to_daemon`，改走
  子会话三元组——`AgentSession(parent_session_id=主控会话, user_id=mission.created_by)`
  + interactive lease + 首 run（mission_id + role 双标记），同事务 commit（复用
  `create_session` 原子三元组模式，无孤儿）。首 prompt = 分身任务简报
  （objective + worktree 约束 + worker_done 用法）。
- **stage 透传**：`prepare_interactive_dispatch` 增 `stage` 参数写 lease
  metadata.stage（`MISSION_WORKER_STAGE`）→ claim payload → daemon 谓词。
- **跨 ws 代表机器钉定**：placement 增代表 binding 模式——`resolve_representative_binding`
  解析出的 runtime 直接钉定但跳过 `runtime.user_id == user_id` 属主校验
  （mission.created_by 常非代表机器属主）；anchor 本机自有 runtime 优先。

### 5.C 完成信号与状态判据替换（Wave 3，核心）

#### 5.C.1 分身受限 MCP server（daemon）

daemon 侧 `_resolveMainAgentMcp` 旁新增分身分支：stage=`mission_worker` 的会话
注入**仅含 worker_done 单工具**的受限 server（与主控 5 工具 server 同机制、不同
工具集；per-session env 注入 MCP_SESSION_ID）。谓词与注入在 create / restore /
reload 三路共用点生效。**递归闸保持**：分身拿不到 dispatch_worker / converge。

#### 5.C.2 worker_done 端点（backend）

新 MCP 工具 `worker_done(workspace_id?, mission_id?, summary)`（会话定位同
`report_progress` 模式：X-Session-Id → 子会话 → resolve_mission_for_session 校验
锚）：
- 写本会话 `worker_done_at=now()`；
- summary 落 AgentArtifact，**挂首 run**（首 run 带 mission_id → `_worker_artifacts` /
  `get_worker_result` / Finalizer 合并链全部既有可见，零新查询路径）；
- mission 已 converged/cancelled 的迟到调用：resolve 需支持 include_terminal
  （活跃 mission 过滤会把已终态 mission 404），记 warning 返回 409，不写状态；
- 全分身完成 false→true 沿迁移时唤醒主控（`notify_orchestrator_workers_done` 的
  Redis SETNX 幂等键改为随"重新开工"删除——新 worker_done 前先 DEL 再 SETNX，
  支持重复完成周期）。

#### 5.C.3 is_worker_complete（单一真相源）

`is_worker_complete(session)`（会话级）：
- **完成** = `worker_done_at IS NOT NULL` **且** 该会话无活跃 turn
  （复用 `_session_has_active_turn` 同款判定——追问重开工期间自动回到未完成，
  干完再调 worker_done 回到完成，语义自洽）；
- **失败/终结** = 会话终态（failed / ended）。
- 存量形态（batch run，无子会话）：run 终态（completed/failed/killed）。

#### 5.C.4 derive_status 接口：虚拟 run 映射（P1-2 修正）

`derive_status` 是 run 级纯函数不动签名；新增包装
`mission_derive_status(session, mission_id, *, workers_only=False)`：
1. 收集 mission 下**非子会话** run（主控轮 + 存量 batch run）原样；`workers_only=True`
   时排除 `role='orchestrator'`（对齐 converge_explicit 分支 D-010「置位不依赖主控
   run 状态」与 schedule_loop 信号 1 的现行收窄——否则主控在自己活跃轮内调
   converge 时 derive 恒 running、置位永败）；
2. 每个分身子会话映射为**虚拟 run**，优先级从高到低：`worker_done_at 非空且无
   活跃 turn` → `completed`（优先于终态映射——converge end_session 后 done 分身
   仍应映射 done 而非 failed）；会话终态 failed → `failed`；其余（含 idle 未
   done、追问重开工中）→ `running`；
3. 两组合并喂 `derive_status`。空集语义：有分身时虚拟集合非空，不会误判
   planning。

**五个消费点全部换包装**（Grill 补全）：`finalizer.converge_mission_for_completed_run`
（converge_explicit 分支，workers_only=True）、`daemon/router.py::_team_mission_summary`
（前端团队块状态源，防止 idle 误显 awaiting_input 启动超时时钟）、
`mcp_tools._mission_status_core`、`orchestrator.schedule_loop` 信号 1
（workers_only=True）、`mission_context.workers_all_terminal_with_stats`
（第五判据点，Grill Res-B——complete_lease / patrol 两调用点原按 run 终态会给
主控发"全部终态请收敛"误导通知；子会话形态下该函数判据换 is_worker_complete，
worker_done 成为唯一正确唤醒源）。

#### 5.C.5 判据迁移点

- `_converge_core` busy 前置 → is_worker_complete；
- patrol awaiting_input / 超时收敛时钟 → mission_derive_status；
- `Finalizer.cleanup_mission` → 只清"已完成分身"的 worktree 副本，未完成分身
  cwd 不动；
- `list_workers` / `TeamMissionWorkerSummary` 数据源 → 分身列表 = 子会话行
  （存量 mission 回落 batch run 行），轮次 run 不再混入。

#### 5.C.6 成本口径合并（P1-5 修正）

`MissionControlService.cost_from_runs` 输入扩为 union：mission runs ∪ 分身子会话
的轮次 run（按 `agent_session_id ∈ mission_worker_sessions` 查）——治理门预算拦截
覆盖子会话追问轮成本。

### 5.D 生命周期：converge / cancel 沿树批量收口（Wave 3）

- **时序**：converge 原子抢占 `converged_at` → merge → **merge 成功后**沿树逐个
  `end_session`（走 P0-2 修好的 SESSION_END 链）。冲突回滚路径（converged_at 还原
  NULL / needs_manual）**不 end_session**——子会话保持活跃供解冲突参考。
- `MissionControlService.cancel`：kill 名单 = runs + 分身子会话，统一走
  `cancel_lease`（含 SESSION_END）。
- patrol 增孤儿子会话扫描（独立查询，不复用 `_active_mission_ids`）：mission 已
  converged/cancelled 但子会话仍活跃 → 补发 end_session。

### 5.E 归属与最小 UI（Wave 4）

- 归属：5.B 三元组 `user_id=mission.created_by`——inject / 权限卡片 / 门户 /
  审计的 owner-only 机制全部不动，归属对了自然通。
- `TeamMissionWorkerSummary`（`daemon/schema.py`）加 **`sub_session_id`** 字段
  （避免与 AgentSession.agent_session_id——SDK 字符串 id——同名异义，Grill P2⑨）。
- `team-task-block.tsx`：分身行（有 sub_session_id）点击 → 复用 `session-panel`
  打开该会话（实时流 + 追问）。
- `pnpm gen:types` 同步。

### 5.F 生命周期契约表（v2 修正：lease 建立态 pending；converge 冲突路径不收口）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch_worker（子会话形态） | 主控 MCP | backend | objective/role/target_workspace_id? | AgentSession(pending→active) + interactive lease(**pending**) + 首 run(mission_id+role)；worktree 建副本 |
| 首 turn 完成 | daemon | backend run_sync | session_id/run_id/output | 首 run completed；会话保持 active；worker_done_at NULL |
| worker_done | 分身受限 MCP | backend | summary | worker_done_at=now()；summary artifact 挂首 run；全分身完成→唤醒主控 |
| 追问重开工 | 用户（owner） | backend inject | session_id/prompt | 新轮 run（无 mission_id）；is_worker_complete 回到未完成 |
| converge_mission | 主控 MCP | backend finalizer | mission_id | converged_at 抢占 → merge 成功 → 沿树 end_session（子会话 ended + lease completed + SESSION_END WS）；**冲突/needs_manual 路径不收口** |
| cancel mission | 用户 | backend control | mission_id | 分身 run killed + 子会话 ended + SESSION_END WS（P0-2 链） |
| patrol 孤儿扫描 | backend patrol | daemon | session_id/lease_id | 孤儿子会话补发 end_session |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/migrations/versions/<new>_agent_session_parent_worker_done.py | agent_sessions 加 parent_session_id/worker_done_at + 索引 |
| 修改 | backend/app/modules/agent/model.py | AgentSession 加两列；mission_worker_sessions / resolve_mission_for_session 辅助查询 |
| 修改 | backend/app/modules/agent/mcp_tools.py | _dispatch_worker_core 换三元组；worker_done 端点（summary 挂首 run，迟到 409）；_converge_core busy 判据；list_workers 子会话行化 |
| 修改 | backend/app/modules/agent/mission.py | is_worker_complete / mission_derive_status（虚拟 run 映射包装） |
| 修改 | backend/app/modules/agent/finalizer.py | converge 后沿树 end_session（merge 成功后，冲突不收口）；cleanup 只清已完成副本 |
| 修改 | backend/app/modules/agent/control.py | cancel 名单扩子会话；can_dispatch_worker 口径=存量 running run + 未完成子会话；cost_from_runs 输入 union 子会话轮次 run |
| 修改 | backend/app/modules/agent/patrol.py | 孤儿子会话扫描（独立查询）；超时时钟换 mission_derive_status |
| 修改 | backend/app/modules/agent/orchestrator.py | schedule_loop 信号 1 换 mission_derive_status |
| 修改 | backend/app/modules/agent/execution.py | worktree 块抽共享 helper（git 探测/direct 旁路/worktree_add） |
| 修改 | backend/app/modules/agent/placement.py | prepare_interactive_dispatch 增 stage 参数写 lease metadata；代表 binding 钉定模式（跳属主校验） |
| 修改 | backend/app/modules/agent/mission_context.py | 分身任务简报渲染（objective+worktree 约束+worker_done 用法） |
| 修改 | backend/app/modules/daemon/router.py | _team_mission_summary 换 mission_derive_status + 分身行返回 sub_session_id |
| 修改 | backend/app/modules/daemon/schema.py | TeamMissionWorkerSummary 加 sub_session_id：producer=backend schema → openapi → api-types → consumer=team-task-block（点击开 session-panel） |
| 修改 | backend/app/modules/daemon/session/service.py | create_session 三元组模式参数化复用（parent/owner/stage/首 run 双标记） |
| 修改 | frontend/src/components/daemon/team-task-block.tsx | 分身行点击按 sub_session_id 复用 session-panel 打开 |
| 修改 | frontend/src/lib/api-types.ts + backend/openapi.json | pnpm gen:types 再生成（schema→openapi→api-types→组件） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | _resolveMainAgentMcp 增分身分支：stage=mission_worker 注入仅含 worker_done 的受限 server（create/restore/reload 三路共用点） |
| 修改 | sillyhub-daemon/src/mcp-server.ts | 分身受限 server 工具集（worker_done 单工具，调 backend 新端点）；env 门控受限模式（现六处全量 registerTool 须按模式裁剪），injectMcpSessionId 覆盖受限 server 名 |
| 新增 | backend/app/modules/agent/tests/test_worker_subsession_*.py + sillyhub-daemon/tests/interactive/*.test.ts | 三元组派发/worker_done/判据替换/批量收口/双判据/受限注入单测 |

实现级备注（Grill Res-D/E）：`list_workers` 子会话行保留首 run id（`first_run_id`
字段），供 `get_worker_result` 连续消费。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 双判据兼容期口径分裂 | is_worker_complete + mission_derive_status 单一真相源，五处判据点 + 四个 derive 消费点全部改调，禁各自实现 |
| 会话树环（脏数据） | resolve_mission_for_session visited 环检测，超深截断返 None |
| converge 批量 end_session 部分失败 | best-effort 逐个 + patrol 孤儿扫描兜底 |
| 分身受限 server 被绕过加工具 | server 工具集硬编码单工具；P2 下放派发工具时走独立决策（含深度治理） |
| gen:types 无关旧测试债 | 按 CLAUDE.md 规则 21 惯例顺手补 mock 字段 |
| 迟到 worker_done / 重复完成周期 | 迟到 409 不写；SETNX 幂等键随重开工 DEL |

## 8. 决策记录（decisions.md 同步）

- D-001@v1：子会话挂载用 parent_session_id 会话树（用户拍板方案 B，否决 mission_id
  直接锚——通用性与"会话派会话"愿景优先，查询复杂度用 mission_worker_sessions
  一层枚举吸收）。
- D-002@v1：完成信号 = worker_done 显式标记（否决会话 end 方案——与"可追问"冲突）。
- D-003@v1：分身受限 MCP server 仅含 worker_done（Grill P0-1 修正：原"daemon 零
  改动"不成立；平台侧检测完成否决——不可靠，违背显式信号决策）。
- D-004@v1：owner = mission.created_by + placement 代表 binding 钉定模式。
- D-005@v1：derive 走虚拟 run 映射包装，不改 run 级纯函数签名（Grill P1-2）。
