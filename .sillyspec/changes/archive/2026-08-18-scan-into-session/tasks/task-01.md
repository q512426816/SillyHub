---
id: task-01
title: Bind scan session to workspace
title_zh: 扫描会话绑定工作区
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/tests/modules/agent/test_scan_interactive_dispatch.py
provides: {}
expects_from: {}
goal: >
  给 start_scan_dispatch 创建的 AgentSession 补绑 workspace_id，让扫描会话出现在工作区会话列表，与变更中心的会话驱动模型对齐。
implementation:
  - service.py 的 start_scan_dispatch 中 AgentSession 构造（L1709-1721 区间）补 workspace_id=workspace_id 入参，该参数在函数作用域可直接使用
  - test_scan_interactive_dispatch.py 的 test_start_scan_dispatch_uses_interactive_session 中补充断言，校验新建 AgentSession 的 workspace_id 等于调用传入的 workspace_id
acceptance:
  - 单测断言 session.workspace_id 等于传入的 workspace_id 且通过
  - agent 模块既有测试不回归，新增字段为可空列默认 None，仅显式赋值不影响旧断言
verify:
  - cd backend && uv run pytest tests/modules/agent/test_scan_interactive_dispatch.py -x -q
  - cd backend && uv run pytest app/modules/agent -x -q
constraints:
  - 只补 AgentSession 构造字段与对应单测断言，不改 scan bundle 构建、lease 元数据与 SESSION_INJECT 链路（design 非目标）
  - 不修改既有测试断言语义，仅新增断言
  - 兼容 Windows、Linux 和 macOS，纯 Python 字段赋值无平台特定逻辑
related_tests: []
---
