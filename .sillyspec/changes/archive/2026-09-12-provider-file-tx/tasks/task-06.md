---
id: task-06
title: 'Regression sweep + module docs changelog'
title_zh: '回归收口——全套件回归+typecheck+模块文档变更索引'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1+D-002@v2+D-003@v1+D-004@v2+D-005@v2]
allowed_paths:
  - .sillyspec/docs/sillyhub-daemon/modules/codex-settings.md
  - .sillyspec/docs/sillyhub-daemon/modules/pi-settings.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
target_files:
goal: >
  全链路回归与文档收口：相关套件全绿 + daemon typecheck + 三处模块文档变更索引。
implementation:
  - 跑全部相关套件（atomic-write / codex-settings / pi-settings / provider-file-settings-reload / session-manager-config-switch / session-recovery / session-store-persistence / daemon-provider-file-dispatch / provider-injection-smoke.integ）——不跑全量（CLAUDE.md 规则 0）
  - pnpm typecheck 全绿
  - 模块文档：sillyhub-daemon.md 变更索引条目 + codex-settings.md / pi-settings.md 模块卡（原子写与标记语义注意事项）
acceptance:
  - 九套件全绿、typecheck 0 错
  - 三处文档落盘且引用变更名 2026-09-12-provider-file-tx
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/atomic-write.test.ts tests/codex-settings.test.ts tests/pi-settings.test.ts tests/provider-file-settings-reload.test.ts tests/interactive/session-manager-config-switch.test.ts tests/interactive/session-recovery.test.ts tests/interactive/session-store-persistence.test.ts tests/daemon-provider-file-dispatch.test.ts tests/provider-injection-smoke.integ.test.ts && pnpm typecheck
constraints:
  - integration-critical 真实集成证据（真启动 daemon 冒烟）归 verify 阶段，本 task 不做
  - 文档只加变更索引/注意事项，不重写模块卡结构
---


