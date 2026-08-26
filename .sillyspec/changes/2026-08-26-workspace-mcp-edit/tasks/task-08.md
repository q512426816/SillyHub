---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-08
title_zh: "daemon注入链路测试"
title: "daemon 注入链路测试"
priority: P0
depends_on: [task-07]
allowed_paths:
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
goal: provider 合并注入全分支测试（优先级/白名单剔除/回落/无 workspaceId 现状不变/restore 缓存）
acceptance: |
  1. 优先级：workspace 同名覆盖 platform；内置 server 名不可被 workspace/platform 覆盖（builtin 最高）
  2. 白名单外 workspace server 被剔除且记 warn（rejected 断言）
  3. 内置 server 在 admin 白名单为空时仍注入（白名单参数含内置名——D-006@v2 回归锚）
  4. 拉取失败回落：platform 用本地文件/空、workspace 空、内置照常（R-03）
  5. 无 workspaceId：注入结果与改造前一致（现状快照断言）
  6. restore/reload 缓存缺失触发重取（mock fetch 计数）
verify: cd sillyhub-daemon && pnpm exec vitest run tests/cli-session-manager-injection.test.ts
implementation: cli-session-manager-injection.test.ts 补全分支用例（mock fetch/缓存注入沿既有模式）
constraints: ["无 workspaceId 现状快照断言", "白名单空时内置仍注入"]
expects_from:
  task-07:
    - contract: "provider 注入合并"
      needs: [mergeMcpConfigs 白名单参数, rejected warn, 会话级缓存, 回落, 合并优先级]
---

# task-08: 注入链路测试

## 落点

既有 provider 用例所在地 `tests/cli-session-manager-injection.test.ts`（:422 有 provider 签名注入用例可参照）；mock fetch/cache 注入沿用该文件模式。
