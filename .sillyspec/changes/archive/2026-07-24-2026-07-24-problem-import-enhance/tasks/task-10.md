---
id: task-10
title: Adapt import-problem-modal.test for attachment column + dynamic template
title_zh: 前端测试适配 附件列 + 下载模板动态
author: qinyi
created_at: 2026-07-24 14:22:15
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/ppm/problem/import-problem-modal.test.tsx
provides: []
expects_from:
  task-08:
    - contract: ImportProblemModal
      needs: []
goal: >
  测试适配：预览附件列渲染 + 超额标红 + 下载模板调动态端点。
implementation:
  - vi.mock downloadImportTemplate（动态端点）
  - 用例：preview 返回含 attachment_exceeded=true 行 → 断言附件列显示 + 标红 + 状态列「附件超过3张」
  - 用例：step1 点「下载导入模板」→ 断言调 downloadImportTemplate（非静态 a.href）
acceptance:
  - 附件列 + 超额标红断言通过
  - 下载模板走动态端点断言
verify:
  - cd frontend && pnpm test -- import-problem-modal
constraints:
  - 参考 problem-detail-modal.test.tsx vi.mock 范式
  - 全 mock，不测真实 API
---

# TaskCard — 前端测试适配（附件列 + 下载模板动态）

## 依据

- design.md §5 Wave2.4（测试适配）、§12 FR-10 验收（前端附件列 + 下载动态）
- plan.md task-10（W2，依赖 task-08，覆盖 FR-10）
- D-005@v1（附件 ≤3 超额标红）、D-007@v1（模板下载改动态端点）

## 现状（import-problem-modal.test.tsx 已有三用例）

- `vi.mock("@/lib/ppm/problem")` 仅 mock `importProblemsPreview` / `importProblemsCommit`
- `mkPreviewRow` 字段集**不含** `attachment_count` / `attachment_exceeded`（task-03 schema 新增字段，task-07 类型同步）
- 用例1~3 覆盖三态切换 + 标红 + 提交回传，**未覆盖**附件列与下载模板

## 实现要点

1. **vi.mock 扩展**：`@/lib/ppm/problem` 的 mock 工厂追加 `downloadImportTemplate: vi.fn()`（动态端点，D-007），并在顶部 `import { downloadImportTemplate }` 取 `vi.mocked()` 引用。
2. **mkPreviewRow 补字段**：加 `attachment_count: over.attachment_count ?? 0` + `attachment_exceeded: over.attachment_exceeded ?? false`（对齐 task-07 类型）。
3. **新增用例A（附件超额，D-005）**：preview 返回 `attachment_count=4, attachment_exceeded=true, valid=false` 行 → 断言：
   - 附件列单元格渲染计数「4」；
   - 该行 `<tr>` 带 `bg-red-50`（沿用现有 rowClassName 标红判定）；
   - 状态列 Tag 文案含「附件超过3张」（task-08 新增文案）。
4. **新增用例B（下载模板动态端点，D-007）**：step1 渲染后点「下载导入模板」按钮 → 断言 `downloadImportTemplate` 被调用一次；**反向断言**未走静态 `a.href`（无 `public/templates/...xlsx` 请求 / 无 `<a download>` 创建，task-09 已删静态文件）。
5. URL.createObjectURL / HTMLAnchorElement 在 jsdom 下按 problem-detail-modal.test.tsx 范式 stub（避免 jsdom 不支持 download 行为的脆性）。

## 边界

- 全 mock，不触发真实 API / 真实 Excel 解析（后端 task-02/05 已测）。
- 不改三态现有用例（仅 fixture 补字段，保持零回归）。

## 验收

- `cd frontend && pnpm test -- import-problem-modal` 全绿（原 3 用例 + 新增 2 用例）。
- 附件列 + 超额标红 + 状态文案 + 动态下载端点断言均通过。
