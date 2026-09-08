# 团队分身子会话系统 backend 审计报告（缺陷 + 性能双视角）

author: qinyi
created_at: 2026-08-26 05:56:48

审计对象：`2026-08-25-team-subsession-governance` / `2026-08-26-team-subsession-recursion` / `2026-08-26-subsession-portal-grouping` 三个已归档变更的 backend 产物（已在 main）。

方法：只读代码 + grep 调用链 + 定向 pytest（137 个用例全过，见 §4）+ 本地 PG（localhost:5432/platform，297 sessions / 43 missions / 421 runs）只读 EXPLAIN。**未修改任何源码。**

严重级定义：P0 致命 / P1 重要缺陷 / P2 性能可优化或低概率缺陷 / P3 建议。

---

## 0. 结论速览

无 P0。发现 **2 个 P1 缺陷**（治理状态机存在无出口的死锁态；patrol 孤儿扫描在大数据量下饥饿）、**1 个 P1 级性能问题**（团队任务概要组装每 mission ~14+Nd 次查询）、以及一批 P2（唤醒竞态、constraints 丢更新、派发中断孤儿、递归 CTE 全表 Hash 扫描、治理门重复枚举、N+1 批量化）。整体架构质量高：单源判据、原子抢占、幂等收口、best-effort 隔离等模式执行到位；问题集中在「边缘状态出口」与「批量查询」两端。

---

## 1. 缺陷核验（审计清单 A 逐条）

### A.1 N+1 查询（清单 1）

`is_worker_complete`（backend/app/modules/agent/mission.py:135-156）对 AgentSession 形态仅在 `worker_done_at is not None` 且会话非终态时才查 DB（`_sessions_with_active_turns` 单会话版），所以 N+1 只发生在「已完成分身」集合上——比典型 N+1 轻，但 backend/app/modules/agent/mission.py:130 已有批量版 `_sessions_with_active_turns`，循环点全部可零成本批量化。逐点：

| 循环点 | 位置 | 说明 |
|---|---|---|
| `_list_workers_core` | backend/app/modules/agent/mcp_tools.py:1547 | 每个 done 分身 1 查询；list_workers / mission_status / `_team_mission_summary` 三端点共用 |
| `_converge_core` busy 计数 | backend/app/modules/agent/mcp_tools.py:1797 | busy 分支逐 worker 判定（分身+存量 run） |
| `_worker_done_core` 全完成判定 | backend/app/modules/agent/mcp_tools.py:2171 | 全完成判定（全树枚举 + 批量活跃 turn + 纯函数逐分身判定） |
| `_worker_form_count` | backend/app/modules/agent/control.py:240 | **每次派发治理门必经**（running_worker_count），done 分身逐个查 |
| `cleanup_mission` | backend/app/modules/agent/finalizer.py:475 | 有 worktree_branch 且属子会话的 run 逐个判定 |
| `_patrol_budget_force_end` | backend/app/modules/agent/patrol.py:918 | 活跃未完成分身逐个判定（未 done 的不查 DB，实际查询少） |
| `workers_all_terminal_with_stats` | backend/app/modules/agent/mission_context.py:275 | complete_lease + patrol awaiting_input 双触发点 |
| `cancel` | backend/app/modules/agent/control.py:287-322 | `_split_worker_forms`（2 查询含 CTE）后每活跃子会话 `_cancel_target_run_for_session` 2 查询（backend/app/modules/agent/control.py:225-253）；cancel 低频，可接受 |

**mission_derive_status 无 N+1**（backend/app/modules/agent/mission.py:209 一次批量 IN）——该函数是干净的；脏的是外层循环点。

