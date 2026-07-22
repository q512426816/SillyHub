---
id: task-03
title: task/schema.py ExecutePlanReq + TaskExecuteCreate/Update/Response 加 file_urls（FR-02, D-007）
title_zh: task schema 4 类加 file_urls
author: qinyi
created_at: 2026-07-22 22:16:15
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/ppm/task/schema.py
provides:
  - contract: ExecutePlanReq.file_urls
    fields: [file_urls]
expects_from:
  task-01:
    - contract: TaskExecute.file_urls
      needs: [file_urls]
goal: >
  task 侧 4 个 schema 加 file_urls，按三场景区分默认值（D-007）。
implementation:
  - ExecutePlanReq（L151-176，end_remark L175 后）加 file_urls: list[str] | None = None（D-007：非 default_factory=list）
  - TaskExecuteCreate（L195-214，status L213 前）加 file_urls: list[str] = Field(default_factory=list)（看板 CRUD 创建默认空）
  - TaskExecuteUpdate（L227-245，status L245 前）加 file_urls: list[str] | None = None（更新可选）
  - TaskExecuteResponse（L259-282，model_config L282 前）加 file_urls: list[str]（from_attributes 自动映射 ORM）
acceptance:
  - ExecutePlanReq.file_urls 不传时为 None（让 service 的 is not None 守卫可生效）
  - TaskExecuteResponse 从 ORM 映射出 file_urls
  - mypy + ruff 通过
verify:
  - cd backend && uv run mypy app
  - cd backend && uv run ruff check app/modules/ppm/task/schema.py
  - cd backend && uv run ruff format --check app/modules/ppm/task/schema.py
constraints:
  - D-007：ExecutePlanReq 必须用 list[str] | None = None（非 default_factory=list），否则 is not None 恒真、空提交会把附件覆盖为 []
  - 三场景区分：Create=default_factory=list、Update=| None=None、Response=list[str]、ExecutePlanReq=| None=None
---

流程位置：Wave 2（task 侧）。task-04 消费 ExecutePlanReq.file_urls。注意 TaskExecuteService.create 用 model_dump() 自动透传 file_urls，无需改 service create 路径。
