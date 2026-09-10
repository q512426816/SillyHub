---
id: task-06
title: '前端表单（codex 选项/pi 端点字段/openai_chat 禁选）+ gen:types 联动'
title_zh: '前端表单（codex 选项/pi 端点字段/openai_chat 禁选）+ gen:types 联动'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P1
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-012]
allowed_paths:
  - frontend/src/components/llm-providers/
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
target_files:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
expects_from:
  task-05:
    - contract: llm_provider_codex_vocab
      needs: [codex_vocab, pi_openai_chat_422]
goal: >
  表单 agent_kind 增 codex 选项（AGENT_KIND_OPTIONS :58 / 下拉 :752 一带）；agentKind=pi 时 API 格式
  禁选 openai_chat 并按 Plan 约束 4 落禁配说明文案；pi 的 baseUrl 字段语义标注（非空=自定义端点走
  daemon 文件层，空=官方端点走 env 层）；双仓跑 gen:types 让 api-types/openapi 与词表零漂移。
implementation:
  - 前端禁选与禁配文案与后端 422 规则逐字对齐（pi 时 openai_chat 禁选+提示文案）
  - AGENT_KIND_OPTIONS 增 codex（注明凭证经 daemon per-session CODEX_HOME 文件注入，无需 env auth_field）；agentKind 状态归一（:220-221 initial 兼容 codex）
  - API 格式下拉（:826-844）——agentKind=pi 时 openai_chat 选项 disabled + hint 明示 pi 不支持 OpenAI 格式（Plan 约束 4）；提交前校验兜底拦绕过
  - pi 分支 baseUrl 提示补自定义端点语义（填=文件层三文件，空=官方端点 env 层）；同步修正 :894-897 既有「pi 恒按 auth_field 注 key」注释（禁配后说法失效，CLAUDE.md 18）
  - 表单测试——codex 可选且 payload agent_kind=codex、pi 选 openai_chat 被拦、claude 路径零回归
  - gen:types 双仓同批——frontend pnpm gen:types（产 src/lib/api-types.ts + backend/openapi.json）与 sillyhub-daemon pnpm gen:types（agent_kind 类型含 codex，两 api-types :16264 一带）
acceptance:
  - codex 可选可提交；pi 时 openai_chat 被禁选且文案说明原因；claude 路径行为零变化
  - frontend 与 sillyhub-daemon 两处 pnpm gen:types:check 零漂移（agent_kind 类型含 codex）
  - llm-providers 既有测试组全绿 + tsc --noEmit 通过
verify:
  - cd frontend && pnpm gen:types && pnpm vitest run src/components/llm-providers && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm gen:types:check
constraints:
  - api-types 禁手写——仅 gen:types 生成提交（CLAUDE.md 21 铁律）
  - gen:types 前确认 frontend node_modules 健康（pnpm exec tsc --version 可跑，防假 CSSProperties 报错误判）
  - 热切换确定性文案规范（R-05）不因本 task 引入——切换提示组件不在改动面
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
