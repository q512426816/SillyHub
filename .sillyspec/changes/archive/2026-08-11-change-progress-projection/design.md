---
author: qinyi
created_at: 2026-08-11 15:43:48
scale: large
risk_level: unit-sufficient
related_change: 2026-08-10-sillyhub-platform-sync（收件箱层，本变更前置：platform_change_progress 表 + 3 端点为本变更复用/扩展对象）
related_contract: sillyspec 仓 docs/sillyspec/sillyhub-progress-sync-contract.md（跨仓契约，存 sillyspec 仓；本变更不动 §3 body，补 workspace 隔离章节）
---

# 设计文档（Design）— 变更中心接入进度同步层（workspace 隔离 + 实时投影）

> **前置依赖**：本变更建立在已归档的两段之上——主仓 `2026-08-10-sillyhub-platform-sync`（收件箱层：`platform_change_progress` 表 + POST/GET 3 端点）和 sillyspec 仓 `2026-08-10-platform-progress-sync`（客户端 push/pull/冲突）。这两段 done。本变更补第三段「收件箱 → 变更中心展示」，并补前置段缺失的 workspace 隔离。

## 1. 背景

进度同步链路设计为三段，前两段已落地，第三段（本变更）从未进入任何 change scope：

| 段 | 内容 | 落地 change | 状态 |
|---|---|---|---|
| ① 工具 → 收件箱 | `serializeForSync()` 六表投影（含权威 current_stage/status），`platform sync` 上行 + base_ts 冲突检测 | sillyspec 仓 2026-08-10-platform-progress-sync | ✅ |
| ② 收件箱存储 + 下行 | `platform_change_progress` 表（change_name 全局 PK）+ POST/GET 3 端点 | 主仓 2026-08-10-sillyhub-platform-sync | ✅ |
| ③ 收件箱 → 变更中心展示 | 把权威 stage 投影到 changes 展示 | **本变更** | ❗缺失 |

### 1.1 症状

变更中心前端「状态/阶段」与实际不符。根因（已查证）：

- 前端 `changes/page.tsx:236`(状态)/`:250`(阶段) 读 `changes` 表；`current_stage` 来自 `parser.py:574 _infer_current_stage` **扫文件存在性猜**（有 verify-result.md→verify、有 plan.md→plan…），识别不出 quick/blocked/审核等待/rerun 等真实态。
- 工具上行的权威 stage 躺在 `platform_change_progress.latest_progress.changes[0].current_stage`，但 **change 模块零引用** 该表（`PlatformChangeProgressORM` 全部引用圈在 platform_sync 模块内）；前端也零调用 `/api/changes` 同步端点。

### 1.2 workspace 隔离缺口（前置段遗留）

收件箱设计为「平台级聚合、无 workspace 语义」（`platform_sync/auth.py:7` 引用的 sillyhub-platform-sync 变更 D-002；`service.py:34` 类 docstring）：`platform_change_progress` 表只有 `change_name` 全局 PK，**无 workspace_id 列**；工具上行 body 也不含 workspace_id（契约 §3 + design B2）。这导致投影时无法按 workspace 区分「同一 change_name 属于哪个工作区」——多 workspace 同名 change 会串值。

平台当前无法从任何工具→平台上行请求确定 workspace：`ApiKey` 表只绑 `user_id` 无 workspace 列（`auth/model.py:201-252`），`User` 经 `UserWorkspaceRole` 可属多 workspace。

> ⚠️ **命名空间注脚（Grill X10）**：本文档 `D-002@v1` 指**本变更**的决策（投影=实时 join）；`platform_sync/auth.py:7` 注释引用的 `D-002` 是**另一变更** sillyhub-platform-sync 的决策（无 workspace 语义）。两者同名不同义，勿混。

### 1.3 关键复用点（降低工作量，均已 Grill 核实）

