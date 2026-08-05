---
id: task-01
title: Backend aggregate endpoint + trespass tests
title_zh: 后端聚合端点加越权测试
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/profile/router.py
  - backend/app/modules/agent/profile/service.py
  - backend/app/modules/agent/tests/test_profile_service.py
  - backend/app/modules/agent/tests/test_profile_router.py
provides:
  - 契约 AgentProfileAggregatedItem（AgentProfileRead 全字段加 workspace_id 加 workspace_name，供 task-02 gen:types 消费）
  - service 方法 list_visible_all（actor 入参，逐档 _can_read_async 过滤返回聚合可见列表）
goal: >
  新增只读聚合端点 GET /api/agent-profiles?scope=mine，跨工作区并集返回 actor 可见档案，逐档 _can_read_async 判定严防越权，每条带 workspace 归属名。
implementation:
  - router.py 给 list_platform_profiles 加 scope 查询参数，取值 mine 走聚合分支调 list_visible_all 返回聚合响应类型，未带 scope 走原 list 保持 C8 行为不变；新增 DTO AgentProfileAggregatedItem（AgentProfileRead 全字段加 workspace_id 与 workspace_name 均可空）及聚合列表响应类型，DTO 仍定义在 router.py（profile 模块无 schema.py，已 Glob 核实）
  - service.py 新增 list_visible_all(actor)，查 agent_profiles 全表逐档 _can_read_async 过滤不拼 ws clause（正确处理 owner-left-ws 边界 R-07），批量预取 workspace 名映射填 workspace_name 避免 N+1，platform 与系统预置档按 id 去重
  - test_profile_service.py 新增 TestListVisibleAll，复用现有 _make_user/_make_workspace/_make_member/_make_profile helper，覆盖 actor A 不见 B private、非成员不见该 ws 的 workspace 级、owner-left-ws 后该档对其仍可见（R-07，owner 短路与 get() 一致）、聚合集含自己 private 加所属 ws 级加平台预置
  - test_profile_router.py 新增端点测试，复用 client fixture 加 JWT helper（_create_user/_token_for/_grant_workspace_permission），校验 scope=mine 聚合响应结构与 workspace_name 字段、未带 scope 保持原 platform 列表行为不变
acceptance:
  - 端点返回 actor 可见全集（自己 private 跨 ws 加各所属 ws 的 workspace 级加全部 platform 加系统预置）
  - 越权用例通过（A 不见 B private、非成员不见该 ws workspace 级、owner-left-ws 该档仍可见）
  - 未带 scope 调用 /api/agent-profiles 行为与改动前一致（C8 不破坏 AgentProfileSelect 依赖）
  - 聚合项 workspace_id 与 workspace_name 正确填充（private 与 platform 级为 null、workspace 级填归属工作区名）
  - cd backend 执行 uv run pytest app/modules/agent -q --no-cov 全绿
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
constraints:
  - 纯加法不改现有 CRUD 与 list/get/create/update/delete/copy 方法签名
  - 逐档 _can_read_async 判定不拼 ws clause（防越权 R-01）
  - 本服务不读写任何密钥（design §10 红线）
  - 生命周期豁免（design §8.5）纯读不写不动 session/lease/agent_run/daemon 状态流转
---
