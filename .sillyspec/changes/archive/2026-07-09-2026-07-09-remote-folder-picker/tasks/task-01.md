---
id: task-01
title: 新增 listRoots 业务层
wave: W1
depends_on: []
allowed_paths:
  - sillyhub-daemon/src/roots-rpc.ts
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  sillyhub-daemon 新增 src/roots-rpc.ts，实现跨平台磁盘根列举 listRoots()，返回 {roots: string[]}（D-001）。FR-1 / NFR-1。
implementation: |
  - Windows：遍历 A:\~Z:\ fs.existsSync 探测，收集盘符（带尾 \\），单盘 try/catch 不中断。
  - Linux/macOS：返回 ["/"]。
  - 对齐 file-rpc.ts 风格；root 带 OS 原生尾 sep。
acceptance: |
  - Windows 返回存在盘符（带尾 \\）；Linux/macOS 返回 ["/"]；单盘失败不中断；pnpm test+typecheck 过。
verify: |
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints: |
  - 不改 list_dir 契约；依据 design §7.1。
---

# task-01 · 新增 listRoots 业务层

> Wave W1 · daemon · FR-1 / D-001 / NFR-1 · design §7.1

## 验收标准
- [ ] Windows 返回存在盘符（带尾 `\\`），如 `["C:\\","D:\\"]`
- [ ] Linux/macOS 返回 `["/"]`
- [ ] 单盘 existsSync 失败不中断枚举
- [ ] `pnpm test` + `pnpm typecheck` 通过

## TDD/验证步骤
- 先写测试（task-03）：Win 盘符 / Unix 根 / 单盘失败 / 异常映射
- 实现 `listRoots`
- `cd sillyhub-daemon && pnpm test` + `pnpm typecheck`
