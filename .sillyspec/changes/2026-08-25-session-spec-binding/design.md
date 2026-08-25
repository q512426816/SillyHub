---
author: qinyi
created_at: 2026-08-25 22:15:45
change: 2026-08-25-session-spec-binding
scale: large
tier: independent
prototype: prototype-session-spec-binding.html
---

# 设计文档（Design）— 会话与变更/快速修复多对多绑定

## 1. 背景

用户在平台会话中执行 SillySpec 流程命令（`sillyspec run <阶段> --change <变更名>` / `sillyspec run quick ...`），但这些执行痕迹目前没有落到「会话 ↔ 变更/快速修复」的关联上：

- **变更侧**：`change_session_links` 多对多表已存在（`backend/app/modules/change/model.py:246`，2026-08-14 D-007），但唯一写入口是 reparse 发现新变更时 best-effort 绑定「工作区最近活跃会话」（`change/service.py:1306 _bind_change_to_session`，调用点 L1213-1215）——与"哪个会话真的跑了这个变更"无关；消费侧（审批通知 `_notify_bound_session`、`mcp_gateway/tools.py:1124`）只取最新一条；变更详情会话列表（`change/router.py:310 list_change_sessions`）走的是 `AgentSession.change_id` 单 FK，完全没查 links 表——**双轨割裂**。
- **快速修复侧**：完全空白——`quicklog_entries` 无 session 字段、无绑定表、前端零会话入口（quicklog-table/drawer 无任何会话 UI）。
- **会话列表**：无法按变更/快速修复筛选会话（现有筛选：status/runtime/machine/provider/q/workspace/change_id 单FK）。
- 自动感知链路其实已具备：daemon 为会话子进程注入 `SILLYHUB_SESSION_ID`（`sillyhub-daemon/src/spawn-env.ts:173`）；消息入库时 bash 工具调用已按 sillyspec 命令打 `tool_kind='sillyspec'` 标（`backend/app/modules/agent/tool_kind.py:32`）；CLI 经 `POST /api/agent-logs` 上报时带 `hub_session_id` + entry 级 `change_key`/`quick_id`（`platform_sync/schema.py:276-300`）——但 hub 分支目前**忽略** entry 的 ctx（`platform_sync/service.py:715-729`）。

本变更把这三条既有线索接通：会话内跑过 sillyspec 命令 → 自动建立多对多绑定 → 变更/快速修复侧展示关联会话 + 快速修复补齐会话工作台 + 会话列表加筛选。

## 2. 设计目标

- **FR-01 自动绑定（变更）**：会话内执行 `sillyspec run <任意阶段> --change <变更名>` 后，该会话与该变更自动建立多对多关联（一个会话可关联多个变更，一个变更可关联多个会话）。
- **FR-02 自动绑定（快速修复）**：会话内执行 `sillyspec run quick ...` 的会话自动关联到对应快速修复记录（ql_id），同样多对多。
- **FR-03 变更侧展示**：变更详情「会话调试」卡与变更级会话工作台改以 M:N 绑定为数据源（现单 FK）。
- **FR-04 快速修复侧展示与弹出会话**：快速修复详情抽屉新增「关联会话」卡；新增快速修复级会话门户路由（对齐变更门户），支持新建绑定本快速修复的会话。
- **FR-05 会话列表筛选**：工作区会话列表增加「关联」筛选下拉，可按变更或快速修复筛选会话（服务端过滤，多对多命中）。
- **FR-06 悬浮会话支持**：悬浮会话 preContext 支持 quickId，快速修复上下文可从悬浮球发起绑定会话。

## 3. 非目标（Non-Goals）

