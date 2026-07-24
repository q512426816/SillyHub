---
id: task-08
title: Frontend import-problem-modal.tsx three-step modal
title_zh: 新增 components/ppm/problem/import-problem-modal.tsx 三态弹窗
author: qinyi
created_at: 2026-07-24 09:52:21
priority: P0
depends_on: [task-07]
blocks: [task-09, task-11]
requirement_ids: [FR-12]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/ppm/problem/import-problem-modal.tsx
provides:
  - contract: ImportProblemModal
    fields: []
expects_from:
  task-07:
    - contract: importProblemsPreview
      needs: []
    - contract: importProblemsCommit
      needs: []
    - contract: ProblemImportPreviewRow
      needs: [valid, error, project_name, module_name, pro_desc, duty_user_name, audit_user_name]
    - contract: ProblemImportResultResp
      needs: [created, skipped, failed_rows]
goal: >
  复制 import-module-modal 三态范式适配问题清单全字段：上传→预览(未匹配标红)→结果，
  成功后 onSuccess 刷新列表。
implementation:
  - 新建 import-problem-modal.tsx，props: { open, onClose, onSuccess }
  - step1：Upload.Dragger(.xlsx) + 下载模板按钮(public/templates/problem-import-template.xlsx)
  - step2：全字段 Table（项目/模块/描述/类型/加急/功能/责任人/发现人/时间/计划起止/验证人/工作量/...+状态列）；valid=false 或 error 行 rowClassName 标红；确认提交勾选行
  - step3：StatBox 统计 created/skipped/failed
  - 复用 import-module-modal 的 step/checkedRows/handleUpload/handleCommit 结构，适配为单表 rows（非 sheets）
acceptance:
  - 三态切换正确
  - 未匹配/错误行标红
  - 确认导入调 importProblemsCommit，成功 onSuccess
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 复制范式，问题清单是单表（flat rows）非 plan 的 sheets 多表
  - 不改 import-module-modal.tsx
---

# task-08 — 新增 components/ppm/problem/import-problem-modal.tsx 三态弹窗

> 依据：design.md §5 Wave2 step3、§3 非目标（不导入附件 / 不查重 / 只产「新建」态）、§7 DTO 与字段映射、原型 `prototype-problem-import.html`（三态线框 + 模板列说明）；
> 决策 D-001@v1（导入范式=后端解析+两步式+前端三态弹窗）、D-003@v1（全字段）；
> 范式**完整复制** `frontend/src/components/ppm/milestone/import-module-modal.tsx`（step 状态机 + handleUpload/handleCommit + rowClassName 标红 + StatBox 结果），StatBox 复用 `milestone-helpers.tsx:113`。

## 复制范式后的关键差异（problem vs module）

- **单表 flat rows，非 sheets 多表**：import-module-modal 按 Sheet 分组（`checkedSheets` + `visibleRows` flatMap，L95-100/L215-217）；problem 只有一组 `preview.rows`，去掉 sheet 维度，`dataSource` 直接喂 `preview.rows`。
- **props 瘦身**：去掉 `planNodeId` / `projectId`（项目归属来自 Excel 每行 `project_name` 反查，D-002），只保留 `{ open, onClose, onSuccess }`。
- **client 签名**：`importProblemsPreview(file)`（无 planNode/projectId 参数）→ `importProblemsCommit({ rows })`（无 `{ sheets }` 包装，body 直接是 rows 数组包装）。
- **预览列扩展为全字段**（对齐 §7 `ProblemImportPreviewRow` 17 业务列）：项目/模块/描述/类型/加急/功能/责任人/发现人/发现时间/计划起止/验证人/工作量/工作类型/答复/延期/备注 + 状态列（valid/error）；空值统一 `render: v ?? "—"`。
- **模板路径**：`/templates/problem-import-template.xlsx`（task-10 产出），下载名「问题清单导入模板.xlsx」，复用 L308-315 临时 anchor click 范式。
- **结果 StatBox**：`created`（blue）/ `skipped`（amber）+ `failed_rows` 红底 `<ul>`（L395-404），对齐 `ProblemImportResultResp`。

## 步骤骨架（沿用 L47-240 的 step/uploading/preview/committing/result 状态机 + open 重置 useEffect）

- step1：`Upload.Dragger` accept=".xlsx" beforeUpload→handleUpload(`return false` 阻止 AntD 自动上传) + 「下载导入模板」Button。
- step2：`Table<ProblemImportPreviewRow>` 全字段列；`rowClassName = (row) => !row.valid ? "bg-red-50" : ""`（L208-210 范式；problem 去掉 `duty_matched` 维度，只看 `valid`/`error`）；状态列 `valid`→绿「就绪」Tag / `!valid`→红 Tag 显 `error`。底部 validCount/invalidCount 统计 + 上一步/确认导入按钮。
- step3：StatBox created/skipped + failed_rows 列表；`handleClose`：`step === 3 && result` → `onSuccess()` 刷新列表（L235-240）再 `onClose()`。

## 勾选回传适配（constraints：单表 rows）

import-module-modal 的 `checkedSheets`（sheet 级）→ problem 适配为行级：执行时二选一与原型 UX 对齐（原型未画行级勾选，倾向后者）——
(a) `checkedRows: Record<row_index, boolean>` + Checkbox 列，handleCommit 组装勾选行；或
(b) 直接 `preview.rows.filter(r => r.valid)` 全部 valid 行回传 `importProblemsCommit({ rows: validRows })`。

## 不做

- 不改 `import-module-modal.tsx`（constraints：仅复制范式）。
- 不在本组件做反查/校验/入库（后端 preview 已填 `valid`/`error`，commit 重查防篡改 D-011）。
- 不处理附件 / 查重 / 非新建态（§3 非目标，原型 L109 注明系统字段不导入）。
