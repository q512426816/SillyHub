---
author: qinyi
created_at: 2026-08-23 04:50:00
scale: large
tier: independent
---

# 设计文档（Design）— 平台承接 Agent 日志上报

## 1. 背景

CLI 侧（sillyspec 仓，已实现已测试）在 agent 每次 `sillyspec run` 入口探测本地 harness 会话日志并主动 REST 上报（协议 `docs/platform-agent-log-protocol.md`）：best-effort、5s 超时、失败只 warn 不阻断、本地 `agent-session-log.json` 留底。上报只含**路径与元信息**，不含日志内容；内容解析由 daemon 按路径读文件（可选增强，本次不做）。本变更是平台端承接：落库 + 会话视图展示。

链路定位（协议 §0 图）：

```
本地 agent CLI ──sillyspec run──> 探测日志 ──POST /api/agent-logs（本变更新增端点）──> backend platform_sync
                                                                                          │ (workspace_id, log_path) upsert
浏览器会话详情 SessionPanelPage ──GET /api/agent-logs?workspace_id=…（本变更新增读通道）<── platform_agent_logs
```

## 2. 设计目标

见 requirements.md FR-01~FR-05。核心两条：写端点完全对齐既有 CLI 推送端点范式（quicklog-entries 同构）；读通道 + 面板让用户在会话视图直接看到 agent 本机日志线索。

## 2.5 非目标（Non-Goals）

同 proposal.md「非目标」：不做日志内容 tail/解析渲染（协议可选增强）、不做 daemon 派发记录自动对齐、不做服务端 TTL 清理、不改 CLI 侧行为、不触碰生命周期状态机。

## 3. 总体设计

落位 **platform_sync 模块扩展**（D-001）：该模块就是「SillySpec CLI 推送同步层」（router 现注册 9 条路由：progress×2/documents/approval×2/changes 列表/spec-manifest/spec-sync/quicklog-entries），新端点与其鉴权依赖（`require_platform_sync_write` / `require_platform_sync`）、upsert 范式、测试 fixture 全部同构，不新建模块。

### 3.1 数据模型（`platform_sync/model.py` 新增 ORM）

`AgentSessionLogORM` → 表 `platform_agent_logs`：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | `default=uuid.uuid4` |
| `workspace_id` | UUID FK workspaces CASCADE，NOT NULL | 只由 shpsync_ token 派生（D-004@v1 通道），无 NULL 过渡期场景 |
| `log_path` | String(1024)，NOT NULL | CLI 上报原样（Windows 盘符/反斜杠），NFR-02；Pydantic 侧同 max_length=1024 先行 422（防 PG 超长 500，X-08） |
| `harness` | String(32)，NOT NULL | codex / claude-code / zcode / 自定义 |
| `format` | String(64)，NULL | codex-rollout-jsonl 等 |
| `session_id` | String(128)，NULL | agent CLI 自身会话 id |
| `originator` | String(128)，NULL | sillyhub-daemon / zcode / … |
| `detected_via` | String(64)，NULL | 探测通道 |
| `agent_cwd` | String(1024)，NULL | entry 级 cwd |
| `exists` | bool，NOT NULL，default true | 上报时文件存在性 |
| `size_bytes` | BigInteger，NULL | 文件大小 |
| `mtime_ms` | Float，NULL | 文件 mtime 毫秒 |
| `first_seen_at` | String(64)，NULL | CLI ISO 8601 UTC 原文（D-003） |
| `last_seen_at` | String(64)，NULL | 同上，排序键 |
| `invocations` | Integer，NULL | CLI 侧累计调用次数（CLI 留底文件是计数权威，D-005） |
| `last_command` | String(255)，NULL | 只含 flag 名（协议 §7） |
| `scan_run_id` | String(128)，NULL | 顶层 body 带下（辅助归属） |
| `pushed_at` | String(64)，NULL | 本行最近一次上报的 body.pushed_at |
| `created_at` / `updated_at` | DateTime(tz) server_default now() | 服务端审计 |

约束：`UniqueConstraint("workspace_id", "log_path", name="uq_platform_agent_logs_workspace_path")`——与 quicklog_entries 同款（nullable 列 + 复合唯一约束先例，SQLite/PG 对齐）。不存 payload JSON 原文（D-002：结构化列即协议「整行存 entries 元信息」；字段演进靠 schema 升版加列，extra=ignore 保证未知字段不 422）。

### 3.2 API 契约

**POST /api/agent-logs**（`_write_auth`，与 quicklog-entries 完全同款：无凭据 401 / shk_live_·JWT 403 / scope.workspace_id None 403 fail-closed）

请求（Pydantic `AgentLogPushRequest`，`extra=ignore` 宽松）：