- **手动绑定/解绑 UI**：不做用户手动增删绑定的界面（绑定只由系统自动产生）。后续如有需要另开变更。
- **不修改 SillySpec CLI**：CLI 是外部工具，本变更全部在平台侧（backend/frontend）实现；不假设 CLI 任何新版本行为。
- **不改会话/lease/run 状态机**：会话生命周期（pending/active/ended/…）与 lease 编排完全不动。
- **不迁移删除 `AgentSession.change_id` 列**：该列保留并继续写入（见 D-002 冻结语义），彻底删列留待后续变更。
- **不做绑定关系的审计日志/通知**。
- **不做会话树行绑定徽标与绑定成功 toast**（原型中的 Q/C 小徽标、绑定提示条为方向示意元素，不进本期实现，X-012）。
- **全局 `/sessions` 门户不加关联筛选**（跨工作区选项过杂；筛选仅在 workspace scope 树列表提供，门控谓词见 §5.W4.4）。

## 4. 拆分判断

单变更承载：绑定检测、数据模型、API、前端门户/筛选是一个内聚特性闭环，拆开会导致中间态（有表无写入、有筛选无数据）。与活跃变更 `2026-08-25-team-subsession-governance`（治理）`2026-08-25-workspace-git-log`（git 日志）代码不重叠。

## 5. 总体方案（Wave 分组）

### W1 数据层
1. `change/model.py` 新增 `QuicklogSessionLink`（自然键 M:N，见 §8 数据模型；模型放 change 模块——变更中心拥有"spec 记录↔会话关联"域，quicklog 查询服务本就在 change 模块）。
2. alembic 迁移：建 `quicklog_session_links` 表 + **存量播种**（`INSERT INTO change_session_links (id, change_id, session_id, created_at) SELECT gen_random_uuid(), change_id, id, now() FROM agent_sessions WHERE change_id IS NOT NULL` + `ON CONFLICT (change_id, session_id) DO NOTHING`）。
3. 新增 `change/binding.py` 绑定 helper（幂等 best-effort，savepoint 包裹，失败仅 log.warning 不抛出——对齐 `_bind_change_to_session` 风格）：
   - `bind_session_to_change(db, workspace_id, change_key, session_id)`：**`change_key == "default"` 直接返回（D-005@v2：伪键跳过收敛在本函数内，命令解析与 agent-logs 两个通道统一生效）**；按 (workspace_id, change_key) 查 Change，不存在则建 placeholder 行（对齐 `_ensure_change_row` defaults：status=draft/location=active/path=changes/<name>）；upsert link（唯一约束幂等）。
   - `bind_session_to_quicklog(db, workspace_id, ql_id, session_id)`：直接 upsert link 行（无 FK 到 quicklog_entries，不存在条目行也允许先绑——CLI 推送 quicklog 条目与 agent-logs 到达顺序不保证）。
4. `agent/tool_kind.py` 重构：把 `_is_sillyspec_command` 内部的「分段（&&/;/|）+ 剥包装（pnpm/npx/yarn/sudo/node）」逻辑提为可复用的公共函数 `iter_command_segments(command)`，`_is_sillyspec_command` 行为不变（现有单测锁行为；daemon 侧 tool-kind.ts 零改动）。

### W2 检测层（自动绑定的三个新写入口）
1. **run_sync 命令解析**（FR-01 主通道）：`daemon/run_sync/service.py submit_messages` 落库循环中，tool_call 行解析出 `tool_kind=='sillyspec'` 时（现成判定点 L677-691），取 `json.loads(content)["args"]["command"]` 调 `extract_spec_bindings` 提取 `--change <变更名>` → `bind_session_to_change`。会话 id 经 run 二跳（`AgentRun.agent_session_id`）获得：**需先按需加载 run 并守卫 `agent_session_id IS NULL`（batch run 无会话、会话被删 FK 置空两种情况跳过绑定，X-002）**；workspace_id 取会话行。**解析规则**（D-004/D-005@v2）：
   - `sillyspec run quick ...` 子命令：其 `--change` 值是 CLI 内部 quick 会话 id（`quick-<hex>`/`default`），**不**作为变更绑定；quick 的绑定不经此通道（ql_id 此刻未知）。
   - `sillyspec run <非quick> ... --change <名>`（空格分隔为主、兼容 `--change=名`）：产出变更绑定；`名 == "default"` 跳过（伪键；解析层跳过 + `bind_session_to_change` 内部兜底双保险，D-005@v2）。
   - 其余 sillyspec 子命令（progress/status/archive…）无绑定产出。
