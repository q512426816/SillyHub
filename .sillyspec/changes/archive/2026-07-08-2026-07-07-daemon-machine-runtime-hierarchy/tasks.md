---
author: WhaleFall
created_at: 2026-07-07 16:15:16
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: brainstorm
---

# Tasks — 高层任务清单（brainstorm 产出，plan 阶段细化 Wave/依赖/粒度）

> 本文件为 brainstorm 阶段的高层任务分解，按 design §12 文件变更清单推导。`sillyspec run plan` 阶段将细化为 Wave 分组 + 依赖关系 + 验收点。

## 后端（backend/app/modules/daemon/）

- **T-B1 schema 新增**：`schema.py` 新增 `DaemonMachineRead` / `DaemonMachineListResponse` / `DaemonMachineUpdate`（含 `runtime_count` / `online_runtime_count` / 嵌套 `runtimes: list[DaemonRuntimeRead]`）。
- **T-B2 service 新增**：`runtime/service.py` 新增 `list_machines(...)`（主查询 JOIN users + 二次 IN 查 runtimes 分组 + 派生计数 + 排序）、`update_machine_alias(...)`、`_get_owned_instance(...)`；`service.py:DaemonService` 薄委托。
- **T-B3 router 新增 3 端点**：`router.py` 新增 `GET /machines`、`PATCH /machines/{id}`、`POST /machines/{id}/self-update`，显式 `response_model`，权限 `RuntimeAdminUser` + 归属校验。
- **T-B4 后端测试**：`GET /machines`（分页/筛选 q·status·provider·user_id/排序/权限 admin vs 普通/计数派生/0-runtime）、`PATCH /machines/{id}`（正常/null 清空/越权 403/404）、`POST /machines/{id}/self-update`（路由/离线 504）；现有端点回归。

## 前端（frontend/src/）

- **T-F1 lib 层**：`lib/daemon.ts` 新增 `DaemonMachineRead` 等类型 + `listDaemonMachines` / `updateDaemonMachine` / `triggerMachineSelfUpdate`；`lib/query-keys.ts` 新增 `daemonMachines`。
- **T-F2 hook**：新增 `lib/use-daemon-machines.ts`（react-query，`Promise.all` machines+sessions，15s 轮询）。
- **T-F3 RuntimeCard 抽组件**：从 `page.tsx` 抽出 `components/daemon/runtime-card.tsx`，视觉不变（仅去 Daemon 版本行，D-006/C-002）。
- **T-F4 MachineCard 新组件**：新增 `components/daemon/machine-card.tsx`（折叠头含聚合费用+runtime数胶囊+别名/升级；展开体 RuntimeCard 网格；1:1 对齐原型）。
- **T-F5 page 重构**：`app/(dashboard)/runtimes/page.tsx` 改两级手风琴（机器级 SummaryCard/分页/筛选/时间窗 + MachineCard 列表 + 展开态记忆 + `?session=` 恢复改编 + 4 Modal 保留，别名改调 `updateDaemonMachine`）。
- **T-F6 前端测试**：`machine-card.test.tsx`、`runtime-card.test.tsx`、`use-daemon-machines.test.tsx` 新增；`page.test.tsx` / `page-usage.test.tsx` 适配新结构。

## 验收（贯穿）
- 视觉 1:1 对齐 `prototype-machine-runtime.html`（D-006）。
- 后端 `cd backend && pytest` 通过；前端 `cd frontend && pnpm test` 通过；test_strategy=module。
- 跨平台行为一致；中文 UI。

## 依赖（plan 阶段排序依据）
- T-B1 → T-B2 → T-B3 → T-B4（后端自上而下）
- T-F1 → T-F2 → T-F3 → T-F4 → T-F5 → T-F6（前端自上而下）
- T-F2 依赖 T-B3（hook 调真实端点）；T-F5 可先用 mock 并行，集成测试依赖 T-B3。
- 建议 Wave：W1 后端端点+测试（T-B*）｜W2 前端 lib+hook+组件（T-F1..F4）｜W3 page 重构+集成测试（T-F5..F6）。
