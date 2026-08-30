---
id: task-07
title: Frontend client downloadImportTemplate (dynamic) + attachment type
title_zh: lib/ppm problem.ts downloadImportTemplate 改动态端点 + types 加附件字段
author: qinyi
created_at: 2026-07-24 14:21:30
priority: P0
depends_on: [task-05]
blocks: [task-08, task-09]
requirement_ids: [FR-10]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/lib/ppm/problem.ts
  - frontend/src/lib/ppm/types.ts
provides:
  - contract: downloadImportTemplate
    fields: []
  - contract: ProblemImportPreviewRow
    fields: [attachment_count, attachment_exceeded]
expects_from:
  task-05:
    - contract: GET /problem-list/import-template
      needs: []
goal: >
  下载模板改调动态端点 GET /import-template；PreviewRow 类型加 attachment_count/exceeded。
implementation:
  - problem.ts 增 downloadImportTemplate()：GET /api/ppm/problem-list/import-template（downloadExcel 或 blob 下载，替代静态 a.href）
  - "types.ts ProblemImportPreviewRow 加 attachment_count: number + attachment_exceeded: boolean"
acceptance:
  - downloadImportTemplate 调动态端点
  - 类型含 attachment_count/exceeded
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改现有 importProblemsPreview/Commit/exportProblems
  - 走统一 downloadExcel/blob helper
---

# task-07 — 前端 client downloadImportTemplate 改动态端点 + 类型加附件字段

## 依据

- design.md §5 Wave2.1（`lib/ppm/problem.ts`: `downloadImportTemplate()` 改调 `GET /problem-list/import-template`，blob 下载；类型加 attachment_count/exceeded）
- design.md §7（`GET /api/ppm/problem-list/import-template → 200 xlsx`；`ProblemImportPreviewRow += attachment_count: int; attachment_exceeded: bool`）
- design.md §11 D-007@v1（模板下载改动态端点 → §5 Wave2）
- plan.md task-07 / 任务总表（W2 P0，依赖 Wave 1，覆盖 FR-10 / D-007）
- 现状代码：
  - `frontend/src/lib/ppm/problem.ts` 现无 downloadImportTemplate；导出走 `downloadExcel`（export.ts:45，签名 `downloadExcel(path, params?, filename?)`），导入预览走 `uploadExcelWithAuth`，提交走 `apiFetch`
  - `frontend/src/lib/ppm/types.ts` ProblemImportPreviewRow（types.ts:894-931）现 24 字段无附件相关字段

## 改动

### 1. `frontend/src/lib/ppm/problem.ts`

新增导出函数（与 `exportProblems` 同范式：调 `downloadExcel`，文件名兜底）：

```ts
/**
 * 下载导入模板 (GET /api/ppm/problem-list/import-template, 动态生成 xlsx)。
 *
 * 后端按当前用户 data_scope 生成: 18 列表头 + 隐藏 sheet "_data" +
 * DataValidation 下拉(项目/责任人/验证人 按范围、模块全部平铺、枚举固定)。
 * 替代旧静态 public/templates/problem-import-template.xlsx (task-09 删)。
 */
export async function downloadImportTemplate(): Promise<void> {
  await downloadExcel(
    "/api/ppm/problem-list/import-template",
    undefined,
    "problem-import-template.xlsx",
  );
}
```

### 2. `frontend/src/lib/ppm/types.ts`

在 `ProblemImportPreviewRow`（types.ts:894）「---- 校验结果 ----」区块前或 `remarks` 后，加两个附件字段，对齐后端 schema.py（D-005）：

```ts
  /** 附件图片数量 (importer 从 ws._images 按锚点行聚合统计, D-001) */
  attachment_count: number;
  /** 附件是否超过 3 张 (>3 → true, valid=false "附件超过3张", D-005) */
  attachment_exceeded: boolean;
```

字段位置：放在业务字段与反查结果之间（remarks 之后、`// ---- 反查结果 ----` 之前），保持「Excel 原文 → 附件 → 反查 → 校验」分组顺序。

## 验收

- `downloadImportTemplate` 走 `downloadExcel("/api/ppm/problem-list/import-template", ...)`，**非**静态 a.href
- `ProblemImportPreviewRow` 新字段类型严格：`attachment_count: number`（非 nullable）、`attachment_exceeded: boolean`
- 现有 `importProblemsPreview` / `importProblemsCommit` / `exportProblems` 不动
- `cd frontend && pnpm exec tsc --noEmit` 通过（下游 task-08/09/10 依赖此契约）

## 约束

- 不引入 blob 手写 fetch；统一走 `downloadExcel`（已有 token + 401 刷新 + 文件名兜底）
- 不改其它 problem client 函数；不动 ProblemImportPreviewResp / Commit / Result 类型
- 字段命名严格 snake_case 对齐后端 Pydantic（task-08 前端展示直接读 attachment_count）