- **McpToken 模式**（`mcp_gateway/`）：`shmcp_` 前缀、workspace_id 硬 FK CASCADE、token_hash 存 sha256 唯一、authenticate 按 hash O(1) 查表派生 `McpTokenPrincipal(token_id, workspace_id, scope)`。本变更的 platform sync token **参照此模式 + ApiKey 的 name 字段**（字段集见 §8.1，Grill X1/X2 校准），独立新表（职责分离：MCP 派发 ≠ 进度同步）。
- **`Workspace.root_path`**（`workspace/model.py:62`）：已 1:1 绑定本地项目目录（部分唯一索引 `ux_workspaces_root_path_active`，`model.py:36-40`），`_find_active_by_root_path`（`service.py:875-883`）反查已核实存在。本变更**不改 workspace 模块**。
- **connect 文本级段替换 writer**（`sync.js:109 replaceTopLevelSection`）：已从旧 flat writer 迁移，逐字节保留注释（`sync.js:41-50` 说明）。本变更扩展 connect 下发 token 复用它。
- **`ApiKeyService`**（`auth/api_key_service.py`）：user 级 shk_live_ key 校验（authenticate 返 User）。本变更换发端点复用它做一次性鉴权。
- **mcp 段同源坑 NG-4 边界已核实**（Grill 确认）：`sync.js:286-288` connect 复用 platform url/token 进 mcp 段，但真 McpToken 是 `shmcp_`，同源假设错——留单独 change，本变更新端点不复用该路径。

## 2. 设计目标

- **G1 投影 current_stage**：change 模块 `enrich_summaries`/`enrich_with_workspace_ids` 实时 read-only join `platform_change_progress`，取权威 current_stage 覆盖猜值；不双写 changes 表。
- **G2 workspace 隔离**：workspace-scoped token 派生 + `platform_change_progress` 加 workspace_id 列 + 复合唯一 `(workspace_id, change_name)`，sync 全链路按 workspace 隔离。
- **G3 自动下发**：扩展 `sillyspec platform connect` 换发 workspace-scoped token，文本级段替换写入 local.yaml platform 段（保留注释）；换发端点带 workspace 权限校验（Grill X4）。
- **G4 冲突优先级**：以工具上行为准；工具从未上行的 change fallback 到 changes 表现有值（reparse 猜值/agent 写值）。
- **G5 投影仅 current_stage，不投 status**（Grill X3 / D-004@v2）：sillyspec changes.status 实测仅 `active`/`archived` 两值，archived 已由 `current_stage==archive` 派生（前端 page.tsx:240 现有逻辑），status 投影无增量，撤销。
- **G6 不动契约 §3 body**：workspace 走 token 派生，**不进** serializeForSync body。
- **G7 棕地免回填**：项目规则 7「数据可清空」，新列/新表直接 alembic upgrade，老数据不回填。

## 3. 非目标（Non-Goals）

- **NG-1**：不改 `serializeForSync()` body 结构（workspace 不进 body，走 token 派生）。
- **NG-2**：不改契约 §3（changes 行字段集保持）；仅补 workspace 隔离新章节。
- **NG-3**：不做 push 时回写 changes 表缓存（用实时 join，避免双写一致性）。
- **NG-4**：不顺带修 mcp 段同源假设坑（connect 把 shk_live_ 复用进 mcp 段，但真 McpToken 是 shmcp_）——留单独 change。
- **NG-5**：不实现 `/api/changes/{name}/documents`、`/api/changes/{name}/approval` 无前缀端点（沿用 sillyhub-platform-sync NG-7 预存缺口）。
- **NG-6**：不做字段级 auto-merge（沿用契约 §9 D-002）。
- **NG-7**：不做 platform sync token 管理 UI（端点签发即可，UI 后续补）。
- **NG-8**：不动 sillyspec 仓 `src/sillyhub-mcp/` 派发层（契约 D-004 铁律）。
- **NG-9**：不做 status 字段投影（D-004@v2，仅投 current_stage；status 由变更中心派生）。

## 4. 拆分判断

**单一 change + Wave 分组**。理由：投影 + workspace 隔离 + token + 下发是一个逻辑闭环——投影依赖隔离，隔离依赖 token，token 依赖下发。拆多 change 割裂依赖链。Wave 串行化内部依赖（W1 数据层 → W2 token 鉴权 → W3 收件箱隔离 → W4 投影层 → W5 connect 下发 + 契约 → W6 gen:types/测试/收尾）。

## 5. 总体方案

### 5.1 架构（workspace 隔离 + 实时投影数据流）

