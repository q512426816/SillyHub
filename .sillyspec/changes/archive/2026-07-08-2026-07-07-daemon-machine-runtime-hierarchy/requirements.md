---
author: WhaleFall
created_at: 2026-07-07 16:15:16
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: brainstorm
---

# Requirements — 守护进程运行时页 Machine→Runtime 两级重构

## 角色表

| 角色 | 权限范围 | 本变更相关能力 |
|---|---|---|
| 平台管理员（`is_platform_admin=true`，持 `RUNTIME_ADMIN`） | 全部 owner 的机器/runtime | 看全部机器；按 owner 筛选；改任意机器别名；升级任意 daemon；配 runtime 可写目录 |
| 普通用户（持 `RUNTIME_ADMIN`） | 仅自己的机器/runtime | 仅看自己机器；改自己机器别名；升级自己 daemon；配自己 runtime 可写目录 |
| daemon 进程（X-API-Key） | 注册/心跳/lease/session | **本变更不涉及**（注册/心跳协议不改） |

## 功能需求（FR）

### FR-1 后端 `GET /api/daemon/machines`（机器聚合查询）
**Given** 已登录用户持 `RUNTIME_ADMIN`
**When** 调用 `GET /api/daemon/machines?q=&status=&provider=&user_id=&limit=20&offset=0`
**Then**
- 普通用户：仅返回 `daemon_instance.user_id == 自己` 的机器
- 管理员：返回全部机器；传 `user_id` 时按 owner 精确过滤
- `q` 大小写不敏感模糊匹配 `hostname` / `display_alias` / 该机器下任一 runtime 的 `provider`
- `status` 精确匹配 `daemon_instance.status`
- `provider` 过滤含该 provider 的机器（EXISTS 子查询）
- 排序：online 优先 → `last_heartbeat_at` DESC
- 分页：`limit`(默认20,1-100) / `offset`(默认0) 为**机器级**
- 每机器返回：机器字段 + `owner` + `runtime_count` + `online_runtime_count` + `runtimes[]`
- `cleanup_stale_runtimes()` 先于查询执行
- 越权/未登录 → 401/403

**覆盖**：D-002（机器状态来源）、D-003（0-runtime 机器 runtime_count=0/runtimes=[]）、D-007（机器级分页）

### FR-2 后端 `PATCH /api/daemon/machines/{instance_id}`（机器别名）
**Given** 已登录用户持 `RUNTIME_ADMIN`，body `{display_alias: str|null}`
**When** 调用 `PATCH /api/daemon/machines/{instance_id}`
**Then**
- 归属校验：管理员全局 / 普通用户 `instance.user_id==自己`，越权 → 403；不存在 → 404
- `display_alias` 省略=不变；显式 null/空白=清空；非空=strip 后写入 `daemon_instance.display_alias`
- 返回更新后的 `DaemonMachineRead`（重新聚合）
- 0-runtime 机器也可改别名（直写 instance，不依赖 runtime）

**覆盖**：D-001（机器级操作上提）

### FR-3 后端 `POST /api/daemon/machines/{instance_id}/self-update`（daemon 升级）
**Given** 已登录管理员/owner，机器在线
**When** 调用 `POST /api/daemon/machines/{instance_id}/self-update`
**Then**
- 归属校验同 FR-2
- 按 `instance_id` 路由 WS 下发 `daemon:self_update`，返回 `{sent: true, latest_version}`
- 机器离线/WS 发送失败 → 504（`DaemonRuntimeOffline`）

**覆盖**：D-001

### FR-4 前端 `/runtimes` 页两级手风琴视图
**Given** 用户进入 `/runtimes`
**When** 页面加载
**Then**
- 顶部 SummaryCard 为**机器级**统计（总数/在线/维护中/禁用/离线，按 `machine.status`）
- 显示机器卡列表，每张机器卡默认折叠，展示：机器图标 + 名称(display_alias??hostname) + 别名小字 + 状态徽章 + OS·arch + 心跳(formatRelativeTime) + daemon 版本 #build_id + 负责人 + **聚合费用胶囊**(sum cost) + **runtime 数胶囊**(online/total) + 别名按钮 + 升级 daemon 按钮(离线 disabled) + chevron
- 点击机器头 → 展开/折叠，展开体为该机器的 `RuntimeCard` 网格（`xl:grid-cols-2`）
- 展开态记忆（`expandedMachineIds` Set），切页/刷新保留
- 0-runtime 机器 → 展开体显空态「该机器暂无运行时」
- 机器级分页器（PAGE_SIZE=20）+ 筛选条（搜索/状态/提供方/人员[admin]）+ 时间窗切换 + 刷新
- 视觉 1:1 对齐 `prototype-machine-runtime.html`

