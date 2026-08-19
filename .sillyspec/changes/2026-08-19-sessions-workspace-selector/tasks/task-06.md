---
id: task-06
title: Backend workspace ownership validation tests
title_zh: 后端归属校验单元测试
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P1
depends_on: [task-02]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_service.py
goal: >
  在 test_session_service.py 补充 create_session workspace 归属校验用例（有权限通过/无权限404/不传零回归）
implementation:
  - 在 test_session_service.py 的 TestCreateSession 类中追加测试方法
  - mock allowed_workspace_ids 返回指定 workspace_id 集合
  - 新增 test_create_session_with_valid_workspace_id：allowed 集合含目标 ws_id → 创建成功且 session.workspace_id 正确
  - 新增 test_create_session_workspace_not_in_allowed：allowed 集合不含目标 ws_id → raises DaemonSessionWorkspaceNotFound（404）
  - 新增 test_create_session_workspace_not_found：workspace_id 指向不存在的 UUID → raises DaemonSessionWorkspaceNotFound（404，同语义不泄露存在性）
  - 新增 test_create_session_no_workspace_zero_regression：workspace_id=None 时不调用 allowed_workspace_ids 校验且 session.workspace_id=None（零回归）
  - 新增 fixture 或 mock 用于创建 Workspace 模型实例和 workspace membership 数据
  - 确保 DaemonSessionWorkspaceNotFound 异常类已被 task-02 添加到 service.py
acceptance:
  - pytest backend/app/modules/daemon/tests/test_session_service.py 全部通过
  - 有权限路径：session 写入正确 workspace_id + cwd=root_path
  - 无权限路径：抛 DaemonSessionWorkspaceNotFound 且无 session 落库
  - 不存在路径：抛 DaemonSessionWorkspaceNotFound 且无 session 落库
  - 不传路径：allowed_workspace_ids 未被调用且 session.workspace_id=None
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_service.py -v
constraints:
  - 复用现有 db_session fixture（conftest.py 提供 async SQLAlchemy session）
  - 复用 _create_user / _create_runtime / _mock_hub / _mock_redis 工厂函数
  - mock allowed_workspace_ids 用 patch（与现有测试的 mock 风格一致）
  - 需要创建 Workspace 模型实例（app.modules.workspace.model.Workspace）作为校验目标
---