```
平台初始化工作区 / 用户 connect 时（一次性换发，带权限校验）：
  sillyspec platform connect <url> <user级shk_live_ token>
     │  读本地 root_path
     ▼
  POST /api/workspaces/resolve-by-root-path  {root_path}
     │  鉴权=现有 shk_live_ (ApiKeyService) 或 JWT
     │  反查 workspace (_find_active_by_root_path) → 反查不到 404
     │  ★校验调用者对该 workspace 有 WORKSPACE_WRITE（复用 mcp-tokens
     │    权限模型，Grill X4）→ 无权限 403
     │  签发 shpsync_ token → 存 platform_sync_tokens(token_hash, workspace_id, created_by)
     ▼
  返回 {workspace_id, token(shpsync_明文)}
     │  connect 用 replaceTopLevelSection 写 local.yaml platform 段（保留注释）
     ▼
  local.yaml.platform.token = shpsync_...  （workspace-scoped）

工具每次 sync（push）：
  sillyspec sync → POST /api/changes/{name}/progress
     │  Authorization: Bearer shpsync_...
     ▼
  require_platform_sync → PlatformSyncTokenService.authenticate
     │  按 token_hash 查 platform_sync_tokens → 派生 (user=created_by, workspace_id)
     ▼
  PlatformSyncService.upsert_progress(workspace_id, name, body, ...)
     │  存 platform_change_progress (workspace_id, change_name, latest_progress, ...)

变更中心查询（实时投影，仅 current_stage）：
  GET /api/workspaces/{wid}/changes
     │  require_permission(登录用户, wid)
     ▼
  ChangeService.enrich_summaries(changes)   # list：批量 IN join
     │  select ... where workspace_id=? and change_name in (<change_keys>)
     │  取 latest_progress.changes[0].current_stage → 覆盖猜值
     │  join 不到 → fallback changes 表现有值
     ▼
  ChangeSummary（current_stage 已权威化）→ 前端零改展示
```

### 5.2 七 Phase

