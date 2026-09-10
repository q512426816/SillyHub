---
id: task-04
title: 'relax-llm-provider-schema-pi-kind-and-auth-field-env-pattern'
title_zh: 'backend llm_provider schema 放开 agent_kind=pi + auth_field 泛化 env 变量名 pattern（Create/Update/FetchModels 三处 auth_field）'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py
target_files:
  - backend/app/modules/llm_provider/schema.py
  - NEW:backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py
goal: >
  放开 llm_provider pydantic 值域，让用户能创建 agent_kind=pi 的独立凭证行
  （D-002@v1 独立配额池的 backend 前提）：agent_kind 扩员 + auth_field 三处
  泛化为 env 变量名 pattern，为 daemon 侧 PiCredentialInjector（task-05）供合法输入。
implementation:
  - 'LlmProviderCreate.agent_kind（schema.py:17）由 Literal["claude"] 改 Literal["claude", "pi"]；agent_kind 仅 Create 有该字段，Update/FetchModelsRequest 不新增'
  - 'auth_field 三处泛化（pattern=r"^[A-Z][A-Z0-9_]*$"）：Create（:23）str = Field(default="ANTHROPIC_AUTH_TOKEN", pattern=...)；Update（:41）str | None = Field(default=None, pattern=...)；FetchModelsRequest（:104）str | None = Field(default=None, pattern=...)，均保持原缺省/None 语义'
  - 'docstring 补注：auth_field 形状=env 变量名（大写字母开头，仅大写/数字/下划线）；pi 用途=平台 worker 独立配额池凭证（D-002@v1），如 ZAI_API_KEY/OPENROUTER_API_KEY'
  - '新增 tests/test_llm_provider_pi_kind.py：pi 可建、非法 auth_field（小写/含空格/空串）被 pattern 拒、claude 旧值与缺省零回归'
acceptance:
  - 'LlmProviderCreate(agent_kind="pi", auth_field="ZAI_API_KEY") 校验通过'
  - 'auth_field="zai_key"/"ANTHROPIC KEY"/"" 触发 pydantic ValidationError（pattern 生效）'
  - 'claude 零回归：agent_kind 缺省 "claude"、auth_field 缺省 "ANTHROPIC_AUTH_TOKEN" 及旧值 "ANTHROPIC_API_KEY" 校验行为与改前逐字一致；Update auth_field=None 仍=不动'
verify:
  - 'cd backend && uv run pytest app/modules/llm_provider/tests/test_llm_provider_pi_kind.py -q --no-cov'
constraints:
  - '零 DDL：agent_kind（String(32)）/auth_field（String(64)）列宽已容纳，仅 pydantic 校验层放宽'
  - 'claude 旧值/缺省行为逐字不变（缺省 ANTHROPIC_AUTH_TOKEN 不动，pattern 兼容旧两字面量）'
  - 'agent_kind 仅 LlmProviderCreate 有字段（Update/FetchModelsRequest 无）；不动 service/router/claim 解析链'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
