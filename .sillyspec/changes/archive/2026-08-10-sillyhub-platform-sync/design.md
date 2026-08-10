---
author: qinyi
created_at: 2026-08-10 23:22:56
scale: medium
related_contract: sillyspec 仓 docs/sillyspec/sillyhub-progress-sync-contract.md（跨仓契约，存于 sillyspec 仓，multi-agent-platform 仓无副本；§13 清单摘录见本设计 §10.1）
---

# 设计文档（Design）— SillyHub 后端实现 SillySpec 进度同步层

> **跨仓契约依据**：本设计依据 sillyspec 仓的 `docs/sillyspec/sillyhub-progress-sync-contract.md`（下称「契约」——这是**跨仓契约**，存于 `C:\Users\qinyi\IdeaProjects\sillyspec\docs\sillyspec\`，multi-agent-platform 仓无副本）+ 客户端真实调用源码 `sillyspec/src/sync.js`。契约状态 `client-landed-backend-pending`——客户端全链路已落地并经 71 断言 mock 测试固化，SillyHub 后端为本变更实现对象。本设计与契约 §9「派发层」克制清单完全正交（契约 design D-004 铁律：进度同步不碰派发层）。契约 §13 校验清单 8 项已逐字摘录到本设计 §10.1，可独立核对（不依赖跨仓文件路径解析）。

## 1. 背景

SillySpec 是单人命令行工具，各用户本地各有进度库 `sillyspec.db`（better-sqlite3 WAL，gitignored，互不可见）。SillySpec 客户端已实现一套**进度同步层**（源码 `sillyspec/src/sync.js`）：把本地进度序列化成 JSON 投影，HTTP 上行到 SillyHub 聚合、下行 import 重建本地。**同步对象是进度状态 JSON，不是代码、不是 .db 文件**。SillyHub 是权威聚合点。

客户端侧（`SyncManager`）已固化以下真实调用（`sync.js` 权威行号）：

| 客户端方法 | HTTP | URL（`platform.url` + 路径） | 鉴权 | 关键行为 |
|---|---|---|---|---|
| `connect` | GET | `/api/health` | 无（验证连通） | `sync.js:204` |
| `sync`（push） | POST | `/api/changes/{name}/progress` | `Authorization: Bearer <token>` + 3 个 `X-SillySpec-*` header | body=裸六表 JSON；读 409 冲突 `sync.js:305-329` |
| `syncDocuments` | POST | `/api/changes/{name}/documents` | Bearer | `sync.js:389`（**预存缺口**：backend 无此无前缀端点，范围外） |
| `checkApproval` | GET | `/api/changes/{name}/approval` | Bearer | `sync.js:424`（**预存缺口**：backend 无此无前缀端点，范围外） |
| `pullList` | GET | `/api/changes` | Bearer | 轻量列表 `sync.js:543` |
| `pull` | GET | `/api/changes/{name}/progress` | Bearer | 完整 JSON 下行 `sync.js:581` |

**三个待实现端点**（契约 §1）：① POST progress 增强（读 header + base_ts 冲突检测）② GET `/api/changes` 轻量列表 ③ GET 单 change progress。`/api/health` 已存在不动；`/api/changes/{name}/documents`、`/api/changes/{name}/approval` 的无前缀路径在 backend 当前**不存在**（client↔backend 预存缺口；契约 §1「已有不动」系从客户端视角的误述）——本变更范围外，client syncDocuments/checkApproval 暂仍 404，留后续 change 补齐（NG-7）。

### 1.1 关键事实（已查证）

- 现有 SillyHub change 端点是 `/api/workspaces/{workspace_id}/changes/{change_key}/progress`（`backend/app/modules/change/router.py:381`，router prefix `/workspaces/{workspace_id}` + main 挂 `/api`），走登录用户 `require_permission(CHANGE_CREATE)`，body 是 `ProgressUpdate`（currentStage/stages/lastActive）。**与契约要的 `/api/changes/{name}/progress` 是两套不同系统**：路径（无 workspace 前缀）、寻址（change **name** 字符串 vs uuid change_key）、鉴权（Bearer token vs 登录用户权限）、body（裸六表 JSON vs ProgressUpdate）。契约 §1「现有端点需增强」系误导表述，SillyHub 侧实为**全新实现**，不碰现有 `/workspaces/{wid}/changes/*`（契约 D-004）。
- SillyHub 鉴权基建（`backend/app/core/auth_deps.py`）已有双路径：`Authorization: Bearer <jwt>`（`get_current_user`）+ `X-API-Key: <shk_live_…>`（`ApiKeyService.authenticate`，长生命周期，绑定 User）。客户端固化为 `Authorization: Bearer`（`sync.js:296`），故后端必须接受该形态。
- `/api/health` 已无鉴权公开（`backend/app/modules/health/router.py`），客户端 `connect` 不带 auth header 验证连通——已满足，不动。
- **documents/approval 预存缺口**（已查证，对应 B-002）：客户端 `syncDocuments`/`checkApproval` 调 `/api/changes/{name}/documents`、`/api/changes/{name}/approval`（`sync.js:389/424`），但 backend 现存的是 workspace 前缀版 `/api/workspaces/{wid}/changes/{change_key}/{documents,approval}`（`change/router.py:450/403` + `openapi.json:3470/3294`），无前缀路径不存在。契约 §1「已有不动」系从客户端视角的误述。本变更只做 progress 3 端点，documents/approval 留后续 change（NG-7）。

### 1.2 关键复用点（降低工作量）

- `ApiKeyService`（`backend/app/modules/auth/api_key_service.py`）：长生命周期 key 签发/校验/吊销 + Redis 缓存。本变更**复用**它做 platform.token 鉴权（platform.token = 一个 SillyHub API Key），不新建 token 体系。
- 现有 alembic 迁移惯例（`op.create_table` dialect 无关让 SQLite 测试与 PG 生产对齐；当前 head 单一 `202608091100`，无需多 head 合并）。
- 现有 router 挂载惯例（main.py `include_router(..., prefix="/api")`）。

## 2. 设计目标

- **G1**：实现契约 §1 三个端点（POST progress 增强 + GET 列表 + GET 单 change），响应形态严格对齐契约 §4.4/§5/§6（客户端兼容两种形态，本设计选**裸形态**：列表裸数组、单 change 裸六表 + 顶层 `last_pushed_at`）。
- **G2**：POST 读 3 个 `X-SillySpec-*` header（User/Base-Ts/Pushed-At），实现契约 §4.2 base_ts 乐观锁冲突检测（`stored > baseTs` 字典序比对 → 409）。
- **G3**：409 响应体含 `{conflict:true, platform_progress:<完整六表>, last_pushed_at}`，`platform_progress` 必须是完整的 `serializeForSync` 六表 JSON，可被客户端 `resolve --take-platform` 直接 import（契约 §4.4 硬要求）。
- **G4**：鉴权 = `Authorization: Bearer`，复用 API Key（`shk_live_` 前缀走 `ApiKeyService.authenticate`，否则回退 JWT）。platform sync 端点只验 token 合法，**不做 workspace 权限检查**（平台级聚合，无 workspace 语义）。
- **G5**：时间戳比对用 ISO 8601 UTC **字符串字典序**（契约 §7，不转 Date 对象，避免时区/精度误判）。
- **G6**：零回归——老 body（裸 JSON 无 header）继续可解析；客户端老版不发 header → base_ts 视为空 → 接受（等同首次同步）；GET 端点不存在时客户端 `fetchJson` 返回 null 降级不阻断（契约 §8/§10）。
- **G7**：不实现字段级 auto-merge（契约 §9 D-002），冲突就是冲突，返回 409 让客户端 human-in-loop。

## 3. 非目标（Non-Goals）

- **NG-1**：不做 platform.token 签发/管理 UI。token 复用现有 API Key 体系（admin 已有签发/吊销 UI），本变更只在 docs 说明 platform.token = API Key。
- **NG-2**：不做字段级 auto-merge（契约 §9）。
- **NG-3**：不做实时推送（WebSocket/SSE）、分布式锁、连客户端 SQLite。
- **NG-4**：不碰派发层（`create_mission`/`dispatch_worker`/`converge_mission`，契约 D-004/path-a 契约范畴）。
- **NG-5**：不做 change name 跨项目去重（契约 §3 按 name 全局聚合；多项目同名风险见 R-01，契约未要求处理）。
- **NG-6**：不把 `serializeForSync` 六表结构强类型化进后端 schema——按裸 JSON 存储透传（契约 §3「sillyhub 存储时按裸 JSON 存即可，无需理解六表内部结构」），避免与客户端六表演进耦合。
- **NG-7**：不实现 `/api/changes/{name}/documents`、`/api/changes/{name}/approval` 的无前缀端点（client↔backend 预存缺口，§1.1 已查证）。本变更只做 progress 3 端点，documents/approval 留后续 change。

## 4. 拆分判断

**单一 change + Wave 分组**。理由：3 端点 + 鉴权 + 存储 + 冲突算法是一个逻辑整体（端点依赖鉴权依赖，鉴权依赖存储），拆多 change 割裂依赖。Wave 串行化内部依赖（W1 存储 → W2 鉴权 → W3 业务 → W4 端点 → W5 测试 → W6 收尾），Wave 内任务并行度低（线性依赖链），逐 task 实现更清晰。

## 5. 总体方案

### 5.1 架构

```
SillySpec 客户端(sync.js,各用户本地)
   │ ① Authorization: Bearer <API Key(shk_live_)>  +  X-SillySpec-{User,Base-Ts,Pushed-At}
   ▼
┌──────────────────────────────────────────────────────────┐
│ backend FastAPI  /api/changes/...                         │
│                                                           │
│  POST /changes/{name}/progress                            │
│    ├ require_platform_sync (Bearer=shk_live_ APIKey优先   │
│    │                        /JWT回退, 不查workspace权限)    │
│    ├ 读 3 个 X-SillySpec-* header                         │
│    ├ PlatformSyncService.upsert_progress:                 │
│    │    base_ts 字典序 §4.2 → 200 | 409{conflict,         │
│    │    platform_progress, last_pushed_at}                │
│    └ 存 platform_change_progress (latest_progress JSON +  │
│       last_pushed_at + last_pusher)                       │
│                                                           │
│  GET /changes → [{name,current_stage,last_pushed_at,      │
│                   last_pusher}]  (轻量列表)                │
│  GET /changes/{name}/progress → 完整六表 + 顶层            │
│                                  last_pushed_at           │
└──────────────────────────────────────────────────────────┘
   独立于 /api/workspaces/{wid}/changes/* (契约 D-004 互不干涉)
```

### 5.2 Phase 拆分

#### Phase 1 · 数据地基（D-003）
新建 `backend/app/modules/platform_sync/model.py` 定义 `PlatformChangeProgressORM`（change_name PK + latest_progress JSON + last_pushed_at + last_pusher + updated_at）。alembic 迁移建表，down_revision 对齐当前 head `202608091100`。dialect 无关 `op.create_table` 让 SQLite 测试与 PG 生产对齐。

#### Phase 2 · 鉴权依赖（D-002）
新建 `backend/app/modules/platform_sync/auth.py` 的 `require_platform_sync` 依赖：从 `Authorization: Bearer` 取 token，识别 `shk_live_` 前缀走 `ApiKeyService.authenticate`，否则回退 `get_current_user`（JWT）。不做 workspace 权限检查（平台级聚合无 workspace 语义）。鉴权失败 → 401。

#### Phase 3 · 业务 + schema（D-004/D-005/D-006）
新建 `service.py` 的 `PlatformSyncService`：
- `upsert_progress(name, body, base_ts, pushed_at, user)`：实现契约 §4.2 算法——base_ts 空/缺失 → 无条件接受；`stored_last_pushed_at > base_ts`（字典序）→ 冲突返回 409（含完整 `latest_progress`）；否则接受 upsert。
- `list_lightweight()`：返回 `[{name, current_stage, last_pushed_at, last_pusher}]`，`current_stage` 取自 `latest_progress.changes[0].current_stage`。
- `get_progress(name)`：返回 `latest_progress` + 顶层 `last_pushed_at`；不存在返回 None（router 层 404）。

新建 `schema.py`：请求/响应用 Pydantic v2。**裸六表用 `dict` 透传**（NG-6，不强类型化），冲突响应 `ConflictResponse(conflict: bool, platform_progress: dict, last_pushed_at: str | None)`，轻量列表项 `ChangeListItem(name, current_stage: str|None, last_pushed_at: str|None, last_pusher: str|None)`。

#### Phase 4 · 端点 + 挂载（D-001）
新建 `router.py`：3 端点，router 自带 `prefix="/changes"`，main 挂 `prefix="/api"` 落地 `/api/changes/...`。POST 读 3 个 `X-SillySpec-*` header（`request.headers.get(...)`，缺失/空均视为 None）。main.py 加 `app.include_router(platform_sync_router, prefix="/api", tags=["platform-sync"])`。

#### Phase 5 · 测试（覆盖契约 §13 校验清单）
新建 `tests/test_router.py` + `conftest.py`：覆盖契约 §13 全部 8 项 + §4.2 冲突算法 + §7 字典序 + §8 零回归 + §5/§6 响应形态。

#### Phase 6 · 收尾
`pnpm gen:types` 同步 `backend/openapi.json`（platform_sync 端点虽无前端消费，OpenAPI 须完整，CLAUDE.md 规则 20）；`.sillyspec/local.yaml` 的 `modules` 块补 platform_sync 的 test 配置（test_strategy=module 命中需要，R-02）；模块文档同步。

### 5.3 Wave 分组（plan 阶段细化）

| Wave | Phase | 内容 | 依赖 |
|---|---|---|---|
| W1 | P1 | `platform_change_progress` 表 + ORM + alembic 迁移 | 无（地基） |
| W2 | P2 | `require_platform_sync` 鉴权依赖 | W1（复用 session，不直接依赖表，逻辑上并列，归此 Wave） |
| W3 | P3 | `PlatformSyncService`（§4.2 冲突算法）+ schema | W1 |
| W4 | P4 | router 3 端点 + main 挂载 | W2+W3 |
| W5 | P5 | 测试（契约 §13 校验清单） | W4 |
| W6 | P6 | gen:types + local.yaml modules 补充 + 文档 | W5 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/platform_sync/__init__.py` | 模块初始化 |
| 新增 | `backend/app/modules/platform_sync/model.py` | `PlatformChangeProgressORM` |
| 新增 | `backend/app/modules/platform_sync/schema.py` | 请求/响应模型（裸六表 dict 透传 + ConflictResponse + ChangeListItem） |
| 新增 | `backend/app/modules/platform_sync/service.py` | `PlatformSyncService`（upsert_progress 冲突检测 + list_lightweight + get_progress） |
| 新增 | `backend/app/modules/platform_sync/auth.py` | `require_platform_sync` 依赖（Bearer=APIKey/JWT） |
| 新增 | `backend/app/modules/platform_sync/router.py` | 3 端点（POST progress / GET changes / GET changes/{name}/progress） |
| 修改 | `backend/app/main.py` | `include_router(platform_sync_router, prefix="/api", tags=["platform-sync"])` |
| 新增 | `backend/migrations/versions/20260810150000_create_platform_change_progress.py` | alembic：建 platform_change_progress 表 |
| 修改 | `backend/migrations/env.py` | autogenerate 模型导入列表加 `from app.modules.platform_sync import model`（env.py 注释「Add new modules here」，让 alembic autogenerate 识别新表） |
| 新增 | `backend/app/modules/platform_sync/tests/__init__.py` | 测试包初始化 |
| 新增 | `backend/app/modules/platform_sync/tests/conftest.py` | 测试 fixture（app/client/auth token） |
| 新增 | `backend/app/modules/platform_sync/tests/test_router.py` | 契约 §13 校验清单 8 项 + 冲突算法 + 零回归测试 |
| 修改 | `.sillyspec/local.yaml` | `modules` 块补 platform_sync 的 test 配置（R-02，test_strategy=module 命中需要） |
| 修改 | `backend/openapi.json` | gen:types 同步（platform_sync 端点 OpenAPI 完整） |
| 修改 | `frontend/src/lib/api-types.ts` | gen:types 生成（platform_sync 端点 `/api/changes*` 路径 + `ChangeListItem` 类型；CLAUDE.md 规则 20 类型同步，非前端业务消费） |
| 修改 | `.sillyspec/docs/multi-agent-platform/modules/backend.md` | 模块文档同步（platform_sync 子模块说明） |

> 本变更不改 `frontend/` **业务代码**（platform sync 端点无前端消费，仅 gen:types 同步 `api-types.ts` 类型，CLAUDE.md 规则 20）、不改 `sillyhub-daemon/`、不改现有 `change/router.py`（契约 D-004 互不干涉）。

## 7. 接口定义

### 7.1 `POST /api/changes/{name}/progress`（上行 + 冲突检测，契约 §4 核心）

```http
POST /api/changes/{name}/progress HTTP/1.1
Authorization: Bearer <API Key(shk_live_...) 或 JWT>
X-SillySpec-User: zhangsan                       # 可选，未配置时客户端不发
X-SillySpec-Base-Ts: 2026-08-10T13:00:00.000Z    # 可选，首次同步/无基准时整条 header 缺失
X-SillySpec-Pushed-At: 2026-08-10T14:30:00.000Z  # 推送时刻（客户端时钟）

<serializeForSync 裸六表 JSON 作为 body>
```

- **200 OkResponse**：任意 2xx，body 客户端不读。
- **409 ConflictResponse**（契约 §4.4）：
  ```json
  {"conflict": true, "platform_progress": {/*完整 latest_progress 六表*/}, "last_pushed_at": "2026-08-10T13:45:00.000Z"}
  ```
- **401**：token 非法/过期/吊销。

base_ts 冲突检测算法（契约 §4.2，`service.upsert_progress` 实现）：
```
baseTs = header X-SillySpec-Base-Ts  # 可能为 None/缺失
if baseTs 为空 or 缺失:  # 首次同步/客户端无基准 → 无条件接受
    存 latest_progress=body, last_pushed_at=Pushed-At, last_pusher=User → 200
