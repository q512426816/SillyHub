---
id: task-02
title: 引入 Inter 字体(@fontsource/inter + next/font/local)
priority: P0
depends_on: []
blocks: [task-04]
covers:
  - FR-07
  - D-004@v2
allowed_paths:
  - frontend/src/styles/fonts.ts
  - frontend/src/app/layout.tsx
  - frontend/package.json
status: pending
created_at: 2026-06-22T00:18:09
author: qinyi
---

# Task-02 — 引入 Inter 字体

## 目标

用 `@fontsource/inter` + `next/font/local` 把 Inter 作为 SillyHub 默认无衬线字体,自托管 woff2,避免构建期发起任何外网请求(规避 Docker 构建代理问题)。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend/package.json` | 改 | 加 `@fontsource/inter` 依赖,运行 `npm i @fontsource/inter` |
| `frontend/src/styles/fonts.ts` | 新建 | 用 `next/font/local` 加载 Inter woff2,导出 `inter` 对象 |
| `frontend/src/app/layout.tsx` | 改 | 把 `inter.className` 应用到 `<body>` |

## 实现要点

1. **安装依赖**:`cd frontend && npm i @fontsource/inter`(确认写入 package.json dependencies)。
2. **fonts.ts** 用 `next/font/local` 加载以下 woff2(路径相对 fonts.ts):
   - `../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2`
   - `../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2`
   - `../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2`
   - `../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2`
   - 统一导出一个 `inter` 对象:`variable: "--font-inter"`, `display: "swap"`, `preload: true`, `fallback: ["PingFang SC", "Source Han Sans CN", "Microsoft YaHei", "system-ui", "sans-serif"]`
   - src 路径按 4 个字重分别声明,通过 `weight` 字段区分(400/500/600/700),`style: "normal"`
3. **layout.tsx** 把 `inter.className` 拼到现有 `<body>` className 上(保留 `min-h-screen bg-background text-foreground`):
   ```tsx
   <body className={`${inter.className} min-h-screen bg-background text-foreground`}>
   ```
4. **系统字体栈降级**:在 `next/font/local` 的 `fallback` 数组中显式给出 `PingFang SC` / `Source Han Sans CN` / `Microsoft YaHei` / `system-ui` / `sans-serif`,即使 Inter 加载失败,中文与英文也有合理兜底。

## 边界

1. **禁用 `next/font/google`**(D-004@v2),规避 Docker 构建代理环境无法访问 Google Fonts 的问题。
2. **字体加载失败兜底**:`next/font/local` 的 `fallback` 字段已配置系统字体栈(PingFang SC / Source Han Sans CN / Microsoft YaHei / system-ui),CSS 层面自动降级,不依赖 JS。
3. **不影响 SSR / 水合**:使用 `next/font/local` 标准方式,Next 14 自动注入 preload link 与 CSS 变量,无需自定义副作用,不破坏 `AntdRegistry` / `AntdProviders` 结构。
4. **不引入网络字体 CDN**:严禁 Google Fonts CDN、jsdelivr、unpkg 等,所有 woff2 必须来自 `node_modules/@fontsource/inter/files/`。
5. **woff2 路径来自 @fontsource 包**:不手动下载 woff2 到 `public/`,统一从 npm 包 `files/` 目录引用,版本与依赖锁定。

## 非目标

- 不定义 design tokens(由 task-01 负责 `styles/tokens.ts`)。
- 不修改 `globals.css` 的字体相关规则(由 task-04 负责把 `--font-inter` 变量接入 Tailwind / antd)。
- 不调整 antd ConfigProvider 的 fontFamily(由 task-03 负责)。

## 验收标准

| ID | 验收项 | 验证方式 |
|---|---|---|
| AC-01 | `frontend/package.json` dependencies 含 `@fontsource/inter` | `grep @fontsource/inter frontend/package.json` |
| AC-02 | `fonts.ts` 使用 `next/font/local` 而非 `next/font/google` | `grep -n "next/font/local" frontend/src/styles/fonts.ts`;反向断言无 `next/font/google` |
| AC-03 | `layout.tsx` 的 `<body>` 应用了 `inter.className` | `grep "inter.className" frontend/src/app/layout.tsx` |
| AC-04 | `npm run build` 不发起任何外网请求(构建可在无网络 Docker 中成功) | 在断网/代理环境下 `npm run build` 通过;不出现 `fonts.gstatic.com` / `fonts.googleapis.com` DNS 解析 |
| AC-05 | 首页 computed `font-family` 含 `Inter` | 浏览器 devtools computed style 显示 `__variable_xxx`(指向 Inter)+ 实际渲染 Inter 字形 |

## 操作步骤

1. 确认当前 `frontend/src/app/layout.tsx` 的 body 结构(已完成:`<body className="min-h-screen bg-background text-foreground">`,内含 `AntdRegistry > AntdProviders > children`)。
2. `cd frontend && npm i @fontsource/inter`。
3. 新建 `frontend/src/styles/fonts.ts`,按实现要点导出 `inter`。
4. 改 `frontend/src/app/layout.tsx`:import `inter`,拼接到 body className。
5. `npm run build` 验证无外网请求(检查构建日志无 gstatic/googleapis 解析)。
6. 对照验收表格逐项确认。

## 风险

- **字重路径名差异**:`@fontsource/inter/files/` 下文件名为 `inter-latin-{weight}-normal.woff2`,若版本变更命名规则改变需重新核对。安装后用 `ls node_modules/@fontsource/inter/files/ | grep latin` 确认实际文件名。
- **Tailwind / antd 暂不感知 `--font-inter`**:本任务只挂 CSS 变量到 body,实际消费由 task-04 / task-03 完成;验收 AC-05 以 computed style 含 Inter 字形为准,不要求全局所有元素生效。
