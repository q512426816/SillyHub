---
author: WhaleFall
created_at: 2026-07-07 16:08:48
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: brainstorm
---

# Design — 守护进程运行时页 Machine→Runtime 两级重构

## 1. 背景

`/runtimes` 页（`frontend/src/app/(dashboard)/runtimes/page.tsx`）当前是 **Runtime 平铺视图**：消费 `GET /api/daemon/runtimes/page`（`backend/app/modules/daemon/router.py:462`）返回的扁平 `DaemonRuntimeRead[]`，按 `PAGE_SIZE=12` 服务端分页，渲染为 `RuntimeCard` 网格。

这与后端的真实运行模型脱节。变更 `2026-07-03-daemon-entity-binding` 已把数据模型重构为两级：

- `daemon_instances`（**机器**）：一台 Daemon 主机进程，承载 hostname/os/arch/version/build_id/allowed_roots/status/last_heartbeat_at/display_alias 等机器级字段（`backend/app/modules/daemon/model.py:25`）。
- `daemon_runtimes`（**Runtime**）：`daemon_instance_id` 外键从属（`model.py:114`），一行 = 该机器下的一种 provider，只剩 provider/version/allowed_roots/status 等运行时维度字段。

也就是说，**后端早已是「一台机器含多个 runtime」的两级结构**，心跳/stale 清理也以 `daemon_instance.last_heartbeat_at` 为权威（`runtime/service.py:759`，`DEFAULT_RUNTIME_STALE_SECONDS=45`，超时联动整机 offline）。但前端 `/runtimes` 页从未跟进——它仍把 runtime 当一级资源平铺，用户看不到「机器」这一层。

entity-binding 的 design §7 当时明确把「runtimes 页机器级视图」留给后续变更（`schema.py:133` 注释：「语义正确的机器级视图由后续 daemon_instance Read 承载」）。**本变更即填补这个缺口**。

## 2. 目标 / 非目标

### 目标
1. `/runtimes` 页改为 **Machine → Runtime 两级手风琴视图**：机器卡为一级资源（默认折叠），展开后内嵌该机器的 runtime 卡网格。runtime 不再作为首页平铺对象。
2. 后端提供 **按 Machine 聚合** 的数据结构 `GET /api/daemon/machines`，机器级分页/筛选，避免前端自行分组（消除现有「按 runtime 分页导致前端分组跨页断裂」的硬伤）。
3. 机器级操作（别名、升级 daemon）上提到机器卡；runtime 级操作（可写目录、会话、审计、启禁、移除）保留在 runtime 卡。
4. 前端实现 **1:1 对齐** `prototype-machine-runtime.html` 视觉（方案 A），作为验收基准（D-006）。
5. 为后续「机器监控 / 资源占用 / Workspace 按机器分组」预留扩展空间（Machine 已是一级资源）。

### 非目标
- 不改 `daemon_instances` / `daemon_runtimes` 表结构（实体上提已完成）。
- 不改 daemon 进程的注册/心跳/WS 协议（`POST /register`、`POST /heartbeat`、`/ws` 全部不动）。
- 不改 workspace-daemon-switcher 消费的 `GET /daemon/instances`（保留其 online-only 轻量语义，本变更另起 `/machines` 端点，互不污染）。
- 不做机器监控/资源占用（CPU/内存/磁盘）——仅预留扩展点。
- 不保留旧的 runtime 平铺视图切换（D-005：完全替换）。

## 3. 整体方案（方案 A · 手风琴两级）

```
后端（新增 3 端点，0 改表）:
  GET   /api/daemon/machines              → 机器聚合查询（机器级分页/筛选 + 嵌套 runtimes）
  PATCH /api/daemon/machines/{instance_id} → 改机器 display_alias（直写 daemon_instance）
  POST  /api/daemon/machines/{instance_id}/self-update → daemon 升级（按 instance 路由 WS）

  GET /api/daemon/runtimes/usage          → 复用（用量仍走此端点，前端按机器分组聚合）

前端（重构 /runtimes 页）:
  useDaemonMachines(params)   → react-query 调 /machines，15s 轮询
  <MachineCard machine runtimes> → 折叠头（机器信息 + 聚合费用 + runtime数 + 别名/升级）+ 展开体
  <RuntimeCard runtime usage>  → 从 page.tsx 抽出（视觉不变）+ 用量统计区
  <RuntimesPage>              → SummaryCard(机器级) + 筛选条 + 时间窗 + 机器分页 + MachineCard 列表
```

