---
author: WhaleFall
created_at: 2026-07-07 16:15:16
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: brainstorm
---

# Proposal — 守护进程运行时页 Machine→Runtime 两级重构

## 动机

`/runtimes` 页是管理员/用户管理本地 daemon 运行时的入口。当前它把每个 runtime（一种 provider）平铺成卡片网格，用户看到的是一串「claude / codex / gemini…」卡片，**看不到「机器」这一层**——而真实运行模型是「一台 Daemon 主机包含多个 provider 运行时」。

这与后端数据模型脱节。变更 `2026-07-03-daemon-entity-binding` 已把模型重构为两级（`daemon_instances` 机器 → `daemon_runtimes` 从属），心跳/stale 也以机器级心跳为权威。但前端从未跟进，runtime 仍是一级资源。entity-binding 当时明确把「runtimes 页机器级视图」留给后续——本变更即填补此缺口。

## 现有方案为什么不够（关键问题）

1. **模型脱节**：前端平铺 runtime，用户无法一眼看出「这些 runtime 属于同一台机器」。同一台机器跑 claude+codex，页面上是两张不相邻的卡（按 status/心跳/provider 排序后）。
2. **分组跨页断裂**：现有 `/runtimes/page` 按 runtime 分页（PAGE_SIZE=12）。即便前端按 `daemon_instance_id` 分组，第 1 页 12 条 runtime 可能横跨多台机器，某台机器的 runtime 被切到第 2 页 → 分组不完整。这是结构性硬伤，前端无解。
3. **机器级操作错位**：别名（`display_alias`）和 daemon 升级本质是机器级（一台进程一次），现挂在 runtime 卡上借道 runtime_id 路由。0-runtime 机器连别名都改不了。
4. **机器级信息缺位**：hostname、OS、机器在线状态、最后心跳、runtime 数等「机器视图」无处展示，为后续机器监控/资源占用/Workspace 按机器分组等能力无扩展基础。

## 变更范围

### 后端（`backend/app/modules/daemon/`，0 改表，纯新增）
- `GET /api/daemon/machines`：机器聚合查询，机器级分页/筛选，返回 `DaemonMachineRead`（机器字段 + owner + runtime_count + online_runtime_count + 嵌套 runtimes）
- `PATCH /api/daemon/machines/{instance_id}`：机器别名（直写 daemon_instance）
- `POST /api/daemon/machines/{instance_id}/self-update`：daemon 升级（按 instance 路由 WS）
- schema.py 新增 `DaemonMachineRead` / `DaemonMachineListResponse` / `DaemonMachineUpdate`
- runtime/service.py 新增 `list_machines` / `update_machine_alias` / `_get_owned_instance`

### 前端（`frontend/src/`，重构 /runtimes 页）
- 新增 `lib/use-daemon-machines.ts`（react-query hook，15s 轮询）
- 新增 `components/daemon/machine-card.tsx`（手风琴机器卡）
- 新增 `components/daemon/runtime-card.tsx`（从 page.tsx 抽出，视觉不变）
- 重构 `app/(dashboard)/runtimes/page.tsx` 为两级手风琴（机器级分页/筛选 + 展开内嵌 runtime 卡）
- `lib/daemon.ts` 新增 machine 类型与函数；`lib/query-keys.ts` 新增 daemonMachines

### 用量聚合
- 复用现有 `GET /api/daemon/runtimes/usage`，前端按 `daemon_instance_id` 分组求和聚合费用到机器头，runtime 卡用量不变。

## 不在范围内（显式清单）

- ❌ 不改 `daemon_instances` / `daemon_runtimes` 表结构（entity-binding 已完成实体上提）
- ❌ 不改 daemon 进程（`sillyhub-daemon/`）注册/心跳/WS 协议
- ❌ 不改 `GET /daemon/instances`（保留给 workspace-daemon-switcher，online-only 轻量语义）
- ❌ 不删现有 `/runtimes/page`、`/runtimes/*` mutation 端点（保留兼容）
- ❌ 不做机器监控/资源占用（CPU/内存/磁盘）——仅 Machine 成一级资源为后续预留
- ❌ 不保留旧 runtime 平铺视图切换（完全替换，D-005）
- ❌ 不做 runtime 级跨机器聚合筛选（如「所有 online codex」）——机器级筛选优先

## 成功标准（可验证）

1. `/runtimes` 页首屏显示**机器卡列表**（默认折叠），每张机器卡展示 hostname/别名/OS·arch/状态/心跳/daemon 版本/runtime 数（在线/总数）/聚合费用；点击展开显示该机器全部 runtime 卡。
2. `GET /api/daemon/machines` 支持 `q`/`status`/`provider`/`user_id`/`limit`/`offset`，机器级分页，admin vs 普通用户权限正确，`runtime_count`/`online_runtime_count` 派生正确，0-runtime 机器返回空 runtimes。
3. 机器卡「别名」→ `PATCH /machines/{id}` 改 `daemon_instance.display_alias`；「升级 daemon」→ `POST /machines/{id}/self-update`；两者 0-runtime 机器可用。
4. runtime 卡保留可写目录/会话/审计/启禁/移除/用量统计全部现有能力，视觉对齐 `prototype-machine-runtime.html`（D-006）。
5. 现有 `/runtimes/page`、`/instances`、runtime 级端点回归不破；现有 `page.test.tsx` 适配新结构后通过；后端新增端点单测通过。
6. 跨平台（Win/Linux/macOS）行为一致。

## 关联文档
- `design.md` — 完整设计（13 节）
- `requirements.md` — FR 需求 + Given/When/Then
- `decisions.md` — D-001..D-007 决策台账
- `prototype-machine-runtime.html` — 方案 A 视觉验收基准
