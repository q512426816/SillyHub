---
id: task-11
title: Frontend test import-problem-modal.test.tsx
title_zh: 前端测试 import-problem-modal.test.tsx
author: qinyi
created_at: 2026-07-24 09:54:04
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-12]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/ppm/problem/import-problem-modal.test.tsx
provides: []
expects_from:
  task-08:
    - contract: ImportProblemModal
      needs: []
goal: >
  覆盖三态弹窗：上传→预览(标红)→结果切换、未匹配行标红渲染、确认提交回传。
implementation:
  - vi.mock importProblemsPreview/importProblemsCommit（参考 problem-detail-modal.test.tsx 的 vi.mock 纯渲染范式）
  - 用例1：初始渲染上传态(step1)，模拟选文件触发 preview，mock 返回含 valid=false 行 → 断言进入 step2 且该行标红
  - 用例2：step2 点确认提交 → 断言调 importProblemsCommit 且 onSuccess 触发
  - 用例3：step3 结果态渲染 created/skipped 统计
acceptance:
  - 三态切换断言通过
  - valid=false 行标红断言
  - 提交回传 + onSuccess 断言
verify:
  - cd frontend && pnpm test -- import-problem-modal
constraints:
  - 参考 problem-detail-modal.test.tsx 的 vi.mock 范式（jsdom 下纯渲染）
  - 不测真实 API，全 mock
---

# task-11 — 前端测试 import-problem-modal.test.tsx

> 依据：design.md §5 Wave2 step6（前端测试）、§12 自审/FR-12 验收；plan.md task-11（覆盖 FR-12）；
> 范式**完整复制** `frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.test.tsx` 的 vi.mock 纯渲染哲学
> （该文件 L14-18 明示：jsdom 下 antd Modal/Dashboard 异步提交序列易碎，全 mock API，不触发真实网络）。
> 依赖 task-08 产出的 `ImportProblemModal`（props `{ open, onClose, onSuccess }`，单表 flat rows，step1/2/3 状态机）。

## 测试范围（三态切换 + 标红 + 提交回传）

- vi.mock `@/lib/ppm/problem`（`importProblemsPreview` / `importProblemsCommit`），参考 problem-detail-modal.test.tsx L30-40 的 hoisted `vi.mock` + `vi.mocked()` 取 mock 范式；mock 返回值用 `mockResolvedValue`。
- 用例1（上传→预览，标红）：render `<ImportProblemModal open />` 初始断言 step1 文案（「选择文件开始预览」）→
  触发 `Upload.Dragger` 的 `beforeUpload` 回调（`fireEvent.change` input 或直接调 `props.beforeUpload(file)`，`file = new File([buf], "t.xlsx")`）→
  `importProblemsPreview` mock resolve 含一行 `valid=false, error="项目名未匹配"` 的 `ProblemImportPreviewResp` →
  `waitFor` 断言进入 step2（「确认导入」按钮出现）且 error 文案渲染、`rowClassName` 命中标红（`bg-red-50` 或 error Tag）。
- 用例2（提交回传 + onSuccess）：在 step2 下 `importProblemsCommit` mock resolve `{ created: 2, skipped: 1, failed_rows: [] }` →
  click「确认导入」→ `waitFor` 断言 commit 被调用（body.rows 为 valid 行数组，防篡改 D-011 仅后端测，前端只验回传形状）且进入 step3。
- 用例3（结果态统计 + onSuccess 关闭）：进入 step3 后断言 created/skipped 数值文案渲染（StatBox）、failed_rows 空时不渲染失败列表；
  click「关闭」→ 断言 `onSuccess` 回调触发一次（task-08 `handleClose` step3 触发 onSuccess 范式）。

## fixtures / 边界

- `mkPreviewRow(over)` 工厂：默认全业务字段 `null` + `valid:true, error:null, row_index:1`，按用例覆盖 `valid/error/project_name` 等（对齐 task-07 `ProblemImportPreviewRow` 字段集，只覆盖断言涉及字段，不全填）。
- 不测真实 API / 真实解析（importer 在后端 task-02 / service 在 task-05 已测）；jsdom 下不触发真实文件 IO 与网络。
- 跨天拆分等纯算法本组件不涉及（无 buildDetailDays 类逻辑），本测试聚焦三态渲染与回传契约。

## 验收 / verify

- `cd frontend && pnpm test -- import-problem-modal` 三个用例全绿。
- 纯前端 vitest jsdom，不依赖真实后端 / docker。