数据流：进页面 → `Promise.all([listMachines(params), getRuntimesUsage(window)])` → 前端把 usage Map 按 `runtime_id` 映射到 runtime 卡、按 `daemon_instance_id` 分组求和到机器头聚合费用。

## 4. 数据模型（backend，0 改表）

复用现有两张表，**不改 schema**：

| 表 | 角色 | 关键字段 |
|---|---|---|
| `daemon_instances` | 机器 | id(=daemon_local_id), user_id, hostname, display_alias, os, arch, version, build_id, allowed_roots, capabilities, status, last_heartbeat_at, created_at |
| `daemon_runtimes` | Runtime | id, daemon_instance_id(FK), user_id, name, provider, version, allowed_roots, status, last_heartbeat_at, metadata_ |

机器在线状态来源（D-002）：直接用 `daemon_instance.status`。后端 `cleanup_stale_runtimes`（`runtime/service.py:759`）已以 instance 心跳为准维护：超 45s → `instance.status='offline'` + 联动其下非 disabled runtime 为 offline。前端不自行派生。

## 5. 后端 API 设计

### 5.1 `GET /api/daemon/machines`（核心新增）

- **权限**：`RuntimeAdminUser`（`Permission.RUNTIME_ADMIN`），与 `/runtimes/page` 一致。admin 看全部 owner；普通用户固定追加 `daemon_instance.user_id == actor_user_id`（请求的 `user_id` 被忽略）。admin 传 `user_id` 时按 owner 精确过滤。
- **查询参数**：
  - `q: str | None`（max 200）——大小写不敏感模糊匹配 `hostname` / `display_alias` / 该机器下任一 runtime 的 `provider`（ILIKE `%q%`）
  - `status: str | None`——精确匹配 `daemon_instance.status`（online/offline/maintenance/disabled）
  - `provider: str | None`——含某 provider 的机器（`EXISTS(SELECT 1 FROM daemon_runtimes WHERE daemon_instance_id=... AND provider=?)`）
  - `user_id: uuid | None`——admin 按 owner 过滤
  - `limit: int = 20`（ge 1, le 100）、`offset: int = 0`（ge 0）——**机器级分页**
- **响应 `DaemonMachineListResponse`**：
  ```python
  class DaemonMachineRead(BaseModel):
      id: uuid.UUID
      hostname: str
      display_alias: str | None = None
      os: str | None = None
      arch: str | None = None
      status: str
      last_heartbeat_at: datetime | None
      version: str | None = None        # daemon 语义版本
      build_id: str | None = None       # daemon 构建 SHA
      created_at: datetime
      owner: OwnerRead | None = None    # JOIN users
      runtime_count: int                # 该 instance 下 runtime 总数
      online_runtime_count: int         # status=='online' 的 runtime 数
      runtimes: list[DaemonRuntimeRead] = []  # 该机器全部 runtime（含各自 capabilities/allowed_roots）
      model_config = {"from_attributes": True}

  class DaemonMachineListResponse(BaseModel):
      items: list[DaemonMachineRead]
      total: int
      limit: int
      offset: int
  ```
- **排序**：online 优先 → `last_heartbeat_at DESC`（与前端现有 `displayItems` 的 `statusRank` + 心拍排序语义一致，上移到 SQL）。
- **实现**（`runtime/service.py` 新增 `list_machines(...)`）：
  1. 主查询：`SELECT daemon_instances JOIN users(owner)` + WHERE 过滤 + ORDER BY + LIMIT/OFFSET，返回 `(instance, owner)` 列表 + total。
  2. 二次查询：取本页所有 `instance_id`，**一次性** `SELECT daemon_runtimes WHERE daemon_instance_id IN (...)`，按 instance 分组。
  3. 组装：每 instance 挂载其 runtimes（经 `_runtime_read` 构造 `DaemonRuntimeRead`），派生 `runtime_count` / `online_runtime_count`。
  4. `cleanup_stale_runtimes()` 先于查询调用（与 `/runtimes/page` 一致，保证 stale 已收敛）。
- **router 注册顺序**：`/machines` 是固定路径，声明在 `/runtimes/{runtime_id}` 之前无冲突（不同路径前缀），但需注意 `/runtimes/page`、`/runtimes/usage` 已在动态段前——`/machines` 独立前缀不受影响。

### 5.2 `PATCH /api/daemon/machines/{instance_id}`（机器别名，D-001）

