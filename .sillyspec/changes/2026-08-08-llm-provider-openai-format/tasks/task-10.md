---
id: task-10
title: backend provider_config openai shape in context.py
title_zh: 后端 provider_config openai 形态（context.py）
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-09]
blocks: [task-11]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/lease/context.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_lease_context.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/daemon/tests/test_lease_context.py
goal: >
  context.py resolve_default_provider_config（L62）+ _inject_provider_config（L117）加 openai 分支：命中 openai 格式 provider 时构造 6 字段 provider_config {agent_kind, api_format, litellm_base_url, litellm_model_name, litellm_auth_token, model}，不含上游 api_key；anthropic 分支逐字不变。写 provider_config openai 形态单测。
implementation:
  - resolve_default_provider_config（context.py:62）：查命中默认 provider 后，读 provider.api_format（task-01 列）。openai_chat 分支构造 6 字段 dict：agent_kind=provider.agent_kind、api_format="openai_chat"、litellm_base_url=settings.LITELLM_BASE_URL、litellm_model_name=f"usr-{user_id}-{provider.id}"（与 task-09 register 命名逐字一致）、litellm_auth_token=settings.LITELLM_AUTH_TOKEN（daemon 用作 ANTHROPIC_AUTH_TOKEN 打 LiteLLM；源同 task-09 master key / virtual key）、model=provider.model。不解密 / 不下发上游 api_key（D-003）。anthropic 分支现有 9 字段 dict 逐字保留。
  - _inject_provider_config（context.py:117）：复用 resolve_default_provider_config 单一真相源（不另写一份），openai 形态经同一 helper 返回后注入 payload["provider_config"]。X-10 override_model 逻辑保留：openai 形态 provider_config["model"]（= provider.model）覆盖 payload["model"]，与 anthropic 一致。
  - 未命中（用户未配默认）仍返回 None（D-007 零回归，两格式共用）。
  - settings keys（LITELLM_BASE_URL + LITELLM_AUTH_TOKEN）经 app.core.config 读取（复用 task-09 已登记的 settings，不重复定义；若 task-09 用 LITELLM_MASTER_KEY 命名，此处 litellm_auth_token 取同一值——LiteLLM /v1/messages 接受 master key 鉴权）。
  - 写 test_lease_context.py 补 openai 形态用例：openai 命中 → dict 恰 6 键（agent_kind/api_format/litellm_base_url/litellm_model_name/litellm_auth_token/model），断言不含 api_key/auth_field/base_url/model_role_mappings/extra_env/settings_config 等上游字段；litellm_model_name == f"usr-{uid}-{pid}"；anthropic 命中 → 现有 9 字段 dict 逐字相等（零回归锁死）；未配 → None。
  - _inject_provider_config openai 形态 claim payload 注入用例：payload["provider_config"] 为 6 字段 openai 形态，payload["model"] 被 provider.model 覆盖。
acceptance:
  - openai 形态 provider_config 恰 6 字段，不含上游 api_key / auth_field / base_url / model_role_mappings / extra_env / settings_config（D-003/NFR-01）
  - anthropic 形态 9 字段 dict 逐字不变（现有 test_lease_context.py 用例全绿，零回归 NFR-02）
  - litellm_model_name = f"usr-{user_id}-{provider.id}"，与 task-09 register 命名一致（R-03 路由命中前提）
  - _inject_provider_config openai 形态正确注入 claim payload（interactive + batch 两路经同一 helper）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov（含 test_lease_context.py openai 形态新增 + 现有 anthropic 用例零回归）
  - 断言 openai 形态 dict 键集合 == {agent_kind, api_format, litellm_base_url, litellm_model_name, litellm_auth_token, model}
constraints:
  - openai 形态 config 绝不含上游 api_key（D-003/NFR-01，比今天 anthropic「key 下发 daemon」更安全）
  - anthropic 分支逐字不变（NFR-02 零回归；只加 if api_format=="openai_chat" 早返回，不动既有 9 字段构造）
  - litellm_model_name 命名必须与 task-09 register 逐字一致（usr-<uid>-<pid>），否则 LiteLLM 按 model_name 路由不命中 → Claude Code 报错
  - litellm_auth_token 不进日志/审计（R-02，同 api_key 脱敏铁律；仅放 provider_config dict 短暂下发）
provides:
  - resolve_default_provider_config openai 形态 6 字段 provider_config 契约：{agent_kind, api_format:"openai_chat", litellm_base_url, litellm_model_name, litellm_auth_token, model}
  - _inject_provider_config openai 分支（claim interactive + batch 两路注入 openai 形态）
expects_from:
  task-09:
    - contract: litellm_client.register 已在 set_default 联动（openai provider set-default 后 model_name=usr-<uid>-<pid> 已 live in LiteLLM）；context.py 构造同名 litellm_model_name 才能被 LiteLLM 路由命中
      needs: [model_name 命名约定 f"usr-{user_id}-{provider_id}", settings keys LITELLM_BASE_URL + LITELLM_AUTH_TOKEN 可读]
---

# task-10 实现笔记

design 锚点：§5.1 数据流（provider_config openai 形态下发 daemon ← 6 字段不含上游 key）、§7.3 provider_config openai 形态（6 字段逐字定义）、§7.5 生命周期契约表「claim lease / PROVIDER_CONFIG_CHANGED」两事件 openai 形态、§9 兼容策略（anthropic 逐字不变）、§10 R-08（LiteLLM SPOF 仅影响 openai 链路）。

上下游衔接：
- 上游 task-09：model_name 命名 + settings keys 是跨任务契约。set_default 已先 register，本任务构造的 litellm_model_name 在 claim / WS push 时已被 LiteLLM 认识。命名漂移 = 路由 404，本任务单测必须与 task-09 用例锁同一格式。
- 下游 task-11：daemon ProviderConfig 类型加 litellm_* 三字段 + injector openai 分支消费本任务产出的 6 字段。字段名必须逐字对齐（snake_case，对齐既有 ProviderConfig 风格）。
- 单一真相源：_inject_provider_config 不另写 openai 构造，全部经 resolve_default_provider_config（task 原作者已强调 D-006 单一真相源，避免 claim 与 set_default 即时下发两份各写）。

D-003/NFR-01 安全增益：今天 anthropic 形态把解密后的上游 api_key 放进 provider_config 下发 daemon；openai 形态改为只下发 LiteLLM 地址 + 令牌 + model_name，上游 key 留在服务器 LiteLLM（task-09 register 时传一次）。daemon env / 日志 / 审计均不含上游 key，攻击面收窄。anthropic 链路因「逐字不变」约束不在本任务改（留独立安全增强坑）。