**覆盖**：D-002、D-003、D-005（完全替换）、D-006（视觉对齐）、D-007

### FR-5 前端 RuntimeCard（抽组件，保留全部能力）
**Given** runtime 卡渲染
**When** 展示单个 runtime
**Then**
- header：provider 徽章（准确色调）+ 状态徽章 + 别名/id/注册时间/负责人
- meta 网格：版本/会话/协议/可执行路径（**不含 Daemon 版本**——已上提机器头）
- 用量统计区：4 数字（输入/输出/缓存/费用）+ sparkline 趋势折线；空数据 → 「—」/「暂无数据」
- 运行能力（agents chips）+ 可写目录（Tag 列出或「未配置」）
- 操作按钮组：可写目录[admin] / 审计日志 / 会话[claude/codex/online] / 启用|禁用 / 移除
- 视觉与现有 RuntimeCard 一致（抽组件零改动，仅去 Daemon 版本行）

**覆盖**：D-006

### FR-6 用量聚合（前端分组）
**Given** `useDaemonMachines` 返回 machines + `getRuntimesUsage(window)` 返回全量用量
**When** 渲染
**Then**
- runtime 卡用量 = `usageByRuntime.get(runtime.id)`（与现状一致）
- 机器头聚合费用 = `sum(该机器 runtimes 的 usage.summary.total_cost_usd)`，undefined→0
- 切时间窗 → 只重发 `/runtimes/usage`，不重发 `/machines`
- 列表 15s 轮询不重拉用量

**覆盖**：D-004（用量不内联）

### FR-7 URL `?session=` 恢复
**Given** URL 含 `?session=<id>` 且对应 session 活跃
**When** 页面加载完成
**Then** 找到该 session 的 runtime 所属 machine（从 `machines.flatMap(m=>m.runtimes)` 查）→ 自动展开该 machine → 开 `RuntimeSessionDialog`（`initialSessionId` 接默认态 attach）；runtime 不在当前页/已删/session 非活跃 → 清 param 降级。

### FR-8 现有端点回归（不破坏）
**Given** 现有消费方（workspace-daemon-switcher、daemon-client、daemon 进程）
**When** 调用 `GET /instances` / `GET /runtimes/page` / `PATCH /runtimes/{id}` / `PUT /runtimes/{id}/allowed-roots` / `POST /runtimes/{id}/self-update` / 会话/审计/启禁/移除
**Then** 行为与本变更前完全一致（端点保留，契约不变）。

## 非功能需求（NFR）

- **NFR-1 跨平台**：后端端点、前端组件无 OS 特定逻辑；daemon 侧不改 → Win/Linux/macOS 行为一致（CLAUDE.md 规则 12）。
- **NFR-2 中文 UI**：所有新增/改动文案中文（CLAUDE.md 规则 11）。
- **NFR-3 性能**：`GET /machines` 单次查询 + 一次 IN 子查询取 runtimes（避免 N+1）；`daemon_runtimes.daemon_instance_id` 已有索引。
- **NFR-4 不破坏既有契约**：纯新增 `/machines*`，保留全部既有端点。
- **NFR-5 显式 response_model**：每个新端点声明 `response_model`（CONVENTIONS）。
- **NFR-6 无 migration**：复用现有表，未上线可重置（CLAUDE.md 规则 10）。
- **NFR-7 视觉一致性**：前端 1:1 对齐 `prototype-machine-runtime.html`（D-006），主色 #2563EB，沿用 frontend-style-system。

## 决策覆盖关系

| 决策 | 覆盖 FR/NFR |
|---|---|
| D-001 机器级操作上提（别名+升级→机器卡，新增 /machines mutation） | FR-2, FR-3, FR-4, FR-5 |
| D-002 机器状态来源 = daemon_instance.status | FR-1, FR-4 |
| D-003 空机器展示 | FR-1, FR-4 |
| D-004 用量不内联 /machines，前端分组聚合 | FR-6, NFR-3 |
| D-005 完全替换两级视图，不保留平铺 | FR-4 |
| D-006 视觉 1:1 对齐 prototype | FR-4, FR-5, NFR-7 |
| D-007 机器级分页 | FR-1, FR-4 |
