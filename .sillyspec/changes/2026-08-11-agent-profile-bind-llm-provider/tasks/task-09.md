---
id: task-09
title: backend injection tests
title_zh: 后端凭证注入测试
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-05]
blocks: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py
goal: >
  覆盖凭证注入四级判断、归属校验、agent_kind 校验、openai_chat 分支、删除回退。
implementation:
  - 绑定且归属且 agent_kind 通过用绑定
  - 未绑走用户默认
  - 用户无默认则不注入走本机
  - 跨用户归属不匹配回退
  - agent_kind 不符回退
  - openai_chat 形态构造 6 字段
  - 绑定 provider 删除后回退
acceptance:
  - 上述 7 场景全部断言通过
verify:
  - cd backend && pytest app/modules/daemon/lease/tests/test_inject_provider_config_bind.py -n auto
constraints:
  - 用 backend/.venv/Scripts/python.exe
  - SQLite vs PG 方言，不绑死 SQL 函数名
  - 覆盖 NFR-01 与全局验收 1 到 7
---