- **P1 数据层**：新表 `platform_sync_tokens` + `platform_change_progress` 加 workspace_id + 复合唯一 + migration。
- **P2 token 签发鉴权**：`POST /workspaces/{wid}/platform-sync-tokens` 签发 + `require_platform_sync` 派生 workspace（shk_live_ 过渡保留）。
- **P3 收件箱隔离**：`upsert_progress`/`list_lightweight`/`get_progress` 全加 workspace_id 过滤，upsert 键改 `(workspace_id, change_name)`。
- **P4 投影层**：change 模块 enrich 实时 join（仅 current_stage）+ fallback。
- **P5 connect 下发**（跨仓 sillyspec）：`resolve-by-root-path` 端点（带 WORKSPACE_WRITE 校验）+ connect 换发 + replaceTopLevelSection 写入。
- **P6 契约补章**：sillyhub-progress-sync-contract.md 补 workspace 隔离章节。
- **P7 gen:types + 测试**：openapi 同步 + 各模块 pytest + connect 联调。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明（含字段数据流） |
|---|---|---|
| 新增 | backend/app/modules/platform_sync/token_model.py | `PlatformSyncTokenORM` 字段集见 §8.1（参照 McpToken+ApiKey，Grill X1 校准）。 |
| 新增 | backend/app/modules/platform_sync/token_service.py | `PlatformSyncTokenService.create()`（shpsync_+secrets.token_urlsafe(32)，存 sha256）/`authenticate()`（按 hash 查→派生 user=created_by, workspace_id）。 |
| 新增 | backend/app/modules/platform_sync/workspace_router.py | 新端点专用 router（prefix="/workspaces"，Grill X6：与无前缀 /changes router 分离）：`POST /{wid}/platform-sync-tokens` + `POST /resolve-by-root-path`。 |
| 新增 | backend/migrations/versions/20260811150000_platform_sync_workspace.py | 建 platform_sync_tokens 表 + platform_change_progress 加 workspace_id 列 + 复合唯一索引。棕地免回填（规则 7）。 |
| 修改 | backend/app/modules/platform_sync/model.py | `PlatformChangeProgressORM` 加 `workspace_id` 列；PK 改复合 `(workspace_id, change_name)`。 |
| 修改 | backend/app/modules/platform_sync/auth.py | `require_platform_sync` 返回 `tuple[User, workspace_id\|None]`；shpsync_ 走 `PlatformSyncTokenService.authenticate` 派生（user=token.created_by FK）；shk_live_ 过渡保留（workspace_id=None）。**数据流：workspace_id producer=platform_sync_tokens.workspace_id → authenticate 派生 → router 注入 → service 写 platform_change_progress.workspace_id**。 |
| 修改 | backend/app/modules/platform_sync/service.py | `upsert_progress(workspace_id, name, ...)`/`list_lightweight(workspace_id)`/`get_progress(workspace_id, name)` 全加 workspace_id 参数 + where 过滤；upsert 键改复合。 |
| 修改 | backend/app/modules/platform_sync/router.py | 收件箱 3 端点（无前缀 inline /changes）从 auth 取 workspace_id 传 service。 |
| 修改 | backend/app/modules/platform_sync/schema.py | **新增**（Grill X5）：`PlatformSyncTokenCreated`（201 响应 DTO 含明文 token）+ `ResolveByRootPathReq`（body root_path）+ `ResolveByRootPathResp`（workspace_id+token）Pydantic 模型。 |
| 修改 | backend/app/main.py | import workspace_router 并 `include_router` 注册（参照 :47/:580 platform_sync_router 的 prefix=/api 模式），否则新建 workspace_router 端点不可达。 |
| 修改 | backend/conftest.py | 根 conftest `db_engine` 补 `import llm_provider model`（agent-profile-bind-llm-provider 落地后遗留的预存测试债：agent_profiles.llm_provider_id FK→llm_providers.id，根 create_all 报 NoReferencedTableError 阻断所有 db_engine 测试）。task-07 顺手补（CLAUDE.md 规则 20「gen:types 暴露预存测试债顺手补」同源思路），让 platform_sync 子模块测试可跑。 |
| 修改 | backend/app/modules/change/service.py | `enrich_summaries`（**list**：批量 `IN` join）+ `enrich_with_workspace_ids`（**single**：`=` 匹配，Grill X7 分述）。**数据流：current_stage producer=工具 serializeForSync(latest_progress.changes[0]) → 存 platform_change_progress.latest_progress JSON → enrich join 读 → 覆盖 ChangeSummary.current_stage → consumer=前端 changes/page.tsx:250 展示**；join 不到 fallback 现有值。 |
| 新增 | backend/app/modules/change/tests/conftest.py | 参照 `platform_sync/tests/conftest.py:20-29` 模式 import 注册 `PlatformChangeProgressORM` 表并单独 `create`（根 conftest db_engine 不含该 model 故根 create_all 不建表），供 enrich join 测试用。 |
| 修改 | sillyspec/src/sync.js | connect 扩展：调 resolve-by-root-path 换发 shpsync_ token，replaceTopLevelSection 写入 platform 段。**跨仓**。 |
| 修改 | sillyspec/docs/sillyspec/sillyhub-progress-sync-contract.md | 补「§14 workspace 隔离」章节：token 派生 + 新签发端点 + connect 换发 + 权限校验；§3 body 不变。**跨仓**。 |
| 生成 | frontend/src/lib/api-types.ts | `pnpm gen:types` 同步新端点 schema（禁止手写，规则 20）。 |
| 生成 | backend/openapi.json | `pnpm gen:types` 同步新端点 schema。 |

## 7. 接口定义

```
# 新：签发 workspace-scoped platform sync token（workspace 成员，WORKSPACE_WRITE）
POST /api/workspaces/{workspace_id}/platform-sync-tokens
  鉴权: 登录用户 require_permission(WORKSPACE_WRITE)
  → 201 { id, workspace_id, key_prefix, token: "shpsync_...", created_at }  # 明文仅一次

# 新：connect 换发（带 workspace 权限校验，Grill X4 安全闭环）
POST /api/workspaces/resolve-by-root-path
  鉴权: Bearer shk_live_ (ApiKeyService) 或 JWT
  body: { root_path: str }
  流程: ①反查 workspace (_find_active_by_root_path) → 反查不到 404
        ②★校验调用者对该 workspace 有 WORKSPACE_WRITE（复用 mcp-tokens 权限
          模型）→ 无权限 403
        ③签发 shpsync_ token（created_by=调用者, workspace_id=反查到的 wid）
  → 200 { workspace_id, token: "shpsync_..." }

# 改：3 个收件箱端点鉴权升级（shpsync_ 派生 workspace，无前缀 router 不变）
POST /api/changes/{name}/progress       # router 从 auth 取 workspace_id 传 upsert
GET  /api/changes                       # list_lightweight(workspace_id)
GET  /api/changes/{name}/progress       # get_progress(workspace_id, name)

# 改：投影（change 模块，read-only，仅 current_stage）
ChangeService.enrich_summaries(changes) -> list[ChangeSummary]
  # list：一次 select where workspace_id=? and change_name in (...)，禁 N+1
ChangeService.enrich_with_workspace_ids(change) -> ChangeRead
  # single：select where workspace_id=? and change_name=change_key（= 匹配）
```

