---
id: task-03
title: '两接线点分派 + applyClaudeSettings kind 守卫'
title_zh: '两接线点分派 + applyClaudeSettings kind 守卫'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-011]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts
  - sillyhub-daemon/src/credential-injector.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
  - NEW:sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts
provides:
  - contract: applyProviderFileSettings
    fields: [applyProviderFileSettings, per_session_dir_layout, kind_dispatch, env_injection_pairs]
  - contract: codex_pi_wiring
    fields: [spawn_wiring, claude_kind_guard]
expects_from:
  task-01:
    - contract: codex-settings.writeCodexHome
      needs: [writeCodexHome, CodexHomeWriteInput]
  task-02:
    - contract: pi-settings.writePiDir
      needs: [writePiDir, PiDirWriteInput]
goal: >
  把 W1/W2 两写盘器接入 interactive（daemon.ts:7997 一带，design 写 7920 属笔误以实际为准）与
  batch（task-runner.ts:531 + :537-542 STAGE_META env 追加模式处）两接线点，按 provider.agent_kind 分派
  写盘+env 注入；两处 applyClaudeSettings 加 kind=claude（或缺省）守卫，堵非 claude 的 settings_config
  写穿 claude 目录（Grill P2，claude-settings.ts 本体不动）。
implementation:
  - 抽共享分派 helper（两文件单点定义、另一方导入）——kind 为 codex 时 writeCodexHome 并加 CODEX_HOME env；kind 为 pi 且 base_url 非空时 writePiDir 并加 PI_CODING_AGENT_DIR env；目录按 D-011 落会话配置根 <root>/codex/<session_id>/ 与 <root>/pi/<session_id>/（spawn 前 mkdir，不含 TEMP 段）
  - daemon.ts:7997 一带接入（applyClaudeSettings 后、buildSpawnEnv env 追加处），daemonApiKey 从 config.api_key（cli.ts:683 setDaemonApiKey 同源）取值传入；task-runner.ts:531 一带同分派进 spawnEnv
  - kind 守卫落调用侧——仅 agent_kind 为 claude 或缺省才调 applyClaudeSettings
  - 失败语义唯一化（Plan 约束 3）——写盘失败记 error 后该 kind 的 env 注入一并跳过，仍 spawn 不阻断
  - 新增 tests/daemon-provider-file-dispatch.test.ts 锁分派矩阵——claude/codex/pi 官方（base_url 空）/pi 自定义/provider_config absent 五态 + kind 守卫 + 失败跳过含 env
acceptance:
  - codex 会话与批任务 spawn 前 per-session CODEX_HOME 已写 auth.json+config.toml 且子进程 env 指向该目录；pi 且 base_url 非空时 PI_CODING_AGENT_DIR 同理
  - pi 官方端点与 provider_config absent 两态零写盘零注入（行为与现状逐字一致）
  - applyClaudeSettings 仅 claude/缺省 kind 触发——codex/pi kind 的 settings_config 不写穿 claude 目录
  - 新测试全绿且既有 credential-injector/spawn-env/claude-settings 测试零回归
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/daemon-provider-file-dispatch.test.ts tests/credential-injector.test.ts tests/claude-settings.test.ts && pnpm typecheck
constraints:
  - 不改 claude-settings.ts / credential-injector.ts / spawn-env.ts 本体（credential-injector 注释更新归收尾非本 task）
  - 不注册 codex env 注入器——已核 credential-injector.test.ts:600 getInjector('unknown-xyz') 断言不受影响，该测试文件不动
  - per-session 目录终态清理与热切换重写归 task-04，本 task 只做 spawn 前创建+写入+env 注入
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
