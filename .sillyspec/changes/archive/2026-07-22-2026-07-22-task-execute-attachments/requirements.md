---
author: qinyi
created_at: 2026-07-22 22:05:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 任务负责人 | 在任务详情弹窗执行填报，上传当天执行附件 |
| 问题责任人 | 在问题详情弹窗执行填报，上传当天执行附件 |
| 查看者 | 在执行记录表查看每条记录的附件 |

## 功能需求

### FR-01: TaskExecute 支持 file_urls 字段
覆盖决策：D-001@v1
Given `ppm_task_execute` 表
When migration 升级
Then 表新增 `file_urls` JSON 列（`nullable=False`, `server_default='[]'`），旧记录 `file_urls=[]`

### FR-02: 计划任务执行填报上传附件（按天）
覆盖决策：D-002@v1, D-003@v1, D-005@v1, D-007@v1
Given 进行中的计划任务，打开 `task-detail-modal` execute 模式，有 in-flight 记录
When 用户在填报区某天上传附件 + 填耗时/说明 + 提交
Then 当天附件 id 存入对应 `TaskExecute.file_urls`；重开时首天已上传附件回填预填；不传 file_urls 时保留原值不清空

### FR-03: 问题执行填报上传附件（按天）
覆盖决策：D-002@v1, D-003@v1, D-006@v1, D-007@v1
Given 进行中的问题，打开 `problem-detail-modal` execute 模式，有 in-flight 记录
When 用户填报区上传附件 + 提交
Then `file_urls` 经 `problem/router.py` 拆包（`file_urls=body.file_urls`）→ `execute_problem` signature → 落库 `TaskExecute.file_urls`（router 透传不断裂）

### FR-04: 执行记录表回显附件
覆盖决策：D-004@v1
Given 执行记录表（task/problem-detail-modal）
When 记录有 `file_urls`
Then 附件列行内 `FileViewer` 显示（图片缩略图点击预览 / 文件图标点击下载）；无附件显示空

### FR-05: 跨天填报每天各自附件
覆盖决策：D-002@v1
Given 跨天填报（多天 DetailDay）
When 每天各自上传附件 + 提交
Then 每天的 `executePlanTask`/`executeProblem` 携带当天 `file_urls`，各自落独立 `TaskExecute` 记录

## 非功能需求

- **兼容性**：migration `server_default='[]'`，旧记录无附件；项目未上线允许重置（CLAUDE.md 规则 11）。
- **可回退**：`alembic downgrade -1` 撤列；`git revert`。
- **可测试**：后端单测（含 router→service 透传）+ 前端单测（预填/接入/回显）。
- **零回归**：现有执行流程（必填校验 / 跨天拆分 / 3 态状态机）不受影响。
- **跨平台**：Windows/Linux/macOS（migration + 前端组件通用）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | file_urls 存文件 id |
| D-002@v1 | FR-02, FR-03, FR-05 | 按记录级归属 |
| D-003@v1 | FR-02, FR-03 | 首天预填（含 InflightLike 加字段） |
| D-004@v1 | FR-04 | 执行记录表附件列行内 FileViewer |
| D-005@v1 | FR-02, FR-03 | owner_id 策略（首天 inflightId / 后续天 null） |
| D-006@v1 | FR-03 | problem router 拆包链路（3 处改） |
| D-007@v1 | FR-02, FR-03 | file_urls None 默认 + is not None 守卫 |

> 全部 D-001@v1 ~ D-007@v1 已被 FR 覆盖，无剩余风险决策。
