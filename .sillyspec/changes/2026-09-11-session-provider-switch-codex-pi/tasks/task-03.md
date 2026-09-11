---
id: task-03
title: 'reload 内核接入——_reloadSessionNow codex/pi 文件层合并 + codex 迁移钩子 + reloadWithProvider 删 claude-only 守卫 + types/cli daemonApiKey 注入'
title_zh: 'reload 内核接入——_reloadSessionNow codex/pi 文件层合并 + codex 迁移钩子 + reloadWithProvider 删 claude-only 守卫 + types/cli daemonApiKey 注入'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:36
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-04, FR-05]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/cli.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  把 codex/pi 的文件层凭证注入（ForReload 写盘 + env 合并）与 codex thread 迁移钩子接进
  _reloadSessionNow 共享 reload 内核，删除 reloadWithProvider 的 claude-only 守卫，并在
  SessionManagerDeps/cli.ts 装配 daemonApiKey——使会话级切换与 PROVIDER_CONFIG_CHANGED
  热切换对 codex/pi 确定性生效（FR-01/FR-04，D-003@v1）。
implementation:
  - types.ts SessionManagerDeps（:477 一带）增可选 daemonApiKey 字段（string | null，缺省 null），注释注明 producer=cli.ts 装配处传 daemon api_key（daemon.ts:1957 仅经 DaemonOptions 接收成品不新增通道）、consumer=reload/restore 传 ForReload（codex openai_chat 形态 litellm key，同 spawn 缺省语义），进程内注入不出 daemon 边界
  - cli.ts SessionManager 构造 deps（:807 一带）补 daemonApiKey 注入，取 config.api_key ?? null——与 spawn 路径 daemon.ts:8266 this._config.api_key / task-runner.ts:705 this.config?.api_key ?? null 同源
  - session-manager.ts _reloadSessionNow 在 applyTranscriptConfigDir 调用（:1806-1810）之后、driver.start（:1878）之前插文件层合并块，仅 state.provider 为 codex 或 pi 执行（claude 跳过）；codex 迁移钩子（仅 codex）——条件 providerConfig 非空 且 oldEnv 无 CODEX_HOME 键 且 state.agentSessionId 非空时 await migrateCodexThreadFromHost(state.agentSessionId, join(daemonStateDir(), 'codex', state.sessionId))（确定性派生路径对齐 task-runner.ts:259，需补 daemonStateDir import），迁移失败 warn 不阻断 reload（对齐 claude 迁移失败降级 R-01 语义）
  - 同块写盘 + env 合并——const fileEnv = await applyProviderFileSettingsForReload(入参 sessionKey=state.sessionId, provider=providerConfig, daemonApiKey=this.deps.daemonApiKey ?? null, priorEnv=oldEnv)，随后 Object.assign(newEnv, fileEnv)（文件层键最后合并盖过下层，与 daemon.ts:8285 spawn 路径同模式——per-session 隔离目录是平台更高意志；失败兜底已内聚在 ForReload 返回值，本处不加 try/catch 重试）
  - reloadWithProvider（:1499-1506）删 state.provider !== 'claude' 抛错守卫（内核已 provider-generic），同步改写方法 JSDoc 的 @throws 行（删 codex 未支持措辞）；锁死旧行为的两处回归断言随守卫删除转红——session-manager-config-switch.test.ts REG-4（:382-393）与 session-manager-reload-provider.test.ts 边界-2（:596-608），断言改写为 codex 走通归 task-06 统一收口（两文件在 task-06 allowed_paths，本卡不占路径）
acceptance:
  - codex 会话 reload 切供应商后 state.env 带 CODEX_HOME 且指向 daemonStateDir()/codex/<sessionId>，目录内 auth.json / config.toml 被新供应商产物重写
  - pi 会话切自定义端点供应商后 state.env 带 PI_CODING_AGENT_DIR；切官方端点形态供应商后不带（走 env 层）
  - codex 宿主起步会话（oldEnv 无 CODEX_HOME）首次切平台供应商触发 migrateCodexThreadFromHost（三联条件 providerConfig 非空 且 oldEnv 无 CODEX_HOME 且 agentSessionId 非空，缺一不触发）；已带 CODEX_HOME 的会话不触发
  - claude 会话 reload 路径 env 逐字不变（合并块仅 codex/pi 执行），既有 claude reload 用例不改预期全绿
  - reloadWithProvider 对 codex 会话不再抛 not-yet-supported，走共享内核完成 reload（REG-4 / 边界-2 两断言按声明转红待 task-06 改写，非本卡回归）
  - provider 为 null 的 codex 会话 reload 走 ForReload null 分派（镜像 + 保 prior CODEX_HOME，语义由 task-02 提供，本卡只消费）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit（types/cli 新字段全绿）
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/session-manager-reload-provider.test.ts tests/interactive/session-manager-config-switch.test.ts tests/interactive/session-manager-reload-serial.test.ts（claude 既有用例全绿；仅 REG-4 与 边界-2 两断言按声明转红，task-06 收口）
constraints:
  - claude 路径零漂移——合并块仅 codex/pi 执行，claude 的 settings.json / env / transcript 迁移链路逐字不动（design Wave 2 步骤 5）
  - 不改 daemon.ts（spawn 侧 :8266/:8285 既有链路与 :7713 尽力重写兜底均不动）；不动 persistence.ts（restore 路径归 task-04）
  - 本卡不改测试文件（REG-4 / 边界-2 断言改写归 task-06，避免与其 allowed_paths 冲突）
  - ForReload 失败兜底语义内聚在 task-02 返回值，本卡只做 Object.assign，不额外包 try/catch、不重试
  - CLAUDE.md 规则 0——禁止跑全量测试，仅跑本卡相关套件
provides:
  - contract: SessionManagerDeps.daemonApiKey
    fields: [daemonApiKey]
expects_from:
  task-02:
    - contract: reload 文件层分派与 codex thread 迁移 helper
      needs: [applyProviderFileSettingsForReload, migrateCodexThreadFromHost]
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