- **权限**：`RuntimeAdminUser`。归属校验：admin 全局 / 普通用户 `instance.user_id == actor`，越权 403（复用 `_get_owned_instance` 新增辅助）。
- **Body**：`DaemonMachineUpdate { display_alias: str | None }`（省略=不变，显式 null/空白=清空，与 runtime 级 PATCH 语义一致）。
- **行为**：直写 `daemon_instance.display_alias` + bump `updated_at`，返回 `DaemonMachineRead`（重新聚合该机器）。
- **理由**：现有 `PATCH /runtimes/{id}` 经 `runtime.daemon_instance_id` 间接写 instance（`runtime/service.py:update_runtime`），需要先有 runtime。新端点直接面向机器资源，**0-runtime 机器也能改别名**，语义正确。

### 5.3 `POST /api/daemon/machines/{instance_id}/self-update`（daemon 升级，D-001）

- **权限**：`RuntimeAdminUser` + 归属校验。
- **行为**：按 `instance_id` 取 `DaemonInstance` → `hub.send_self_update(instance_id, version=latest)` → 返回 `{"sent": bool, "latest_version": str}`。离线/发送失败 → `DaemonRuntimeOffline`（504）。
- **理由**：现有 `POST /runtimes/{id}/self-update`（`router.py:603`）经 `runtime.daemon_instance_id` 路由 WS。新端点直接按 instance 路由，**不再借道 runtime_id**，与「机器是一级资源」语义对齐。runtime 级端点保留兼容（不删）。

### 5.4 现有端点保留（不破坏）

`GET /runtimes/page`、`GET /runtimes`、`GET /instances`、`PATCH /runtimes/{id}`、`PUT /runtimes/{id}/allowed-roots`、`POST /runtimes/{id}/self-update`、会话/审计/启禁/移除端点**全部保留**——workspace-daemon-switcher、daemon-client、daemon 进程自身仍依赖。本变更只**新增**，不改动既有契约。

## 6. 用量聚合策略（D-004）

`GET /machines` **不内联用量**。用量仍走现有成熟端点 `GET /api/daemon/runtimes/usage?window=7d`（`router.py:391`，service 层单条 LEFT JOIN+COALESCE 聚合）。

前端拿到全量 `usageByRuntime: Map<runtime_id, RuntimeUsageItem>` 后：
- **runtime 卡** → `usageByRuntime.get(runtime.id)` 渲染 4 数字（输入/输出/缓存/费用）+ sparkline（与现状完全一致）。
- **机器头聚合费用** → `sum( 该机器 runtimes 的 usage.summary.total_cost_usd )`。

**取舍**：两次往返（`Promise.all` 并发）vs `/machines` 内联用量。选前者——用量逻辑零重复、`/machines` SQL 简单、用量是「进页面+切窗拉一次」的非实时数据（`page.tsx:reloadUsage`），15s 列表轮询不重拉用量。两次并发往返的延迟可接受。

用量时间窗切换（当日/7天/30天）沿用现有 `usageWindow` state + `reloadUsage` 机制，切窗只重发 `/runtimes/usage`，不重发 `/machines`。

## 7. 前端组件与数据流

### 7.1 `useDaemonMachines(params)` （新 hook，`frontend/src/lib/use-daemon-machines.ts`）

仿 `use-daemon-runtimes.ts` 结构：
```ts
interface DaemonMachinesData { items: DaemonMachineRead[]; total: number; sessions: AgentSessionRead[] }
export function useDaemonMachines(params: DaemonMachineListParams) {
  // queryKey: queryKeys.daemonMachines.list(params)
  // queryFn: Promise.all([listDaemonMachines(params), listAgentSessions({limit:100}).catch(()=>null)])
  // refetchInterval: 15000
}
```
（会话统计仍按 `runtime_id` 聚合到 runtime 卡，复用现有 `sessionStatsByRuntime`。）

### 7.2 `lib/daemon.ts` 新增类型与函数

```ts
export interface DaemonMachineRead {
  id: string; hostname: string; display_alias: string | null;
  os: string | null; arch: string | null; status: string;
  last_heartbeat_at: string | null; version: string | null; build_id: string | null;
  created_at: string; owner?: OwnerRead | null;
  runtime_count: number; online_runtime_count: number;
  runtimes: DaemonRuntimeRead[];
}
export interface DaemonMachineListParams { q?; status?; provider?; user_id?; limit?; offset? }
export interface DaemonMachineListResponse { items: DaemonMachineRead[]; total; limit; offset }
export async function listDaemonMachines(params?): Promise<DaemonMachineListResponse>
export async function updateDaemonMachine(instanceId, input): Promise<DaemonMachineRead>      // PATCH
export async function triggerMachineSelfUpdate(instanceId): Promise<{sent; latest_version}>  // POST
```

