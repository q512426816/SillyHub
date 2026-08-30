---
id: task-08
title: Modal preview attachment column + dynamic template download
title_zh: import-problem-modal 预览附件列 + 下载模板走动态端点
author: qinyi
created_at: 2026-07-24 14:21:45
priority: P0
depends_on: [task-07]
blocks: [task-10]
requirement_ids: [FR-10]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/ppm/problem/import-problem-modal.tsx
provides:
  - contract: ImportProblemModal
    fields: []
expects_from:
  task-07:
    - contract: downloadImportTemplate
      needs: []
    - contract: ProblemImportPreviewRow
      needs: [attachment_count, attachment_exceeded]
goal: >
  预览 Table 加「附件」列（显示 attachment_count + 超额标红）；下载模板按钮调 downloadImportTemplate（动态端点）。
implementation:
  - 预览 Table 加「附件」列：render row.attachment_count（0 显示 —）；attachment_exceeded 时行标红 + 状态列显「附件超过3张」
  - step1「下载导入模板」按钮 onClick 调 downloadImportTemplate()（替代静态 a.href=/templates/...）
acceptance:
  - 预览含附件列 + 超额标红
  - 下载模板走动态端点
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改三态结构/其他列
  - 中文 UI
---

# task-08 — Modal 预览附件列 + 下载模板动态端点

## 依据
- design.md §5 Wave2 step2、§11 D-005（附件 ≤3 超额标红）/ D-007（模板下载改动态端点）
- plan.md task-08（W2，依赖 task-07，blocks task-10）
- 现状：`import-problem-modal.tsx:97-234` 预览 17 列固定 Table；`import-problem-modal.tsx:333-347` step1 下载模板用 `a.href=/templates/problem-import-template.xlsx` 静态锚点

## 改动点（单文件）
1. **预览 Table 加「附件」列**（建议放「备注」之后、「状态」之前）
   - `dataIndex: "attachment_count"`；render `(v: number|null) => v ? String(v) : "—"`
   - `rowClassName`（行 236-239）扩展：`row.attachment_exceeded` 时返回 `"bg-red-50"`（与现有 `!row.valid` 合并取并集）
   - 状态列 render（行 217-230）：`row.attachment_exceeded` 时追加/改显 `<Tag color="red">附件超过3张</Tag>`（与现有 valid 判定合并，超额优先展示）
2. **step1 下载模板改动态端点**
   - 删除行 336-343 手搓 `a.href=/templates/...` 块
   - 改 `onClick={() => { void downloadImportTemplate().catch(e => message.error(e instanceof Error ? e.message : "模板下载失败")); }}`
   - `downloadImportTemplate` 由 task-07 在 `@/lib/ppm` 导出，blob 下载文件名「问题清单导入模板.xlsx」

## 约束
- 不动三态结构（step 1/2/3 状态机）、不动其他列、不动 handleUpload/handleCommit/handleClose
- 不在本 task 删除静态 xlsx（task-09 负责）；本 task 只改调用方式
- 中文 UI（列标题「附件」、Tag 文案「附件超过3张」）

## 验收
- 预览 Table 出现「附件」列；attachment_count=0 显「—」、>0 显数字
- attachment_exceeded 行整行标红 + 状态列显「附件超过3张」
- step1「下载导入模板」点击触发动态端点（不再请求 /templates/...）
- `cd frontend && pnpm exec tsc --noEmit` 通过（依赖 task-07 已导出新类型/函数）

## 风险
- 状态列同时存在 valid=false 与 attachment_exceeded 时展示优先级——按 design §5.3 预览阶段超额即 valid=false（error「附件超过3张」），两者文案一致不冲突
- 下载失败需用户可见提示（message.error），避免静默
