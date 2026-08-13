---
author: qinyi
created_at: 2026-08-13T22:30:00
change: 2026-08-13-spec-sync-visibility
---

# 实现计划（Plan）：工作区配置页「同步到服务器」可见性增强

## 规模分类

- has_schema_change: **true**（DaemonChangeWrite 加 files_total/files_processed 列 + Alembic 迁移）
- has_state_machine_change: **false**（pending→claimed→done/failed 不变；progress 端点不置终态）
- needs_parallel_execution: **false**（Wave 间有依赖，串行；Wave 内 task 多数共享文件须串行）
- needs_human_review: **true**（W4 跨三端 + 新端点，独立 plan review）

## Wave 依赖总览

```
W1(纯前端,失败透传) ──┐
                      ├─→ W3(后端+迁移+终态计数,含 progress 端点) ─→ W4(过程 onProgress 回调+前端 Progress)
W2(纯前端,按钮提示) ──┘
```

W1/W2 并行（互不依赖，但都改 workspace-config-card.tsx → 同 Wave 内串行，分两 Wave 避共享文件并行覆盖）。
W3 是分水岭：加列+迁移+端点+终态计数。**progress 端点归 W3**（W3 终态计数依赖它，D-004 单一写者）。
W4 复用 W3 端点，加过程回调（onWalkComplete/onProgress）+ 前端 Progress 条。

## 关键契约（provides/expects_from 对账基准）

| provider task | provides 契约 | consumer task |
|---|---|---|
| task-06（加列+迁移） | `model.files_total/processed` 列存在 | task-07, task-09, task-11 |
| task-11（progress 端点） | `PATCH .../progress` 端点 + `reportChangeWriteProgress` daemon client 方法 | task-08（终态上报）, task-13（过程上报） |
| task-01（PendingSyncItem 对齐） | 前端类型含 error/completed_at/files_total/processed | task-02, task-09, task-14 |

## Wave 1：失败原因透传（纯前端，FR-01）

串行（共享 spec-workspaces.ts + workspace-config-card.tsx）。

- [ ] task-01: PendingSyncItem 整体对齐后端（FR-01 前置，修既有 schema 漂移）。provides: 前端类型含 task_id/status/runtime_id/error/completed_at。
  - allowed_paths: `frontend/src/lib/spec-workspaces.ts`
- [ ] task-02: 失败分支透传 latest.error（FR-01）+ 测试。depends_on: task-01。
  - allowed_paths: `frontend/src/components/workspace-config-card.tsx`, `frontend/src/components/workspace-config-card.test.tsx`

## Wave 2：按钮提示 + 规范对齐（纯前端，FR-02/03/04）

串行（共享 workspace-config-card.tsx）。depends_on: task-02（W1 收尾，避免改同一文件冲突）。

- [ ] task-03: 5 按钮 antd Tooltip 含义文案 + disabled 原因文案 span 包裹（FR-02 含义提示 + FR-03 disabled 原因提示）。depends_on: task-02。
  - allowed_paths: `frontend/src/components/workspace-config-card.tsx`
- [ ] task-04: 规范对齐 FRONTEND_PAGE_STYLE §5/§11（FR-04：shadcn→antd import 重构 / size sm→middle / "…中"→动词+loading / window.confirm→Modal.confirm）。depends_on: task-03。
  - allowed_paths: `frontend/src/components/workspace-config-card.tsx`
- [ ] task-05: 补 renderGuidance 缺口（导入/生成项目进行中引导框，FR-02/04 辅助）+ 测试。depends_on: task-04。
  - allowed_paths: `frontend/src/components/workspace-config-card.tsx`, `frontend/src/components/workspace-config-card.test.tsx`

## Wave 3：同步终态计数 + progress 端点（后端+迁移+前端，FR-05）

端点归此 Wave（W3 终态计数依赖它）。

- [ ] task-06: DaemonChangeWrite 加 files_total/files_processed 列 + Alembic 迁移 up/down（FR-05 后端基础）。provides: model 列。
  - allowed_paths: `backend/app/modules/daemon/model.py`, `backend/migrations/versions/`
- [ ] task-07: sync_manual_get_pending 返回加 files_total/files_processed（FR-05）。depends_on: task-06。
  - allowed_paths: `backend/app/modules/spec_workspace/service.py`