```json
{ "schema_version": 1, "pushed_at": "2026-08-23T00:53:22.020Z",
  "agent_cwd": "C:/Users/qinyi/IdeaProjects/sillyspec",
  "workspace_id": "ws-xxx", "scan_run_id": null,
  "entries": [ { "harness": "codex", "log_path": "C:/Users/.../rollout-xxx.jsonl",
      "format": "codex-rollout-jsonl", "detected_via": "codex-session-meta-cwd",
      "agent_cwd": "...", "session_id": "<uuid>", "originator": "sillyhub-daemon",
      "exists": true, "size_bytes": 123456, "mtime_ms": 1787446398096.99,
      "first_seen_at": "...", "last_seen_at": "...", "invocations": 3,
      "last_command": "scan --done" } ] }
```

- `entries` 1..50 条（`min_length=1, max_length=50`，防滥用）；`AgentLogEntry` 必填 `harness`+`log_path`，其余 optional；body 顶层 `workspace_id` 被 extra=ignore 吞掉（token 派生唯一权威，协议 §1「不信任 body 里的 workspace_id」）。
- 响应 200 `{"ok": true, "upserted": <n>}`（CLI 不读 body，任意 2xx 即成功）。
- 语义：逐 entry 按 `(workspace_id, log_path)` upsert——存在则整行覆盖（含 invocations/first_seen_at 等，CLI 留底文件是权威，服务端不自己累加，D-005）；单事务批量 commit；同请求内同 log_path 重复条目以后者为准（dict 化去重）。

**GET /api/agent-logs?workspace_id=&limit=**（`_read_auth`）

- 鉴权 scope 复用 `_read_args` 翻译（shpsync_ → token 绑定 workspace；JWT/`shk_live_` → CHANGE_READ 并集 + NULL 桶，与 GET /changes 同规，D-004）；`_read_args` 只做 scope→kwargs，**workspace_id query 参数过滤由 service 新写组合过滤器**（新 ORM 的 `workspace_id IN (并集) OR 参数等值`，NULL 桶子句对本 NOT NULL 表恒空、不引入，X-04）。
- `workspace_id` 可选：给了且在 scope 内 → 单 workspace 行；不在 scope / 无权限 → 空列表（不 403 不泄漏）；不给 → scope 全部（并集聚合或单 workspace）。
- 排序 `last_seen_at DESC NULLS LAST`（显式 nulls_last 消除 PG/SQLite 方言分叉，X-07；ISO 8601 UTC 字符串字典序 = 时间序，D-003），`limit` 默认 20 上限 100。
- 响应：`{"items": [...]}`，字段 **snake_case 原样**（后端无 alias_generator，以 `pnpm gen:types` 生成类型为唯一契约，前端禁止手写驼峰访问，X-06），字段即 3.1 全列。

### 3.3 迁移

`migrations/versions/20260823090000_add_platform_agent_logs.py`，`down_revision = "20260822090000"`（当前单头），create_table 与 ORM 对称（sa.JSON 不涉及；BigInteger/Float/Bool 均 dialect 无关），downgrade drop_table。无历史数据回填（未上线）。

### 3.4 前端设计

- **API 层** `src/lib/agent-logs.ts`：`listAgentLogs(workspaceId?)` → `apiFetch<AgentLogListResponse>("/api/agent-logs", { query })`；类型取 `api-types.ts` 生成 schema（FR-05）；query key 走 `src/lib/query-keys.ts` 工厂新增 `agentLogs` 键（对齐 CONVENTIONS 典型模式 2，X-17）。
- **组件** `src/components/daemon/agent-log-card.tsx`（新建，模式 A 小卡片）：`useQuery` + 30s refetchInterval（轮询跟随 run 级上报节奏，非秒级心跳，X-20）；渲染三态（列表/空态/折叠>3 条展开）；session_id 短码与 log_path 点击复制（navigator.clipboard + 「已复制」瞬时反馈）；大小人性化（B→KB→MB）；相对时间 dayjs（组件内 `dayjs.extend(relativeTime)`——全仓尚未 extend 过，X-15）；harness 徽标 brand-50/700、zcode 用语义 info 青区分（NFR-03，原型对照 `prototype-agent-log-panel.html`）。
- **挂载** `session-panel.tsx` `SessionPanelPage`：消息流（TurnTimeline）下方、TeamTaskBlock 上方插卡；`session.workspace_id` 为 null 不渲染（FR-04）；detailQuery 数据可得 workspace_id，无额外请求。

## 4. 错误处理

- POST 侧 CLI 已 best-effort（失败 warn 不阻断），服务端只需保证 2xx/422/401/403 语义正确；不做重试队列。
- GET 失败（网络/权限）→ react-query error 态卡片隐藏（不干扰会话主体验，卡片是增强信息）。
- 大小/时间字段 null 安全渲染（schema 全 optional 除 harness/log_path）。

## 5. 测试策略

- 后端 `app/modules/platform_sync/tests/test_agent_log_push.py`（新建）：鉴权矩阵 4 例、幂等 upsert、批量 entries、复合键跨 workspace、422、GET 排序/过滤/scope 隔离；conftest `ensure_platform_sync_table` fixture 扩建本表（自 contained 建表惯例）。
- 前端 `agent-log-card` vitest：列表渲染字段、空态、复制回调、null workspace 不渲染。
- 回归：backend pytest 全量 + ruff + mypy；frontend vitest + tsc + lint；`pnpm gen:types` diff 干净。

