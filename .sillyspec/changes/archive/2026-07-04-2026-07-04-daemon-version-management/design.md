<!--
author: qinyi
created_at: 2026-07-04 17:23:26
change: 2026-07-04-daemon-version-management
-->

# design.md — daemon 版本可见 + 远程升级入口

## 1. 背景

服务器（backend + 前端管理页）当前**看不到**已连接客户端 daemon 的版本号，管理员也**无法从服务器触发**客户端 daemon 升级。

根因是两条链路的状态不一致：

| 链路 | 当前状态 |
|---|---|
| **版本上报**（daemon → backend 展示） | ❌ 全链路断裂 |
| **远程升级**（backend 推送 → daemon 自更新） | ✅ 后端 + daemon 已实现（commit `0aa1dcce` / `423359c6`），但 ❌ 前端无触发入口 |

「远程升级」后端链路已存在并存活于 main：
- `POST /api/daemon/runtimes/{runtime_id}/self-update`（`router.py:511`，权限 `RUNTIME_ADMIN`）
- WS 下发 `daemon:self_update`（`ws_hub.send_self_update`）
- daemon 侧 `preflight.ts` 下载新 bundle 原子替换 + exit 重启

「版本上报」四处全断：
1. daemon `register`/`heartbeat` payload 不含 daemon 自身版本（`hub-client.ts:37-47`、`85-90`）
2. `daemon_instances.version` 列已存在但 service 从不写入，恒 NULL（`model.py:64`、迁移 `202607031200:38`）
3. `DaemonInstanceRead` / `DaemonRuntimeRead` 不返回 daemon 版本
4. 前端无展示

本变更补齐「版本上报」断链 + 「远程升级」前端入口。

## 2. 设计目标

- **G1**：daemon 启动注册与每次心跳都上报自身版本（语义版本 + 构建标识）。
- **G2**：backend 接收、持久化版本，并通过现有 daemon 列表/详情 DTO 返回给前端。
- **G3**：前端管理页（runtimes 页）展示每个客户端 daemon 的版本号，并标注「最新 / 可升级 / 未知」。
- **G4**：前端「升级到最新版」按钮，调用已有的 self-update 端点，触发 daemon 远程升级。
- **G5**：`GET /api/daemon/version` 同时返回最新语义版本 + 构建标识，供前端做版本比对。

## 3. 非目标

- ❌ 升级实时进度反馈（WS 推送升级各阶段事件）。升级是低频运维操作，toast + 心跳刷新足够（YAGNI）。
- ❌ 新增 `POST /daemon-instances/{id}/self-update` 端点。现有 runtime 维度端点已可用，按进程级语义升级，不冗余。
- ❌ daemon 版本灰度 / 强制升级策略 / minRequired 门槛拦截。仅展示 + 手动触发。
- ❌ 历史版本审计表。本项目未上线，不要求历史兼容（CLAUDE.md 规则 10）。
- ❌ 自动检查升级（启动 preflight 自更新逻辑已存在，不在本变更扩展）。

## 4. 拆分判断

单一连贯功能，不拆分、不走批量。涉及三子项目（backend + daemon + frontend），任务规模 6-8 个，标准 plan 即可。

## 5. 总体方案

复用现有 self-update 全链路，精准补「上报 4 处断点 + 前端展示 + 前端升级按钮」。分三个 Wave：

**Wave 1 — daemon 上报 + backend 接收存储（数据通路）**
- daemon `RegisterBody` / `HeartbeatBody` 加 `daemon_version` + `daemon_build_id`，`register()` / `heartbeat()` 填入（从 `daemon-version.ts` 的 `DAEMON_VERSION` 与 `build-id.ts` 的 `BUILD_ID` 读取）。
- backend `DaemonRegisterRequest`（schema.py）+ `DaemonHeartbeatRequest`（router.py 生效版）加两 Optional 字段。
- `daemon_instances` 表新增 `build_id` 列（`version` 列已存在）；migration 接当前 head `b16bf63a5d05`。
- `register_daemon` / `heartbeat_daemon`（runtime/service.py）写入 `version` + `build_id`。

