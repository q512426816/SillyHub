---
id: task-10
title: claim 阶段 token 注入测试与 start_init_dispatch 防回退测试
title_zh: 新建 daemon lease tests test_init_claim_tokens 测 claim 注入 payload 含明文不落 metadata 加扩展 test_start_init_dispatch 防回退断言 dispatch 不签 token
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  - backend/app/modules/agent/tests/test_start_init_dispatch.py
provides: []
expects_from:
  task-04:
    - contract: claim payload platform_config local_yaml
      needs: [platform_token 与 mcp_token 注入 payload]
goal: >
  新建 backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py 测 build_claim_payload mode init 分支调两 get_or_issue 注入 payload platform_config local_yaml 含明文 且明文不落 lease.metadata_，并扩展 test_start_init_dispatch.py 加防回退断言 B1 下 dispatch 不签 token metadata 不含 local_yaml，覆盖 FR-01 FR-03 与 D-002。
implementation:
  - 新建 test_init_claim_tokens.py 挂 backend/app/modules/lease/tests/ 复用该目录 conftest 的 daemon_task_leases 表 fixture
  - 测构造一条 mode init lease 含 workspace_id 与 actor_user_id metadata 调 build_claim_payload 断言返回 payload platform_config local_yaml 含 platform_token 与 mcp_token 明文
  - 测同 lease 行落库后 metadata_ 不含 platform_token 与 mcp_token 明文 仅含 server_origin strategy actor_user_id 防落库
  - 测 actor_user_id 从 lease metadata 解析为 get_or_issue 的 created_by 参数
  - 扩展 test_start_init_dispatch.py 加断言 dispatch 后 lease.metadata.platform_config 仅 server_origin strategy 不含 local_yaml 或 token 明文 防回退 B1
acceptance:
  - claim 注入测试 payload 含两明文 token 断言通过
  - lease.metadata_ 落库后查无 platform_token mcp_token 明文 安全契约 D-002 守住
  - dispatch 防回退断言 metadata.platform_config 不含 local_yaml 通过
  - 既有 test_start_init_dispatch.py 断言不破 仅扩展非重写
verify:
  - cd backend && uv run pytest app/modules/daemon/lease/tests/test_init_claim_tokens.py app/modules/agent/tests/test_start_init_dispatch.py -q --no-cov
constraints:
  - claim 测试挂 daemon lease tests 不挂 agent tests 因 B1 dispatch 不签 token 签发在 claim 时 task-04
  - 防回退断言明确 B1 dispatch metadata 不含 local_yaml 防止 execute 时误回退到落库写法
  - 复用 daemon lease tests conftest 与 agent tests conftest 不另起
  - 明文断言用 payload 返回值 lease.metadata_ 查无 明确区分 payload 内存与 DB 持久化
---