## 6. 文件变更清单（File Changes）

新增：
- `backend/app/modules/platform_sync/tests/test_agent_log_push.py`
- `backend/migrations/versions/20260823090000_add_platform_agent_logs.py`
- `frontend/src/lib/agent-logs.ts`
- `frontend/src/components/daemon/agent-log-card.tsx`
- `frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`（组件测试，项目惯例落 `__tests__/` 子目录，task-04 披露偏差）

修改：
- `backend/app/modules/platform_sync/model.py`（+AgentSessionLogORM）
- `backend/app/modules/platform_sync/schema.py`（+AgentLogEntry/AgentLogPushRequest/AgentLogPushOk/AgentLogListItem/AgentLogListResponse）
- `backend/app/modules/platform_sync/service.py`（+upsert_agent_log_entries/list_agent_logs）
- `backend/app/modules/platform_sync/router.py`（+POST/GET /agent-logs）
- `backend/app/modules/platform_sync/tests/conftest.py`（建表扩展）
- `frontend/src/components/daemon/session-panel.tsx`（挂载卡片）
- `backend/openapi.json`（gen:types 产物）
- `frontend/src/lib/api-types.ts`（gen:types 产物）
- `backend/tests/test_session_agent_session_id_migration.py`（task-05 披露越界：单头断言按意图修复，主仓既有红一并修）
- `backend/app/modules/agent/tests/test_mission_session_id.py`（task-05 披露越界：同款单头断言修复，本迁移推进 head 引发）

## 7. 生命周期契约

生命周期契约：无/N/A——本变更不新增、不修改任何 session / lease / agent_run / daemon 的生命周期状态机与状态迁移；仅新增 CLI 推送落库（纯 upsert 行存储）与只读展示通道，不改任何既有实体状态。

## 8. 决策记录

- **D-001 落位 platform_sync 扩展**：备选新独立模块 agent_log（重复 auth/conftest/与八端点分裂）、挂 daemon 模块（写入方是 CLI 非 daemon、语义不符且 router 已 2500+ 行）。选扩展：同构范式零新增依赖引线。用户上一会话已拍板推送式架构（协议文档即契约）。
- **D-002 结构化列、不存 payload JSON**：协议明言「整行存 entries 元信息」；quicklog 存 payload 是因为派生字段查询时算，本表无派生逻辑、展示字段固定。未知字段 extra=ignore 静默丢弃不 422；schema_version 升版需要时加列。
- **D-003 时间字段存 CLI 原文 String(64)**：对齐 `last_pushed_at` 先例（避免时区/精度转换）；CLI 恒发 `toISOString()`（UTC Z 格式）→ 字符串字典序 = 时间序，SQL ORDER BY 直接用。
- **D-004 GET 读通道复用 require_platform_sync 读 scope**：与 GET /changes 完全同规（CHANGE_READ 并集 + NULL 桶），无权限 workspace 静默空列表（不 403，避免 workspace 存在性泄漏）。
- **D-005 upsert 整行覆盖、服务端不累加**：invocations/first_seen_at 以 CLI 值为准（CLI 留底文件是唯一计数权威，多会话并发也由 CLI 侧文件锁保证）；服务端只做幂等落库。
- **D-006 面板挂 SessionPanelPage 而非左侧列表**：日志是会话详情的排障信息；workspace_id 取 `session.workspace_id`（detailQuery 已有，零额外请求），null 会话不渲染。
- **D-007 无 TTL/清理**：量级 = 每 workspace 活跃日志文件数（CLI 侧 ≤10 条留底上限），与 quicklog_entries 同口径；有量级需要再补。

## 9. 风险登记（Risk）

- **R-01 高频上报**：每次 `sillyspec run` 都推 → upsert 幂等吸收（D-005），量级 = 每 workspace 活跃日志文件数（≤10），无膨胀风险。
- **R-02 字段演进**：CLI schema_version 升版新增字段 → extra=ignore 静默丢弃不 422；需要时加列（D-002）。
- **R-03 超长路径**：PG 超 String(1024) 会 500 → Pydantic max_length=1024 先行 422（X-08），CLI best-effort 静默降级。
- **R-04 方言分叉**：NULL 排序 PG/SQLite 不一致 → 显式 NULLS LAST（X-07）。

## 10. 自审（Self-Review）

- 产物门槛：Non-Goals/FR-01~05/文件变更清单/生命周期契约豁免短语逐项命中。
- 独立 Design Grill（23 项 checklist）20 交叉点全数消化：X-06 事实错误已改（snake_case）、X-04/05/07/08/15/17/20 修正项已折入对应章节，无 P0/P1 未决项（decisions.md 存证）。
- 迁移链、鉴权矩阵、conftest 建表、挂载点、gen:types 链路均经源码/命令实证（X-11~X-14、X-18）。
