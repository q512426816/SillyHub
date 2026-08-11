---
id: task-05
title: context.py provider bind injection
title_zh: 凭证注入四级判断与归属校验
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-04]
blocks: [task-09]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
goal: >
  _inject_provider_config 改四级凭证判断，优先用档案绑定 provider，归属与 agent_kind 校验通过才用，否则回退现状。
implementation:
  - 新增 resolve_provider_config_by_id helper，复用 resolve_default_provider_config 的 anthropic 与 openai_chat 双分支构造
  - _inject_provider_config 读 lease_meta 的 llm_provider_id 并按 id 查 provider
  - 校验 provider.user_id 等于 runtime.user_id 且 provider.agent_kind 等于归一化后的 agent_kind_raw
  - 双校验通过用 by_id 构造的 config，否则走原 resolve_default_provider_config
acceptance:
  - 绑定且归属且 agent_kind 通过则用绑定 provider
  - 任一不满足则回退用户默认
  - 未绑走原路径零回归
verify:
  - cd backend && pytest app/modules/daemon/ -n auto
expects_from:
  task-04:
    needs:
      - lease.metadata.llm_provider_id
constraints:
  - 明文 api_key 只在 decrypt 后短驻 config（R-02）
  - openai_chat 分支 litellm_model_name 用 provider.user_id
  - 归属校验口径 runtime.user_id（D-007 现状口径）
  - 覆盖 D-005 / D-006 / D-007 / FR-03 / FR-05 / FR-06 / NFR-01
---
