---
plan_level: full
author: qinyi
created_at: 2026-07-22 22:15:00
---

# 实现计划（Plan）

> **无 Spike**：技术方案确定（复用 file-center file_urls 模式 + FileUpload/FileViewer），无新技术栈/未验证集成。**无批量模式**：13 任务是同一接入点的 task/problem 两侧 + 测试，非「模板×数据」。

## Wave 1（后端数据层，无依赖）
- [x] task-01: TaskExecute 模型加 file_urls JSON 列（覆盖：FR-01, D-001@v1）
- [x] task-02: alembic migration 加 ppm_task_execute.file_urls 列（覆盖：FR-01）

## Wave 2（后端接口层，依赖 Wave 1；task 侧 + problem 侧并行）
- [x] task-03: task/schema.py ExecutePlanReq + TaskExecuteCreate/Update/Response 加 file_urls（覆盖：FR-02, D-007@v1）
- [x] task-04: task/service.py execute_plan 逐字段赋值补 file_urls（覆盖：FR-02）
- [x] task-05: problem/schema.py ProblemExecuteReq 加 file_urls（覆盖：FR-03, D-007@v1）
- [x] task-06: problem/service.py execute_problem signature+赋值补 file_urls（覆盖：FR-03, D-006@v1）
- [x] task-07: problem/router.py 拆包补 file_urls=body.file_urls（覆盖：FR-03, D-006@v1）

## Wave 3（后端测试，依赖 Wave 1+2）
- [x] task-08: 后端单测 execute_plan 带 file_urls 落库（覆盖：FR-02）
- [x] task-09: 后端单测 problem execute 带 file_urls 落库（含 router→service 透传断言）（覆盖：FR-03, D-006@v1）

## Wave 4（前端，依赖后端就绪）
- [x] task-10: lib/ppm/types.ts 加 file_urls（覆盖：FR-02, FR-03, FR-04）
- [x] task-11: task-detail-modal DetailDay+预填+FileUpload+handleSubmit+附件列（覆盖：FR-02, FR-04, FR-05, D-002@v1, D-003@v1, D-005@v1）
- [x] task-12: problem-detail-modal InflightLike+buildDetailDays+FileUpload+handleSubmit+附件列（覆盖：FR-03, FR-04, D-002@v1, D-003@v1）
- [x] task-13: 前端单测 buildDetailDays 预填 + task 组件测 + 回显（覆盖：FR-02, FR-03, FR-04）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | TaskExecute 模型加 file_urls | W1 | P0 | — | FR-01, D-001 | 抄 PlanTask L115-118 |
| task-02 | migration 加 file_urls 列 | W1 | P0 | task-01 | FR-01 | down_revision=202607221500_create_file |
| task-03 | task/schema 加 file_urls | W2 | P0 | task-01 | FR-02, D-007 | ExecutePlanReq 用 `\| None=None` |
| task-04 | task/service execute_plan 补赋值 | W2 | P0 | task-03 | FR-02 | L343-355 逐字段段 |
| task-05 | problem/schema ProblemExecuteReq | W2 | P0 | task-01 | FR-03, D-007 | `\| None=None` |
| task-06 | problem/service execute_problem | W2 | P0 | task-05 | FR-03, D-006 | signature 加参数 + L585-594 |
| task-07 | problem/router 拆包补 file_urls | W2 | P0 | task-05,06 | FR-03, D-006 | L313-322 **关键**，漏则落不进库 |
| task-08 | 后端单测 execute_plan | W3 | P0 | task-04 | FR-02 | 带 file_urls 落库 |
| task-09 | 后端单测 problem execute | W3 | P0 | task-07 | FR-03, D-006 | router→service 透传断言 |
| task-10 | types.ts 加 file_urls | W4 | P0 | — | FR-02,03,04 | 5 接口 |
| task-11 | task-detail-modal | W4 | P0 | task-10 | FR-02,04,05, D-002,003,005 | DetailDay+预填+上传+回显 |
| task-12 | problem-detail-modal | W4 | P0 | task-10 | FR-03,04, D-002,003 | InflightLike+buildDetailDays |
| task-13 | 前端单测 | W4 | P0 | task-11,12 | FR-02,03,04 | 预填+组件测+回显 |

## 关键路径

task-01 → task-05 → task-06 → **task-07** → task-09（problem 侧后端，最长链）；task-10 → task-11/12 → task-13（前端）。

**task-07（problem/router 拆包补 file_urls）是 D-006 关键风险点**——漏改则 problem 侧附件落不进库且被单测遮蔽。

## 全局验收标准

- [x] 后端：`execute_plan`/`execute_problem` 带 `file_urls` 落库（task-08/09 单测绿）
- [x] 后端：problem **router→service 透传 file_urls**（task-09 断言，防 D-006 遮蔽）
- [x] 后端：migration `upgrade`/`downgrade` 验证（加列/撤列）
- [x] 前端：`types.ts` tsc 绿；`buildDetailDays` 首天预填 `file_urls` 单测绿
- [x] 前端：两个弹窗填报上传 + 执行记录表回显（task-13）
- [x] **零回归**：现有执行流程（耗时/说明必填校验、跨天拆分、3 态状态机）不受影响
- [x] brownfield：旧 `TaskExecute` 记录 `file_urls=[]`（migration `server_default='[]'`）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | file_urls 字段 + migration |
| D-002@v1 | task-11, task-12 | DetailDay.fileUrls 按记录级归属 |
| D-003@v1 | task-11, task-12 | 首天预填 file_urls（含 InflightLike） |
| D-004@v1 | task-11, task-12 | 执行记录表附件列 FileViewer |
| D-005@v1 | task-11, task-12 | owner_id 首天 inflightId / 后续天 null |
| D-006@v1 | task-06, task-07, task-09 | problem router 拆包 + signature + 透传断言 |
| D-007@v1 | task-03, task-05 | file_urls `None` 默认 + `is not None` 守卫 |
