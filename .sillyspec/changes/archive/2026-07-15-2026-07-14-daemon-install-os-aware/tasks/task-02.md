---
id: task-02
title: gitattributes to keep install.ps1 CRLF
title_zh: 新增 .gitattributes 保证 install.ps1 为 CRLF
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P1
depends_on: []
blocks: []
allowed_paths:
  - .gitattributes
---

## goal
防止 git autocrlf 在 Windows 提交时把 install.ps1 的 CRLF 转成 LF，导致 PowerShell 解析异常（覆盖 DG-02 / R-05）。

## implementation
- 在仓库根 `.gitattributes` 增加规则：`sillyhub-daemon/scripts/install.ps1 text eol=crlf`
- 若仓库根已有 `.gitattributes`，追加该行；否则新建
- 不动其他文件的 eol 规则

## 验收标准
- [ ] `.gitattributes` 含 `sillyhub-daemon/scripts/install.ps1 text eol=crlf`
- [ ] 其他文件规则不被破坏

## verify
- `git check-attr text eol -- sillyhub-daemon/scripts/install.ps1` 应显示 eol=crlf（或直接查文件内容）
- 或 `cat .gitattributes | grep install.ps1`

## constraints
- 仅作用于 install.ps1，不波及其他脚本（install.sh 仍按 git 默认）
