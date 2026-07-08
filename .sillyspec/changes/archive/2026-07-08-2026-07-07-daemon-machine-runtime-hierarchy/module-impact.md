---
author: WhaleFall
created_at: 2026-07-08 11:35:00
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: archive
---

# 模块影响分析 — 守护进程运行时页 Machine→Runtime 两级重构

## 三重交叉验证

- **声明范围**（design §12 文件变更清单）：backend schema/router/runtime service/service + 测试；frontend lib/use-daemon-machines/components/page/query-keys + 测试。
- **任务范围**（plan.md / tasks/task-01~10.md allowed_paths）：与声明一致。
- **真实变更**（`git status --short` + 未跟踪新建文件，共 18 个代码文件）：以 git diff 为准。

三重一致，无超范围改动。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| daemon | 接口变更 + 新增 | `backend/app/modules/daemon/schema.py`（+`DaemonMachineRead`/`DaemonMachineListResponse`/`DaemonMachineUpdate` 三 DTO）<br>`backend/app/modules/daemon/runtime/service.py`（+`list_machines`/`update_machine_alias`/`_get_owned_instance`）<br>`backend/app/modules/daemon/service.py`（+DaemonService 三薄委托）<br>`backend/app/modules/daemon/router.py`（+`GET /machines`/`PATCH /machines/{id}`/`POST /machines/{id}/self-update` + `_build_machine_read`）<br>`backend/app/modules/daemon/tests/test_machines_router.py`（+25 用例） | 新增机器级聚合读视图 + 两个机器级写操作（别名/升级）。0 改表、0 破坏既有契约（§5.4 现有端点全保留）。**不 touch `sillyhub-daemon/`**（进程协议不动，§14 生命周期豁免）。 | false |
| frontend_app | 逻辑变更（重构） | `frontend/src/app/(dashboard)/runtimes/page.tsx`（Runtime 平铺 → Machine→Runtime 两级手风琴，+1010/-993）<br>`frontend/src/app/(dashboard)/runtimes/page.test.tsx`（mock 改 listDaemonMachines + 加强两级断言）<br>`frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx`（适配）<br>`frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx`（适配） | page 完全替换为两级视图（D-005）：机器级 SummaryCard/分页/筛选/时间窗 + MachineCard 列表 + 展开态记忆 + ?session 恢复改编 + 4 Modal 保留。 | false |
| frontend_components | 新增 | `frontend/src/components/daemon/machine-card.tsx`（新）<br>`frontend/src/components/daemon/runtime-card.tsx`（新，从 page 抽出）<br>`frontend/src/components/daemon/runtime-card-helpers.tsx`（新，含 JSX 故 .tsx）<br>`frontend/src/components/daemon/__tests__/machine-card.test.tsx`（新）<br>`frontend/src/components/daemon/__tests__/runtime-card.test.tsx`（新） | MachineCard 新组件（1:1 对齐 prototype 方案 A：折叠头+聚合费用+runtime数胶囊+展开体+0-runtime空态）；RuntimeCard 从 page 抽出（去 Daemon 版本行 C-002）。 | false |
| frontend_lib | 新增 | `frontend/src/lib/daemon.ts`（+machine 类型 + `listDaemonMachines`/`updateDaemonMachine`/`triggerMachineSelfUpdate`）<br>`frontend/src/lib/query-keys.ts`（+`daemonMachines`）<br>`frontend/src/lib/use-daemon-machines.ts`（新 hook，15s 轮询）<br>`frontend/src/lib/__tests__/use-daemon-machines.test.ts`（新） | 机器级 API client（类型+3 函数+query-key）+ react-query hook（仿 use-daemon-runtimes，用量另走 /runtimes/usage D-004）。 | false |

## 未匹配文件

无。全部 18 个代码文件均匹配到 `_module-map.yaml` 的模块 glob。

## 不改动模块（明确豁免）

- **sillyhub-daemon**（daemon 进程，`sillyhub-daemon/src/**`）：本变更**零改动**。design §14 生命周期豁免：不改 daemon 注册/心跳/WS 协议；升级操作复用既有 `daemon:self_update` WS 消息（仅改路由键 instance_id，不新增事件类型）。
- **core / models / auth / 其它 backend 模块**：无改动（复用现有 DaemonInstance/DaemonRuntime ORM 模型，0 改表）。
- **frontend_stores**：无改动（hook 用现有 useSession）。

## needs_review 说明

4 个受影响模块 needs_review 均为 false：
- daemon：纯新增端点 + 0 破坏既有契约（529 passed 回归验证），现有 `/runtimes/*` 端点全部保留。
- frontend_app/components/lib：重构 + 新增，tsc/test 全过（689 passed），复用既有模式。
