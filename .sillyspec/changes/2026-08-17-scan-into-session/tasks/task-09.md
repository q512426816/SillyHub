---
id: task-09
title: adapt-and-cleanup-tests
title_zh: 测试适配与清理
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: [task-01, task-02, task-03, task-05, task-06, task-07, task-08]
blocks: [task-10]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/workspace/tests/test_daemon_client_scan.py
  - backend/app/modules/workspace/tests/test_scan_provider.py
  - backend/app/modules/agent/tests/test_agent_sessions_include_ended.py
  - backend/app/modules/daemon/tests/test_change_session.py
  - frontend/src/lib/__tests__/menu-permissions.test.ts
  - frontend/src/lib/__tests__/permission.test.ts
  - frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts
goal: >
  适配并清理 scan-into-session 变更波及的既有测试，覆盖后端三元组解包与 session_id、workspace_id、mode 断言、前端智能体菜单组断言清理，并确认 borrow-trigger-contract 契约保留通过，全量测试无红。
implementation:
  - 后端适配 test_daemon_client_scan.py 的 L96 与 L355 二元组解包为三元组，对齐 scan_generate 新返回值
  - 为 scan_generate 的 session_id、start_scan_dispatch 的 workspace_id 补断言，覆盖含早返回分支场景
  - 为 AgentSessionListItem mode 两组装点补断言，并适配 test_scan_provider.py、test_agent_sessions_include_ended.py、test_change_session.py
  - 清理 menu-permissions.test.ts 的 L117、L154、L380 智能体控制台菜单组断言，含 section 分布计数 agent 6 类改 5 类
  - 清理 permission.test.ts 的 L245-249 智能体菜单断言
  - 保留 borrow-trigger-contract.test.ts 不改动，scanGenerate 仍是触发入口契约
acceptance:
  - 后端三元组解包与 workspace_id、session_id、mode 断言全部通过
  - menu-permissions.test.ts 与 permission.test.ts 清理后通过
  - borrow-trigger-contract.test.ts 保留且通过，全量相关测试无红
verify:
  - cd backend 后执行 uv run pytest app/modules/workspace/tests/test_daemon_client_scan.py app/modules/agent/tests/test_agent_sessions_include_ended.py app/modules/daemon/tests/test_change_session.py -q --no-cov
  - cd frontend 后执行 pnpm vitest run menu-permissions permission borrow-trigger
constraints:
  - 仅允许修改 allowed_paths 内的测试文件，不修改任何源码
  - 非测试逻辑有误时禁止改测试迁就
  - borrow-trigger-contract.test.ts 不得删除
---