**cost_so_far**（backend/app/modules/agent/control.py:141-160）：union 侧 `agent_session_id IN (全树会话)` 用 ORM 全行加载全部历史轮次 run 只为求和 `total_cost_usd`——应改 `select(func.sum(...))`。集合大小 = 全树分身数×历史轮数，随 mission 生命期单调增长；且 `can_dispatch_worker`（backend/app/modules/agent/control.py:205-223）每次派发调 `running_worker_count` + `cost_so_far`，二者各自重跑 `_split_worker_forms`（backend/app/modules/agent/control.py:161：non_orchestrator_runs 1 查询 + 树 CTE 2 查询）——**同一治理门内同一 mission 行被 get 3 次、树 CTE 跑 2 次**。

### A.2 递归 CTE 性能（清单 2）

`mission_worker_sessions_tree`（backend/app/modules/agent/model.py:905）每次调用 = 2 查询（mission get + CTE）。生产调用点（grep 全量）：

- **热路径**：`mission_derive_status`（backend/app/modules/agent/mission.py:174——converge busy / mission_status / _team_mission_summary / patrol 收敛兜底全走）；`_converge_core` busy（backend/app/modules/agent/mcp_tools.py:1853）；`_worker_done_core`（backend/app/modules/agent/mcp_tools.py:2171）；`_split_worker_forms`（backend/app/modules/agent/control.py:161——派发门×2、cancel）；`_team_mission_summary`（backend/app/modules/daemon/router.py）；`workers_all_terminal_with_stats`（backend/app/modules/agent/mission_context.py:275，lease complete 路径）。
- **低频**：backend/app/modules/agent/finalizer.py:507/674、backend/app/modules/agent/patrol.py:767/858。

即：**一次派发 2 次、一次 converge busy 2 次、一次 worker_done 2 次、一次团队概要 2 次（derive 内 1 + 显式 1）**。EXPLAIN（本库 297 行）实证：

- 递归项走 `ix_agent_sessions_parent` Index Scan（索引支撑 ✔）；
- **最终 join PG 选了 Hash Join + Seq Scan on agent_sessions**（0.24ms@297 行）——树结果集小、sessions 表大时，每次树调用退化 O(全表) 哈希扫描。修复：末段改 `WHERE AgentSession.id.in_(select(tree.c.sid))` 强制 PK 驱动，或调用方先取 sid 集合再 IN 回表。
- ORDER BY created_at：DISTINCT+Sort，行数=树大小，代价可忽略。
- 深度截断语义：`depth < MAX_TREE_DEPTH(4)`，合法树（≤2）全覆盖，脏环被 (id,depth) UNION 去重 + 截断双重兜底，末端 DISTINCT 防重——**核验通过**；截断外的脏深链不入治理口径（cancel/cost/孤儿名单漏掉 depth>4 后代），属声明过的宽容余量。

### A.3 `_team_mission_summary` 查询量化（清单 3）

backend/app/modules/daemon/router/__init__.py，单次调用：

| 步骤 | 查询数 |
|---|---|
| `ctrl.worker_runs` | 1 |
| `mission_derive_status`（mission get 1 + 树 CTE 内 mission get 1 + CTE 1 + runs 1 + 批量活跃 turn 1 + bound session get 1 + 根活跃 turn 1） | 7 |
| `mission_worker_sessions`（mission get 1 + 一层 select 1） | 2 |
| `mission_worker_sessions_tree`（mission get 1 + CTE 1） | 2 |
| 首 run IN 批查 | 1 |
| done 分身逐个 `is_worker_complete` | Nd |
| scope workspace 名称 IN | 1 |
| **合计** | **≈14 + Nd** |

**同一 mission 行被重复 get 4 次**（derive 内 1、tree CTE 内 2、一层枚举内 1）。`GET /sessions/{sid}/team-missions`（backend/app/modules/agent/router.py）对每个历史 mission 重复整套 → M 个 mission = 14M+ΣNd 查询。批量化空间：mission get 1 次并把 `root_session_id` 传入枚举函数（改 `mission_worker_sessions*` 签名加可选参数）；derive/一层/树三口径在同一请求内共用一次全树结果；done 判定换批量活跃 turn 查询——可压到 **~6 查询/mission**。

