---
author: qinyi
created_at: 2026-07-22 22:05:00
---

# 任务清单（Tasks）

> 任务细节（波次/依赖/验收标准/代码片段）在 plan 阶段展开。本清单只列任务名 + 所属层。

## 后端

- [ ] task-01: `TaskExecute` 模型加 `file_urls` JSON 列（`task/model.py` ~L168，抄 PlanTask L115-118）
- [ ] task-02: alembic migration 加 `ppm_task_execute.file_urls` 列（`down_revision=202607221500_create_file`，参照 L62 写法）
- [ ] task-03: `task/schema.py` `ExecutePlanReq`(`| None=None`) + `TaskExecuteCreate`/`Update`/`Response` 加 `file_urls`
- [ ] task-04: `task/service.py::execute_plan` 逐字段赋值段（L343-355）补 `if req.file_urls is not None: exc.file_urls = req.file_urls`
- [ ] task-05: `problem/schema.py::ProblemExecuteReq` 加 `file_urls: list[str] | None = None`
- [ ] task-06: `problem/service.py::execute_problem` signature 加 `file_urls` 参数 + L585-594 赋值段补（D-006）
- [ ] task-07: `problem/router.py` 拆包处（L313-322）补 `file_urls=body.file_urls`（D-006，关键，漏则附件落不进库）
- [ ] task-08: 后端单测 `execute_plan` 带 `file_urls` 落库
- [ ] task-09: 后端单测 problem execute 带 `file_urls` 落库（**含 router→service 透传断言**，防 D-006 遮蔽）

## 前端

- [ ] task-10: `lib/ppm/types.ts` 加 `file_urls`（`TaskExecute`/`ExecutePlanReq`/`ProblemExecuteReq`/`TaskExecuteCreate`/`TaskExecuteUpdate`）
- [ ] task-11: `task-detail-modal.tsx` `DetailDay` 加 `fileUrls` + 首天预填 + 填报区 `FileUpload` + `handleSubmit` 带 `file_urls` + 执行记录表附件列
- [ ] task-12: `problem-detail-modal.tsx` `InflightLike` 加 `file_urls` + `buildDetailDays` 预填 + 填报区 `FileUpload` + `handleSubmit` + 附件列
- [ ] task-13: 前端单测 `buildDetailDays` 预填 `file_urls`（problem 纯函数）+ task 侧组件渲染测（无纯函数）+ 执行记录表回显
