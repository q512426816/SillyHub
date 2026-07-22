---
id: task-13
title: 前端单测 buildDetailDays 预填 + task 组件测 + 回显（FR-02,03,04）
title_zh: 前端附件预填/回显单测
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-11, task-12]
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.test.tsx
  - frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.test.tsx
  - frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer.test.tsx
expects_from:
  task-12:
    - contract: problem-detail-modal 附件填报+回显
      needs: [file_urls]
  task-11:
    - contract: task-detail-modal 附件填报+回显
      needs: [file_urls]
goal: >
  前端单测：problem buildDetailDays 首天预填 file_urls（纯函数）+ task 侧组件渲染预填 + 附件列回显。
implementation:
  - problem-detail-modal.test.tsx：①补现有 7 处 buildDetailDays fixture 的 file_urls（task-12 把 InflightLike.file_urls 设必填的下游适配）；②加首天预填新用例 buildDetailDays({...,file_urls:["a","b"]}, 注入 today) 首天 fileUrls==["a","b"]、后续天 []（D-003）
  - task-detail-modal.test.tsx 组件渲染测（task 无纯函数）：mock listTaskExecutes 返回 inflight 带 file_urls → 断言首天预填 fileUrls；附件列回显 records 带 file_urls → FileViewer 渲染（vi.mock 标记渲染，参照 frontend-markdown-text-jsdom-null）
  - kanban-task-detail-drawer.test.tsx：TaskExecute fixture 补 file_urls:[]（task-10 把 TaskExecute.file_urls 设必填的下游适配，纯 fixture 补默认值非逻辑改动）
acceptance:
  - buildDetailDays 预填 file_urls 单测绿
  - task 组件预填/附件列回显测绿
  - 现有前端测试零回归
verify:
  - cd frontend && pnpm test
constraints:
  - D-003：断言首天预填 file_urls、后续天空
  - task 侧无纯函数（内联预填），用组件渲染测；problem 侧 buildDetailDays 是纯函数优先测（可注入 today 固定时间）
  - antd 动态组件 jsdom 同步渲染为 null 坑参照 memory frontend-markdown-text-jsdom-null（必要时 vi.mock 纯渲染）
---

流程位置：Wave 4（前端，终点任务）。13 任务收尾。