### 7.3 `<MachineCard>` （新组件，`frontend/src/components/daemon/machine-card.tsx`）

Props：`{ machine: DaemonMachineRead; sessions, usageByRuntime, usageWindow, latestVersion, expanded, onToggleExpand, onEditAlias, onUpgrade, onRuntime*（透传 runtime 卡回调）, isPlatformAdmin }`

折叠头（1:1 对齐原型）：
- 机器图标（status→底色：online 绿/offline 灰）
- 名称（display_alias ?? hostname）+ 别名小字 + 状态徽章
- 行 2：OS·arch · 心跳（`formatRelativeTime`）· daemon 版本 `#build_id[0:7]` · 负责人
- 右侧：**聚合费用胶囊**（蓝，`sum cost`）+ **runtime 数胶囊**（`online/total`）+ 别名按钮 + 升级 daemon 按钮（离线 disabled）+ chevron（展开旋转 90°）

展开体：
- `RuntimeCard` 网格 `xl:grid-cols-2`
- 0-runtime 机器 → 空态「该机器暂无运行时」（D-003）

### 7.4 `<RuntimeCard>` （从 `page.tsx` 抽出，视觉零改动）

迁到 `frontend/src/components/daemon/runtime-card.tsx`，含：header（provider 徽章 + 状态 + 别名/id/注册时间/负责人）+ meta 网格（版本/会话/协议/可执行路径）+ **用量统计区（4 数字 + sparkline）** + 运行能力 + 可写目录 + 操作按钮组。Props 与现有 `RuntimeCard` 内部签名一致，只是提到独立文件。

**Daemon 版本字段上提**（D-006 对齐原型的隐含要求）：现有 page.tsx 的 RuntimeCard meta 含「Daemon 版本」行，两级视图下冗余（同机器所有 runtime 共享同一 daemon 进程版本）。抽组件时**去掉 runtime 卡的 Daemon 版本行**，该信息上提到机器头（原型 runtime 卡 meta 只画 版本/会话/协议）。`daemon_version`/`daemon_build_id` 仍保留在 `DaemonRuntimeRead`（向后兼容其它消费方），仅前端 runtime 卡不渲染。

### 7.5 `<RuntimesPage>` 重构

- SummaryCard 改 **机器级**统计：机器总数 / 在线 / 维护中 / 禁用 / 离线（按 `machine.status` 统计，meta 显示提供方数 + 最近心跳）。
- 筛选条：搜索（hostname/别名/provider）+ 状态 + 提供方 + 人员（admin）+ 时间窗切换 + 刷新。
- 机器级分页器（`PAGE_SIZE=20` 机器/页）。
- `expandedMachineIds: Set<string>` 记忆展开态（切页/刷新保留）。
- URL `?session=<id>` 恢复：找到 runtime 所属 machine → 自动展开该 machine → 开 `RuntimeSessionDialog`（保留现有 `urlRestoreDoneRef` 逻辑，改从 `machines[].runtimes` 扁平化查找）。
- 会话/别名（机器级）/可写目录/目录浏览器 Modal 全部保留；别名 Modal 改调 `updateDaemonMachine`。

### 7.6 `query-keys.ts` 新增

```ts
daemonMachines: { all: [...], list: (params) => [...] }
```

## 8. 操作归属契约表（D-001 落地）

| 操作 | 归属 | 端点 | 备注 |
|---|---|---|---|
| 编辑别名 | **机器卡** | `PATCH /machines/{id}` | instance.display_alias，0-runtime 亦可 |
| 升级 daemon | **机器卡** | `POST /machines/{id}/self-update` | 按 instance 路由 WS |
| 可写目录 | runtime 卡 | `PUT /runtimes/{id}/allowed-roots`（现有） | per-runtime（2026-07-06 下沉） |
| 会话 | runtime 卡 | `/sessions/*`（现有） | provider==claude/codex 可开 |
| 审计日志 | runtime 卡 | `GET /runtimes/{id}/policy-audit`（现有） | 跳 `/runtimes/{id}/audit` |
| 启用/禁用 | runtime 卡 | `/runtimes/{id}/enable\|disable`（现有） | per-runtime |
| 移除 | runtime 卡 | `DELETE /runtimes/{id}`（现有） | 级联清会话/lease |

## 9. 关键决策

