---
id: task-09
title: "mission SSE + workspace activate/init 收紧"
title_zh: "mission SSE 与 workspace activate/init 改 workspace-scoped 权限"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-08, FR-09]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/sse.py
  - backend/app/modules/mcp_gateway/tests/test_sse.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/tests/test_router.py
  - backend/app/modules/workspace/tests/test_permission_scope.py
provides: {}
expects_from: {}
goal: >
  mission SSE 端点从 require_permission_any(TASK_READ) 收紧为 workspace-scoped require_permission(TASK_READ)，workspace activate/init 两端点同样收紧为 workspace-scoped WORKSPACE_WRITE。
implementation:
  - 先写失败测试。mcp_gateway 侧在 test_sse.py 增补用例（或新建 test_permission_scope.py）——用户 A 对 workspace W1 有 TASK_READ、对 W2 无，请求 W2 路径下的 mission events 端点，期望 403（路由参数已含 workspace_id，权限按路径 scope 校验）
  - workspace 侧新建 tests/test_permission_scope.py——非成员用户 POST /api/workspaces/{id}/activate 期望 403；非成员 POST /api/workspaces/{id}/init 期望 403
  - mcp_gateway/sse.py stream_mission_events（:153）依赖改为 Depends(require_permission(Permission.TASK_READ))——require_permission 的 checker 以路径参数 workspace_id 为 scope，天然绑定本 workspace
  - workspace/router.py activate_workspace（:158-162）依赖从 require_permission_any(WORKSPACE_WRITE) 改 require_permission(WORKSPACE_WRITE)
  - workspace/router.py init_workspace（:256-260）同样改 require_permission(WORKSPACE_WRITE)
  - 核对 test_sse.py 既有 test_events_403_for_non_member 用例语义——该用例用普通无角色用户已预期 403，收紧后仍成立；再补一条同平台其它 workspace 成员（对目标 ws 无角色）的 403 用例，覆盖「any 级有权限但 scoped 无权限」的真实漏洞路径
  - 核对 workspace/tests/test_router.py init 端点既有用例（:394-465）的 fixtures 是否给调用者授了目标 workspace 角色，缺失则补（角色绑定 fixture，非改断言）
acceptance:
  - 对目标 workspace 无 TASK_READ 角色的用户（即便在其它 workspace 有该权限）访问 mission events 返回 403
  - 对目标 workspace 无 WORKSPACE_WRITE 角色的用户调用 activate 与 init 返回 403
  - 成员用户三条路径行为回归不变（activate 状态流转 / init 返回 lease_id+runtime_id+claim_token / SSE 帧序列）
  - 未知 mission 仍 404（存在性校验逻辑不动）
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway/tests/test_sse.py -q --no-cov
  - cd backend && uv run pytest app/modules/workspace/tests -q --no-cov
constraints:
  - 不动 create_workspace（:144，本就是全局 any 语义，创建入口保持）；不动 get_workspace/list（已 scoped）
  - require_permission 依赖路径参数名必须精确为 workspace_id（auth_deps checker 固定 Path 名），sse.py 与 workspace/router.py 路由参数名已满足，勿改名
  - 403 语义（权限拒绝）而非 404——本项是权限 scope 收紧不是资源隐藏，mission 存在性 404 逻辑保持独立
  - mcp_gateway/sse.py 若 task-01~04 已改本文件需串行提交（文件级互斥）；核实当前 git 最新态再 Edit
related_tests:
  - path: backend/app/modules/mcp_gateway/tests/test_sse.py
    reason: test_events_403_for_non_member 用无任何角色用户，收紧后仍 403 通过；但需补「any 级有权限、scoped 无权限」用例才能证明漏洞真闭合
  - path: backend/app/modules/workspace/tests/test_router.py
    reason: init 端点用例（:394-465）当前 fixtures 若未授予调用者目标 workspace 角色，收紧后 will 403 失败，需补角色绑定 fixture（不改断言）
---