`require_platform_sync` 新签名：返回 `tuple[User, uuid.UUID | None]`（workspace_id；shk_live_ 过渡期 None，shpsync_ 派生非 None）。返回的 `User` 来源 = `platform_sync_tokens.created_by` FK。

## 7.5 生命周期契约表

**生命周期契约：不适用（N/A）**。本变更只读投影 current_stage（从收件箱读、覆盖到展示 DTO），不触碰 stage 流转、lease、session、agent_run、daemon、claim、heartbeat 等任何生命周期事件——stage 实际推进仍由 sillyspec 工具 + 既有 change/transition/complete_stage 链路负责。require_platform_sync 改返回值只影响 platform_sync 模块内部（Grill 核实 3 端点全在该模块内，无外部 lifecycle 消费方）。故不适用 lifecycle contract。

## 8. 数据模型

### 8.1 新表 `platform_sync_tokens`（参照 McpToken + ApiKey 字段集，Grill X1/X2 校准）

> 字段集参照 `mcp_gateway McpTokenORM`（workspace_id/token_hash/scope/created_by/created_at/revoked_at/last_used_at）+ `auth ApiKey`（name）。**不含 key_prefix/expires_at**（McpToken 无此二列；如需展示前缀可后续加，非必需）。

| 列 | 类型 | 约束 |
|---|---|---|
| id | Uuid | PK |
| workspace_id | Uuid | FK workspaces.id ON DELETE CASCADE, NOT NULL |
| created_by | Uuid | FK users.id, NOT NULL（authenticate 派生 User 的来源） |
| name | String(100) | NOT NULL |
| token_hash | String(255) | UNIQUE NOT NULL（存 sha256(明文)） |
| scope | JSON | nullable（预留） |
| last_used_at | DateTime(tz) | nullable |
| revoked_at | DateTime(tz) | nullable |
| created_at | DateTime(tz) | NOT NULL |

### 8.2 `platform_change_progress` 改造

- 加 `workspace_id: Uuid` 列（FK workspaces.id ON DELETE CASCADE）。
- PK 从 `change_name` 改为复合 `(workspace_id, change_name)`。
- 老数据：规则 7 可清空，migration 直接加列（老行 workspace_id 允许 NULL，投影 join 不命中走 fallback；或重置库）。

### 8.3 status 词表（实测）与投影策略（D-004@v2）

sillyspec `changes.status` 实测**仅 `active` / `archived` 两值**（sillyspec 仓 progress.js:222 / change-registry.js:18,241 / doctor-diagnostics.js:102），非 design 初稿假设的 `in_progress`/`completed`/`blocked`。

**D-004@v2 撤销 status 投影**：archived 由 `current_stage==archive` 派生（前端 changes/page.tsx:240 现有逻辑），active 对应当前 stage 进行中态。status 字段维持变更中心现有派生，不从同步层读。投影层只覆盖 current_stage。

## 9. 兼容策略（brownfield）

