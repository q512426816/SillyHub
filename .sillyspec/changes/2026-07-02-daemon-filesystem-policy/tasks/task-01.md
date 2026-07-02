---
id: task-01
title: policy/path-utils.ts 路径规范化
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-05]
allowed_paths:
  - sillyhub-daemon/src/policy/path-utils.ts
  - sillyhub-daemon/tests/policy/path-utils.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-01

> goal: 新增路径规范化纯函数，防 `..`/symlink/junction/UNC 绕过（D-005）。

## implementation
- `normalizePath(raw)`: strip 外层引号 → git bash `/x/`→`X:/`（Windows）→ `pathResolve` 折叠 `..`
- `resolveRealPath(p)`: 存在则 `fs.realpathSync.native` 解析 symlink/junction；不存在则 realpath 最近存在祖先 + 拼剩余段；Windows 大小写归一；UNC（`\\server\share`）直接返回特殊标记拒
- `isPathUnderAnyRoot(target, roots)`: 边界敏感前缀比较，沿用 write-guard.ts:44 现有逻辑（含 ql-20260702-007 盘符根不补 sep 修复）

## 验收标准
- symlink/junction 指向越界 → isPathUnderAnyRoot 返回 false
- `..` 穿越、UNC 路径被拒
- 不存在路径（新文件）fallback realpath 父目录不抛错

## 验证
- `cd sillyhub-daemon && pnpm test path-utils`

## constraints
- 8.3 短名不防（D-005，需 Windows 原生 API）
- realpath IO 结果按 path LRU 缓存（R-08）
- 跨平台：Windows/macOS/Linux 行为一致
