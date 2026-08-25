---
author: qinyi
created_at: 2026-08-26 02:20:00
scale: large
tier: independent
---

# 设计文档（Design）— 团队分身递归开闸 P2（会话树深度治理）

## 1. 背景

P1（2026-08-25-team-subsession-governance，已归档）落地了分身子会话治理地基：
会话树（parent_session_id）、worker_done 显式完成信号、受限单工具注入、
converge/cancel 沿树批量收口、owner=mission 创建者、判据单一真相源。递归闸
保持关闭（分身只拿 worker_done）。

P2 按路线图开闸：**子会话能派子会话**（用户原始愿景），配套四项治理
（双子代理风险调研结论）：深度上限、converge 层 0 收口、预算树聚合、
daemon 会话总数上限。

用户决策（2026-08-26，弹窗未作答按持续授权推荐默认记录）：
- 总深 3 层（主控 0 / 分身 1 / 孙 2，孙为叶）；
- 非叶分身工具集 = 派工集 + 收敛收口（dispatch_worker / list_workers /
  get_worker_result / mission_status / worker_done 五件；converge_mission 与
  report_progress 主控独有）；
- 架构方案 A（tree_depth 列 + lease metadata 双源各司其职）。

## 2. 设计目标

1. 分身（非叶）能把子任务派给下一层子会话，树形展开到孙层为止。
2. 深度硬闸：backend 派发门 O(1) 拒绝超深；daemon 工具集按 depth 分层
   （叶拿不到 dispatch_worker，物理不可再派）。
3. converge 权不下放：只有层 0 主控（或人工 JWT）能收敛整棵树。
4. 预算闭环：派发门拦增量（P1 已有成本 union）+ patrol 按 mission 维度
   触顶强收运行中的未完成分身。
5. daemon 存活会话总数闸，防进程风暴。

## 3. 非目标（Non-Goals）

- 不改 P1 收口链/判据函数语义（只扩枚举范围为一层→全树）。
- 不做 UI（门户分组/按需开流留 P3）。
- 不做跨 mission 聚合/组织级配额（单 mission 维度即可）。
- 存量兼容：无 tree_depth 的存量分身行视为 1（孙层以下不存在于存量）。

## 4. 拆分判断

单一变更：深度模型→派发门→工具集→治理口径是一条依赖链，拆开会出现
"有深度没闸"或"有闸没枚举"的中间态。工具下放与治理必须同变更落地
（Grill P1 教训：单独开闸=不可控）。

## 5. 总体方案

### 5.A 深度模型（Wave 1）

- `agent_sessions` 加 `tree_depth int NOT NULL DEFAULT 0`（迁移 20260826xx；
  索引 `ix_agent_sessions_tree_depth`）。主控会话 0、分身 1、孙 2；派发时
  `tree_depth = parent.tree_depth + 1` 落库。**迁移数据回填（Grill B1 修正）**：
  `UPDATE agent_sessions SET tree_depth = CASE WHEN parent_session_id IS NULL
  THEN 0 ELSE 1 END`（全表，主控/普通会话=0、存量分身=1）——NOT NULL 保证
  迁移后无 NULL 读值，删除原「NULL 按 1 计」运行时规则。daemon 会话 create
  路径不传 depth 落默认 0（主控/普通），分身派发路径显式传 parent+1。
- 新增 `mission_worker_sessions_tree(db, mission_id)`：递归 CTE 从根会话
  （mission.session_id）沿 parent_session_id 展开全树（递归 CTE 用 UNION 去重防环 + 深度截断 MAX_TREE_DEPTH=4 防脏数据深环）。
- P1 的 `mission_worker_sessions`（一层）保留（热路径子会话行化仍一层最快），
  全树版供治理口径消费。

### 5.B 派发链路：递归派发 + 深度门（Wave 2）

`mcp_tools._dispatch_worker_core` 升级：

- **调用方解析（Grill B2 修正——统一规则，五端点同构）**：X-Session-Id →
  会话行后按 parent 判别——`parent_session_id 非空`（分身）→ 沿链爬根定位
  mission（**禁懒建**，miss=404，防在分身上误锚新 mission）；`parent NULL`
  （主控/普通会话）→ 保留 P1 懒建语义不变。适用 dispatch_worker /
  list_workers / get_worker_result / mission_status / worker_done 全部五端点
  （原「只读三工具口径不变」作废——分身调用只读工具同样走爬根，否则 404）。
- **parent 挂点**：新子会话 `parent_session_id = 调用会话 id`（不再固定
  主控）——树形展开；首 run 双标记/owner=mission.created_by 不变。
- **深度门**：`调用会话.tree_depth + 1 > MAX_DISPATCH_DEPTH(=2)` →
  400 中文（"已达最大派发深度 3 层，孙分身不能再派工"）。
