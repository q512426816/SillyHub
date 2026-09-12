---
id: task-04
title: 'Reload transactionality: engine gate + guard hoist + catch-side file rollback'
title_zh: 'reload 事务性——引擎门（provider 维度）+守卫前移+catch 文件层回滚'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 11:21:23
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-001@v1+D-002@v2+D-005@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts
goal: >
  _reloadSessionNow 三改造：provider 维度引擎门（cursor fail-loud、config-only 不
  连坐）；resume 守卫前移到文件写盘前（缺 key 零写入）；catch 文件层回滚（ForReload
  旧形态重跑 + 空返回删标记）（FR-01/02/05，D-001@v1+D-002@v2+D-005@v2）。
implementation:
  - 入口门：本次调用携带 provider 切换载荷且引擎不在 PROVIDER_RELOAD_ENGINES 集合（claude/codex/pi）时 throw fail-loud；config-only 调用（人格/配置切换）不判门
  - agentSessionId 缺失守卫上移到 hasProviderFileWriter 写盘块之前，错误 message 逐字保留
  - 写盘块设局部布尔 fileLayerTouched；catch 还原内存态后 fileLayerTouched 为真时 best-effort 重跑 applyProviderFileSettingsForReload（provider=oldProviderConfig、priorEnv=oldEnv，undefined/null/对象全交矩阵分派）；若返回空对象且 per-session 目录存在则 best-effort 删除 MANAGED_MARKER_FILENAME；回滚失败 console.error 不吞 rethrow
  - 测试四组：缺 key reload 目录零写入；driver.start 注入失败 → ForReload 二次调用（回滚入参=旧形态）断言；cursor provider 切换 throw + cursor config-only 切换不受门；claude 既有用例零改动
acceptance:
  - 四组新断言全绿；既有 HOOK 用例（missing agentSessionId message 断言）不改预期全绿
  - daemon typecheck 全绿
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/session-manager-config-switch.test.ts && pnpm typecheck
constraints:
  - R-01 降级语义不变（失败保旧句柄、session 不移除、rethrow 由调用方 catch 吞）
  - _reloadChains 串行化与 pendingSwitch 状态机不动
  - claude 迁移钩子与 env 逻辑零漂移
expects_from:
  - task-01: writeFileAtomic 接口
  - task-03: MANAGED_MARKER_FILENAME 常量与标记语义
---


