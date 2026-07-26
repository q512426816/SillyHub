---
id: task-02
title: LlmProvider model + schema (Create/Update/Read)
title_zh: LlmProvider 模型与 Pydantic 模式
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-01]
blocks: [task-03, task-11, task-12]
requirement_ids: [FR-01]
decision_ids: [D-010@v1]
allowed_paths:
  - backend/app/modules/llm_provider/model.py
  - backend/app/modules/llm_provider/schema.py
provides:
  - contract: LlmProviderRead
    fields: [id, user_id, name, agent_kind, base_url, model, notes, website_url, auth_field, model_role_mappings, default_fallback_model, extra_env, is_default, api_key_masked, created_at, updated_at]
goal: >
  定义 LlmProvider SQLModel ORM（列与 task-01 迁移一致）与 Pydantic 请求/响应 DTO，
  api_key 仅以 masked 形式出参，作为 service/router/前端的字段契约。
implementation:
  - model.py class LlmProvider(BaseModel, table=True) __tablename__=llm_providers，照 git_identity/model.py 逐列声明；model_role_mappings/extra_env 用 dict|None + Column(JSON)；created_at/updated_at 显式 default_factory=datetime.utcnow
  - __table_args__ 声明两条 Index 与 task-01 迁移对齐
  - schema.py LlmProviderCreate：agent_kind Literal[claude]；auth_field Literal[ANTHROPIC_AUTH_TOKEN,ANTHROPIC_API_KEY]（X-13）；api_key/model_role_mappings/extra_env 可选
  - LlmProviderUpdate：全 |None=None；api_key=None 语义=不动原密钥
  - LlmProviderRead：model_config=ConfigDict(from_attributes=True)；含全字段 + api_key_masked；不暴露 encrypted_api_key/明文
acceptance:
  - LlmProviderRead.model_validate(orm_row) 可从 ORM 构造，结果不含密文/明文
  - api_key_masked 字段不在 ORM，仅 schema 承载（值由 service task-03 计算）
verify:
  - cd backend && uv run mypy app && uv run ruff check .
constraints:
  - masked 规则 X-09（task-03 service 算后注入 Read）：明文 <8 位→****；>=8 位→首4...尾4；空/None→字段 None 省略
  - auth_field 用 Literal 限定（X-13），daemon injector task-08 据此值写 env
  - model_role_mappings/extra_env 用 dict|None + Column(JSON)（照 git_identity allowed_repositories JSON 范式）
  - 明文 api_key 不入 ORM（service 先 encrypt 再赋 encrypted_api_key，R-04 已关闭无需 exclude）
  - Read 字段集 = provides 契约（前端 task-11/12 消费），勿随意增删
---
