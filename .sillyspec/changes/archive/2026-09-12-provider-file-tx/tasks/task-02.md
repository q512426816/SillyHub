---
id: task-02
title: 'Replace six config write points with writeFileAtomic'
title_zh: '六写盘点原子化——codex 两文件+mirror 拷贝+pi 三文件换 writeFileAtomic'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/codex-settings.ts
  - sillyhub-daemon/src/pi-settings.ts
target_files:
  - sillyhub-daemon/src/codex-settings.ts
  - sillyhub-daemon/src/pi-settings.ts
goal: >
  把 per-session 配置的六个写盘点全部换成 task-01 的 writeFileAtomic，产物内容
  逐字节等价（FR-03 / D-003@v1）。
implementation:
  - codex-settings.ts：writeAuthJson 的 writeFile、writeCodexHome 的 config.toml writeFile、mirrorCodexHostAuth 的宿主 copyFile（改 copy 到 tmp 再 rename）共三处
  - pi-settings.ts：writeAuthJson/writeModelsJson/writeSettingsJson 三处 writeFile
  - 不改 migrateCodexThreadFromHost 的 rollout 拷贝（design 划界：数据搬运非配置写盘）
acceptance:
  - 既有 codex-settings.test.ts / pi-settings.test.ts 不改预期全绿（产物 golden 等价锁定）
  - grep 确认两文件内已无面向配置目标的裸 writeFile
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/codex-settings.test.ts tests/pi-settings.test.ts && pnpm typecheck
constraints:
  - 只换写入原语，读逻辑/合并逻辑/日志载荷零变化
  - 不动 ForReload 矩阵与门槛判定
expects_from:
  - task-01: writeFileAtomic 接口
---


