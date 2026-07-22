---
author: qinyi
created_at: 2026-07-22 22:05:00
---

# 提案书（Proposal）

## 动机

PPM 的执行记录 `TaskExecute`（问题清单「问题执行」与任务计划「计划任务执行」**共用此表**）当前**无法上传附件**，执行记录表也**不回显附件**。平台文件中心（变更 2026-07-22-platform-file-center）已建立通用文件服务，且 `file/model.py:28` 已把 `ppm_task_execute` 列为合法 `owner_type`，但 TaskExecute 后端模型/schema/migration 均无 `file_urls` 字段，落地存在缺口。

## 关键问题

1. **填报无附件**：执行填报只有「耗时」+「执行情况说明」两个文本框，无法上传现场照片 / 完成凭证 / 文档。
2. **回显无附件**：执行记录表只有开始/结束/耗时/说明 4 列，看不到任何附件。
3. **落地缺口**：file-center 已为 TaskExecute 预留接入点（owner_type），但后端 TaskExecute 无 `file_urls` 字段。

## 变更范围

- **后端**：`TaskExecute` 加 `file_urls`（model + schema + migration）；task 侧 `ExecutePlanReq` + `execute_plan` 逐字段赋值（router 直传不用改）；problem 侧 `ProblemExecuteReq` + `execute_problem` signature + **router 拆包**（3 处，D-006）。
- **前端**：`types.ts` 加 `file_urls`；`task-detail-modal` + `problem-detail-modal` 填报区每天加 `FileUpload`（首天预填）+ `handleSubmit` 带 `file_urls` + 执行记录表附件列 `FileViewer`。
- **测试**：后端 `execute_plan`/`execute_problem` 带 `file_urls` 落库（problem 含 router→service 透传断言）；前端预填 + 接入 + 回显。

## 不在范围内（显式清单）

- 不改 file 模块（`/api/file`、`File` 表、MinIO 存储）。
- 不做 `/ppm/task-execute` 独立执行记录页的附件展示。
- 不改 PPM 父记录（`PlanTask`/`PpmProblemList`）的 `file_urls`。
- 不做附件必填校验。
- 不做附件按归属精确查阅 / 孤儿回收。

## 成功标准（可验证）

- 计划任务执行填报能上传附件，跨天每天各自附件，提交后落库 `TaskExecute.file_urls`。
- 问题执行填报同样（file_urls 经 router 拆包 → service 落库，不断裂）。
- 执行记录表每行回显该条记录附件（图片预览 / 文件下载）。
- 后端单测：`execute_plan`/`execute_problem` 带 `file_urls` 落库；problem router→service 透传 `file_urls`。
- 前端单测：`buildDetailDays` 首天预填 `file_urls`；填报 / 回显。
- 现有执行流程（耗时/说明必填校验、跨天拆分、3 态状态机）零回归。
