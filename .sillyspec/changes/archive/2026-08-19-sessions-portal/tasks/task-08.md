---
id: task-08
title: daemon 热切换内核：_reloadSession 抽取 + SessionSwitchConfigPayload + reloadWithConfig（覆盖 FR-05, D-012@v1）
title_zh: daemon 统一热切换内核
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: []
blocks: [task-05, task-09]
requirement_ids: [FR-05]
decision_ids: [D-012@v1, D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts
provides:
  - contract: SessionSwitchConfigPayload
    fields: [sessionId, runId, claimToken, prompt, profile, providerConfig]
  - contract: ReloadWithConfigApi
    fields: [markPendingConfigSwitch, reloadWithConfig]
expects_from: {}
goal: >
  从 reloadWithProvider 抽取共享 reload 内核并实现 reloadWithConfig/markPendingConfigSwitch，支撑会话内档案/供应商热切换（resume 历史无缝）。
implementation:
  - types.ts 新增 SessionSwitchConfigPayload（profile 含 systemPrompt/mcpRefs/skillRefs，providerConfig 同 claim payload 结构，均可 null）
  - session-manager.ts 把 reloadWithProvider（:2638-2787）内联实现重构为 _reloadSession(sessionId, {systemPrompt, providerConfig}) 共享内核，保留三次实战修复语义（CLAUDE_CONFIG_DIR 隔离/close 后置/resetForResubscribe）
  - 新增 reloadWithConfig(sessionId, payload)：按 payload 调 _reloadSession 后喂入切换轮 prompt
  - 新增 markPendingConfigSwitch(sessionId, payload)：idle 立即执行，running 挂至 _onResult 边界（复用 markPendingSwitch :2570-2586 先例）
  - state 与 sessions.json 持久化补 config 快照字段（缺省容错）
  - Codex 路径只切 providerConfig 不注 systemPrompt（原 D-003）
acceptance:
  - reloadWithProvider 既有行为回归不变（重构零语义漂移）
  - reloadWithConfig 在 idle 立即 reload 并喂 prompt，running 挂起至轮次边界
  - daemon 重启后恢复的会话带 config 快照
verify:
  - cd sillyhub-daemon && npm test -- --run
constraints:
  - Codex reload 是全新工作（现 provider 不为 claude 时抛错），失败时回滚旧 query 不破坏会话
  - 切换不改会话状态机（session 维持 active）
related_tests: []
---
