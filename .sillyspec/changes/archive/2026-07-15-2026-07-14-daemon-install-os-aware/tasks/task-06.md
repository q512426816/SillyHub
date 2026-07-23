---
id: task-06
title: Frontend InstallDaemonBlock OS detection + switch
title_zh: 前端 InstallDaemonBlock 加 OS 检测 + 手动切换 + Windows PowerShell 命令
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: []
blocks: [task-07]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
provides:
  detectOs:
    description: 纯函数，按 navigator.userAgent 判定 OS（/Win/ → windows，否则 unix）
    fields:
      - returns("windows" | "unix")
---

## goal
改造 `InstallDaemonBlock`（frontend/src/app/(dashboard)/runtimes/page.tsx 约 165-223 行），按 OS 自动显示对应安装命令 + 手动切换（覆盖 FR-01, FR-02, FR-03, FR-04, D-002@v1）。

## implementation
- 新增纯函数 `detectOs(ua: string): "windows" | "unix"`：`/Win/i.test(ua)` → "windows"，否则 "unix"
- 新增 `os` state，在现有 `useEffect`（设 serverUrl）里同时 `setOs(detectOs(navigator.userAgent))`，沿用 mounted 模式防 hydration 不一致（R-03）
- 展开内容新增「macOS / Linux ｜ Windows」切换 UI：两个 outline button（shadcn 风格，与现有 Button 一致），active 态高亮（bg-foreground text-background），点击 `setOs` 覆盖自动检测（D-002）
- 命令按 `os` 分支：
  - windows：`irm ${serverUrl}/daemon/install.ps1 | iex` + 琥珀提示「⚠️ 在 PowerShell 或 cmd 中运行（开始菜单搜 PowerShell 打开后粘贴）」
  - unix：现有 `curl -fsSL ${serverUrl}/daemon/install.sh | bash -s -- --server-url ${serverUrl}`（逐字不变，FR-04）
- `handleCopy` 复制当前 os 对应命令
- 样式复用现有 dashed border / muted bg / text-[11px] / Terminal 图标（遵循 CLAUDE.md 规则 17 frontend-style-system）

## 验收标准
- [ ] Windows（navigator.userAgent 含 Win）默认选中 Windows，显示 `irm <serverUrl>/daemon/install.ps1 | iex` + 琥珀提示
- [ ] macOS/Linux 默认选中 unix，显示 curl|bash（逐字不变）
- [ ] 点切换按钮可覆盖自动检测，命令与提示切换
- [ ] 复制按钮复制当前 os 命令
- [ ] mounted 模式防 hydration（首屏不渲染命令）
- [ ] 现有 serverUrl（window.location.origin）逻辑不变

## verify
- task-07 vitest
- 手动：浏览器改 UA 看 Windows/unix 切换

## constraints
- 复用现有 InstallDaemonBlock 的 shadcn/ui Tailwind 风格（不引入 AntD 重组件）
- 中文文案（CLAUDE.md 规则 12）
- mounted state 模式（与 serverUrl 一致，防 SSR/客户端不一致）
- D-002（自动 + 手动切换）
