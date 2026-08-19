---
id: task-01
title: define-workspace-type-vocab-and-schema
title_zh: 后端词表与 schema——type 必填枚举、description 字段与列表参数收口
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: []
blocks: [task-02, task-03, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/constants.py
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/link_service.py
  - backend/app/modules/workspace/tests/test_service.py
  - backend/app/modules/workspace/tests/test_model.py
  - backend/app/modules/workspace/tests/test_schema_default_agent.py
  - backend/app/modules/workspace/tests/test_daemon_client_scan.py
provides:
  - contract: WORKSPACE_TYPE 词表常量
    fields: [WORKSPACE_TYPE_VALUES, WorkspaceTypeLiteral, YAML_TYPE_NORMALIZE_MAP]
  - contract: WorkspaceCreate/WorkspaceUpdate/WorkspaceRead/WorkspaceBrief
    fields: [type, role, description]
goal: >
  建立 workspace type 八值受控词表单一事实源，Create.type 必填 Literal、Update omit 不改 null 清空、Read/Brief 补 description（Brief 另补 role），列表 type 参数枚举化加 unclassified 互斥参数，service 与 link_service 全链路透传（design §5.1/§5.3/§7）。
implementation:
  - 新建 constants.py——WORKSPACE_TYPE_VALUES 八值元组、WorkspaceTypeLiteral、YAML_TYPE_NORMALIZE_MAP，键值逐字对齐 design §5.1（map 值域全部落在八值内；本卡只定义不消费，消费方为 task-02 迁移与 task-03 parser）
  - schema.py——Create.type（现 100 行 str None）改 WorkspaceTypeLiteral 必填（删 default，OpenAPI required 加 enum）并新增 description（str None 默认 max 2000）；Update.type（现 152 行）改 Literal None 加 description，与 default_agent 同 omit/null 模式（schema.py 156 行先例，D-005@v1）；Read 补 description（type 读路径保持 str None 不校验存量，design §9）；WorkspaceBrief（289-295 行）补 role 与 description（默认 None）
  - router.py 列表端点（197-244 行）——workspace_type Query（现 203 行 str max50）改 Literal 类型非法值 422，新增 unclassified bool 默认 False，两者同传抛 422；service.list_with_owner（351 行起）签名与两个调用分支同步，unclassified 为真时追加 type IS NULL 谓词；service.create 新建 Workspace 构造（203-224 行）补 description 透传；link_service.list_by_project 的 Brief 构造（140-147 行）补 role 与 description（读现有列零新查询）；update 走既有 exclude_unset setattr 无需改
  - 全仓 grep WorkspaceCreate( 复核内部调用方（R-03）——已核 app 代码零构造调用仅 router HTTP 体；scan_generate 直建 pending workspace 不经 Create schema，type 维持 NULL 显示未分类
  - 修齐被必填炸出的既有模块测试——test_service（22 处构造）、test_schema_default_agent（59/70 行）、test_model（110 行 type service 非法值与 119 行缺 type）、test_daemon_client_scan（多处）的 WorkspaceCreate 构造补合法 type（默认 other），仅补入参不改断言语义
acceptance:
  - 缺 type 或非法值创建/更新 422；合法八值通过且 OpenAPI JSON 的 Create.type 带 8 值 enum（AC-01）
  - PATCH omit 不改、显式 null 清空，type/role/description 三字段行为一致（AC-02）
  - type=frontend-code 精确命中、unclassified=true 只出空 type 行、两者同传 422（AC-03）；Read 响应含 description，Brief 另含 role
verify:
  - cd backend && uv run pytest app/modules/workspace/tests -q
constraints:
  - 读路径不校验存量——WorkspaceRead.type 保持 str None，仅写入与查询参数走 Literal（design §9）
  - 不动 model.py（description 列归 task-02）与 ppm_project_workspace 关联表（D-001@v1）；词表与 design §5.1 逐字一致
related_tests:
  - path: backend/app/modules/workspace/tests/test_service.py
    reason: 22 处 WorkspaceCreate 构造缺 type，必填后 ValidationError，需补合法 type 入参
  - path: backend/app/modules/workspace/tests/test_model.py
    reason: 110 行 type 传 service 非法值、119 行缺 type，需改词表值并补 type
  - path: backend/app/modules/workspace/tests/test_schema_default_agent.py
    reason: 59 与 70 行 WorkspaceCreate 构造缺 type，需补 type 入参
  - path: backend/app/modules/workspace/tests/test_daemon_client_scan.py
    reason: 多处 WorkspaceCreate 构造缺 type，需补 type 入参
---
