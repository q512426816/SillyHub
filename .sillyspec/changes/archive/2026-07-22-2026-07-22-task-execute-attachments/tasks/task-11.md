---
id: task-11
title: task-detail-modal DetailDay+预填+FileUpload+handleSubmit+附件列（FR-02,04,05, D-002,003,005）
title_zh: task-detail-modal 接入附件上传与回显
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-10]
blocks: [task-13]
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx
provides:
  - contract: task-detail-modal 附件填报+回显
    fields: [file_urls]
expects_from:
  task-10:
    - contract: types.ts file_urls
      needs: [file_urls]
goal: >
  task-detail-modal 跨天填报每天各自上传附件 + 执行记录表附件列回显（task 侧内联预填）。
implementation:
  - DetailDay（L47-52）加 fileUrls: string[]
  - 首天预填段（L94-101，内联）i===0 时 fileUrls: inflight.file_urls ?? []，后续天 fileUrls: []
  - 填报区每天块（L304-345）内加 <FileUpload owner_type="ppm_task_execute" owner_id={i===0 ? inflightId : null} value={d.fileUrls} onChange={(v)=> setDetailDays(prev => prev.map((x,j)=> j===idx ? {...x, fileUrls: v} : x))}/>（D-002 记录级、D-005 owner_id）
  - handleSubmit（executePlanTask 调用 L166-173）每天带 file_urls: d.fileUrls.length ? d.fileUrls : undefined（D-007 空传 undefined 保留原值）
  - 执行记录表（thead L266-272 加「附件」列、body L274-289）每行加 <FileViewer fileIds={e.file_urls ?? []}/>（D-004）
acceptance:
  - 每天各自 FileUpload；首天回填 in-flight 已传附件
  - 提交每天带 file_urls 落库；执行记录表附件列行内 FileViewer 回显
  - pnpm typecheck 绿；现有跨天拆分/必填校验/3 态状态机零回归
verify:
  - cd frontend && pnpm typecheck
constraints:
  - D-002：按记录级归属（每天一组 FileUpload，非整组）
  - D-003：首天内联预填 file_urls（与 time_spent/execute_info 一致）；后续天空
  - D-005：owner_id 首天=inflightId（记录已存在）/ 后续天=null（start 创建发生在提交循环内，记录尚未创建）
  - D-007：file_urls 为空传 undefined（不传），保留原值不清空
  - 复用 file-center FileUpload/FileViewer，零新组件零新 API；owner_type="ppm_task_execute"
---

流程位置：Wave 4（前端）。task 侧无纯函数（预填内联），组件测在 task-13。