- **D-001@v1 机器级操作上提**：别名+升级上提机器卡（本质 instance 级），新增 `/machines/{id}` mutation 端点直写；可写目录/会话/审计/启禁/移除留 runtime 卡。type=architecture, source=code+user。
- **D-002@v1 机器在线状态来源**：直接用 `daemon_instance.status`，前端不派生。type=term, source=code。
- **D-003@v1 空机器**：0-runtime 机器仍展示机器卡，runtime 区显空态。type=boundary, source=code。
- **D-004@v1 用量聚合**：`/machines` 不内联用量，复用 `/runtimes/usage` 前端按 `daemon_instance_id` 分组求和聚合费用。type=architecture, source=user。
- **D-005@v1 视图替换**：完全替换为两级视图，不保留平铺切换。type=boundary, source=user。
- **D-006@v1 视觉对齐**：前端实现必须 1:1 对齐 `prototype-machine-runtime.html`（方案 A），作为验收基准。type=boundary, source=user。
- **D-007@v1 分页维度**：机器级分页（默认 20/页），机器卡永不跨页断裂。type=architecture, source=user。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| `/machines` 响应体大（每机器含全部 runtime） | 机器级分页（20/页）+ 不内联用量；实际机器数通常个位数~数十 |
| 用量两次往返延迟 | `Promise.all` 并发；用量非实时，可接受 |
| 抽 `RuntimeCard` 出 page.tsx 破坏现有 1887 行 page 的内联引用 | 抽组件时保持 Props 签名不变，page 改为传 props；现有 `page.test.tsx` / `page-usage.test.tsx` 需同步适配（验证渲染+用量） |
| `?session=` 恢复路径变化（runtime 现在嵌在 machine 里） | `urlRestoreDoneRef` 逻辑改为从 `machines.flatMap(m=>m.runtimes)` 查找，找到后展开所属 machine |
| 机器级 mutation 端点归属校验遗漏 | 新增 `_get_owned_instance` 辅助，复用 runtime 侧 `_get_owned_runtime` 的 admin/owner 模式 + 单测覆盖越权 403 |
| provider 筛选（含某 provider 的机器）SQL 性能 | `EXISTS` 子查询，`daemon_runtimes.daemon_instance_id` 已有索引（`idx_daemon_runtimes_instance`） |

## 11. 验收标准

### 后端
- [ ] `GET /machines` 分页/筛选（q/status/provider/user_id）/排序正确；admin vs 普通用户权限；`runtime_count`/`online_runtime_count` 派生正确；0-runtime 机器返回 `runtimes=[]`、计数 0。
- [ ] `PATCH /machines/{id}` 别名 正常更新/显式 null 清空/越权 403/不存在 404。
- [ ] `POST /machines/{id}/self-update` 路由正确；离线 → 504。
- [ ] 现有 `/runtimes/page`、`/instances`、runtime 级端点回归不破。

### 前端（视觉 1:1 对齐 D-006）
- [ ] 机器卡折叠/展开交互、展开态记忆（切页保留）。
- [ ] 机器头：聚合费用胶囊（sum）+ runtime 数胶囊（在线/总数）+ 别名/升级按钮（离线 disabled）。
- [ ] runtime 卡用量统计区：4 数字（输入/输出/缓存/费用）+ sparkline（空数据显「—」/「暂无数据」）。
- [ ] SummaryCard 机器级统计正确。
- [ ] 机器级分页、筛选（搜索/状态/提供方/人员）、时间窗切换。
- [ ] `?session=` 恢复：自动展开所属 machine + 开弹窗。
- [ ] 别名 Modal 调 `updateDaemonMachine`；升级调 `triggerMachineSelfUpdate`。
- [ ] provider 徽章色调、状态徽章与原型一致。

### 测试
- 后端：`backend/app/modules/daemon/` 下新增 `test_machines_router.py`（或并入既有 daemon 测试），覆盖上述。
- 前端：`machine-card.test.tsx`、`runtime-card.test.tsx`、`page.test.tsx` 适配 + `use-daemon-machines.test.tsx`。
- 命令（local.yaml）：`cd backend && pytest`、`cd frontend && pnpm test`；test_strategy=module。

## 12. 文件变更清单

### backend（新增为主）
- `app/modules/daemon/schema.py` — 新增 `DaemonMachineRead` / `DaemonMachineListResponse` / `DaemonMachineUpdate`
- `app/modules/daemon/router.py` — 新增 `GET /machines`、`PATCH /machines/{id}`、`POST /machines/{id}/self-update`
- `app/modules/daemon/runtime/service.py` — 新增 `list_machines(...)`、`update_machine_alias(...)`、`_get_owned_instance(...)`；`update_machine_self_update` 复用 ws_hub
- `app/modules/daemon/service.py` — `DaemonService` 薄委托（对齐 `list_instances` 模式）
- 测试：`backend/app/modules/daemon/tests/`（机器端点单测）

