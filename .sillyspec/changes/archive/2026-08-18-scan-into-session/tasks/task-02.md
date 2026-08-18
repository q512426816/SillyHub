---
id: task-02
title: extend-scan-generate-to-return-session-id
title_zh: scan_generate 返回 session_id 并回填端点响应
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/tests/test_daemon_client_scan.py
  - backend/app/modules/workspace/tests/test_scan_provider.py
provides:
  - contract: ScanGenerateResponse
    fields: [workspace_id, agent_run_id, session_id]
expects_from: []
goal: >
  scan_generate 返回值扩展为三元组 (workspace_id, agent_run_id, session_id)，正常分支取 run 的
  agent_session_id，早返回分支取 existing_run 的 agent_session_id（老 run 为 null），并回填端点响应。
implementation:
  - service.py 的 scan_generate 返回类型扩展为三元组，正常分支 session_id 取 run 的 agent_session_id
  - 早返回分支 session_id 取 existing_run.agent_session_id，历史老 run 无该字段时为 null
  - schema.py 补 session_id 字段且默认 null，router.py 端点解包三元组并回填，适配既有测试解包
acceptance:
  - scan_generate 正常分支返回三元组且 session_id 等于 run 的 agent_session_id
  - 早返回分支返回三元组且 session_id 取 existing_run 的 agent_session_id，老 run 时为 null
  - scan-generate 端点响应体含 session_id 字段
  - 适配后的既有测试全部通过
verify:
  - 运行 workspace 模块相关 pytest 与 ruff 检查全部通过
constraints:
  - 改动限定在 allowed_paths 内，不改动扫描流程本身
  - 早返回分支 session_id 为 null 属预期行为，老 run 缺失 agent_session_id 按 null 处理
related_tests: test_daemon_client_scan.py 与 test_scan_provider.py 的二元组解包断言需适配为三元组
---
