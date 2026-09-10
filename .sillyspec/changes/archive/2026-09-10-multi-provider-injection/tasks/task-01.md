---
id: task-01
title: implement-codex-home-writer-with-per-form-mapping
title_zh: 'codex-settings.ts——per-session CODEX_HOME 写盘器（per-form 映射/保守合并/失败跳过含 env）'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: []
blocks: ['task-02', 'task-03']
requirement_ids: [FR-01]
decision_ids: [D-003, D-005, D-011, D-012]
allowed_paths:
  - sillyhub-daemon/src/codex-settings.ts
  - sillyhub-daemon/tests/codex-settings.test.ts
target_files:
  - NEW:sillyhub-daemon/src/codex-settings.ts
  - NEW:sillyhub-daemon/tests/codex-settings.test.ts
provides:
  - contract: codex-settings.writeCodexHome
    fields: [writeCodexHome, CodexHomeWriteInput, per_form_mapping]
  - contract: settings-writer-failure-convention
    fields: [failure_convention]
goal: >
  新增 codex-settings.ts 写盘器，按 per-form 映射把 lease 供应商凭证写进 per-session CODEX_HOME 两文件（auth.json+config.toml，golden=spike a2b 系证据），补齐 codex 供应商切换不生效缺口（FR-01 / D-005 载体 / D-011 目录粒度 / D-012 门槛）。
implementation:
  - 新建 sillyhub-daemon/src/codex-settings.ts，导出 CodexHomeWriteInput（codexHome/provider/daemonApiKey 三字段）与 writeCodexHome 返回 Promise<void>，风格对齐 claude-settings.ts（纯函数+显式路径入参+async best-effort）；per-form 映射随接口注释固化为唯一事实源——anthropic 形态 key 取 provider.api_key、base_url 取 provider.base_url、model 取 default_fallback_model 缺省回退 model 裸 id，openai_chat 形态 key 取 daemonApiKey（master key 不出 backend）、base_url 取 litellm_base_url、model 取 litellm_model_name（对齐 credential-injector.ts openai_chat 分支先例）
  - auth.json 写顶层 OPENAI_API_KEY 键=per-form key（golden=spike a2-auth.json，JSON 先读后写保留未知兄弟键）；config.toml 写顶层 model/model_provider 与 model_providers.sillyhub 表（name/base_url/wire_api 固定值 responses——codex 0.147.0 已移除 chat 无第二合法值），已有文件仅差量替换托管段、非托管行原样保留，零新增依赖手写极小 TOML 序列化（package.json 不在授权路径）
  - 门槛按 D-012——provider_config 存在即进入，per-form 必需字段校验内移（anthropic 形态 api_key/base_url 至少一项、openai_chat 形态 litellm_base_url/litellm_model_name 至少一项），缺失记 warn 跳过写盘；provider_config 整体缺省时不写不抛，与现状逐字一致（lease absent 边界）
  - 写 IO 失败记 error 后抛出交调用方处置（调用方跳过 CODEX_HOME env 注入仍 spawn，失败语义唯一化——design Plan 约束 3），不静默吞错
  - 新建 sillyhub-daemon/tests/codex-settings.test.ts 覆盖两形态 golden 逐字段比对、保守合并保留非托管段、门槛正反例、写失败抛出、absent 零写入（mkdtemp 隔离，学 claude-settings.test.ts 范式）
acceptance:
  - anthropic 形态写出的 config.toml/auth.json 与 spike a2b-config.toml/a2-auth.json golden 逐字段一致（provider 表键名 sillyhub、wire_api 值 responses），已有文件重写后非托管段逐字保留
  - openai_chat 形态 key=daemonApiKey、base_url=litellm_base_url、model=litellm_model_name 全部落盘正确且全程不引用 provider.api_key
  - per-form 必需字段缺失记 warn 且零文件写入；provider_config 缺省时不写不抛；写 IO 失败（mock EACCES）记 error 并 reject 供调用方跳过 env 注入
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/codex-settings.test.ts && pnpm typecheck
constraints:
  - 不做 spawn 接线/目录生命周期/热切换（归 task-03/04）；不注册 codex env 注入器（codex 走文件层，D-003）；不新增 package.json 依赖；daemonApiKey 与 api_key 不入日志
  - openai_chat 形态判据不得引用 anthropic 分支字段名（D-012——该形态 payload 无 api_key 无 base_url）；不改 ProviderConfig 形状与 lease 协议；wire_api 固定 responses 写死并注明 CLI 版本基线 0.147.0（R-03 格式漂移由 task-07 冒烟暴露）
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
