---
id: task-04
title: '注册与模型路由——dsh-settings.ts per-session DSH_HOME cordis.patch.yml 写入器（llm-pi-ai 路由生成）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（16 键 caps 口径含 Grill 修正：permission_dialog=true/dialog=''native''/multimodal=false）+ gen-provider-caps.mjs 三端镜像刷新（FR-05/06）'
title_zh: '注册与模型路由——dsh-settings.ts per-session DSH_HOME cordis.patch.yml 写入器（llm-pi-ai 路由生成）+ providers.ts PROVIDER_CAPS/INTERACTIVE_PROVIDERS 注册（16 键 caps 口径含 Grill 修正：permission_dialog=true/dialog=''native''/multimodal=false）+ gen-provider-caps.mjs 三端镜像刷新（FR-05/06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/dsh-settings.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/tests/dsh-settings.test.ts
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
  - sillyhub-daemon/tests/provider-adapter-registry.test.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/lib/provider-caps.ts
target_files:
  - NEW:sillyhub-daemon/src/dsh-settings.ts
  - NEW:sillyhub-daemon/tests/dsh-settings.test.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
goal: >
  引擎注册与模型路由：providers.ts 注册 dsh（caps 16 键按 Grill 修正后口径）+ dsh-settings.ts per-session DSH_HOME patch 写入器 + caps 三端镜像刷新。
expects_from:
  - "task-03: dsh-acp-driver 工厂（createDriver 消费）"
implementation:
  - sillyhub-daemon/src/interactive/providers.ts：PROVIDER_CAPS 加 dsh 条目（resume/mcp/attachments/thinking/subagent=false/permission_dialog=true/edit_patch=false/model_select/provider_switch/ctx_usage=true/compact=false/thinking_level=true/steering=false/multimodal=false、dialog='native'、sessionFork='none'——design 接口定义修正后口径）+ INTERACTIVE_PROVIDERS 加 ProviderAdapter（createDriver/envInjector apiKeyEnv 注入/fileSettings 指向 dsh-settings/perSessionDir dsh-home/<sessionId>/smokeSuite/switchable=true）
  - 新建 sillyhub-daemon/src/dsh-settings.ts：按 ProviderConfig 生成 per-session DSH_HOME 的 profiles/acp/cordis.patch.yml（llm-pi-ai 自定义路由：api 按 base_url 形态判 anthropic-messages/openai-completions、apiKeyEnv 指向注入变量、models 含 platform 传入 model），照 sillyhub-daemon/src/codex-settings.ts 先例；无 provider_config 时不写 patch（dsh 本机默认）
  - 跑 sillyhub-daemon/scripts/gen-provider-caps.mjs 刷新 backend/app/modules/agent/provider_caps.py 与 frontend/src/lib/provider-caps.ts 镜像（生成物不手改）
  - 新建 sillyhub-daemon/tests/dsh-settings.test.ts：patch 内容快照（api 判定/apiKeyEnv 引用/无配置不写）；更新 provider-registry / provider-adapter-registry 既有断言（provider 集合与 caps 同值守护）
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py 随镜像刷新对齐
acceptance:
  - INTERACTIVE_PROVIDERS 含 dsh 完整声明（satisfies 编译期校验过）
  - caps 三端镜像一致（daemon 单源 → backend/frontend 生成物，对齐测试绿）
  - patch 写入器三态正确（anthropic 形态/openai 形态/无配置跳过）
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm exec vitest run tests/dsh-settings.test.ts tests/interactive/provider-registry.test.ts tests/provider-adapter-registry.test.ts
  - cd backend && uv run pytest -q app/modules/agent/tests/test_provider_caps_alignment.py
constraints:
  - caps 16 键逐字按 design.md 接口定义修正后口径（permission_dialog=true/dialog='native'/multimodal=false——Grill 阻断项修复结论）
  - 镜像文件只由 gen-provider-caps.mjs 生成；switchable 与 caps.provider_switch 同值（守护测试锁定）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
