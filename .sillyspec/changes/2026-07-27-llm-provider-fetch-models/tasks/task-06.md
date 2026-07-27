---
id: task-06
title: daemon 新增生成 CLAUDE_CONFIG_DIR/settings.json 能力（spike-01 修正：非合并已有，是新增写文件）
title_zh: daemon 新增生成 settings.json
priority: P0
depends_on: []
blocks: [task-07, task-13]
requirement_ids: [FR-10]
decision_ids: [D-008, D-009]
created_at: 2026-07-27 09:47:54
author: qinyi
allowed_paths:
  - sillyhub-daemon/src/claude-settings.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/spawn-env.ts
expects_from:
  task-04:
    - contract: provider_config (lease payload)
      needs: [settings_config]
  task-05:
    - contract: ProviderConfig (TS)
      needs: [settings_config]
goal: >
  daemon 新增写 $CLAUDE_CONFIG_DIR/settings.json 能力，合并 provider_config.settings_config 顶层键（attribution/enabledPlugins/model/skipDangerousModePermissionPrompt），让 attribution 等 env 无等价物的开关真正生效。
implementation: |
  - 新建 src/claude-settings.ts（导出 writeClaudeSettings(provider_config, dir=CLAUDE_CONFIG_DIR)）：从 settings_config 取 4 顶层键 attribution/enabledPlugins/model/skipDangerousModePermissionPrompt，浅合并成对象 → JSON.stringify → await writeFile(join(dir,'settings.json'), ..., 'utf-8')。
  - settings_config absent / null / 无任一顶层键 → 直接 return（不写、不抛、不删已存文件），claude 走默认 + 注入 env（零回归 D-007）。
  - 两处挂钩（spawn 前 await）：task-runner.ts:548（batch，spawn 在 :1024）+ daemon.ts:2906（interactive）；目录已由 cli.ts:287 writePid 内 mkdir(CLAUDE_CONFIG_DIR,{recursive:true}) 保证，helper 内不再建（YAGNI）。
acceptance: |
  - settings_config 含 attribution（或其余 3 顶层键）时写出的 settings.json 含对应顶层键。
  - settings_config 为 null/absent/无顶层键时不写文件（claude 走默认+env，零回归）。
  - batch（task-runner.ts:548）与 interactive（daemon.ts:2906）两条 spawn 路径都在 spawn 前挂钩。
  - 写盘用 await writeFile，不阻塞 spawn 主路径以外的循环。
verify: |
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
constraints: |
  - spike-01 修正=新增写文件能力（daemon 此前全源码无 settings.json 写入，spawn-env.ts:151-155 + config.ts:55-60 注释证实 CLAUDE_CONFIG_DIR 刻意 env-only 隔离 ql-20260726-002-1180），非合并进已有函数；写盘时机=spawn 前非 daemon 启动，与隔离意图一致（隔离为不读宿主 ~/.claude/settings.json，不禁止平台自写）。
  - api_key 永不进 settings.json（只走 provider_config.api_key 加密字段 + auth_field，design §5.2 D-009）。
  - spike-02 内联验顶层键被 claude 识别（cc-switch 范式 + 官方 settings.json 契约）；不识别 → 该键降级为仅存储不阻断其余（attribution 是 5 开关里唯一无 env 等价物项）。
  - daemon 单实例假设下单写同一 CLAUDE_CONFIG_DIR；不重构现有 settings 生成（本就无）。
---