- **converge 层 0 收口**：`_converge_core` 增调用方上下文（request 透传）——
  调用会话 tree_depth > 0 → 403（"只有主控会话可以收敛任务"）；JWT 用户通道
  （Bearer）保留（人工干预口）；**X-API-Key 无 X-Session-Id 的 header-less
  显式 mission_id 回退路径同样过守卫**（判别按鉴权通道 header 嗅探——
无 Bearer 且无 X-Session-Id 的 apiKey 调用一律 403，Grill minor——防绕过，
对齐 mcp_tools.py:897-899 通道判别先例，勿按用户角色实现）。
- `list_workers` / `get_worker_result` / `mission_status` 对分身调用方开放
  （只读自查，解析走上方统一规则；worker_done 的 miss 保留 P1 迟到 409
  分支语义）。

### 5.C daemon 分层工具集（Wave 3，D-003@v2）

- `prepare_interactive_dispatch` 透传 `worker_depth` 写 lease metadata；
  claim payload → daemon。
- daemon 受限 server 分层：
  - `depth < MAX_DISPATCH_DEPTH`（非叶，1 层分身）：注册 dispatch_worker /
    list_workers / get_worker_result / mission_status / worker_done 五件；
  - `depth >= MAX_DISPATCH_DEPTH`（叶，2 层孙）：仅 worker_done（P1 现状）；
  - converge_mission / report_progress 永不注册（层 0 权）。
- 工具集按 depth 硬编码分层（两档），env 门控沿用 P1 机制。
- hub-client 转发路径不变（X-Session-Id 定位，分身调用 dispatch_worker
  与主控同端点——backend 侧靠调用方解析区分）。

### 5.D 预算强收 + 会话总数闸（Wave 4）

- **patrol 预算职责（⑥）**：独立扫描 `budget_usd 非空` 的活跃 mission，
  `cost_so_far >= budget_usd` 且存在未完成分身 → 复用 P1 收口链批量
  end_session（reason="mission_budget_exceeded"）+ mission 标记 degraded
  语义（§5.E 的 budget_force_ended_at 标记机制）；计数键 `budget_force_ended`。
- **daemon 会话闸**：SessionManager.create 前置计数（active/running 会话数
  ≥ `SILLYHUB_MAX_ACTIVE_SESSIONS`，默认 20，env 可配 0=不限）→ 抛
  SessionLimitReached → daemon notifyRunResult 标 run failed → **backend
  run_sync 侧补收口规则（Grill M1-R 终版——收口置 failed 非 ended）**：
  触发面收窄为「**首 run failed 且会话从未 ready**」（readiness 判定对齐
  session/service.py :3021 先例——闸拒绝的会话从未 ready，追问轮中途失败
  的存活分身不命中，防误杀）→ 子会话置 **status='failed' + ended_at**
  （对齐 P1 `_fail_worker_subsession` 语义，非 end_session 的 ended）——
  虚拟映射「会话终态 failed → failed」天然可收敛（degraded），杜绝闸拒绝
  后占额度且 mission 卡死。restore 路径不受闸限。

### 5.E 全树治理口径迁移（Wave 5）

以下消费点的一层枚举换 `mission_worker_sessions_tree`（孙层计入）：
- `mission_derive_status` / `is_worker_complete` 的分身集合；
- `control` 三口径（计数/成本 union/cancel 名单）；
- `finalizer.cleanup_mission`（孙层副本清理）与 converge 收口遍历；
- `patrol` 孤儿扫描/预算强收的枚举；
- **`_worker_done_core` 成员校验与全完成枚举（Grill B3——漏换则孙调
  worker_done 422、mission 永不可收敛）**；
- **`_converge_core` busy 前置计数**；
- **`mission_context.workers_all_terminal_with_stats`（防对孙层误发
  「全部终态」唤醒）**。

**预算强收的可收敛语义（Grill M2 修正）**：强收批量 end_session 前原子置位
mission 标记（constraints.`budget_force_ended_at`）；`mission_derive_status`
虚拟映射增补规则——mission 带该标记时「会话 ended 且未 done」映射
`failed`（终态）而非 running → derive 出 degraded，强收后 mission 可正常
converge（收尾但不圆满）。
`_team_mission_summary` / `list_workers` 前端展示保持一层直查 + 孙层折叠
计数（展示细节留 P3，本变更仅保证状态正确含孙层）。

