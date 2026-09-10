---
id: task-05
title: 'schema codex 词表 + pi×openai_chat 禁配（Create 422 + Update service 层）'
title_zh: 'schema codex 词表 + pi×openai_chat 禁配（Create 422 + Update service 层）'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-008, D-012]
allowed_paths:
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/service.py
  - backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py
  - backend/app/modules/llm_provider/tests/test_llm_provider.py
target_files:
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/service.py
  - backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py
  - backend/app/modules/llm_provider/tests/test_llm_provider.py
related_tests:
  - backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py
provides:
  - contract: llm_provider_codex_vocab
    fields: [codex_vocab, pi_openai_chat_422]
goal: >
  LlmProviderCreate.agent_kind 词表增 codex（schema.py:20 仅 Create 一处——Update/FetchModelsRequest
  实证无该字段，Grill B-4；衔接并行变更 4726893a5 已合 main 的 pi），并落 pi×openai_chat 禁配一行规则
  （Create 侧 model_validator 422 + Update 侧 service.update 取行后判，Plan 约束 2），连带翻转
  test_llm_provider_pi_kind.py:53-56 既有 codex 拒绝用例（D-012 连带声明/D-008 分层）。
implementation:
  - schema.py:20 Literal 增 "codex"（claude/pi 缺省与既有语义零改动，注释记 codex 走 daemon 文件层注入）
  - LlmProviderCreate 增 model_validator——agent_kind=pi 且 api_format=openai_chat 抛 ValidationError（FastAPI 422）
  - service.py update（:230-263）取行后判——row.agent_kind=pi 且本次把 api_format 置 openai_chat 时抛新 AppError 子类（code 循 HTTP_422_ 前缀范式，LlmProviderNotFound 同风格）
  - 翻转 test_llm_provider_pi_kind.py:53-56 test_unknown_kind_still_rejected——codex 改断言校验通过，另用真未知字面量（如 gemini）保留 ValidationError 拒绝用例
  - 补用例——pi_kind 文件加 codex 词表/Create 禁配组；test_llm_provider.py TestCrudFlow 加 Update 侧禁配（建 pi 行后 patch api_format=openai_chat 断 422）与 claude/codex×openai_chat 仍合法对照
acceptance:
  - agent_kind=codex Create 校验通过；真未知 kind（如 gemini）仍 ValidationError
  - pi×openai_chat 在 Create 与 Update 两路均 422 拒绝；claude/codex×openai_chat 不受影响
  - 既有 pi 可建/auth_field pattern/claude 缺省零回归组全绿
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests/test_llm_provider_pi_kind.py app/modules/llm_provider/tests/test_llm_provider.py -q
  - cd backend && uv run ruff check app/modules/llm_provider && uv run mypy app/modules/llm_provider
constraints:
  - 仅 Create 一处词表——Update/FetchModelsRequest 不新增 agent_kind 字段（Grill B-4）
  - Update 侧校验落 service 层非 schema（LlmProviderUpdate 无 agent_kind 判不了组合，Plan 约束 2）
  - openapi.json/api-types 联动归 task-06，本 task 不跑 gen:types
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