2. **platform_sync agent-logs hub 分支**（FR-02 唯一可靠通道）：`upsert_agent_log_entries` hub 命中分支（L715-729）补消费 entry 的 `change_key`/`quick_id`（现在被完全忽略）：hub 会话归属校验通过后，对每个 entry 的 ctx 调对应 bind（change_key→change link；quick_id→quicklog link）。两键按 schema 互斥（`schema.py:275` 注释「CLI quick 优先」），若并存以 quick_id 为准。ctx 目标按 workspace 查找（R-05），变更不存在建 placeholder（default 伪键由 `bind_session_to_change` 内部跳过，D-005@v2，X-004）；quicklog 条目行不存在也直接绑（见 W1.3）。
3. **platform_sync agent-logs 聚合分支**：find-or-create `origin='tool_report'` 会话后（L740-776），同样按 ctx 落绑定——让本地直跑 CLI 上报聚合出的会话也出现在变更/快速修复的关联列表里。
4. reparse 的 `_bind_change_to_session`（最近活跃会话 best-effort）保留不动（第五个写者，行为不变）。

### W3 API 层
1. `list_change_sessions`（`change/router.py:310`）改读 `change_session_links`（JOIN agent_sessions，`deleted_at IS NULL`），响应 schema `AgentSessionListItem` 不变（FR-03；存量播种保证旧单 FK 数据不丢）。
2. 新增 `GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions`（FR-04 数据源；读 `quicklog_session_links`，响应同 `AgentSessionListItem` 列表；标题提取复用 `list_change_sessions` 的 window-function 逻辑——提取为共享 helper，两端点同源，X-013）。
3. `GET /api/daemon/sessions`（`daemon/router.py:2015` + `daemon/session/service.py:3876-3926`）：`change_id` 参数改为 M:N 子查询 `AgentSession.id IN (SELECT session_id FROM change_session_links WHERE change_id=:x)`（语义从"单FK精确"扩为"M:N 命中"，参数名/类型不变）；新增 `ql_id: str|None` 参数（同理走 quicklog links）（FR-05 服务端）。
4. `POST /api/daemon/sessions`：`SessionCreateRequest` 新增 `quicklog_id: str|None`（ql_id 短码字符串，非 UUID）；创建落库点（`daemon/session/service.py:1075-1091`）`change_id` 存在时**补写** link 行（单 FK 照写，D-002 双写）；`quicklog_id` 存在时写 quicklog link（FR-04/FR-06 落点）。

