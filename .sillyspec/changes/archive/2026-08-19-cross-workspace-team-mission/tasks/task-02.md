---
id: task-02
title: add-representative-binding-query
title_zh: 添加代表 binding 查询函数
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v2]
allowed_paths:
  - backend/app/modules/workspace/member_runtimes/queries.py
  - backend/app/modules/workspace/member_runtimes/tests/test_representative_binding.py
provides:
  - contract: resolve_representative_binding
    fields: [workspace_id, user_id, provider]
expects_from: []
goal: >
  新增 resolve_representative_binding 查询函数，按 owner 在线优先或任意在线解析目标工作区的代表 binding。
implementation:
  - 在 member_runtimes/queries.py 新增 resolve_representative_binding 函数
  - 分支1：查询该 workspace 的 owner(user_id=workspace.owner_id) 在线 binding
  - 分支2：owner 无在线 binding，查任意 member 的在线 binding(按 daemon 最近心跳排序)
  - 分支3：均无在线 binding，返回 None(调用方抛 NoOnlineDaemonError)
  - 返回 runtime dict(shape 与 query_runtime_by_daemon_and_provider 一致)
acceptance:
  - 函数返回 owner 在线 binding 优先命中
  - owner 无在线时返回任意在线 binding(心跳排序)
  - 全部离线返回 None
  - 单测覆盖三分支逻辑
verify:
  - cd backend && uv run pytest app/modules/workspace/tests/test_representative_binding.py -q --no-cov
constraints:
  - 仅查询不写数据库(纯只读操作)
  - 不侵入既有查询函数(独立新增)
  - 返回 shape 与既有 runtime dict 一致(兼容 placement 消费方)

---