- [ ] task-11: 后端新增 PATCH progress 端点 + ChangeWriteProgressRequest schema + status==claimed 校验（BL-3，FR-05/FR-06 共用端点）+ 端点测试。provides: progress 端点。depends_on: task-06。
  - allowed_paths: `backend/app/modules/daemon/change_write_router.py`, `backend/app/modules/daemon/schema.py`, `backend/app/modules/daemon/tests/`
- [ ] task-08: daemon spec-sync 分支 complete 前最后一次 progress 上报（FR-05 终态计数，D-004 单一写者）+ hub-client reportChangeWriteProgress 方法 + daemon.ts 接口声明。depends_on: task-11。expects_from: task-11 提供 reportChangeWriteProgress 端点契约。
  - allowed_paths: `sillyhub-daemon/src/task-runner.ts`, `sillyhub-daemon/src/hub-client.ts`, `sillyhub-daemon/src/daemon.ts`, `sillyhub-daemon/src/spec-sync.ts`
- [ ] task-09: 前端 done 分支展示「已同步 N 个文件」（FR-05，files_total null 降级文案）+ PendingSyncItem 加 files_total/processed（随 task-01 对齐补）。depends_on: task-07, task-01。
  - allowed_paths: `frontend/src/lib/spec-workspaces.ts`, `frontend/src/components/workspace-config-card.tsx`
- [ ] task-10: gen:types 同步 openapi.json + api-types.ts（FR-05 schema 变更同步）。depends_on: task-06, task-07, task-11。
  - allowed_paths: `backend/openapi.json`, `frontend/src/lib/api-types.ts`

## Wave 4：同步实时进度（阶段级，跨三端，FR-06）

复用 W3 端点，加过程回调。

- [ ] task-12: daemon postSpecSync 加 onProgress 回调 + packSpecDir 加 onWalkComplete 钩子（FR-06 + BL-2 全量路径 total 上报窗口）。depends_on: task-08。
  - allowed_paths: `sillyhub-daemon/src/spec-sync.ts`, `sillyhub-daemon/tests/spec-sync.test.ts`
- [ ] task-13: daemon task-runner spec-sync 分支接 onProgress 到 progress 端点（FR-06，增量 ops.length / 全量 onWalkComplete 两路径上报点 + complete 前终态上报协同 task-08）。depends_on: task-12, task-08。
  - allowed_paths: `sillyhub-daemon/src/task-runner.ts`, `sillyhub-daemon/tests/`
- [ ] task-14: 前端 syncing 分支 antd Progress 条 + 「同步中 N/M」（FR-06，files_total 未知降级阶段名「打包中」BL-2）+ 测试。depends_on: task-09, task-13。
  - allowed_paths: `frontend/src/components/workspace-config-card.tsx`, `frontend/src/components/workspace-config-card.test.tsx`

## 收尾

- [ ] task-15: 全量回归（前端 vitest + backend pytest spec_workspace/daemon + daemon vitest）+ gen:types diff 干净 + 模块文档更新（spec_workspace.md/daemon.md/spec-sync.md 变更索引）。depends_on: task-14。
  - allowed_paths: `.sillyspec/docs/backend/modules/spec_workspace.md`, `.sillyspec/docs/backend/modules/daemon.md`, `.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md`

## 验收点（关键）

- W1：失败时前端显示真实 error（非写死）；PendingSyncItem 与后端返回字段一致。
- W2：5 按钮 Tooltip 含义+disabled 原因；无 shadcn Button/size sm/window.confirm/"…中"残留；tsc+vitest 绿。
- W3：迁移 up/down 幂等；progress 端点 status==claimed 校验（pending/done/failed 返 409）；complete 不碰计数列；终态「已同步 N 个」显示。
- W4：onWalkComplete 钩子在 walkDir 后 tar 拼接前触发；全量首同步 total 未知时前端降级「打包中」；Progress 条 N/M 跳动（阶段级）。
- gen:types diff 仅含本次 schema 变更。

## 风险（继承 design.md 风险登记 7 条）

W4 task-13 的 onProgress 时序最易 flaky——单测覆盖增量/全量/终态三上报点，回调失败仅 warn 不阻塞同步。
