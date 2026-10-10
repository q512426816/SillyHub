---
id: task-02
title: 'backend 快照端点与三态对照——GET local-snapshot（RPC 编排+双源合并+对照+四态降级）（FR-01/FR-02）'
title_zh: 'backend 快照端点与三态对照——GET local-snapshot（RPC 编排+双源合并+对照+四态降级）（FR-01/FR-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 23:16:34
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/linked_repos_sync.py
  - backend/app/modules/daemon/tests/test_linked_repos_sync.py
  - backend/app/modules/workspace/linked_repos/router.py
  - backend/app/modules/workspace/linked_repos/schema.py
  - backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
target_files:
  []
provides:
  snapshot-api:
    endpoint: "GET /api/workspaces/{id}/linked-repos/local-snapshot（WORKSPACE_READ）"
    response: "{status: ok|daemon_offline|daemon_unsupported|binding_missing, fetched_at?, entries:[{key,sources,rel_path?,abs_path?,role?,state?,detail?,match,platform_repo_id?,platform_rel_path?}], platform_only_names?}"
    rpc: "linked_repos_snapshot 请求-响应（超时 15s，conflict_snapshot 先例）；binding 缺失→binding_missing 不 409"
expects_from:
  task-01:
    daemon-snapshot: "见 task-01 provides.daemon-snapshot"

goal: >
  backend 快照端点与三态对照——RPC 编排现拉+双源合并+对照计算+四态降级（D-003 手动现拉）
implementation:
  - linked_repos_sync.py——local_snapshot 编排：按当前用户绑定机器路由 RPC（binding 缺失→binding_missing 语义不抛 409；method_not_found→daemon_unsupported；offline/timeout→daemon_offline）；对照计算（内存）：双源按 key 合并（rel_path 取 projects 源、abs_path 取 repos 源，Grill Gap A）→与平台登记按 name 对照三态；path 兜底链：projects 源 path→config projects 块相对路径→null
  - schema.py——LocalSnapshotResponse/LocalEntry（合并形态：sources 数组+rel_path/abs_path 双字段）
  - router.py——GET local-snapshot 端点（WORKSPACE_READ）
  - 测试——RPC 编排四态降级/合并语义（同名 projects+repos 单条双字段）/对照三态/path 兜底
acceptance:
  - FR-01/FR-02 GWT 过——四态 status 各有断言；合并条目一次成型；快照不落库
  - 老 CLI 两源全缺组合场景——status=ok 且 entries 空+detail 说明（兼容策略断言）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_linked_repos_sync.py app/modules/workspace/linked_repos/tests -q --no-cov
constraints:
  - 快照即弃不落库（D-005）；binding_missing 不冒泡 409（Gap B）
  - 禁跑全量测试
---