stored = 该 change 已存 last_pushed_at
if stored 存在 AND stored > baseTs:  # 字符串字典序（ISO 8601 UTC，§7）→ 冲突
    → 409 {conflict:true, platform_progress: latest_progress, last_pushed_at: stored}
# base_ts 有效 → 接受
存 latest_progress=body, last_pushed_at=Pushed-At, last_pusher=User → 200
```

### 7.2 `GET /api/changes`（轻量列表，契约 §5）

```http
GET /api/changes
Authorization: Bearer <token>
```
响应（裸数组形态，客户端兼容 `{changes:[...]}` 包裹，本设计选裸数组）：
```json
[{"name": "2026-08-10-xxx", "current_stage": "execute", "last_pushed_at": "...", "last_pusher": "zhangsan"}]
```

### 7.3 `GET /api/changes/{name}/progress`（完整 JSON，契约 §6）

```http
GET /api/changes/{name}/progress
Authorization: Bearer <token>
```
响应（裸六表 + 顶层 `last_pushed_at`，客户端兼容 `{progress:{...}}` 包裹，本设计选裸形态）；不存在 → 404：
```json
{"project": {...}, "changes": [...], "stages": [...], "steps": [...], "batch_progress": [...], "approvals": [...], "last_pushed_at": "..."}
```

### 7.4 生命周期契约

本变更不涉及生命周期契约（无状态 HTTP 端点 + JSON 聚合存储，无 session/lease/agent_run 事件流、无状态机流转）。POST/GET 均为单次请求-响应，不涉及 long-running 生命周期管理。

## 8. 数据模型

### 8.1 新表 `platform_change_progress`

| 列 | 类型 | 说明 |
|---|---|---|
| change_name | String PK | SillySpec change name（如 `2026-08-10-xxx`），契约 §3 按 name 寻址 |
| latest_progress | JSON | `serializeForSync` 裸六表 JSON 透传（NG-6 不强类型化） |
| last_pushed_at | String(64) nullable | 上次接受的 `X-SillySpec-Pushed-At`（ISO 8601 UTC 字符串，作下次冲突比对基准） |
| last_pusher | String(255) nullable | 上次推送者（`X-SillySpec-User`，缺失为 NULL） |
| updated_at | DateTime(timezone=True) | 服务端落库时刻（`server_default=now()`），审计用 |

索引：`change_name` PK 自带；按 name 查询为主，无需额外索引（聚合表行数有限）。

> `last_pushed_at` / `last_pusher` 用 `String` 而非 `DateTime`：契约 §7 明确比对用**字符串字典序**，存字符串避免读写时区/精度转换。`updated_at` 是服务端审计字段（非比对基准），用 `DateTime(timezone=True)`。

### 8.2 alembic 迁移

`20260810150000_create_platform_change_progress.py`：`op.create_table` 建 `platform_change_progress`，down_revision=`202608091100`（当前 head）。本项目未上线，无需历史数据回填（CLAUDE.md 规则 11）。`upgrade`/`downgrade` 完全对称（create/drop）。

## 9. 兼容策略（零回归，对照契约 §8）

> 零回归对象限定到：现有 `/api/workspaces/{wid}/changes/*` 路由 + 本变更新 3 端点。`/api/changes/{name}/documents`、`/api/changes/{name}/approval` 无前缀路径是 client↔backend 预存缺口（NG-7），不在零回归对象内（无现存物可回归）。

| 场景 | 要求 | 实现 |
|---|---|---|
| 老 body（裸 JSON 无 header）继续可解析 | POST body 是裸 JSON，无 header 也存 | schema 用 `dict` 接收 body，header 全可选 |
| 客户端老版不发 header | base_ts 视为空 → 接受（等同首次） | `header.get(...)` 缺失/空均 None → §4.2 首次分支 |
| GET 端点不存在（未升级） | 客户端 fetchJson 返回 null 降级 | 客户端侧行为，后端实现后即存在 |
| 首次同步 Base-Ts 缺失 | 当「无基准」接受 | §4.2 baseTs 空/缺失分支 |
| 与现有 `/workspaces/{wid}/changes/*` 路径 | 不冲突 | 新 router `/api/changes/...` 无 workspace 段，FastAPI 路由匹配不冲突（D-004） |

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | change name 全局唯一聚合，多项目/多仓库同名 change 会互相覆盖 | P2 | 契约 §3 按 name 寻址未要求处理；本次按 name 聚合，design NG-5 写明，留后续 change（按 project/origin 隔离） |
| R-02 | `.sillyspec/local.yaml` 的 `modules` 块未配 platform_sync（现有 12 条唯独缺它），新模块命中后 verify 无 test 命令 | P1 | P6 在 local.yaml `modules` 块补 `platform_sync: {path, test}`（test_strategy=module 命中需要） |
| R-03 | API Key 持有者（User）login_disabled/deleted 后 platform sync 鉴权失败 | P2 | `ApiKeyService.authenticate` 已检查 owner-disabled；行为正确（key 失效即拒），文档说明 |
| R-04 | 字典序比对前提：`last_pushed_at` 必须是同格式 ISO 8601 UTC | P1 | 后端只存客户端 `X-SillySpec-Pushed-At`（客户端 `new Date().toISOString()` 统一格式），不自行生成比对基准；§7 注明 |
| R-05 | pre-commit hook 跑 mypy（非只 ruff），裸 `dict` body 可能触发 mypy 类型提示缺失 | P2 | schema 用 `dict[str, Any]` 显式标注；execute 阶段 ruff format + mypy 双过 |
| R-06 | gen:types 暴露无关旧测试债 | P2 | 按 CLAUDE.md 规则 20 惯例，顺手补字段而非躲报错 |

### 10.1 契约 §13 校验清单（sillyhub 侧落地后，逐字摘录自跨仓契约）

- [ ] POST `/api/changes/{name}/progress` 读 `X-SillySpec-User` / `X-SillySpec-Base-Ts` / `X-SillySpec-Pushed-At` 三个 header
- [ ] base_ts 冲突检测算法（契约 §4.2）：缺 header / baseTs 空 → 接受；`stored > baseTs` → 409
- [ ] 409 响应体含 `{conflict:true, platform_progress:<完整六表>, last_pushed_at}`，`platform_progress` 可被 `resolve --take-platform` 直接 import
- [ ] GET `/api/changes` 返回轻量列表（裸数组 or `{changes:[...]}`），每项含 `name`/`current_stage`/`last_pushed_at`/`last_pusher`
- [ ] GET `/api/changes/{name}/progress` 返回完整六表 + 顶层 `last_pushed_at`（裸 or `{progress:{...}}` 包裹）
- [ ] 时间戳比对用 ISO 8601 UTC 字符串字典序（契约 §7）
- [ ] 老 body（裸 JSON 无 header）继续可解析（零回归）
- [ ] 不实现字段级 auto-merge（契约 §9）

> 本设计 §7 接口定义 + §5.2 P3 冲突算法 + §5.2 P5 测试计划 覆盖以上 8 项（task-07 逐条测）。

## 11. 决策追踪

| 决策 | 内容 | 覆盖章节 / FR |
|---|---|---|
| D-001@v1 | 端点路径 `/api/changes/{name}/progress`，无 workspace 前缀，按 change name 寻址 | §5.2 P4, §7 / FR-01 |
| D-002@v1 | 鉴权复用 API Key（`shk_live_`），Bearer=APIKey 优先/JWT 回退，不做 workspace 权限检查 | §5.2 P2, §1.2 / FR-02 |
| D-003@v1 | 存储新建独立表 `platform_change_progress`，不混入 workspace-scoped Change 表 | §5.2 P1, §8.1 / FR-03 |
| D-004@v1 | base_ts 冲突检测用 ISO 8601 UTC 字符串字典序比对 | §5.2 P3, §7.1, R-04 / FR-04 |
| D-005@v1 | 元字段（user/base_ts/pushed_at）走 HTTP header，body 保持裸 JSON（零回归） | §5.2 P4, §9 / FR-05 |
| D-006@v1 | 不做字段级 auto-merge，冲突 409 让客户端 human-in-loop | §3 NG-2, §7.1 / FR-06 |
| D-007@v1 | GET 响应选裸形态（列表裸数组 / 单 change 裸六表 + 顶层 last_pushed_at） | §7.2, §7.3 / FR-07 |
| D-008@v1 | change name 全局唯一聚合（不按 project/workspace 隔离） | §3 NG-5, R-01 / FR-08 |

所有 D-xxx@v1 已被设计章节覆盖，无未解决项。

## 12. 自审（Self-Review）

- ✅ 必填章节齐全：背景(§1)/设计目标(§2)/非目标(§3)/总体方案(§5)/文件变更清单(§6)/接口定义(§7)/数据模型(§8)/兼容策略(§9)/风险登记(§10)/决策追踪(§11)。
- ✅ 生命周期契约：§7.4 明确「不涉及」（无状态 HTTP + JSON 聚合，无 session/lease/agent_run 事件流）。
- ✅ 所有 D-001@v1~D-008@v1 被 §5/§7/§8 覆盖，无悬空决策。
- ✅ 与契约 §1 端点表、§4.2 算法、§4.4 响应、§5/§6 形态、§7 比对、§8 零回归、§9 克制清单逐条对齐（§13 清单摘录见 §10.1）。
- ✅ Design Grill 独立审查（step7）发现的 4 项已修正：B-001 契约跨仓路径明确化 + §13 清单摘录（§10.1）；B-002 documents/approval「已有不动」虚假声明改为预存缺口（§1 表/§1/§1.1/NG-7/§9）；B-003 R-02 措辞修正（§10）；B-004 D-002 evidence 待 decisions.md 澄清（get_current_principal 不接受 Bearer=APIKey，require_platform_sync 是新逻辑）。
- ⚠️ 自审存疑：R-01（change name 全局唯一多项目同名）本次不解决，需后续 change；R-02（local.yaml modules 块）P6 处理。两者均不阻断本变更。
- ✅ YAGNI：不复用不新建（API Key 复用、不新建 token 表、不强类型化六表），无过度设计。
