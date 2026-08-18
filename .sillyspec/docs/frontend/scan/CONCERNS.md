---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 关注点（Concerns）

> 子项目：`frontend/`。仅列本次扫描逐项核实过的真实问题并标来源（Grep / Glob / wc / 配置文件）；🔴 高 / 🟡 中 / 🟢 低。核实不了的候选一律不写。

## 代码质量

### 🔴 E2E 测试未启用（依赖声明但零落地）

- 实证：`@playwright/test ^1.60.0` + `puppeteer ^24.43.1` 在 `package.json` devDependencies，但 `playwright.config.*` 与 `*.spec.ts` 全仓 Glob **0 命中**。来源：package.json + Glob。
- 风险：登录、工作区扫描、Agent Run SSE、daemon 交互会话、PPM 导入等关键流程无端到端保护；组件测覆盖不了路由跳转、middleware 守卫与 SSE 透传链路。puppeteer 还是体积不小的死重依赖。
- 建议：选定 Playwright 补核心路径 E2E，或移除两个未用依赖。

### 🟡 超大文件债（17 个非测试源文件 >800 行）

- 实证（wc -l，排除生成物 `api-types.ts` 32857 行与测试）：**17 个**源文件超 800 行。页面/组件 top3：`app/(dashboard)/ppm/milestone-details/page.tsx` **3139**、`components/daemon/interactive-session-panel.tsx` **1286**、`app/(dashboard)/runtimes/page.tsx` **1197**；紧随其后 `m/ppm/problem-list/page.tsx` 1164、`components/agent-log-viewer.tsx` 1125、`app/(dashboard)/sessions/page.tsx` 1122、`workspaces/[id]/agent/page.tsx` 1075、`llm-provider-form.tsx` 1046；数据层另有 `lib/ppm/types.ts` 1547、`lib/daemon.ts` 1296。来源：wc 实测。
- 风险：单文件改动评审面大、测试迁移成本高（page-team-toggle 整页测试 3136ms 就是先例，后拆组件降到 80ms）。
- 建议：新页面按展示组件拆分（change-detail-layout-rework 已示范 page.tsx 1119→484 拆法），存量按触碰时机渐进拆。

### 🟡 next/dynamic ssr:false 是公共测试污染点

- 实证：`ui/markdown-text.tsx` 与 `charts/index.tsx`（ECharts 桶导出）用 `next/dynamic ssr:false`，jsdom 同步渲染停在 loading 返 null——现有 **14 个**测试文件各自 `vi.mock("@/components/ui/markdown-text")`，图表测试须直接 import 具体组件文件绕过桶导出。来源：Grep 计数 + `work-hour-bar-chart.test.tsx:4` 注释。
- 风险：新测试引入 Markdown/图表却忘 mock，会假阳性通过（断言空 DOM）。
- 建议：在 `src/test/` 提供统一 mock 工具，新测试 import 即用。

### 🟢 'use client' 面积概览（取舍而非缺陷）

- 实证：211 个源文件带 `'use client'` 指令，页面几乎全客户端渲染。来源：Grep 计数。
- 说明：交互密集型控制台（SSE 流、看板拖拽、表单）的合理取舍；Server Components 收益有限，但新增纯展示页也无约束引导，保持自觉即可。

### 🟢 日期 toLocaleString 无漏网（zh-CN 债保持清零）

- 实证：全 src `toLocaleString(` 命中里，所有 Date 调用均显式传 `"zh-CN"`（含 `RuntimeUsageLineChart.tsx:61` 的多行调用）；裸 `.toLocaleString()` 仅 5 处且均为 Number 千分位（turn-timeline、agent/page、图表 tooltip），属约定保留项。来源：Grep 逐条核对。
- 说明：2026-08-11 清零的「CI en-US 红」债未复发。

### 🟢 旧债已清：死代码 / 双 lockfile / 遗留标记

- 实证：`CollapsibleCard` 全 src **0 命中**（旧记忆中的死代码已删除）；`frontend/` 根仅 `pnpm-lock.yaml`，`package-lock.json` 已不存在（旧双 lockfile 项解决）；全 src 遗留任务标记（FIXME/XXX/HACK 类）**0 命中**，`@ts-expect-error` 仅 1 处注释性豁免。来源：Grep + ls。
- 说明：此三项为上一版扫描的遗留关注点，本次核实均已消除。

## 依赖风险

### 🔴 OpenAPI 类型漂移闸门未进 CI（仅本地/流程守护）

- 实证：`gen:types:check`（生成 `api-types.ts` + `git diff --exit-code`）在 `.github/workflows/` 全目录 grep `gen:types` **0 命中**；frontend-ci 只跑 lint/typecheck/test/build。来源：workflow 文件 + Grep。
- 风险：后端 schema 改动漏跑 regen 时前端 tsc 照样绿（对着旧类型编译），失同步只在实际请求时暴露；当前仅靠 CLAUDE.md 规则 21 的流程纪律拦截。
- 建议：在 CI 增加类型漂移检查步骤（需 backend 环境配合 dump openapi，或改为校验已提交的 openapi.json 与 api-types.ts 一致性）。

### 🟡 next 14.2.5 精确锁版，大版本线落后

- 实证：`"next": "14.2.5"`（无 caret 精确锁），`eslint-config-next` 同为 14.2.5；Next 15 大版本线已发布超过一年。来源：package.json。
- 风险：14 线安全补丁与 App Router 新特性停更风险随时间上升；升级需同步 eslint-config-next 并回归 RSC 缓存语义。
- 建议：排期评估升 15（React 19 联动），升级前读 upstream breaking changes。

### 🟡 antd ^6.4.4（v6 主版本）+ React 18.3.1 组合

- 实证：`antd ^6.4.4`、`@ant-design/icons ^6.2.5`，`react`/`react-dom` 精确锁 18.3.1；antd 6 为当前最新主版本线，且未跟进 React 19。已知行为差异：antd 6 对连续两 CJK 字符按钮文案自动插空格（历史记录，测试断言需注意）。来源：package.json + 上一版扫描核实记录。
- 风险：v6 社区生态/兼容库滞后期的排错成本；与 React 19 / Next 15 升级互相牵制。
- 建议：锁定 patch 定期跟版；大升级时 antd / next / react 三者一起评估。

### 🟢 echarts 体积已按需控制

- 实证：`echarts ^6.1.0` 直接 import 均为 type-only（全 src 仅 2 处 `import type { EChartsOption }`），运行时经 `echarts-for-react ^3.0.6`，图表统一走 `charts/index.tsx` 桶导出 `next/dynamic ssr:false` 拆 chunk；`next.config.mjs` 另有 `optimizePackageImports`（antd/icons/lucide/xyflow，不含 echarts）。来源：Grep + charts/index.tsx + next.config.mjs。
- 说明：重依赖已隔离在动态 chunk，主包未受 echarts 全量拖累。

### 🟢 工具链与类型环境钉死

- 实证：`engines.node >=20.0.0`、`packageManager: pnpm@9.6.0`，CI `--frozen-lockfile`；TS 5.5.4 `strict` + `noUncheckedIndexedAccess`；`@uiw/react-markdown-preview ^5.2.1` + `rehype-sanitize ^6.0.0` 单一用途于 MarkdownText（ssr:false 包装）。来源：package.json + tsconfig.json。
- 说明：环境漂移风险受控；`noUncheckedIndexedAccess` 正确性收益大于心智成本，保持开启。
