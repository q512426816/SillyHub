---
id: task-01
title: TaskExecute 模型加 file_urls JSON 列（FR-01, D-001）
title_zh: TaskExecute 模型加 file_urls JSON 列
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/ppm/task/model.py
provides:
  - contract: TaskExecute.file_urls
    fields: [file_urls]
goal: >
  给 TaskExecute 加 file_urls JSON 列（存文件 id 列表），复用 PlanTask 同款语义（D-001）。
implementation:
  - 在 task/model.py TaskExecute 类（L131-196）attach_group_id（L168）后新增 file_urls 字段，照抄 PlanTask L115-118 写法——file_urls: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
  - 顶部已 import JSON/Column/Field（PlanTask 已在用），无需新增 import
acceptance:
  - TaskExecute ORM 实例可读写 file_urls，新实例默认 []
  - mypy + ruff 通过
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/task/model.py
  - cd backend && uv run ruff format --check app/modules/ppm/task/model.py
constraints:
  - D-001：值=文件 id，与 PlanTask/PpmProblemList 完全一致
  - nullable=False + default=list，保证新记录 file_urls=[]（brownfield 旧记录由 migration server_default 兜底为 []）
---

流程位置：Wave 1（后端数据层，无依赖）。本任务为 problem/task 两侧共用的数据基座，下游 task-02（migration）+ task-03/05（schema）+ task-08/09（测试）均消费此字段。
