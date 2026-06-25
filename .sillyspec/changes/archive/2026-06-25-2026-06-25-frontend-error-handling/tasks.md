---
author: qinyi
created_at: 2026-06-25 10:06:00
change: 2026-06-25-frontend-error-handling
project: frontend
---

# Tasks — 前端错误处理规范化

> 仅列任务名 + 文件 + 覆盖 FR/D。实现细节在 plan 阶段展开（Wave 分组、依赖、验收点）。

## Wave 1 — 基础设施（可独立验证）

- [ ] **task-01** 新增 `errMessage(err, fallback?)` 纯函数（network_error 中文兜底 / 否则 err.message / 默认 fallback「操作失败」）— `frontend/src/lib/errors.ts` — FR-01, D-001@v1, D-002@v1, D-006@v1
- [ ] **task-02** 新增 `useNotify()` hook（封装 `App.useApp().message` + errMessage，暴露 error/success）— `frontend/src/lib/errors.ts` — FR-02, D-005@v1
- [ ] **task-03** `errMessage` 单测（network 兜底 / 业务中文 / 非 ApiError / fallback / 绝不含 code）— `frontend/src/lib/errors.test.ts` — FR-01, D-001@v1

## Wave 2 — 首场景落地（端到端验证）

- [ ] **task-04** daemon 删除改造：`window.confirm`→`Modal.confirm`、失败 `setError`→`notify.error`、成功补 `notify.success` — `frontend/src/app/(dashboard)/runtimes/page.tsx` — FR-03, D-003@v1, D-007@v1
- [ ] **task-05** 验证 `runtimes/page.test.tsx` 不破坏（必要时同步更新 mock/断言）— R-06

## Wave 3 — 收敛（依赖 Wave 1）

- [ ] **task-06** D 模式 16 处收敛（`${code}: ${message}`→`errMessage`/`notify`，保持原 toast/inline）— 16 处文件（清单见 design §6）— FR-04, D-004@v2, D-007@v1, R-02
- [ ] **task-07** 合并 3 处重复局部 `errMessage` util → import 全局 — `stores/kanban.ts` / `ppm/problem-list/_forms.tsx` / `ppm/problem-changes/_forms.tsx` — FR-05, D-002@v1
- [ ] **task-08** 展示策略规范同步模块文档（`lib-errors.md` 注意事项区 + daemon 相关）— FR-06, D-007@v1

## 验证（全链路）

- [ ] **task-09** `pnpm test` 全绿 + `tsc --noEmit` 0 error + `rg D 模式残留` = 0 + `pnpm lint` — R-02, NFR-01, NFR-05
