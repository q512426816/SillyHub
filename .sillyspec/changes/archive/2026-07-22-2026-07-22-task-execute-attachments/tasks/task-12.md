---
id: task-12
title: problem-detail-modal InflightLike+buildDetailDays+FileUpload+handleSubmit+附件列（FR-03,04, D-002,003）
title_zh: problem-detail-modal 接入附件上传与回显
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-10]
blocks: [task-13]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1, D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx
provides:
  - contract: problem-detail-modal 附件填报+回显
    fields: [file_urls]
expects_from:
  task-10:
    - contract: types.ts file_urls
      needs: [file_urls]
goal: >
  problem-detail-modal 接入附件填报（纯函数 buildDetailDays 首天预填）+ 执行记录表回显，业务逻辑同 task 侧。
implementation:
  - InflightLike（L60-64）加 file_urls: string[] | null
  - buildDetailDays（L74-97，首天预填 L84-91）i===0 时 fileUrls: inflight.file_urls ?? []，后续天 []
  - 填报区每天块内加 <FileUpload owner_type="ppm_task_execute" owner_id={i===0 ? inflightId : null} value={d.fileUrls} onChange=.../>（D-002/D-005，同 task 侧）
  - handleSubmit（executeProblem 调用 L193-199）每天带 file_urls: d.fileUrls.length ? d.fileUrls : undefined（D-007）
  - 执行记录表加「附件」列 <FileViewer fileIds={e.file_urls ?? []}/>（D-004）
acceptance:
  - buildDetailDays 首天预填 file_urls；每天 FileUpload；提交带 file_urls；附件列回显
  - pnpm typecheck 绿；现有 problem execute 流程零回归
verify:
  - cd frontend && pnpm typecheck
constraints:
  - D-002：按记录级归属
  - D-003：InflightLike 加 file_urls 字段（Design Grill B3），buildDetailDays 首天预填（纯函数，task-13 单测覆盖）
  - D-005：owner_id 首天=inflightId / 后续天=null
  - D-007：空 file_urls 传 undefined（保留原值）
  - 复用 FileUpload/FileViewer；owner_type="ppm_task_execute"
---

流程位置：Wave 4（前端）。problem 侧有 buildDetailDays 纯函数，是 task-13 单测重点。