### 5.F 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch_worker（分身调用=递归） | 分身 MCP | backend | objective/role/target? | 新子会话 parent=分身、tree_depth+1；超深 400 |
| dispatch_worker（叶调用） | 孙 MCP | backend | — | 400 深度拒绝，零写入 |
| converge_mission（分身调用） | 分身 MCP | backend | mission_id | 403 层 0 收口 |
| converge_mission（主控/用户） | 主控/JWT | backend | mission_id | P1 既有全树收口（枚举含孙） |
| patrol 预算触顶 | patrol | daemon | session_id/lease_id | 未完成分身批量 end_session（reason=budget） |
| daemon 会话闸拒绝 | daemon create | backend | error | 首 run failed + 会话从未 ready → 子会话置 failed 终态（可收敛 degraded，不崩 mission） |
| 孙 worker_done | 孙分身 MCP | backend | summary | 全树枚举成员校验通过；置位/挂首 run/唤醒同分身（B3 修正后孙可达） |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/migrations/versions/20260826020000_agent_session_tree_depth.py | tree_depth 列 NOT NULL DEFAULT 0+索引；全表 CASE 回填（parent NULL→0 / 非空→1，data migration） |
| 修改 | backend/app/modules/agent/model.py | AgentSession.tree_depth + mission_worker_sessions_tree 递归 CTE |
| 修改 | backend/app/modules/agent/mcp_tools.py | 调用方链式解析/parent 挂点/深度门 400/converge 层0 403；list_workers 等只读对分身开放口径 |
| 修改 | backend/app/modules/agent/mission.py | is_worker_complete/mission_derive_status 分身集合换全树 |
| 修改 | backend/app/modules/agent/control.py | 三口径枚举换全树 |
| 修改 | backend/app/modules/agent/finalizer.py | 收口/清理遍历换全树 |
| 修改 | backend/app/modules/agent/patrol.py | 职责⑥预算强收 + 孤儿/收口枚举换全树 |
| 修改 | backend/app/modules/agent/placement.py | worker_depth 写 lease metadata |
| 修改 | backend/app/modules/daemon/lease/context.py | claim payload 白名单透传 worker_depth（stage 先例 :479-480） |
| 修改 | sillyhub-daemon/src/daemon.ts | claim payload 归一化读 worker_depth 透传 SessionManager |
| 修改 | backend/app/modules/agent/mission_context.py | 非叶分身简报增「可派工到下一层」指引（Grill minor） |
| 修改 | backend/app/modules/daemon/run_sync/service.py | 闸拒绝失败即收口规则（M1） |
| 修改 | sillyhub-daemon/src/mcp-server.ts | 受限 server 两档工具集（depth 分层） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | 会话总数闸（env 默认 20）+ worker_depth 读 metadata |
| 修改 | sillyhub-daemon/src/mcp-config.ts | worker_depth 透传（受限 server 配置） |
| 修改 | sillyhub-daemon/src/cli.ts | 谓词分层（worker_depth 消费） |
| 修改 | sillyhub-daemon/src/interactive/session-store-persistence.ts | snapshot 补 worker_depth（restore 保档，M3） |
| 修改 | sillyhub-daemon/src/interactive/types.ts | worker_depth 四处类型声明载体（CreateSessionInput/SessionState-MainAgentMcpContext/PersistedSessionRecord，Grill minor4） |
| 新增 | backend/app/modules/agent/tests/test_subsession_recursion_*.py | 深度门/层0收口/全树枚举/预算强收/会话闸 |
| 新增 | sillyhub-daemon/tests/interactive/ | 分层工具集注入测试 |

字段数据流：`tree_depth`：producer=迁移回填+派发落库（NOT NULL DEFAULT 0）
→ 治理门 SQL O(1) 消费。`worker_depth`：producer=placement 写 lease
metadata → claim payload（context.py 白名单）→ daemon.ts 归一化 →
SessionManager 消费（决定工具集档位）**并随 snapshot 持久化**
（session-store-persistence 补字段，restore 保档——Grill M3，防重启非叶
分身静默降级叶档；P0-1 修复后 stage 先例已证明该链路可靠）。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 递归风暴（分身狂派孙） | 深度硬闸（backend 400 + daemon 叶无工具双保险）+ MAX_WORKERS 全树计数 + 预算强收 |
| 分身递归派发的 worktree_path 越权（传祖先 cwd 共写） | 递归派发不支持 caller worktree 透传（分身调用的 payload.worktree_path 一律忽略置 None），孙层一律自建副本 |
| 存量 depth=1 分身自动获得派工能力 | 显式确认为预期行为（本项目未上线，CLAUDE.md 规则 11；非叶档即 1 层） |
| 受限 server mcpRefs 过滤（P1 verify 预告重估） | 维持豁免——分身工具集是 depth 决定的固定治理面，非 profile 可配置能力（D-003@v2 重申） |
| 旧 lease 无 worker_depth | daemon 侧缺键按叶档（1 工具）兜底——宁少勿多 |
| 全树 CTE 脏环 | 递归 CTE UNION 去重 + 深度截断 MAX_TREE_DEPTH=4 |
| 闸拒绝后 mission 卡死 | 收口置 failed（非 ended）+ 从未 ready 触发面收窄（M1-R） |
| 会话闸误伤 restore | 闸只限 create，restore/重连不受限 |
| converge 收口把人工 JWT 也拦 | JWT 通道显式豁免（层 0 = 会话调用方判定，JWT 无会话上下文） |
