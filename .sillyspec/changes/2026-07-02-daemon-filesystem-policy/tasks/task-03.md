---
id: task-03
title: policy/shell-paths.ts Shell 写路径提取
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-05, task-17]
allowed_paths:
  - sillyhub-daemon/src/policy/shell-paths.ts
  - sillyhub-daemon/tests/policy/shell-paths.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-03

> goal: Bash + PowerShell + CMD 命令写路径提取器（FR-04）。

## implementation
- Bash：迁移 write-guard.ts:102 `extractBashWritePaths`（`>/>>/cp/mv/install/tee/mkdir/touch`）+ `normalizeBashWritePath`
- PowerShell 新增：`Set-Content/Add-Content/Out-File/New-Item(-ItemType File)/Copy-Item/Move-Item/Rename-Item/Remove-Item`，取 `-Path`/`-Destination`/`-Target` 或位置参数
- CMD 新增：`copy/move/mkdir/echo >/type >/del`
- 返回 `string[]` 写路径，交 PolicyEngine 逐条 canWrite

## 验收标准
- `echo test > E:\a.txt` 提取 `E:\a.txt`
- `Set-Content E:\a.txt` 提取 `E:\a.txt`
- `mkdir E:\abc` 提取 `E:\abc`
- 纯读命令返回空数组

## 验证
- `cd sillyhub-daemon && pnpm test shell-paths`

## constraints
- 正则解析尽力而为（D-001）：`eval`/变量展开/反引号无法解析的复杂命令靠 audit 兜底
- 不做完整 shell AST
- PowerShell `-Path` 参数解析覆盖常见形式