### frontend（重构为主）
- `src/lib/daemon.ts` — 新增 `DaemonMachineRead` 等类型 + `listDaemonMachines` / `updateDaemonMachine` / `triggerMachineSelfUpdate`
- `src/lib/use-daemon-machines.ts` — **新增** hook
- `src/lib/query-keys.ts` — 新增 `daemonMachines`
- `src/components/daemon/machine-card.tsx` — **新增** 组件
- `src/components/daemon/runtime-card.tsx` — **新增**（从 page.tsx 抽出，视觉不变）
- `src/app/(dashboard)/runtimes/page.tsx` — 重构为两级手风琴
- 测试：`machine-card.test.tsx`、`runtime-card.test.tsx`、`page.test.tsx`、`page-usage.test.tsx`、`use-daemon-machines.test.tsx` 适配

### 不改动
- `daemon_instances` / `daemon_runtimes` 表
- daemon 进程（`sillyhub-daemon/`）注册/心跳/WS 协议
- `GET /instances`、`GET /runtimes/page`、runtime 级 mutation 端点（保留兼容）
- `prototype-machine-runtime.html`（已是验收基准，锁定不改）

## 13. 自审

- ✅ 是否改表？否，纯复用 entity-binding 已建的两级模型。
- ✅ 是否破坏既有契约？否，只新增 `/machines*`，保留全部既有端点。
- ✅ 用量聚合是否引入后端重复逻辑？否，复用 `/runtimes/usage`。
- ✅ 0-runtime / 离线 / 越权 / `?session=` 恢复 边界是否覆盖？是（D-003、归属校验、URL 恢复改编）。
- ✅ 前端视觉是否有据？是，1:1 对齐 `prototype-machine-runtime.html`（D-006）。
- ✅ 是否跨平台？端点/组件无 OS 特定逻辑，daemon 侧不改，兼容 Win/Linux/macOS（CLAUDE.md 规则 12）。
- ⚠ 待 plan 阶段细化：Wave 分组（backend 端点 → frontend hook → 组件 → page 重构 → 测试）、task 粒度、`RuntimeCard` 抽离时的 props 透传清单。

## 14. 生命周期契约（显式豁免声明）

**本变更不涉及任何生命周期契约变更。** 虽然文档中出现 session/lease/agent_run/daemon/lifecycle 等关键词，但均为**复用现有契约**，不做任何状态机/事件/转换矩阵的修改：

| 生命周期域 | 现有契约 | 本变更处理 |
|---|---|---|
| daemon 注册（`POST /register`） | per-daemon 上报 daemon_local_id + 机器字段 + providers | **不改**（端点/请求体/响应体不变） |
| daemon 心跳（`POST /heartbeat` + WS heartbeat） | 刷新 instance.last_heartbeat_at + 各 runtime.status | **不改** |
| stale 清理（`cleanup_stale_runtimes`） | instance 心跳超 45s → offline + 联动 runtime offline | **不改**（`GET /machines` 仅调用它，不修改其逻辑） |
| session 生命周期（active/reconnecting/ended/failed） | `SessionService.*` + daemon RecoveryCoordinator | **不改**（会话端点全保留） |
| lease 生命周期（pending/claimed/completed/expired/cancelled） | `DaemonLeaseService` | **不改** |
| agent_run 生命周期 | `agent/service.py` | **不改** |
| runtime 启用/禁用/移除 | `enable/disable/delete` 端点 | **保留**（runtime 卡仍调用，契约不变） |

**理由**：本变更是「在既有两级数据模型之上新增机器级读视图 + 两个机器级写操作（别名/升级）」。别名写 `daemon_instance.display_alias`（纯字段更新，无状态机）；升级复用现有 `hub.send_self_update`（既有 WS 消息，不新增事件类型）。因此无需新的事件×状态转换矩阵，原有 session/lease/agent_run/daemon 生命周期完整保留。

`POST /machines/{id}/self-update` 复用的 `daemon:self_update` WS 消息已是 daemon 侧既有事件（`router.py:603` 现有 `/runtimes/{id}/self-update` 已在用），本变更只是改用 instance_id 路由而非 runtime_id 路由，**不引入新事件**。
