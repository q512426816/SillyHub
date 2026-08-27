---
id: task-12
title: daemon-write-guard-session-overlay
title_zh: daemon 写守卫 session 级 overlay 增量（D-011）
author: qinyi
created_at: 2026-08-28 03:12:21
priority: P0
depends_on: [task-05]
blocks: [task-11]
requirement_ids: [FR-04]
decision_ids: [D-011@v1, D-002@v2, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
provides:
  - contract: SessionOverlayRootsEnforcement
    fields: [effectiveAllowedRoots, writable_dir]
expects_from:
  task-05:
    - contract: GrantAuthorization
      needs: [platform_binding]
goal: >
  补全 D-002@v2 的 writable_dir 路径级强制：daemon 写守卫支持 session 级 overlay
  交集收紧（spike-02 结论 B 的修复），backend platform 会话注入
  effective_allowed_roots=[writable_dir]（task-05③ 补全）。
implementation:
  - daemon 侧 session-manager.ts _judgeWriteViaPolicyEngine：state.effectiveAllowedRoots 非空时路径须同时落于 session roots 与 PolicyCache roots（交集收紧；沿 _borrowSandboxRoots per-session 先例；复用 fallback 块 isPathUnderAnyRoot 判定逻辑；无该字段会话零行为变化）
  - daemon 测试：policyEngine 存在时 session overlay 生效（内/外/交集三态）+ 无字段零变化回归（既有写守卫测试全绿）
  - backend 侧：platform 会话向 lease metadata / claim 链注入 effective_allowed_roots=[writable_dir]（镜像 task-05 的 tool_config 注入先例；仅 platform 会话，不污染普通会话）
  - backend 测试：platform 会话 lease/claim payload 含 effective_allowed_roots=[writable_dir]；管理员同 runtime 普通会话不含
acceptance:
  - daemon 写守卫在 policyEngine 装配下按 session overlay 交集收紧（writable_dir 外写被 deny，内允许，机器级 PolicyCache 同时生效）
  - 无 effectiveAllowedRoots 的既有会话写守卫行为逐字节不变（既有测试全绿）
  - backend 仅 platform 会话注入该字段，普通会话零变化
  - task-05 的「写限目录内外」验收自此真实成立（FR-04 口径不降级）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager-write-guard.test.ts
  - cd sillyhub-daemon && pnpm exec vitest run --exclude tests/task-09-spec-pull-push.test.ts --exclude tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts --exclude tests/daemon-borrow-sandbox.test.ts（daemon 回归；三件 fragile 独跑）
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_create_config.py -q --no-cov -n auto
constraints:
  - daemon 只改 session-manager.ts 一处判定 + 新测试文件（D-011 收窄的 Non-Goal 边界）
  - 交集语义只收紧不放宽；session roots 不得绕过 PolicyCache deny
  - 既有携带 effectiveAllowedRoots 的会话自此被真实收紧（overlay 文档语义，修正休眠缺陷——如有依赖旧非强制的既有测试失败，修断言并在 related_tests 登记）
  - ESM import 带 .js 扩展名（daemon 约定）
related_tests:
  - path: sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts
    reason: 本 task 新建；若与既有写守卫测试文件名冲突则并入既有文件并说明
