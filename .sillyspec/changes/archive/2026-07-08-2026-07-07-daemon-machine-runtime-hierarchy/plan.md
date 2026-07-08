---
author: WhaleFall
created_at: 2026-07-07 16:27:15
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: plan
plan_level: full
---

# 实现计划 — 守护进程运行时页 Machine→Runtime 两级重构

## 来源
brainstorm 四件套（design.md / proposal.md / requirements.md / decisions.md / tasks.md）+ `prototype-machine-runtime.html`（方案 A 视觉基准）。后端两级数据模型已就位（entity-binding），本变更新增机器级读写端点 + 前端两级手风琴重构。

## 范围
- **backend**（`backend/app/modules/daemon/`）：schema 新增 3 DTO、runtime/service 新增 `list_machines`/`update_machine_alias`/`_get_owned_instance`、router 新增 3 端点、后端测试。0 改表、0 破坏既有契约。
- **frontend**（`frontend/src/`）：lib 类型+函数、`use-daemon-machines` hook、`RuntimeCard` 抽组件、`MachineCard` 新组件、`/runtimes/page.tsx` 重构、前端测试。
- **不动**：表结构、daemon 进程协议、`/instances`、`/runtimes/page`、runtime 级 mutation 端点。

## Spike 前置验证
无。技术确定性强——复用既有两级 ORM 模型 + 既有 `_runtime_read`/`_get_owned_runtime`/`hub.send_self_update` 模式，无新技术栈/隔离/性能瓶颈。

## Wave 1（后端，可独立完成）
- [x] task-01: schema 新增 `DaemonMachineRead`/`DaemonMachineListResponse`/`DaemonMachineUpdate`（覆盖：FR-1, FR-2, D-002, D-003, D-007）
- [x] task-02: service 新增 `list_machines`/`update_machine_alias`/`_get_owned_instance`（覆盖：FR-1, FR-2, D-001, D-002, D-004）
- [x] task-03: router 新增 `GET /machines` + `PATCH /machines/{id}` + `POST /machines/{id}/self-update`（覆盖：FR-1, FR-2, FR-3, D-001）
- [x] task-04: 后端单测 + 既有端点回归（覆盖：FR-1, FR-2, FR-3, FR-8）

## Wave 2（前端基础，依赖 Wave 1 端点契约；可先用 mock 并行启动）
- [x] task-05: `lib/daemon.ts` machine 类型 + `listDaemonMachines`/`updateDaemonMachine`/`triggerMachineSelfUpdate` + `query-keys.daemonMachines`（覆盖：FR-1, FR-2, FR-3）
- [x] task-06: 新增 `lib/use-daemon-machines.ts` hook（15s 轮询 + sessions 并发）（覆盖：FR-4, FR-6, D-004）
- [x] task-07: 抽 `components/daemon/runtime-card.tsx`（视觉不变，去 Daemon 版本行）（覆盖：FR-5, D-006, C-002）
- [x] task-08: 新增 `components/daemon/machine-card.tsx`（折叠头 + 展开体，1:1 对齐原型）（覆盖：FR-4, D-002, D-003, D-006）

## Wave 3（前端集成，依赖 Wave 2）
- [x] task-09: 重构 `app/(dashboard)/runtimes/page.tsx`（机器级 SummaryCard/分页/筛选/时间窗 + MachineCard 列表 + 展开态记忆 + `?session=` 恢复改编 + 4 Modal 保留）（覆盖：FR-4, FR-7, D-005, D-006, D-007）
- [x] task-10: 前端测试（machine-card/runtime-card/use-daemon-machines + page 适配）（覆盖：FR-4, FR-5, FR-6, FR-7）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | schema 新增 machine DTO | W1 | P0 | — | FR-1,2; D-002,003,007 | DaemonMachineRead 含 runtime_count/online_runtime_count/嵌套 runtimes |
| task-02 | service list_machines + alias + 归属 | W1 | P0 | task-01 | FR-1,2; D-001,002,004 | 主查询 JOIN users + IN 查 runtimes 分组，避免 N+1 |
| task-03 | router 3 端点 | W1 | P0 | task-02 | FR-1,2,3; D-001 | 显式 response_model，RuntimeAdminUser + 归属校验 |
| task-04 | 后端测试 + 回归 | W1 | P0 | task-03 | FR-1,2,3,8 | /machines 全维度 + mutation 越权/离线 + 既有端点不破 |
| task-05 | lib 类型 + 函数 + query-keys | W2 | P0 | task-03（契约） | FR-1,2,3 | 可先按契约 mock，集成在 W3 |
| task-06 | useDaemonMachines hook | W2 | P0 | task-05 | FR-4,6; D-004 | 仿 use-daemon-runtimes 结构 |
| task-07 | RuntimeCard 抽组件 | W2 | P0 | — | FR-5; D-006, C-002 | 从 page.tsx 抽出，仅去 Daemon 版本行 |
| task-08 | MachineCard 新组件 | W2 | P0 | task-07 | FR-4; D-002,003,006 | 折叠头（聚合费用+runtime数胶囊+别名/升级）+ 展开体 |
| task-09 | page.tsx 重构两级 | W3 | P0 | task-06,08 | FR-4,7; D-005,006,007 | SummaryCard 机器级 + 手风琴 + ?session 恢复 |
| task-10 | 前端测试 | W3 | P0 | task-09 | FR-4,5,6,7 | 新组件单测 + page 适配现有测试 |

