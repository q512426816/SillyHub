---
id: task-07
title: Frontend vitest for OS detection and switch
title_zh: 前端 vitest 覆盖 OS 检测 / 切换 / 两 OS 命令
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: [task-06]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
expects_from:
  task-06:
    needs:
      - detectOs
---

## goal
为 `detectOs` 与 InstallDaemonBlock 的 OS 切换写 vitest（覆盖 FR-01, FR-03）。

## implementation
- 测 `detectOs` 纯函数：Windows UA（如 `Mozilla/5.0 ... Windows NT 10.0`）→ "windows"；mac/linux UA → "unix"
- 测 InstallDaemonBlock 渲染（参考现有 runtimes 页测试风格 / jsdom + vitest）：
  - mock `navigator.userAgent` 为 Windows → 渲染含 `irm` + `install.ps1` + 琥珀提示
  - mock 为 mac → 渲染含 `curl` + `install.sh`，不含 `irm ... install.ps1`
  - 点 Windows 切换按钮（从 unix 默认）→ 命令变 irm|​​iex
  - 复制按钮调用 clipboard 写当前 os 命令
- 注意 jsdom + markdown-text/dynamic 已知坑（参考记忆 frontend-markdown-text-jsdom-null）：本组件不涉及 markdown，常规 render 即可

## 验收标准
- [ ] detectOs Windows/unix UA 用例通过
- [ ] Windows 默认渲染 irm install.ps1 + 提示
- [ ] unix 默认渲染 curl install.sh
- [ ] 手动切换覆盖命令
- [ ] 复制当前 os 命令

## verify
- `cd frontend && pnpm test`（参考 local.yaml frontend 测试命令）

## constraints
- vitest + jsdom（项目现有风格）
- mock navigator.userAgent（Object.defineProperty 或 vi.stubGlobal）
- 不破坏现有 runtimes 页测试
