---
id: task-08
title: daemon 测试（diff 客户端 / 缓存位置 / rename / 回退旧 tar / 首同步全量）
title_zh: daemon 增量同步行为测试
author: qinyi
created_at: 2026-08-13 15:23:34
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-05, FR-07]
decision_ids: [D-004@v1, D-005@v1]
goal: >-
  覆盖 task-06/07 增量 diff 行为（首同步/增量 op/rename/.runtime/回退/conflict/缓存回写），
  并更新 task-07 变更致断言的既有 postSpecSync 测试
allowed_paths:
  - sillyhub-daemon/tests/**
implementation:
  - 新建/扩展 sillyhub-daemon/tests 下 spec-sync 增量用例（参照 spec-transport-tar-sync/spec-sync.test.ts mock 模式）
  - 用例覆盖首同步无缓存走旧 tar+写缓存、有缓存新增add/修改update/删除delete/同hash异路径rename、op 带 base_version、.runtime 排除、缓存路径在 ~/.sillyhub/daemon/manifests（mock homedir）、增量 404 回退旧 tar、conflict 抛错不静默、new_versions 回写缓存 version
  - 更新 task-07 变更致断言的既有测试（spec-transport-tar-sync/spec-sync.test.ts、task-09-spec-pull-push.test.ts 等锁定 postSpecSync 旧 tar 契约的用例改为新行为：增量默认+旧 tar 回退），不删测试逻辑
acceptance:
  - 用例全绿；覆盖首同步/增量 diff/rename/.runtime/回退/conflict/缓存回写
  - 既有 postSpecSync 测试断言同步新行为
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/spec-transport-tar-sync/spec-sync.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 真实断言；fragile 3 文件（task-09-spec-pull-push / spec-transport-tar-sync / daemon-borrow-sandbox）按 local.yaml 独占策略跑
  - 不改测试逻辑绕过
provides:
  - contract: daemon_tests_green
    fields: [incremental diff, cache, rename, fallback]
    desc: daemon 增量同步测试全绿
expects_from:
  - contract: incremental_diff_push
    provider: task-07
    needs: [ops, rename detection, old tar fallback]
---