**Wave 2 — backend 读侧 + latest 分发（接口扩展）**
- `DaemonRuntimeRead` 扩展返回 `daemon_version` + `daemon_build_id`（JOIN `daemon_instances` 读）；`DaemonInstanceRead` 同步加两字段。
- `GET /api/daemon/version` 扩展：`_compute_daemon_version` 拆分为同时提取 `BUILD_ID`（SHA）与 `DAEMON_VERSION`（语义版本）。**关键：`get_daemon_latest_version()` 保持返回 SHA 不变**——self-update 端点（`router.py:527/533`）经 WS 推送的 `version` 必须是 SHA，daemon `preflight.ts:183` 用 BUILD_ID 比对依赖此契约；新增 `get_daemon_latest_semver()` 返回语义版本。`DaemonVersionResponse` 新增 `latest_version`（语义，新函数）+ `latest_build_id`（SHA，现有函数），保留旧 `latest` 兼容 install.sh。

**Wave 3 — 前端展示 + 升级入口（UI 接线）**
- OpenAPI 重生成 `api-types.ts`。
- `runtimes/page.tsx` 每个 runtime 行显示其 daemon 版本（语义版本 + SHA 短码）+ 与 latest 比对的徽标（最新 / 可升级 / 未知）+「升级到最新版」按钮。
- 按钮调 `trigger_daemon_self_update(runtime_id)`；点击后 toast 提示异步、版本经心跳自动刷新；daemon offline 时禁用。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/hub-client.ts` | `RegisterBody` + `HeartbeatBody` 加 `daemon_version`/`daemon_build_id`；`register()`/`heartbeat()` 构造 body 填入 |
| 修改 | `sillyhub-daemon/src/__tests__/hub-client.test.ts`（或对应测试） | 断言 register/heartbeat body 含版本字段 |
| 修改 | `backend/app/modules/daemon/schema.py` | `DaemonRegisterRequest` 加 `daemon_version`/`daemon_build_id`（Optional）；`DaemonInstanceRead` 加 `version`/`build_id`；`DaemonRuntimeRead` 加 `daemon_version`/`daemon_build_id` |
| 修改 | `backend/app/modules/daemon/router.py` | `DaemonHeartbeatRequest`（生效版 L152）加两字段；`DaemonVersionResponse` 加 `latest_version`/`latest_build_id`；`_compute_daemon_version` 双提取；`get_daemon_version` 返回双值 |
| 修改 | `backend/app/modules/daemon/runtime/service.py` | `register_daemon`/`heartbeat_daemon` upsert DaemonInstance 时写入 `version`/`build_id`；runtime 列表读取时 JOIN 带出 |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonInstance` 加 `build_id` 列（`version` 已存在） |
| 新增 | `backend/migrations/versions/<rev>_daemon_instance_build_id.py` | alembic 加 `daemon_instances.build_id` 列，down_revision=`b16bf63a5d05` |
| 修改 | `backend/tests/modules/daemon/test_service.py`（或对应） | register/heartbeat 写入 version/build_id 断言 |
| 修改 | `backend/tests/modules/daemon/test_router.py` | GET /version 返回 latest_version+latest_build_id；register 接收版本 |
| 新增 | `backend/tests/modules/daemon/test_migration_build_id.py` | migration upgrade/downgrade build_id 列 |
| 修改 | `frontend/src/lib/api-types.ts` | OpenAPI 重生成（DaemonRuntimeRead/DaemonInstanceRead/DaemonVersionResponse 新字段） |
| 修改 | `frontend/src/lib/daemon.ts` | 补 `triggerDaemonSelfUpdate(runtimeId)` 调用（若 OpenAPI 已生成则直接用） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | runtime 行显示 daemon 版本 + 徽标 + 升级按钮 + toast + offline 禁用 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx` | 版本显示 + 升级按钮调用 + offline 禁用断言 |

## 7. 接口定义

### 7.1 daemon → backend 上报字段（新增，Optional）

```
daemon_version: str | None   # 语义版本，如 "1.4.2"（来自 DAEMON_VERSION）
daemon_build_id: str | None  # git short SHA（来自 BUILD_ID，release 注入；dev="dev"）
```

加到 `DaemonRegisterRequest`、`DaemonHeartbeatRequest`（生效版）、daemon 侧 `RegisterBody`、`HeartbeatBody`。

### 7.2 backend → 前端 DTO 扩展

```python
class DaemonRuntimeRead(BaseModel):
    ...
    daemon_version: str | None = None      # 新增，JOIN daemon_instances.version
    daemon_build_id: str | None = None     # 新增，JOIN daemon_instances.build_id

