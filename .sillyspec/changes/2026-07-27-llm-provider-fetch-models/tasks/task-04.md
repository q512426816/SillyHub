---
id: task-04
title: context.py provider_config 透传 settings_config
title_zh: context.py 透传 settings_config 到 lease
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P1
depends_on: [task-01]
blocks: [task-05, task-06, task-13]
requirement_ids: [FR-10]
decision_ids: [D-009]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
provides:
  - contract: provider_config (lease payload)
    fields: [settings_config]
expects_from:
  task-01:
    - contract: LlmProvider.settings_config
      needs: [settings_config]
goal: >
  把 settings_config 透传进 lease 下发的 provider_config，供 daemon 合并（env 顶层覆盖 + settings.json 顶层合并）。
implementation:
  - 在 backend/app/modules/daemon/lease/context.py:139-148 现有 8 字段 dict 末尾追加 "settings_config": provider.settings_config。
  - 原样透传 ORM 行的 settings_config 值，不解密、不加工、不判空；为 None（含 task-01 brownfield 老行）时照传 None，daemon 侧 ?.env ?? {} 链路判空（design §5.2 D-009）。
  - 不动相邻 override_model（X-10）逻辑，仅扩 dict。
acceptance:
  - payload["provider_config"] dict 含 settings_config 键。
  - 值 == provider 行的 settings_config（含 None 情形）。
  - 其余 8 字段（agent_kind/base_url/api_key/auth_field/model/model_role_mappings/default_fallback_model/extra_env）顺序与值不变。
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov
  - cd backend && uv run mypy app
constraints:
  - 只透传不改值；不在此解密（api_key 解密仍在 :142 本地完成）。
  - brownfield 兼容：provider 无 settings_config（NULL）视 None 透传，daemon ?. 链路安全。
---
