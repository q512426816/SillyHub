---
id: task-03
title: 'backend 导入端点——POST import（合并条目逐条幂等落库，rel_path+my_path 双落地）（FR-03）'
title_zh: 'backend 导入端点——POST import（合并条目逐条幂等落库，rel_path+my_path 双落地）（FR-03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 23:16:34
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/workspace/linked_repos/router.py
  - backend/app/modules/workspace/linked_repos/schema.py
  - backend/app/modules/workspace/linked_repos/service.py
  - backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
target_files:
  []
provides:
  import-api:
    endpoint: "POST /api/workspaces/{id}/linked-repos/import（WORKSPACE_MEMBER_MANAGE）"
    request: "{entries:[{name,rel_path?,abs_path?}]}"
    response: "{results:[{name,result: imported|skipped|failed, detail?}]}"
expects_from:
  task-02:
    snapshot-api: "前端经快照拿合并条目形态（见 task-02 provides.snapshot-api）"

goal: >
  backend 导入端点——合并条目逐条幂等落库（Grill Gap A 语义，一条对照条目一次导入同时落 rel_path 与 my_path）
implementation:
  - service.py——import_repos：逐条 create_repo(name, rel_path) +（含 abs_path 时）upsert_my_path(当前操作者)；重名→skipped 不重不丢；每条独立成败（failed 带 detail 不回滚已成功条目）；成功后触发既有 best-effort 推送
  - schema.py——ImportRequest/ImportResultItem
  - router.py——POST import 端点（WORKSPACE_MEMBER_MANAGE）
  - 测试——双字段一次落地/重名 skipped 幂等（二次导入全 skipped）/逐条独立成败/权限（成员 403）/成功触发推送
acceptance:
  - FR-03 GWT 过；成功标准第 2 条可达（demo 合并条目导入后 rel_path+my_path 双落地）
verify:
  - cd backend && uv run pytest app/modules/workspace/linked_repos/tests -q --no-cov
constraints:
  - 不新造数据模型（复用 create_repo/upsert_my_path）；导入后走既有下行链路（本 task 不实现同步）
  - 禁跑全量测试
---
