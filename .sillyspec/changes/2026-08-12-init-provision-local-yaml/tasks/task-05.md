---
id: task-05
title: start_init_dispatch 注释澄清 actor_user_id 落 metadata
title_zh: agent service start_init_dispatch 补注释说明 B1 token 在 claim 时签不落 metadata 确认 actor_user_id 已写入供 claim 解析 零行为改动
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-03]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/agent/service.py
provides: []
expects_from: []
goal: >
  在 backend/app/modules/agent/service.py start_init_dispatch 补注释说明 B1 抉择 token 在 claim 时 build_claim_payload 签发不落 lease metadata，并确认 metadata.actor_user_id 已写入供 claim 时解析为 created_by，零运行时行为改动，覆盖 FR-03 与 D-002，防回退到 dispatch 阶段签 token 的落库写法。
implementation:
  - 在 start_init_dispatch 的 metadata 构造处 service.py 1890 附近补注释，说明 B1 token 在 claim 时 build_claim_payload mode init 分支现算 get_or_issue 注入 payload 不写 lease.metadata_，对齐 design §5.3.1 B1
  - 确认 metadata 已含 actor_user_id 等于 str actor_user_id 字段 service.py 1892 附近，该字段非敏感供 claim 时 build_claim_payload 解析为 created_by 调 get_or_issue
  - 若 actor_user_id 字段当前未写则补写防御，但核实当前应已存在，避免 claim 时 created_by 解析失败
  - 不改任何运行时逻辑 不动 metadata.platform_config 结构 仍只 server_origin 与 strategy 两键
acceptance:
  - 注释明确 B1 token 在 claim 时签不落 lease.metadata_ 引用 design §5.3.1
  - metadata.actor_user_id 字段存在且值为 str actor_user_id 供 build_claim_payload 解析
  - start_init_dispatch 运行时行为零变化 既有 test_start_init_dispatch.py 全部断言不破
  - metadata.platform_config 仍只含 server_origin 与 strategy 不含 local_yaml 或 token 明文
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_start_init_dispatch.py -q --no-cov
constraints:
  - 零运行时行为改动 纯注释与字段确认，不动 metadata.platform_config 结构
  - 既有 init dispatch 测试不破 task-10 防回退断言会校验 metadata 不含 local_yaml
  - actor_user_id 非敏感字段 可落 metadata，区别于明文 token 绝不落 对齐 D-002
  - 不改 dispatch 阶段签 token 的逻辑 B1 明确签发移到 claim 时 task-04
---