### W4 前端层
1. **QuicklogScope 门户**（FR-04）：`SessionListScope` 增加 `{kind:"quicklog"; workspaceId: string; qlId: string}`；新路由 `frontend/src/app/(dashboard)/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx` 薄壳（对齐变更级门户页）；`sessions-portal.tsx` quicklog 分支合成 preContext `{workspaceId, quickId, runtimeId}`；列表查询透传 `ql_id`。**scope 消费分支为 if-chain 判等（TS 不做穷尽检查，漏分支会静默退化，X-008），须逐一补齐**：`session-list-panel.tsx` 的 groups memo 单组模板（L573-583）、queryFn 透传（L496-507）；`sessions-portal.tsx` 的 portalTitle（L312）、scopedPickerWorkspaceId（L239）、defaultExpandedWorkspaceId（L399-403）、空态文案（L476）。
2. **SessionPreContext.quickId**（FR-06）：`session-panel.tsx` `SessionPreContext` 加 `quickId?: string|null`，`handlePreSessionSend` 请求体加 `quicklog_id`；`stores/floating-session.ts` `FloatingPreContext` 加 `quickId`（悬浮球链路顺手补齐）；变更名解析 query（L568-583）同款加快速修复标题解析。
3. **快速修复抽屉会话卡**（FR-04）：新组件 `quicklog-sessions-card.tsx`（镜像 `ChangeSessionsCard`：调新端点取本人会话前 3 条预览，条目 `?session=` 深链直达门户选中态，卡尾「打开会话工作台」Link 到新路由）；挂载进 `quicklog-drawer.tsx`。
4. **会话列表关联筛选**（FR-05）：`session-list-panel.tsx` `WorkspaceTreeList` 筛选条新增「关联」下拉（antd Select，showSearch，选项分组：活跃变更 `listChanges` + 快速修复 `listQuicklogEntries`）；选中→`listAgentSessions` 透传 `change_id` 或 `ql_id`（服务端过滤）。**门控谓词显式化（X-009）**：`WorkspaceTreeList` 对所有 scope（含全局缺省）统一渲染，筛选仅在 `scope?.kind === "workspace"` 时渲染（change/quicklog scope 自身已按关联过滤，再叠加会互相冲突；全局门户跨工作区选项过杂）。
5. `lib/daemon.ts`：`listAgentSessions` 加 `ql_id` 参数；新增 `listQuicklogSessions(workspaceId, qlId)`；`createSession` input 加 `quicklog_id`。
6. `pnpm gen:types` 重生成 `api-types.ts` + 提交 `backend/openapi.json`。

