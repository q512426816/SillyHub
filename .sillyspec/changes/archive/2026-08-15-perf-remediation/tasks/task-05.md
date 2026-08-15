---
id: task-05
title: api_key auth key_prefix index filter
title_zh: api_key 认证候选查询按 key_prefix 索引过滤，bcrypt 扫描从全量降到同前缀
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/auth/api_key_service.py
  - backend/tests/modules/auth/
goal: >
  authenticate bcrypt 路径候选查询加 WHERE key_prefix = :prefix（与签发侧
  _display_prefix 同构计算），bcrypt verify 次数从 O(全部活跃 key) 降到
  O(同前缀 key)；候选为空时防御性回退全扫分支。缓存逻辑不动。
implementation:
  - auth/api_key_service.py:228-241：候选 stmt 加 .where(col(ApiKey.key_prefix) == key_prefix)——key_prefix 变量 :209 已用 _display_prefix(plaintext) 算好，直接复用（同构：签发侧 :105 row.key_prefix=_display_prefix(plaintext)，前 12 字符含 shk_live_ 前缀）
  - ix_api_keys_prefix 索引已存在、key_prefix NOT NULL（design R-03 Grill 核实），不加迁移
  - 空结果防御性回退：prefix 过滤后候选为空（prefix 不匹配但 key 有效的理论场景 / 历史行）→ 重查无 prefix 条件全扫一次，再走原循环；两轮皆空才走负缓存路径
  - 循环体 bcrypt verify（:237 to_thread）、过期/owner 失效判定、正负缓存读写（:212-225 / :248-265）全部不动
  - 测试：命中行为等价（有效 key 认证成功 + last_used 更新）、未命中等价（错误明文 → None + 负缓存）、prefix 过滤单测（造同 prefix 多 key 逐条 verify、异 prefix key 不进候选）、回退分支单测（手工把行 key_prefix 改错 → 仍能认证成功）
acceptance:
  - 有效 key 认证路径行为与改前一致（含缓存命中/回源两态）
  - 异 prefix 的 key 不再被 bcrypt verify（可用 mock verify 计数断言）
  - prefix 数据异常（被改写）时回退全扫仍认证成功，无静默 401
verify:
  - cd backend && uv run pytest tests/modules/auth/test_api_key_service.py -q --no-cov
  - cd backend && uv run pytest tests/modules/auth/ -q --no-cov
  - cd backend && uv run ruff format --check app/modules/auth/api_key_service.py
  - cd backend && uv run mypy app/modules/auth/api_key_service.py
constraints: 缓存键结构与 TTL 不动；revoke 按前缀清缓存路径不动；NFR-04 不加索引不加迁移；负缓存语义（matched_but_invalid 不设负缓存）保持。
---