- **规则 7 可清空**：新表/新列直接 alembic upgrade，老 platform_change_progress 行不回填（workspace_id NULL 或重置）。
- **shk_live_ 过渡期**：`require_platform_sync` 保留 shk_live_ 识别（workspace_id=None），connect 换发跑通后再砍（R-02）。过渡期内 shk_live_ 上行数据 workspace_id=NULL，投影 join 不命中走 fallback，不崩。
- **工具未上行的 change**：join 不到 → fallback changes 表现有 current_stage（reparse 猜值/agent 写值），未接入工具的 workspace 行为不变。
- **quick-\<uuid8\> change**（Grill X9）：quick 模式不建目录（sillyspec progress.js:827），平台 parser 扫不到 → join 不命中 → fallback 现有值（预期行为，非缺陷）。
- **不动既有 `/api/workspaces/{wid}/changes/*` 端点**（contract D-004）：只改 enrich 内部 join，端点签名/响应形态不变。
- **前端零改**：ChangeSummary 字段语义不变，仅 current_stage 值变权威。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `change_key == change_name` 命名一致性（join 前提） | P1 | Grill 已核实同源（parser.py:462 目录名 vs 工具 changeName）；加 join 不命中日志，不命中 fallback |
| R-02 | shk_live_ 过渡期 workspace_id=None 数据混入 | P2 | 过渡期短；NULL 行投影不命中走 fallback；砍除后清理 |
| R-03 | enrich join 性能（N+1） | P1 | list 批量 IN join（一次查询）；single = 匹配（Grill X7 分述）；禁逐行 |
| R-04 | ~~status 枚举映射不全~~ → **已移除**（D-004@v2 撤 status 投影） | — | 不再投 status，无映射风险 |
| R-05 | connect 跨仓协调（sillyspec 仓 sync.js 改动） | P2 | sync.js 改动小（仅 connect 扩展）；跨仓同步；工具侧 mock 测试沿用 sillyhub-platform-sync 模式 |
| R-06 | 本机 platform sync POST 端点返 500（brainstorm 期间实测） | P1 | 排查方向（Grill X8）：①用 curl 复现拿 FastAPI 异常堆栈/request_id ②查是 platform_sync 路由/鉴权 bug、还是本机 backend 环境（DB 迁移未跑/uvicorn 未重载）③查 backend 日志；修后再联调 |
| R-07 | resolve-by-root-path 反查不到 workspace（root_path 未绑） | P2 | 端点返 404 + 提示先在平台绑定工作区；connect 降级提示 |
| R-08 | ~~resolve-by-root-path 权限洞~~ → **已闭环**（Grill X4） | P0→闭环 | 端点校验调用者对反查 workspace 有 WORKSPACE_WRITE（复用 mcp-tokens 权限），否则 403；design §7 已纳入 |

## 11. 决策追踪

| 决策 ID | 标题 | 覆盖 |
|---|---|---|
| D-001@v1 | workspace 归属 = workspace-scoped token 派生（参照 McpToken 模式） | G2 / FR-01 / §5 / §7 / §8.1 |
| D-002@v1 | 投影 = 实时 read-only join（不双写 changes 表） | G1 / FR-04 / §5.1 / §9 |
| D-003@v1 | 冲突以工具上行为准 + 未上行 fallback 现有值 | G4 / FR-05 / §9 |
| D-004@v2 | **撤销 status 投影**（supersedes D-004@v1「status 覆盖+枚举映射」；Grill X3 实测 sillyspec status 仅 active/archived，archived 由 current_stage 派生） | G5 / NG-9 / §8.3 |
| D-005@v1 | 新建平台→local.yaml 下发通道（扩展 connect，文本级段替换 writer） | G3 / FR-03 / §5 / §6 |
| D-006@v1 | resolve-by-root-path 权限校验 = 复用 mcp-tokens WORKSPACE_WRITE（Grill X4 安全洞闭环） | G3 / FR-03 / §7 / R-08 |

## 12. 自审

- ✅ 必填章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/风险登记/数据模型/兼容策略/决策追踪/自审）。
- ✅ 文件变更清单含字段数据流标注（workspace_id 链、current_stage 链；status 链已随 D-004@v2 移除）。
- ✅ §7.5 紧邻「生命周期契约」写明豁免（N/A）。
- ✅ Grill 10 项已处理：X4→D-006@v1（§7 权限校验）、X3→D-004@v2（撤 status）、X1/X2→§8.1 字段集校准+created_by、X5→§6 补 schema.py、X6→workspace_router.py 独立前缀、X7→§6/§7 enrich 分述、X9→§9 quick-uuid 声明、X10→§1.2 注脚、X8→R-06 排查方向。
- ✅ decisions.md D-001~D-006 已建，design §11 引用全部当前版本决策。
- ✅ scale=large，走四件套 + Design Grill independent（review.json 已产）。
- ⚠️ 自审存疑：R-06 本机 500 为 execute 前置排查项（已给方向），不影响 design 成立性。
- ✅ verify Reverse Sync：task-07 顺手补的根 `backend/conftest.py`（import llm_provider model，修 agent-profile-bind-llm-provider 遗留预存债，CLAUDE.md 规则 20 同源）补入 §6 文件清单——execute 实现合理但 design 初稿漏列，verify 据实补全。