### W5 验证
全量回归：backend pytest（change/daemon/platform_sync 模块）+ frontend vitest + tsc + gen:types check。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/change/binding.py | 绑定 helper：`extract_spec_bindings` 命令解析 + `bind_session_to_change` / `bind_session_to_quicklog`（savepoint 幂等） |
| 新增 | backend/app/modules/change/tests/test_spec_binding.py | 解析规则样例库单测（--change 空格/等号、quick 子命令不绑、default 跳过、复合命令多段、pnpm 包装）+ 绑定幂等单测 |
| 新增 | backend/migrations/versions/20260825223000_add_quicklog_session_links.py | 建表 + 存量 change_id 播种（§5.W1.2）；downgrade 对称 drop 表（播种的 link 行保留无害，docstring 说明） |
| 新增 | backend/app/modules/change/tests/test_quicklog_sessions_api.py | 新端点测试（绑定命中/空/软删过滤/跨成员可见） |
| 新增 | frontend/src/app/(dashboard)/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx | 快速修复级门户薄壳（QuicklogScope） |
| 新增 | frontend/src/components/changes/quicklog-sessions-card.tsx | 抽屉关联会话卡（预览3条+工作台入口） |
| 新增 | frontend/src/components/changes/__tests__/quicklog-sessions-card.test.tsx | 卡片渲染/深链/空态测试 |
| 修改 | backend/app/modules/change/model.py | 新增 `QuicklogSessionLink` 模型（§8） |
| 修改 | backend/app/modules/agent/tool_kind.py | 提取公共 `iter_command_segments`（`_is_sillyspec_command` 行为不变，单测锁行为） |
| 修改 | backend/app/modules/daemon/run_sync/service.py | submit_messages 循环：sillyspec tool_call → extract_spec_bindings → bind_session_to_change（经 run.agent_session_id） |
| 修改 | backend/app/modules/platform_sync/service.py | upsert_agent_log_entries hub 分支补消费 ctx 绑定；聚合分支 tool_report 会话绑定 |
| 修改 | backend/app/modules/change/router.py | list_change_sessions 改读 links；新增 quicklog-entries/{ql_id}/sessions 端点 |
| 修改 | backend/app/modules/daemon/router.py | GET sessions 加 `ql_id` 查询参数；POST sessions 透传 `quicklog_id`。**数据流**：`quicklog_id` producer=前端 preContext.quickId → `lib/daemon.ts createSession` body → 本路由 → `daemon/session/service` 创建后 `bind_session_to_quicklog` → consumer=`quicklog_session_links` 行（经 quicklog sessions API 回读） |
| 修改 | backend/app/modules/daemon/schema.py | `SessionCreateRequest.quicklog_id: str|None`（producer/consumer 链见上行）；sessions 列表查询参数 `ql_id` |
| 修改 | backend/app/modules/daemon/session/service.py | 列表筛选：change_id 改 M:N 子查询 + 新增 ql_id 子查询；创建落库补写 link（change_id 双写、quicklog_id 新写） |
| 修改 | backend/app/modules/daemon/service.py | DaemonService facade 显式签名同步透传（ql_id 筛选 + quicklog_id 创建——task-04 实证 facade 漏传即 500，QA 确认的实现必需项，首版清单遗漏已补） |
| 修改 | backend/app/modules/daemon/tests/（既有会话列表/创建测试文件） | 筛选语义变更断言更新 + 新增用例 |
| 修改 | frontend/src/lib/daemon.ts | `listAgentSessions` 加 ql_id；新增 `listQuicklogSessions`；`createSession` 加 quicklog_id（producer 链见上） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | `QuicklogScope` 类型 + 查询透传 ql_id + 「关联」筛选下拉（workspace 树列表） |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | scope 判别联合收 QuicklogScope + preContext 合成 quicklog 分支（{workspaceId, quickId, runtimeId}） |
| 修改 | frontend/src/components/daemon/session-panel.tsx | `SessionPreContext.quickId` + 快速修复标题解析 query + `handlePreSessionSend` 请求体 quicklog_id |
| 修改 | frontend/src/stores/floating-session.ts | `FloatingPreContext.quickId?: string|null`（FR-06 悬浮球链路） |
| 修改 | frontend/src/components/changes/quicklog-drawer.tsx | 挂载 QuicklogSessionsCard |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（及门户测试） | QuicklogScope + 筛选透传断言 |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types`（schema 变更后强制） |

> **明确不修改**：`sillyhub-daemon/**` —— 检测全部在 backend 消息入库/上报层实现；daemon 侧 `SILLYHUB_SESSION_ID` env 注入（spawn-env.ts:173）与 tool_kind 打标（tool-kind.ts）现状已够用，本变更对 daemon 零改动（task-13 以 `git diff --stat -- sillyhub-daemon` 验证零改动）。

## 7. 接口定义

```python
# backend/app/modules/change/binding.py
@dataclass(frozen=True)
class SpecCommandBinding:
    kind: Literal["change"]          # quick 不经命令解析通道（ql_id 未知，D-004）
    change_key: str

def iter_command_segments(command: str) -> list[str]:
    """按 &&/;/| 分段并剥 pnpm/npx/yarn/sudo/node 包装，返回裸命令段列表。
    （自 agent/tool_kind.py._is_sillyspec_command 内部逻辑提取，行为不变）"""

def extract_spec_bindings(command: str) -> list[SpecCommandBinding]:
    """解析 sillyspec 命令，产出变更绑定目标。
    规则：段首为 sillyspec run quick → 无产出（--change 是 CLI quick 会话 id）；
    段首为 sillyspec run <其他> 且含 --change <名> 或 --change=名 → 产出；
    名 == 'default' 跳过。"""

async def bind_session_to_change(
    db: AsyncSession, workspace_id: uuid.UUID, change_key: str, session_id: uuid.UUID
) -> None:  # best-effort：savepoint，失败 log.warning 不抛

async def bind_session_to_quicklog(
    db: AsyncSession, workspace_id: uuid.UUID, ql_id: str, session_id: uuid.UUID
) -> None:  # 同上；无需 quicklog_entries 行存在
```

```python
# 新端点（change/router.py）
@router.get("/workspaces/{workspace_id}/quicklog-entries/{ql_id}/sessions")
async def list_quicklog_sessions(workspace_id: UUID, ql_id: str) -> list[AgentSessionListItem]
# 读取 quicklog_session_links JOIN agent_sessions（deleted_at IS NULL），last_active_at 倒序；
# 跨成员可见（对齐 list_change_sessions 现状：列表可见、stream owner-only 不变）

# daemon sessions 列表新参数（daemon/router.py）
GET /api/daemon/sessions?ql_id=ql-20260824-014   # 新增；change_id 语义扩为 M:N 命中

# 创建会话（daemon/schema.py）
class SessionCreateRequest(...):
    quicklog_id: str | None = None   # ql_id 短码；创建时 bind_session_to_quicklog
```

```typescript
// frontend
export type QuicklogScope = { kind: "quicklog"; workspaceId: string; qlId: string };
export type SessionListScope = WorkspaceScope | ChangeScope | RuntimeScope | QuicklogScope;

export interface SessionPreContext {  // session-panel.tsx（现 changeId 基础上加 quickId）
  runtimeId: string; workspaceId: string | null;
  changeId?: string | null; quickId?: string | null;
}
// createSession input 加 quicklog_id?: string；listAgentSessions options 加 ql_id?: string;
// 新增 listQuicklogSessions(workspaceId: string, qlId: string): Promise<AgentSessionListItem[]>
```

### 7.5 生命周期契约表

本变更**不改动任何既有生命周期状态机**（会话 pending/active/…/ended、lease claim/heartbeat、run 状态均不变）；新增的是**绑定行插入事件**（无状态迁移，幂等 upsert）。绑定事件契约如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 消息入库检测到 sillyspec 命令 | daemon（submitMessages 上报） | backend run_sync → change/binding | agent_run_id（→agent_session_id）、args.command、workspace_id | 无状态迁移；upsert change_session_links |
| agent-logs 上报（hub 会话命中） | SillySpec CLI | backend platform_sync | hub_session_id、entries[].change_key/quick_id、workspace_id（token 派生） | 无状态迁移；upsert change/quicklog links |
| agent-logs 上报（无 hub，聚合） | SillySpec CLI | backend platform_sync | harness、entries[].change_key/quick_id、workspace_id | find-or-create origin=tool_report 会话后 upsert links |
| 创建绑定会话（门户/悬浮球） | 前端 | backend POST /api/daemon/sessions | runtime_id、prompt、workspace_id、change_id 或 quicklog_id | 会话按既有流程创建；额外 upsert link 行 |
| 存量播种（一次性迁移） | alembic | DB | agent_sessions.change_id | 无；INSERT … ON CONFLICT DO NOTHING |

生命周期契约豁免说明：上表均为绑定行插入（幂等、无状态机），无 session/lease/agent_run 的状态迁移；每个事件均有对应实现任务与测试任务（见 §5 W2/W3 与 tasks.md）。

## 8. 数据模型

```python
# backend/app/modules/change/model.py 新增
class QuicklogSessionLink(Base, table=True):
    __tablename__ = "quicklog_session_links"
    id: UUID primary key
    workspace_id: UUID  FK→workspaces.id ON DELETE CASCADE, NOT NULL
    ql_id: str(128)    NOT NULL          # 自然键（ql-YYYYMMDD-NNN-后缀）
    session_id: UUID   FK→agent_sessions.id ON DELETE CASCADE, NOT NULL
    created_at: timestamptz server_default now()
    # 约束：uq_quicklog_session_link_pair UNIQUE(workspace_id, ql_id, session_id)
    # 索引：ix_quicklog_session_link_ql(workspace_id, ql_id)、ix_quicklog_session_link_session(session_id)
```

- **无 FK 到 quicklog_entries**（D-001）：quicklog 条目是双源合并（DB 推送行 + QUICKLOG.md 文件解析行），文件源条目没有 DB 行；且 agent-logs（带 quick_id）与 quicklog 条目推送到达顺序不保证。会话侧 FK CASCADE 保证会话删除清绑定；workspace 级联经 workspace_id FK 保证。
- `change_session_links` 表结构不变；`AgentSession.change_id` 列保留继续写入（D-002：冻结为"创建时锚定的主变更"冗余提示，关联读取一律走 links）。

## 9. 兼容策略（brownfield）

- **未跑过 sillyspec 的会话**：无 link 行，所有现有行为完全不变。
- **`change_id` 查询参数（GET /api/daemon/sessions）**：参数名/类型不变，命中集从"单 FK 精确匹配"扩大为"M:N 命中（含迁移播种行）"——对外契约向后兼容（原命中集是扩大后命中集的子集：播种把存量单 FK 全量转成 link 行）。
- **`AgentSessionRead.change_id`** 字段继续返回；`list_change_sessions` 响应 schema 不变（数据源换 links，消费方 `ChangeSessionsCard`/门户零改动）。
- **迁移回退**：downgrade drop `quicklog_session_links`；播种进 `change_session_links` 的行保留（该表本就存在，多出的历史行无害——消费侧本就按 change_id 过滤）。
- **旧 CLI / 未上报 agent-logs 的环境**：quick 绑定不产生（R-01），其余功能（变更命令解析绑定、筛选、展示）不依赖 agent-logs；前端对空关联列表优雅降级（「暂无本人会话」空态文案）。
- **不改的 API/表**：quicklog-entries 推送/查询 API、QUICKLOG.md 解析、`platform_agent_logs`、悬浮会话既有 changeId 链路（仅加字段）。

## 10. 风险登记（Risk）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | quick 绑定唯一可靠通道是 CLI agent-logs 上报（ql_id 只在 entry 里）；旧版 CLI/未上报则 quick 无绑定 | P1 | 文档化依赖；agent-logs 推送是现行 CLI 已具备能力；变更侧不依赖此通道（命令解析兜底）；前端空态降级 |
| R-02 | 命令解析误绑：`--change default` 伪键、quick 子命令 `--change <quick-8hex>` 误当变更名 | P1 | 解析规则显式跳过两类；样例库单测覆盖（含复合命令/包装前缀/等号形式） |
| R-03 | run_sync 绑定钩子在消息入库热路径做额外查询/写入 | P2 | 仅 tool_kind=sillyspec 的行触发（低频）；savepoint best-effort 失败仅告警；placeholder 变更行查找有 (workspace_id, change_key) 唯一索引 |
| R-04 | 关联筛选下拉选项（变更+快速修复）在大会工作区过长 | P2 | antd Select showSearch 本地搜索；选项只取活跃变更 + 非占位快速修复 |
| R-05 | agent-logs entry ctx 与 hub 会话不属同一变更语境时误绑 | P1 | 绑定按 workspace 归属校验（hub 分支已校验会话归属；ctx 目标按 workspace 查找，变更不存在建 placeholder、quicklog 直接按 (workspace, ql_id) 绑，天然限 workspace 内） |
| R-06 | gen:types 暴露无关旧测试债 | P2 | 按 CLAUDE.md 规则 21 惯例顺手补齐，不为躲报错回退手写 |
| R-07 | 前端骨架屏/深链对 QuicklogScope 的兼容（?session= 恢复等） | P2 | QuicklogScope 完整复用门户既有深链/恢复逻辑（scope 仅影响查询参数与 preContext 合成），测试覆盖 |
| R-08 | reparse 保留的「最近活跃会话」猜测绑定进入 M:N 展示集（变更会话卡出现与实际执行无关的会话噪声） | P2 | 接受（既有行为保留，X-011）：猜测绑定仅在变更新建时产生一条；如噪声明显后续变更可在 reparse 写入口收敛或加 source 标记区分 |

## 11. 决策追踪（decisions.md 同步维护）

| 决策 | 内容 | 覆盖 |
|---|---|---|
| D-001@v1 | quicklog_session_links 用自然键 (workspace_id, ql_id, session_id)，无 FK 到 quicklog_entries（双源合并+到达顺序不保证） | FR-02/FR-04；§8 |
| D-002@v1 | 变更侧收敛：links 为唯一关联真相；存量 change_id 播种迁移；单 FK 列保留双写、冻结为冗余提示（方案A，自治选定，用户需求明确 M:N） | FR-01/FR-03；§5.W1.2/§9 |
| D-003@v1 | 检测双通道：run_sync 命令解析（变更主通道）+ agent-logs 上报归属补绑（quick 唯一通道，hub 分支现忽略 ctx 是要修的点） | FR-01/FR-02；§5.W2 |
| D-004@v1 | `sillyspec run quick` 的 `--change` 值是 CLI 内部 quick 会话 id，不作变更绑定；quick 绑定不经命令解析通道 | FR-02；§5.W2.1 |
| D-005@v2 | `--change default` 伪键跳过绑定，且**收敛在 `bind_session_to_change` 内部**统一生效（命令解析与 agent-logs 两通道，supersedes D-005@v1，Grill X-004） | FR-01/FR-02；§5.W1.3/W2 |
| D-006@v1 | 快速修复门户走 QuicklogScope 新路由 `/workspaces/[id]/quicklog/[qlId]/sessions`，与变更门户同构（对齐 2026-08-22-workspace-sessions-portal D-002@v1 模式） | FR-04；§5.W4.1 |

未解决/剩余风险：R-01（依赖 CLI 上报行为，无法平台侧完全兜底）。

## 12. 自审（Self-Review）

- ✅ 章节齐全：背景/目标/非目标/总体方案/文件清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审。
- ✅ 生命周期关键词命中（session/daemon/agent_run）→ 已含生命周期契约表 + 豁免说明（无状态机迁移）。
- ✅ 每个对外新字段（quicklog_id / ql_id / quickId）已按 producer→consumer 标注数据流（§6 表内 + §7 签名）。
- ✅ FR-01~FR-06 每条均有实现落点（§5 Wave）与测试落点（§6 测试文件行）；生命周期契约表 5 事件均有对应任务。
- ✅ M:N 语义核对：写入口 5 个（命令解析/agent-logs hub/agent-logs 聚合/创建会话/reparse 保留）全部幂等 upsert，唯一约束兜底并发；读入口（变更会话列表/快速修复会话列表/会话列表筛选）全部走 links。
- ✅ 与既有决策不冲突：复用 2026-08-14 D-007（links 表）、2026-08-22 D-002@v1（门户路由模式）、D-004@v1（?session= 深链）；知识库无相关否决决策。
- ⚠️ 自审存疑 1：R-01 的 quick 绑定覆盖率取决于用户环境 CLI 版本行为（CLI 自动上报 agent-logs 的触发面无法在本仓库验证）——已在风险登记列明，验收时以本环境真实 quick run 走查。
- ⚠️ 自审存疑 2：`sillyspec run quick --linked-changes <变更名>` 是否也应让会话绑定该变更——现设计不绑（quick 只绑快速修复），若用户后续要求可在 quicklog link 之外追加 change link，向后兼容。
- ✅ 原型已生成（prototype-session-spec-binding.html，三场景：抽屉会话卡/快速修复门户/列表筛选）——新页面路由级变化，属"必须生成"级。
- ✅ Design Grill（independent 子代理，16 交叉点）已过：specVerdict=pass / qualityVerdict=pass，21 处源码锚点核实无编造。P1 发现 X-004 已修正（D-005@v2：default 跳过收敛到 bind_session_to_change 内部，双通道统一）；P2 缺口已收编进设计（X-002 agent_session_id 守卫、X-008 QuicklogScope 消费分支清单、X-009 筛选门控谓词、X-011→R-08、X-012 徽标/toast 入非目标、X-013 title 共享 helper）。