**会话门户列表 `GET /sessions?limit=500` 本身零增量**（见 A.10）。

### A.4 cost_so_far union 代价（清单 4）

见 A.1 末段。patrol 职责⑥每个带预算的活跃 mission 一轮跑 `cost_so_far`（3 查询）+ 树 CTE（2）+ 逐分身判定；上限 100 mission → 最坏 ~600-1000 查询/轮。派发链每次治理门 2 次重复枚举。`agent_session_id` 有 `ix_agent_runs_agent_session_id` 索引支撑，IN 检索本身无慢查风险，问题是**加载全行 + 重复执行**。

### A.5 锁与并发（清单 5）

1. **worker_done DEL→SETNX 竞态【P2-F04】**：`_worker_done_core`（backend/app/modules/agent/mcp_tools.py:2320-2343）先判 `is_new_signal` 再 `notify_orchestrator_workers_done`（SETNX + signal_at 时间戳波次比较，backend/app/modules/agent/mission_context.py——F04 已修为同波幂等 + 新波再唤醒，替代旧 DEL→SETNX）。两个「最后完成」分身 A/B 同波并发（各自 `old_done_at=None`，都是新信号）：A SETNX 成功→注入；B 在 A 写入 signal_at **之后** SETNX 比较时间戳不覆盖→**不再二次注入**（原竞态已由 F04 修复闭合；主控收到重复系统通知轮烧 token、可能触发两次 converge 的窗口已消除）。
2. **budget_force_ended_at 与 converged_at 抢占互不互踩【通过】**：职责⑥抢占条件含 `converged_at IS NULL AND cancelled_at IS NULL`（backend/app/modules/agent/patrol.py:879-892），converge 抢占条件只查 `converged_at IS NULL`（backend/app/modules/agent/finalizer.py:834-838）——converge 先置位则 patrol rowcount=0 跳过；patrol 先置位（constraints 标记）不妨碍 converge 置位（标记只影响虚拟映射），顺序语义自洽。
3. **constraints JSON 丢更新【P2-F05】**：职责⑥的原子 UPDATE 用**早前读的** `existing_constraints` 整体覆盖 constraints（backend/app/modules/agent/patrol.py:157）；并发的 `_bump_conflict_attempts`（backend/app/modules/agent/mcp_tools.py:702-712）、`_mark_mission_needs_manual`（:715-733）、zombie 标记（backend/app/modules/agent/patrol.py:157）都是 ORM read-modify-write。两类交错会互相抹键（如 conflict_attempts 被 budget 抢占覆盖丢失 → R-07 计数漂移）。修：PG 侧 `constraints = constraints || :patch`（jsonb merge）。
4. **converge 收口与 patrol 孤儿扫描同收口同一会话【通过】**：`end_session` 自带幂等（已 ended/failed 早退），重复调用零副作用、不会重复 SESSION_END（backend/app/modules/agent/finalizer.py:644-646 docstring + 实现核对）。
5. **深度门读-判-写窗口【通过】**：`new_tree_depth = caller.tree_depth + 1`（backend/app/modules/agent/mcp_tools.py:965）源自已提交行，子行深度结构性 ≥ 父 +1，并发派发只会产生多个同深兄弟，不可能超限。

### A.6 边界（清单 6）

