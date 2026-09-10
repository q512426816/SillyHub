---
id: task-07
title: 'enable-pi-option-and-generalize-auth-field-input-in-llm-provider-form'
title_zh: '前端 llm-provider 表单启用 pi 选项 + pi 时 auth_field 泛化为可输入 env 名'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P1
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/lib/api/llm-providers.ts
target_files:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
  - frontend/src/lib/api/llm-providers.ts
expects_from:
  task-08:
    - contract: LlmProviderCreate
      needs: [agent_kind, auth_field]
related_tests:
  - frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx
goal: >
  启用 llm-provider-form 既有 pi 预留下拉项并把 agentKind 固定 state 接成可变，
  agent_kind=pi 时认证字段由固定两选项下拉泛化为可输入 env 变量名（pattern 同
  backend），打通用户从入口创建 agent_kind=pi 独立凭证的前端段（D-002@v1）。
implementation:
  - AGENT_KIND_OPTIONS（llm-provider-form.tsx:56-65）去掉 pi 项的 disabled 与「即将支持」label 后缀，codex/gemini 占位项保持 disabled 不动
  - agentKind state（:203 固定解构）改为可变——编辑态初值取 initial?.agent_kind、新建缺省 claude，Agent 种类 select onChange（:709-711 空实现）接 setAgentKind，hint 文案（:720）同步更新为 pi 可选语义
  - agent_kind=pi 时认证字段控件（:841-864 固定下拉 AUTH_FIELD_OPTIONS）泛化为可输入（输入框或 datalist），按 ^[A-Z][A-Z0-9_]*$ 同款 pattern 即时校验非法输入并提示，占位示例 ZAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY；agent_kind=claude 保持既有两选项下拉与 renameSettingsEnvAuthKey 联动零变化
  - handleSubmit（:335-350）payload 的 agent_kind/auth_field 按当前表单值透传（既有透传链不动，仅解除固定值）
  - 更新 __tests__/llm-provider-form.test.tsx——43/72-73 行 claude 缺省断言保留（缺省仍 claude），新增用例——pi 选项可选且提交 values.agent_kind 为 pi、pi 时 auth_field 输入 ZAI_API_KEY 透传、非法 env 名（小写/含空格）被 pattern 拦截、claude 路径零回归
acceptance:
  - Pi 选项可选不再 disabled，提交 onSubmit values.agent_kind 可为 pi 并透传进 payload
  - agent_kind=pi 时 auth_field 可输入任意匹配 ^[A-Z][A-Z0-9_]*$ 的 env 名，非法输入被拦截提示；claude 时仍是两选项下拉且缺省 ANTHROPIC_AUTH_TOKEN 不变
  - 定向 vitest（llm-provider-form.test.tsx）全绿，含新增 pi 用例与既有 claude 用例零回归
verify:
  - cd frontend && pnpm exec vitest run src/components/llm-providers/__tests__/llm-provider-form.test.tsx
constraints:
  - 只改表单组件与其测试两个文件；不动 lib/api 组装层、后端与 api-types（类型以 task-08 再生成后的 LlmProviderCreate 为准，不手改生成物）
  - claude 既有交互逐字零回归——agent_kind 缺省 claude、auth_field 两选项、认证键改名联动均不变
  - pi 时 auth_field 校验 pattern 与 backend（task-04）同款，前端只做即时报错不吞非法值
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
