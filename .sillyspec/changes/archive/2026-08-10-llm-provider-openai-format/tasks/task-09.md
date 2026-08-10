---
id: task-09
title: backend litellm_client + set/unset/delete openai linkage
title_zh: 后端 litellm_client 封装 + set/unset/delete openai 联动
author: qinyi
created_at: 2026-08-09 01:31:00
priority: P0
depends_on: [task-08, task-02]
blocks: [task-10]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/litellm_client.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/schema.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/router.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_litellm_client.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_llm_provider.py
related_tests:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_litellm_client.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/llm_provider/tests/test_llm_provider.py
goal: >
  新建 litellm_client.py 封装 LiteLLM admin API register/unregister（幂等 best-effort，model_name=usr-<uid>-<pid>）；service.set_default/unset_default/delete 对 openai 格式联动 register/unregister；set_default 返回 litellm_registered 标志（扩 DefaultSwitchResult + SetDefaultResult）；写 litellm_client mock 单测。
implementation:
  - 新建 litellm_client.py：异步客户端封装 LiteLLM admin API。register(provider, *, user_id) -> bool：POST {LITELLM_BASE_URL}/model/new（Authorization: Bearer {LITELLM_MASTER_KEY}），body 含 model_name=f"usr-{user_id}-{provider.id}"、model=provider.model、api_base=_strip_openai_suffix(provider.base_url)（复用 task-02 helper）、api_key=self._cipher.decrypt(provider.encrypted_api_key, provider.key_id)、litelLm_params.provider="openai"；已存在（409/重复）视为成功（幂等）。unregister(model_name) -> None：DELETE /model/delete（按 model_name 删；不存在不抛，幂等）。两方法 best-effort：任何 httpx/网络/解析异常 catch 后 register 返回 False、unregister 静默，不向上抛。
  - LITELLM_BASE_URL + LITELLM_MASTER_KEY 从 app.core.config settings 读取（spike-litellm-routing 定稿 admin API 路由后，master key 即 admin 凭证；若 spike 选 virtual key，本处改为读 virtual key，settings key 名不变）。
  - service.DefaultSwitchResult（service.py:128 dataclass）加字段 litellm_registered: bool | None = None（anthropic 格式 / unset 场景保持 None，仅 openai set 场景填 True/False）。
  - schema.SetDefaultResult（schema.py:169）加字段 litellm_registered: bool | None = None；router.py set-default/unset-default 端点按 DefaultSwitchResult 字段名透传进 SetDefaultResult。
  - service.set_default（service.py:262）：探测成功 + 事务 commit 后，若 row.api_format == "openai_chat" 调 litellm_client.register(row, user_id=row.user_id)，best-effort；成功 litellm_registered=True，失败 litellm_registered=False（不阻塞 is_default，R-09 降级）。anthropic 格式 litellm_registered=None。返回 DefaultSwitchResult(switched=True, affected_sessions=affected, litellm_registered=...)。
  - service.unset_default（service.py:344）/ delete（service.py:256）：openai 格式调 litellm_client.unregister(f"usr-{row.user_id}-{row.id}")，best-effort（失败仅 log.warning，不阻塞 unset/delete）。
  - 写 test_litellm_client.py：mock httpx.AsyncClient（不真连 LiteLLM）。覆盖 register 正常/幂等（409 视成功）/异常返回 False；unregister 正常/不存在（幂等不抛）/异常静默；model_name=usr-<uid>-<pid> 命中；api_base 剥 /chat/completions；api_key 仅出现在请求体不进日志（caplog 断言）。
  - test_llm_provider.py 补 set_default openai 联动用例（mock litellm_client.register）：成功 litellm_registered=True；register 抛错 litellm_registered=False 且 is_default 仍 True；unset/delete 联动 unregister；anthropic set_default litellm_registered=None（零回归）。
acceptance:
  - litellm_client.register/unregister 幂等 best-effort（register 失败返回 False 不抛；unregister 不存在/失败静默）
  - set_default openai 联动 register；失败时 is_default 已 commit 仍为 True，litellm_registered=False（R-09 降级，前端可提示）
  - unset_default / delete openai 联动 unregister（best-effort）
  - DefaultSwitchResult + SetDefaultResult 含 litellm_registered 字段，router 透传
  - model_name = usr-<uid>-<pid> 全局唯一（R-03）
  - openai 上游 api_key 仅出现在 register 请求体，不进日志/响应/审计（R-02/NFR-01）