1. **【P1-F01】「会话 ended 且未 done（无 budget 标记）」存在预算强收之外的生成源，mission 无出口死锁**。虚拟映射把该形态定为 `running`（backend/app/modules/agent/mission.py:224-228：`budget_force_ended` 才映 failed，否则 running），而 `is_worker_complete` 对会话终态（failed/**ended**）返回 True（backend/app/modules/agent/mission.py:149-151）。设计假设「ended 未 done 只由预算强收产生」，但实际生成源还有：① 属主在门户手动结束分身会话（`SessionService.end_session`）；② reconnecting 空闲清扫（backend/app/modules/daemon/session/service.py 注释 "converged by task-07 idle sweep"）；③ patrol 职责③把分身 run 标 failed（backend/app/modules/agent/patrol.py:383）但会话留 active（反例形态：run 全终态 + 会话 active 未 done → 同样 running）。后果链：derive 恒 running → converge 永远 busy（backend/app/modules/agent/mcp_tools.py:1797-1885 `_converge_core` busy 前置判定）；`_auto_converge_awaiting_input` 的 `should_converge` 判据 `mission_derive_status(workers_only=True)` 同样不满足（backend/app/modules/agent/finalizer.py:781-782）→ awaiting_input 超时收敛永不触发；孤儿扫描只管终态 mission（backend/app/modules/agent/patrol.py:840）→ **非预算 mission 一旦出现这种分身，唯一出口是人工 cancel**。同时 `is_worker_complete=True` 释放了 MAX_WORKERS 槽（`_worker_form_count` 计数减一）→ 还能继续派新分身，形成「能派不能收」的怪态。修（最小侵入）：把孤儿扫描扩展出「活跃 mission 的死分身」档——`会话 ended/failed 或 run 全终态 + worker_done 空 + 持续超宽限`→ 置一个通用 `force_ended_at` 标记（复用 budget 键或新键），让虚拟映射落到 failed。
2. **budget_usd=0【P3-F12】**：schema `ge=0` 允许 0（backend/app/modules/agent/mission_schema.py、backend/app/modules/daemon/schema.py/821）。判空写法全部 `is not None`（强收语义不跳过）：`can_dispatch_worker` 在 cost=0 时 `0>=0` 恒 budget_exceeded（backend/app/modules/agent/control.py:285）→ budget=0 的 mission 永远派不出分身；patrol 职责⑥同样 `0<0` 为假即命中（backend/app/modules/agent/patrol.py），只是因派发被挡而无强收对象。属配置陷阱而非逻辑错：建议改 `gt=0` 或前端禁 0。
3. **孙层计入 MAX_WORKERS 口径【通过】**：`running_worker_count` → `_split_worker_forms` → 全树（backend/app/modules/agent/control.py:161），未完成孙占额度；MAX_WORKERS=5（delegation.py）。
4. **ACTIVE_RUN_STATUSES 含 pending_approval【记录】**：审批中轮算活跃 turn → 分身 done 置位后仍判未完成直至审批轮终态；预算强收会杀审批中轮。这是 2026-08-25 二审 #3 的有意选择（防 awaiting_input 误判），语义一致无缺陷。
5. **resolve include_terminal 迟到 409【通过】**：`_worker_done_core` 活跃 miss → 含终态二次解析取根上最新 mission，converged/cancelled → 409 零写入零唤醒（backend/app/modules/agent/mcp_tools.py:2171）；无 mission → 404。锚失配 404、越权校验齐全。
6. **tree_depth 与 parent 脏数据【P3-F16】**：写入路径单 INSERT 同事务（backend/app/modules/agent/mcp_tools.py:1758）结构性一致，仅手工改库可造不一致。影响面：`_enforce_converge_layer0` 按 tree_depth 判层（backend/app/modules/agent/mcp_tools.py:1758，脏 depth=0 的分身可过层 0 守卫）；爬根解析（resolve_mission_for_session）不受影响。低风险记录。

### A.7 run_sync 四闸（清单 7）

`_is_gate_rejected_first_failure`（backend/app/modules/daemon/run_sync/service/__init__.py）：

- **run_count==1 与 autoflush 时序【通过】**：调用点在 run/session 对象已 `session.add` 之后（:1337/:1383），count 查询触发 autoflush，本 run 计入；追问轮 count>1 不命中。正确。
- **readiness 单例【P2-F11】**：`get_session_readiness()._ready` 是**进程内** set（backend/app/modules/daemon/session/service/__init__.py）。多 worker/多副本部署下，daemon /ready 上报落在进程 A、run 终态收口落在进程 B 时，闸③「从未 ready」误判 → 首轮真实失败（如模型错误）的存活分身被误翻 failed 收口。单进程部署无碍；上生产扩副本前需改 Redis 共享或按 daemon WS 连接亲和路由。

### A.8 converge 层 0 守卫（清单 8）

`_enforce_converge_layer0`（backend/app/modules/agent/mcp_tools.py:1541）「三 header 皆无 → 放行」的真实可达性：converge 四路由族鉴权分别是 `require_permission(WORKSPACE_WRITE)` / `require_permission_any(...)`，经 `get_current_principal`（auth_deps）只认 `Authorization: Bearer` 与 `X-API-Key` 双 header——三 header 皆无必然 401 先拦，**生产不可达成立**。风险仅是脆弱性：守卫正确性依赖「外层鉴权必挡无凭请求」这一外部契约（未来引入 cookie 鉴权即破），建议在守卫内把「无 Bearer 无 Session 无 APIKey」也 403（一行改动，注释已自称仅保单测形态）。

### A.9 失败路径（清单 9）

- **派发三元组分段 commit 孤儿形态【P2-F06】**：`_dispatch_worker_core` 实为**两段 commit**——commit#1 在 backend/app/modules/agent/mcp_tools.py:1152（session+run+AgentRunWorkspace，注释自称「与 lease 同事务收口的唯一 commit」已与实现不符）；worktree helper 内部自吞异常（backend/app/modules/agent/execution.py 返回 outcome 不抛）✔；`prepare_interactive_dispatch` 有 NoOnlineDaemon/兜底 except（:1259-1292）✔；但 **`_merge_lease_metadata`（:1306）/ 末次 commit（:1328）/ refresh / 进程崩溃落在 try 外**——异常时 FastAPI 回滚未提交的 lease，而 commit#1 已持久化 → 残留「session pending + run pending + 无 lease」半孤儿：永久占 MAX_WORKERS 槽（is_worker_complete=False）+ 阻塞 converge，无 TTL 清理（职责⑤只扫终态 mission），非预算 mission 无自动出口（与 F01 同死锁家族）。修：把 commit#1 降为 flush（真正实现「三元组单 commit」承诺），或 patrol 补「pending 子会话无 lease 超 TTL」清理档。
- **`_fail_worker_subsession` 未覆盖分支**：即上述 try 外窗口；另 `build_worker_briefing` / `resolve_root_path_for_daemon`（纯函数）风险极低。
- **notify_interactive_dispatch 失败【通过】**：投递不可达仅告警，lease pending 等 daemon 轮询自领取（:1332-1349 注释与实现一致），非孤儿。

### A.10 门户新字段（清单 10）

`AgentSessionRead.parent_session_id / tree_depth`（backend/app/modules/daemon/schema.py:67-72）from_attributes 直映射；`GET /sessions` 列表（backend/app/modules/agent/router.py）与详情（:2215）均零额外查询/join——**核验通过**。

---

## 2. 性能量化（审计清单 B）

| 场景 | 增量查询数 | 说明 |
|---|---|---|
| 会话门户列表（limit 500） | **0**（新字段）；`GET /sessions/{sid}/team-missions` 每 миссion ≈14+Nd | TeamTaskBlock 数据源是真正热点 |
| patrol 每轮（相对三变更前） | 职责⑤：1 + 2×min(100, 终态 mission 数)，**终态 mission >100 后恒 ≥201**；职责⑥：1 + Σ_budget(6+Ni)；活跃 mission derive 内树 CTE 随 checked 数 | 终态 mission 单调累积且永不移出扫描名单 |
| 派发链路（单次 dispatch_worker） | 治理门 7+Nd（重复 `_split_worker_forms`×2：4 查询含 2 CTE + Nd）+ 解析/越权/预检 ~6-10 + 三元组写入 ~4 + RPC 1-2 | 全链 ~25-35 查询 |
| mission_status（常驻查询） | derive 7 + list_workers ~5+Nd + scope 名称 1 ≈ 13+Nd，**外加每 scope workspace 1 次 git probe RPC**（实时探测，R-02 设计选择） | 主 agent 轮询型端点，最贵的单点 |
| converge busy | derive 7 + 全树 2 + non_orchestrator_runs 1 + 逐 worker Nd ≈ 10+Nd | 主 agent 重试循环内反复发生 |
| worker_done | resolve 爬根 ~2-3 + 全树 2 + 首 run 1 + 逐分身 Nd + 置位/唤醒 ~3 ≈ 10+Nd | |

**批量化/缓存点按收益排序**：
1. `_team_mission_summary` 三口径合一（derive/一层/树共用一次全树 + mission get 一次 + 批量 done 判定）→ 14+Nd 降到 ~6（列表端点 M 倍放大）。
2. patrol 职责⑤名单加时间窗/水位 → 稳态每轮 -200 查询且修复饥饿（正确性收益更大）。
3. `can_dispatch_worker` 内缓存一次 `_split_worker_forms`；`cost_so_far` 改 SQL SUM → 每次派发 -3~-5 查询。
4. 树 CTE 末段 IN 改写（PK 驱动）→ 大表下每次树调用 O(全表哈希扫描) → O(树大小)。
5. `is_worker_complete` 循环点批量化（复用 `_sessions_with_active_turns`）。
6. mission_status 的 scope git probe 加 30-60s 短 TTL 缓存（R-02 允许下探）。

---

## 3. 修复建议清单（审计清单 C）

| # | severity | 位置 | 问题一句话 | 最小侵入修复 |
|---|---|---|---|---|
| F01 | **P1** | backend/app/modules/agent/mission.py:217-228 / backend/app/modules/agent/patrol.py:713-790 | 「ended 未 done 无标记」分身使 derive 恒 running，converge 永久 busy、awaiting_input 超时收敛永不触发，非预算 mission 无自动出口 | 孤儿扫描扩档：活跃 mission 下「会话 ended/failed 或 run 全终态 + 未 done + 超宽限期」→ 置通用 force_ended 标记键（虚拟映射即落 failed） |
| F02 | **P1** | backend/app/modules/agent/patrol.py:747-758 | 终态 mission 名单 `created_at ASC LIMIT 100` 无水位，>100 后新终态 mission 的孤儿永远扫不到（零孤儿承诺失效）且每轮恒付 ~201 查询 | 加时间窗（如 `GREATEST(converged_at,cancelled_at) > now()-interval '7 days'`）或扫描水位；排序按终态时间 |
| F03 | **P1(性能)** | backend/app/modules/daemon/router/__init__.py | `_team_mission_summary` 每 mission ≈14+Nd 查询，mission 行重复 get 4 次 | `mission_worker_sessions*` 加可选 `root_session_id` 参数；summary 内一次树结果喂三口径；done 判定批量 |
| F04 | P2 | backend/app/modules/agent/mcp_tools.py:2141 / backend/app/modules/agent/mission_context.py:343 | worker_done 的 DEL→SETNX 非原子，同波双完成 → 主控双注入 | Lua 原子 DEL+SETNX，或 SETNX 失败后 GET 比较周期时间戳再决定 |
| F05 | P2 | backend/app/modules/agent/patrol.py:879-899 / backend/app/modules/agent/mcp_tools.py:702-733 | constraints JSON 多写者 read-modify-write 互相丢键（conflict_attempts 被 budget 抢占覆盖等） | 抢占 UPDATE 改 `constraints = constraints \|\| :patch`（jsonb 合并） |
| F06 | P2 | backend/app/modules/agent/mcp_tools.py:1175 | commit#1 与 lease 段 try 外异常/崩溃 → 「pending session+run 无 lease」半孤儿永久占 MAX_WORKERS 且阻塞 converge | commit#1 降 flush 实现真单事务；或 patrol 补 TTL 清理档 |
| F07 | P2 | backend/app/modules/agent/control.py:141-223 | 治理门重复 `_split_worker_forms`×2；cost_so_far 全行加载求和 | can_dispatch 内复用一次枚举；`select(func.sum(total_cost_usd))` |
| F08 | P2 | backend/app/modules/agent/model.py:877 | 树 CTE 最终 join 在 PG 走 Hash Join + Seq Scan agent_sessions，表大后每次 O(全表)（EXPLAIN 实证） | 末段改 `AgentSession.id.in_(select(tree.c.sid))` PK 驱动 |
| F09 | P2 | backend/app/modules/agent/mcp_tools.py/1683/2114、backend/app/modules/agent/control.py、backend/app/modules/agent/finalizer.py、backend/app/modules/agent/mission_context.py、backend/app/modules/agent/patrol.py | is_worker_complete 循环 N+1（只在 done 分身上发生） | 提供 `is_workers_complete_batch`（批量活跃 turn + 纯函数），循环点替换 |
| F10 | P2 | backend/app/modules/agent/mcp_tools.py:2664 | mission_status 每次 per-scope git probe RPC | 30-60s TTL 缓存探测结果 |
| F11 | P2 | backend/app/modules/daemon/run_sync/service/__init__.py / backend/app/modules/daemon/session/service/__init__.py | readiness 进程内单例，多副本部署四闸③误判 → 存活分身被误收口 | Redis 共享 readiness 或文档钉死单进程部署约束 |
| F12 | P3 | backend/app/modules/agent/mission_schema.py:17 等 | budget_usd=0 合法但语义=永不能派工 | `ge=0`→`gt=0` 或前端禁 0 并文案说明 |
| F13 | P3 | backend/app/modules/agent/mcp_tools.py / backend/app/modules/daemon/router/__init__.py | workers 行三值映射漏 budget_force_ended 分支（行 running vs mission degraded 展示不一致） | 对齐 `_virtual_status` 补该分支 |
| F14 | P3 | backend/app/modules/agent/patrol.py:654 | 职责④ `role != 'orchestrator'` 无 NULL 守卫，与全库 `or_(role IS NULL,...)` 口径不一致（当前首 run 恒有 role 难命中） | 补 NULL 守卫对齐 |
| F15 | P3 | backend/app/modules/agent/mcp_tools.py:1582-1618 | 层 0 守卫「三 header 皆无放行」依赖外层 401 契约（当前不可达，脆弱） | 该分支也 403，注释改「防御性」 |
| F16 | P3 | backend/app/modules/agent/mcp_tools.py:1758 | 层 0 判层按 tree_depth，脏数据 depth=0 分身可过守卫 | 可选改为 parent_session_id 判空或双判 |

核验通过项（无需修复）：converge/budget 抢占互踩、end_session 幂等（无重复 SESSION_END）、深度门读-判-写、MAX_WORKERS 孙层口径、include_terminal 迟到 409、门户列表零增量、CTE 索引支撑与防环、递归深度截断语义。

---

## 4. 验证记录

- 定向 pytest（`uv run pytest -q --no-cov`，全部通过）：test_worker_subsession_patrol_orphan(18)、test_worker_subsession_patrol_budget（同上批）、test_subsession_recursion_dispatch + test_worker_subsession_done + test_worker_subsession_converge_close(33)、test_worker_subsession_lifecycle + test_worker_subsession_list_workers + test_worker_subsession_status + test_control_orchestrator_exclusion(57)、test_session_team_mission + test_mission_status(29)。合计 137 passed。
- 只读 EXPLAIN（本地 PG，297 sessions / 43 missions / 421 runs / 0 subsessions）：递归项 `ix_agent_sessions_parent` Index Scan；最终 join Hash Join + Seq Scan agent_sessions 0.24ms——小库无感，量化为 F08。
- 纯只读审计：未修改任何源码 / 迁移 / 测试。