class DaemonInstanceRead(BaseModel):
    ...
    version: str | None = None             # 新增
    build_id: str | None = None            # 新增

class DaemonVersionResponse(BaseModel):
    latest: str          # 保留（兼容 install.sh，= latest_build_id 回退值）
    minRequired: str
    downloadUrl: str
    latest_version: str  # 新增（语义版本，bundle 提取失败="unknown"）
    latest_build_id: str # 新增（git SHA，bundle 提取失败="unknown"）
```

### 7.3 已有 self-update 端点（不改，仅前端接线）

```
POST /api/daemon/runtimes/{runtime_id}/self-update
  权限: RUNTIME_ADMIN
  返回: {"sent": bool, "latest_version": str}
  失败: DaemonRuntimeOffline（daemon 离线或 WS 发送失败）
```

## 7.5 生命周期契约表

涉及 `daemon` / `heartbeat` / `complete` 关键词，必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| register | daemon | backend | `daemon_local_id`, `hostname`, `providers[]`, **`daemon_version?`**, **`daemon_build_id?`** | daemon_instances upsert（写入 version/build_id） |
| heartbeat | daemon | backend | `daemon_local_id`, `providers[]`, **`daemon_version?`**, **`daemon_build_id?`** | 刷新 last_heartbeat_at + version/build_id |
| self_update（WS） | backend | daemon | `version`(=latest_build_id) | daemon 下载替换 + exit → 重启 → re-register |
| self_update（HTTP 触发） | 前端(admin) | backend | `runtime_id`(path) | 转发 WS，返回 `{sent, latest_version}` |
| re-register（升级后） | daemon | backend | 新 `daemon_version`/`daemon_build_id` | 前端经心跳刷新看到新版本 |

新增字段 `daemon_version` / `daemon_build_id` 出现在：`DaemonRegisterRequest`、`DaemonHeartbeatRequest`、`RegisterBody`、`HeartbeatBody`（7.1）；读侧出现在 `DaemonRuntimeRead` / `DaemonInstanceRead`（7.2）。每个事件有对应代码任务 + 测试任务（见 §6 清单）。

## 8. 数据模型

`daemon_instances` 表（现有 + 新增列）：

| 列 | 类型 | 现状 | 说明 |
|---|---|---|---|
| `version` | String(50), nullable | 已存在（恒 NULL） | 语义版本，本变更换开始写入 |
| `build_id` | String(50), nullable | **新增** | git short SHA |

migration：`down_revision = 'b16bf63a5d05'`（当前 head），`upgrade` 加 `build_id` 列，`downgrade` 删。revision id 唯一（避免与并行变更冲突，见 R-02）。

`daemon_runtimes` 表不动（其 `version` 是 provider 版本，语义不同）。

## 9. 兼容策略

- **旧 daemon 不上报版本**：`daemon_version`/`daemon_build_id` 在 schema 为 Optional（default=None），pydantic 不报错；service 写入 NULL；前端显示「未知」（灰色徽标），不阻塞任何功能。
- **GET /version 旧消费者**：保留原 `latest`/`minRequired`/`downloadUrl` 字段不变（install.sh 依赖），仅新增 `latest_version`/`latest_build_id`，非破坏性。
- **WS breaking 不扩大**：本变更不加新的必填字段（与 2026-07-03-daemon-entity-binding D-007 的 daemon_local_id 必填不同），纯增量 Optional，旧 daemon 仍可注册/心跳。
- **本项目未上线**（CLAUDE.md 规则 10）：不要求历史数据回填，已连接的旧 daemon 重连后自然上报。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `DaemonHeartbeatRequest` 命名冲突（schema.py 旧版 vs router.py:152 生效版），版本字段加错位置不生效 | P1 | 版本字段加到 **router.py:152 生效版**；schema.py 旧残留同步加字段或注释标注已废弃；测试用生效路径验证 |
| R-02 | 新 migration 多 head（与并行变更 2026-07-04-frontend-openapi-types 或其他碰撞） | P0 | down_revision 严格接 `b16bf63a5d05`；execute 前先 `alembic heads` 确认单 head；revision id 用唯一占位 |
| R-03 | daemon 离线时点升级按钮失败 | P2 | 端点已抛 DaemonRuntimeOffline；前端按 runtime status 禁用按钮 + 错误 toast |
| R-04 | 部署 bundle 未注入 DAEMON_VERSION，`_compute` 提取 latest_version 失败 | P2 | `_compute` 回退 "unknown"；前端「未知」不阻塞升级（仍可按 build_id 比对） |
| R-05 | 前端 api-types.ts 重生成与 2026-07-04-frontend-openapi-types 变更冲突 | P2 | execute 时基于最新 backend openapi.json 重生成；手动核对 diff 不回退既有字段 |
| R-06 | daemon BUILD_ID="dev"（本地开发构建）导致版本比对无意义 | P2 | 前端 dev 构建显示「dev」徽标，不触发可升级提示；仅 release 构建参与比对 |
| R-07 | self-update 端点响应字段名 `latest_version` 实际返回 SHA（已存在误导命名），与本变更「语义版本」概念冲突 | P2 | 本变更不改该字段（WS 推送需 SHA 正确，改名破坏 OpenAPI 契约）；前端升级比对统一用 GET /version 的 `latest_build_id`，不依赖 self-update 响应字段语义 |

## 11. 决策追踪

见 `decisions.md`。当前版本决策：

- D-001@V1（上报内容：语义版本 + 构建标识双字段）→ §7.1
- D-002@V1（上报时机：register + heartbeat 都带）→ §7.5
- D-003@V1（存储：复用 version 列 + 新增 build_id 列）→ §8
- D-004@V1（latest 分发：扩展 GET /version 双字段）→ §7.2 / Wave 2
- D-005@V1（升级入口位置：runtimes 页 runtime 行）→ Wave 3
- D-006@V1（升级反馈：异步 toast + 心跳刷新，不做实时进度）→ §3 非目标
- D-007@V1（升级端点维度：runtime_id 直接调用）→ §7.3
- D-008@V1（兼容：字段 Optional，旧 daemon 显示「未知」）→ §9
- D-009@V1（latest 来源拆分：get_daemon_latest_version 保持 SHA，新增 semver 函数）→ §5 Wave 2 / §7.2 / R-07

无未解决决策。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖 | ✅ G1-G5 全部有对应章节与任务 |
| Grill 覆盖 | ✅ D-001~D-008 全部被 §5/§7/§8/§9 引用 |
| 约束一致性 | ✅ 复用现有 daemon-entity-binding per-daemon 契约；不破坏 WS breaking 约定 |
| 真实性 | ✅ 表名/字段名/方法名/行号来自真实代码（schema.py / router.py / hub-client.ts / model.py 核实）；migration head `b16bf63a5d05` 实测 |
| YAGNI | ✅ 砍掉实时进度、新端点、强制升级、审计表 |
| 验收标准 | ✅ 每章节可测试（body 字段 / DTO 字段 / migration / 前端按钮） |
| 非目标清晰 | ✅ §3 明确 5 项不做 |
| 兼容策略 | ✅ §9 三条回退路径 |
| 风险识别 | ✅ R-01~R-06 含 P0 migration 多 head |
| 生命周期契约表 | ✅ §7.5 含 register/heartbeat/self_update/re-register，必需字段出现在 §7 DTO |

**自审结论**：通过。关键风险 R-01（heartbeat schema 命名冲突）与 R-02（migration 多 head）已在 §10 与执行计划中明确防范。
