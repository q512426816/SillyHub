---
id: task-05
title: 删除 dead code（writePlatformConfig / readPlatformConfig / PlatformConfig / PLATFORM_CONFIG_FILENAME）
author: qinyi
created_at: 2026-07-07 23:26:42
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
goal: >
  清理被 task-02/03/04 取代后的 dead code，消除 daemon 对 .sillyspec-platform.json 的全部源码引用。
implementation:
  - 删 writePlatformConfig（:866）
  - 删 readPlatformConfig（:814，dead code 零调用方）
  - 删 PlatformConfig 接口（:794）
  - 删 PLATFORM_CONFIG_FILENAME 常量（:668）
  - 清理相关注释（保留简短历史说明可接受）
acceptance:
  - 删除后 tsc 编译通过（无悬空引用）
  - grep 残留引用零命中（注释除外）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - grep -rn "PLATFORM_CONFIG_FILENAME|writePlatformConfig|readPlatformConfig|PlatformConfig" sillyhub-daemon/src
constraints:
  - 必须在 task-04 替换完唯一调用点后执行（否则编译断）
  - 不删 DAEMON_STATE_FILENAME 等新符号
---

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit` | 删除后编译通过（无悬空引用） |
| 2 | `grep -r "PLATFORM_CONFIG_FILENAME\|writePlatformConfig\|readPlatformConfig\|PlatformConfig" sillyhub-daemon/src` | 零命中（解释性注释除外） |