## 关键路径
task-01 → task-02 → task-03 → task-05 → task-06 → task-08 → task-09 → task-10（后端 schema 链 → 前端 lib/hook/组件 → page 集成 → 测试）。task-07（RuntimeCard 抽离）可与 task-05/06 并行，汇入 task-08。

## 全局验收标准
- [ ] `GET /machines` 机器级分页/筛选（q/status/provider/user_id）/排序/权限正确；runtime_count/online_runtime_count 派生正确；0-runtime 机器 runtimes=[]（FR-1, D-002, D-003, D-007）
- [ ] `PATCH /machines/{id}` 别名 正常/null 清空/越权 403/不存在 404；0-runtime 机器可改（FR-2, D-001）
- [ ] `POST /machines/{id}/self-update` 路由正确；离线 → 504（FR-3, D-001）
- [ ] 现有 `/runtimes/page`、`/instances`、runtime 级 mutation 端点行为不变（FR-8）
- [ ] `/runtimes` 页两级手风琴：机器卡折叠/展开 + 展开态记忆 + 机器头聚合费用/runtime 数胶囊 + 别名/升级按钮（离线 disabled）（FR-4, D-006）
- [ ] runtime 卡用量统计区（4 数字 + sparkline）+ 可写目录/会话/审计/启禁/移除全保留；去 Daemon 版本行（FR-5, D-006, C-002）
- [ ] 0-runtime 机器展开显空态（D-003）
- [ ] `?session=` 恢复：自动展开所属 machine + 开弹窗（FR-7）
- [ ] 视觉 1:1 对齐 `prototype-machine-runtime.html`（D-006）
- [ ] `cd backend && pytest` 通过；`cd frontend && pnpm test` 通过（test_strategy=module）
- [ ] 跨平台（Win/Linux/macOS）行为一致；中文 UI（NFR-1, NFR-2, NFR-7）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（机器级操作上提） | task-02, task-03, task-08, task-09 | /machines mutation 端点 + 机器卡别名/升级按钮 |
| D-002@v1（机器状态来源=instance.status） | task-01, task-08, task-09 | DaemonMachineRead.status + 机器卡状态徽章 |
| D-003@v1（空机器展示） | task-01, task-08 | runtime_count=0/runtimes=[] + 机器卡空态 |
| D-004@v1（用量不内联，前端聚合） | task-06, task-09 | hook 复用 /runtimes/usage + 机器头 sum |
| D-005@v1（完全替换两级视图） | task-09 | page 无平铺切换 |
| D-006@v1（视觉 1:1 对齐原型） | task-07, task-08, task-09 | RuntimeCard/MachineCard/page 对齐 prototype |
| D-007@v1（机器级分页） | task-01, task-09 | limit/offset 机器级 + PAGE_SIZE=20 |
| C-002（runtime 卡去 Daemon 版本行） | task-07 | RuntimeCard meta 无 Daemon 版本 |

| FR | 覆盖任务 |
|---|---|
| FR-1（GET /machines） | task-01,02,03,04,05 |
| FR-2（PATCH /machines 别名） | task-01,02,03,04,05,08,09 |
| FR-3（POST self-update） | task-01,03,04,05,08 |
| FR-4（两级手风琴视图） | task-06,08,09,10 |
| FR-5（RuntimeCard 抽组件） | task-07,10 |
| FR-6（用量聚合） | task-06,09,10 |
| FR-7（?session= 恢复） | task-09,10 |
| FR-8（既有端点回归） | task-04 |

## 自检
- [x] plan_level 标注 full
- [x] Wave 分组（W1 后端 / W2 前端基础 / W3 前端集成）+ 依赖说明
- [x] 任务总表 ≤15（10 个），含 优先级/依赖/覆盖
- [x] 任务使用 checkbox 格式（`- [ ] task-XX:`）
- [x] 全局验收具体可验证（非笼统）
- [x] 覆盖矩阵含全部 D-001..D-007 + FR-1..FR-8
- [x] 无 P0/P1 unresolved blocker（decisions 全 accepted）
- [x] 无估时、无实现细节（细节留 execute）、无泛泛风险
- [x] 无 Mermaid（依赖为三波链式，非平凡性不足）
