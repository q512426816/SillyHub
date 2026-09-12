---
id: task-05
title: 'Restore probe three-state: marker / legacy / zero-action'
title_zh: 'restore 探测三态化——persistence null+codex 标记/legacy/零动作'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/persistence.ts
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/persistence.ts
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts
goal: >
  persistence 恢复路径 null+codex 探测从「目录存在」改三态：标记在 → managed（镜像
  宿主+注 CODEX_HOME，镜像路径同标记先行序）；无标记但 auth.json 或 config.toml 存在
  → legacy managed（info 日志）；皆无 → 零动作（迁移钩子目录恒落此态，F3 假阳性消除）
  （FR-04 后半 / D-004@v2）。
implementation:
  - persistence.ts null+codex 分支：探测改判 MANAGED_MARKER_FILENAME 存在；缺失时 fallback 判 auth.json/config.toml（legacy 态，info 日志 codex_restore_legacy_marker_missing）；镜像调用前同样标记先行——标记写失败跳过镜像但 env 注入保持（目录旧产物=等同未切，managed 判定不变）
  - session-recovery.test.ts：RESTORE-4 语义注释更新（建目录+auth.json → legacy 态行为不变）；新增空目录（仅 sessions/ 子目录）零动作、标记在 managed 两态用例
acceptance:
  - RESTORE 系既有断言不改预期全绿；两新态断言绿
  - 迁移钩子形态目录（无 auth/config/标记）断言零动作
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/session-recovery.test.ts tests/interactive/session-store-persistence.test.ts && pnpm typecheck
constraints:
  - pi 无 null 探测（维持）；非 null 快照恢复路径零改动
  - legacy 态与现状（目录存在即 managed）行为逐字一致，零存量回归
expects_from:
  - task-03: MANAGED_MARKER_FILENAME 常量与标记语义
---


