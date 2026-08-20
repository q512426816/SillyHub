---
id: task-02
title: Add Workspace Ownership Validation to create_session
title_zh: create_session 补 workspace 归属校验
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
goal: >
  在 create_session 方法中当 workspace_id 非空时校验调用者对目标工作区有
  WORKSPACE_READ 权限无权限返回 404 与工作区不存在同语义不泄露存在性
implementation:
  - 在 service.py 顶部从 app.modules.auth.rbac 导入 allowed_workspace_ids
  - 从 app.modules.auth.permissions 导入 Permission
  - 在 create_session 方法中 workspace_id is not None 分支内、读取 Workspace 行之前
    调用 allowed_workspace_ids 校验
  - 校验不通过时抛出新增异常 DaemonSessionWorkspaceNotFound
  - 在 service.py 异常类区域新增 DaemonSessionWorkspaceNotFound(AppError)
    code=HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND http_status=404
  - 校验通过后保持原有 cwd=_ws.root_path 逻辑不变
acceptance:
  - workspace_id 为空时完全跳过校验走原路径零回归
  - workspace_id 非空且用户有 WORKSPACE_READ 权限时正常创建会话
  - workspace_id 非空且用户无权限时返回 404 错误码 HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND
  - workspace_id 指向不存在的工作区时同样返回 404 不泄露存在性
  - 异常类命名和结构与既有 DaemonSessionNotFound 等风格一致
verify:
  - pytest backend/app/modules/daemon/session/ 无新增 fail
  - python -c "from app.modules.daemon.session.service import DaemonSessionWorkspaceNotFound" 无 ImportError
constraints:
  - 校验口径使用 WORKSPACE_READ 与前端 listWorkspaces 数据源一致
  - 不改变 workspace_id=None 时的任何行为（零回归 FR-04）
  - 不新增数据库迁移或 API schema 变更
related_tests:
  - path: backend/app/modules/daemon/tests/test_change_session.py
    reason: task-06 将在该测试文件或同目录 session 测试中补充归属校验用例
---
