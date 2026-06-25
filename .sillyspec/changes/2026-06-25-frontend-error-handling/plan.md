---
plan_level: full
author: qinyi
created_at: 2026-06-25 10:15:00
updated_at: 2026-06-25 11:15:00
change: 2026-06-25-frontend-error-handling
project: frontend
---

# 实现计划 — 前端错误处理规范化

> 依据：`design.md`（§5/§6/§7）+ `requirements.md`（FR-01~FR-06）+ `decisions.md`（D-001~D-007，D-004@v2）+ 9 个 `tasks/task-NN.md` 蓝图。task 编号按拓扑顺序（W1→W5）严格递增，满足 plan→execute 契约（`task-0N` 仅在 Wave checkbox 出现，其余引用用纯数字编号）。无 Spike。

## Wave 1 — 基础（无依赖）
- [ ] task-01: 新增 `errMessage(err, fallback?)` 纯函数（network 中文兜底 / err.message / fallback；绝不返回 err.code）— FR-01, D-001@v1, D-002@v1, D-006@v1

## Wave 2 — 依赖 W1（4 个可并行）
- [ ] task-02: 新增 `useNotify()` hook（`App.useApp().message` + errMessage）— FR-02, D-005@v1, D-007@v1
- [ ] task-03: `errMessage` 单测（6 用例）— FR-01, D-001@v1
- [ ] task-04: D 模式 16 处收敛（保持原 inline 展示）— FR-04, D-004@v2, D-007@v1, R-02
- [ ] task-05: 合并 3 处重复 util → import 全局 — FR-05, D-002@v1

## Wave 3 — 依赖 W2
- [ ] task-06: daemon runtime 删除落地（`window.confirm`→antd `Modal.confirm` + `notify.error`/`notify.success`）— FR-03, D-003@v1, D-007@v1

## Wave 4 — 依赖 W3
- [ ] task-07: 验证 `runtimes/page.test.tsx` + `__tests__/page-usage.test.tsx` 不破坏 — R-06
- [ ] task-08: 展示策略规范同步模块文档（新建 `lib-errors.md`）— FR-06, D-007@v1

## Wave 5 — 全链路验证
- [ ] task-09: `pnpm test` 全绿 + `tsc --noEmit` + `next lint` + D 模式 grep 残留=0 — R-02, NFR-01, NFR-05

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| 01 | errMessage 纯函数 | W1 | P0 | — | FR-01, D-001@v1, D-002@v1, D-006@v1 |
| 02 | useNotify hook | W2 | P0 | 01 | FR-02, D-005@v1, D-007@v1 |
| 03 | errMessage 单测 | W2 | P0 | 01 | FR-01, D-001@v1 |
| 04 | D 模式 16 处收敛 | W2 | P1 | 01 | FR-04, D-004@v2, D-007@v1, R-02 |
| 05 | 合并 3 处重复 util | W2 | P1 | 01 | FR-05, D-002@v1 |
| 06 | daemon 删除落地 | W3 | P0 | 01, 02 | FR-03, D-003@v1, D-007@v1 |
| 07 | runtimes 测试不破坏 | W4 | P0 | 06 | R-06 |
| 08 | 模块文档同步 | W4 | P2 | 01, 02, 06 | FR-06, D-007@v1 |
| 09 | 全链路验证 | W5 | P0 | 01~08 | R-02, NFR-01, NFR-05 |

## 关键路径

`01 → 02 → 06 → 07 → 09`（5 Wave 最长链路）。Wave 2 内 03/04/05 与 02 并行；Wave 4 内 08 与 07 并行。

## 全局验收标准

> AC 为验收标准（非可执行 task），用普通列表；execute 阶段不解析 AC 为任务。

- AC-01: `errMessage` 单测全绿（network→中文兜底 / 业务→中文 message / 非 ApiError→fallback / 返回值绝不含 err.code）（03）
- AC-02: daemon runtime 删除：409 弹友好中文 toast（非 500/英文 code）、204 弹成功 toast + 列表移除、`Modal.confirm` 取代 `window.confirm`（06/07）
- AC-03: D 模式 16 处全部收敛，`rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src` 残留 = 0（04/09）
- AC-04: 3 处局部 errMessage/notifyErr 删除，改 import 全局，行为等价（05）
- AC-05: `pnpm test` 全绿（含 `api.test.ts` / `runtimes/page.test.tsx` / `page-usage.test.tsx` 不破坏）+ `tsc --noEmit` 0 error + `next lint` 通过（09）
- AC-06: （brownfield）未接入新 util 的页面行为零变化

## 覆盖矩阵（decisions.md 当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | 01, 03 | AC-01 |
| D-002@v1 | 01, 05 | AC-01, AC-04 |
| D-003@v1 | 06 | AC-02 |
| D-004@v2（supersedes D-004@v1） | 04 | AC-03 |
| D-005@v1 | 02 | AC-02 |
| D-006@v1 | 01 | AC-01（绝不含 code） |
| D-007@v1 | 02, 06, 04, 08 | AC-02, AC-03 |

> 实现细节见 `design.md §7` 与各 `tasks/task-NN.md`，plan 不重复。
