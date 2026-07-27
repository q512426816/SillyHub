---
id: task-13
title: "daemon 测试 sillyhub-daemon/tests/：credential-injector toEnv 合并 settings_config.env 覆盖 extra_env；新增 helper 写 settings.json 合并顶层（attribution/enabledPlugins）；absent 不写文件。（覆盖：AC-05 daemon 侧, FR-10）— 依赖 task-05/06"
title_zh: daemon 单测：toEnv 合并优先级 + settings.json 写盘 helper（含 absent 不写）
author: qinyi
created_at: 2026-07-27 09:47:54
priority: P0
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-10]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/
goal: >
  daemon 覆盖 toEnv 合并 settings_config.env 覆盖优先级（盖过 extra_env）+ 新 helper 写 settings.json 顶层合并（attribution/enabledPlugins）+ absent 不写文件，零回归锁死 task-05/06 行为（AC-05 daemon 侧）。
implementation:
  - 扩充 credential-injector.test.ts toEnv 用例（纯函数断言，相同输入相同输出）：① settings_config.env 存在时其键覆盖 extra_env 同名键（如 extra_env={FOO:'1'} + settings_config.env={FOO:'2'} → env.FOO==='2'）；② settings_config 缺失/undefined/无 env 时 toEnv 返回值与现状逐字一致（零回归，照现有 baseConfig 用例复跑）；③ api_key 永不从 settings_config 取（settings_config.api_key 即使存在也忽略）。
  - 新建 claude-settings helper 用例（学 credential.test.ts mkdtempSync 临时目录范式）：用 mkdtempSync(join(tmpdir(),'sillyhub-claude-settings-')) 建临时 CLAUDE_CONFIG_DIR，afterAll rmSync 清理；① settings_config 含 attribution → 写出的 settings.json 含 attribution 顶层键（{commit:'',pr:''}）；② settings_config 含 enabledPlugins → 顶层键合并进 settings.json；③ settings_config 多顶层键（attribution+model+skipDangerousModePermissionPrompt）同写；④ settings_config=null/undefined/无任一顶层键 → 不写文件（existsSync false，零回归）；⑤ 已存在 settings.json 时浅合并不丢既有键。
acceptance:
  - toEnv 合并优先级断言通过（settings_config.env 覆盖 extra_env 同名键）
  - settings_config 缺失时 toEnv 零回归（现有 credential-injector.test.ts 用例全绿）
  - settings.json 写盘内容断言通过（attribution/enabledPlugins/model 顶层键落盘）
  - settings_config=null/absent 不写文件断言通过（existsSync false）
  - api_key 永不进 settings.json / toEnv 不从 settings_config 取（安全断言）
  - cd sillyhub-daemon && pnpm test 全绿（vitest）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
constraints:
  - 写盘测试用 mkdtempSync 临时目录隔离（不污染真实 CLAUDE_CONFIG_DIR，学 credential.test.ts:44 范式 + afterAll rmSync 清理）
  - toEnv 纯函数断言：相同输入相同输出，不 mock fs/网络（credential-injector.test.ts:5 铁律沿用）
  - helper 写盘测试断言文件内容用 readFileSync + JSON.parse（不真起 claude 进程，spike-02 顶层键生效验留 verify 端到端）
  - 不为通过改测试逻辑（CLAUDE.md 规则9）；测试失败先查 task-05/06 实现
  - typecheck 先过（pnpm typecheck）再跑 vitest
---