verify:
  - cd backend && uv run pytest app/modules/llm_provider -q --no-cov（含 test_litellm_client.py + test_llm_provider.py 联动用例，全绿）
  - grep -rn "api_key" backend/app/modules/llm_provider/litellm_client.py 确认仅传 LiteLLM 请求体，log 行不含明文 key
constraints:
  - register/unregister best-effort（R-09）：失败不阻塞 is_default 变更；set_default 返回 litellm_registered=False 供前端 toast「网关注册失败，Claude Code 暂不可用，请重试或联系管理员」
  - model_name=usr-<uid>-<pid> 全局唯一幂等（R-03 多用户上游路由隔离）
  - openai 上游 api_key 仅传 LiteLLM 请求体，不入日志/响应/审计（R-02/NFR-01 铁律延续）
  - 路由机制（admin API vs virtual key）以 spike-litellm-routing（R-01/C-02）结论为准；admin API 路径用 master key 作 Authorization，spike 切 virtual key 则改 token 源不改函数签名
  - anthropic 格式 set/unset/delete 行为逐字不变（litellm_registered=None，零回归 NFR-02）
provides:
  - backend/app/modules/llm_provider/litellm_client.py：register(provider, *, user_id) -> bool / unregister(model_name) -> None（幂等 best-effort）
  - model_name 命名约定 f"usr-{user_id}-{provider_id}"（task-10 context.py 构造 litellm_model_name 复用，必须与本处 register 一致）
  - settings keys：LITELLM_BASE_URL + LITELLM_MASTER_KEY 读取入口（task-10 context.py 复用同一 settings 读 litellm_base_url + litellm_auth_token）
  - service.DefaultSwitchResult.litellm_registered: bool | None 字段
  - schema.SetDefaultResult.litellm_registered: bool | None 字段 + router 透传
expects_from:
  task-08:
    - contract: LiteLLM 服务部署就绪，backend 容器可经 LITELLM_BASE_URL 访问 admin API
      needs: [docker-compose litellm 服务 + master key env + healthcheck + restart=always, backend 同网络可达]
  task-02:
    - contract: api_format 列 + openai 鉴权/URL helper 已就绪，set_default 探测可复用
      needs: [provider.api_format 列（task-01 回填 anthropic）, _strip_openai_suffix helper, probe_provider(api_format) openai 探测上游 key 有效]
---

# task-09 实现笔记

design 锚点：§5.1 数据流（set-default → 注册 LiteLLM → 推 provider_config）、§5.3 Wave2 后端 litellm_client + 联动、§7.5 生命周期契约表「set-default(openai) / unset-default(openai) / delete provider(openai)」三事件、§10 R-09（best-effort 降级）+ R-03（model_name 全局唯一）+ R-02（key 脱敏）。

上下游衔接：
- 上游 task-02：provider.api_format 列（task-01 建列）+ _strip_openai_suffix / probe_provider(api_format) 是本任务 register api_base 计算 + set_default 探测的依赖。
- 上游 task-08：LiteLLM 服务必须先可达，否则 register 恒 False（本任务 mock 测不依赖真服务，但联调在 task-12）。
- 下游 task-10：context.py 构造 provider_config openai 形态时，litellm_model_name 必须用本任务约定的 usr-<uid>-<pid>，否则 LiteLLM 路由不命中（R-03）。set_default 已先 register 写入 LiteLLM，后续 claim/WS 推送 provider_config 时 model_name 已 live。

R-09 降级语义：register best-effort 失败时，is_default 已在事务内 commit 为 True（不可回滚，因探测已成功），故 provider_config 仍会以 openai 形态下发，daemon 拿到 litellm_* 后尝试连 LiteLLM 会失败 → Claude Code 报错可见。set_default 返回 litellm_registered=False 让前端明示「网关注册失败」，用户可重试 set-default（幂等 register）或联系管理员。这是设计明示的已知降级态（§10 R-09），优于「静默成功」。
