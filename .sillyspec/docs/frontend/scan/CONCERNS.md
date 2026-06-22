---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:36Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:36
---

# frontend 关注点 / 技术债

> 基于 `frontend/src/` grep 事实，🔴 高 / 🟡 中 / 🟢 低。覆盖旧版文档。

## 代码质量

### 🟡 双 UI 组件库并存（Ant Design 6 + shadcn/ui）

- grep 实证：业务组件大量 `from "antd"` / `@ant-design/icons`，同时 `components/ui/` 有 shadcn 全套原子件（button / card / dialog / badge / input / tooltip / avatar / dropdown-menu / empty-state / skeleton / status-badge / tag）。
- 风险：两套设计系统并存（主题 token、CSS variables、字体、间距），视觉一致性靠人工维护；同一类控件（如 Button）在两栈中各有一份，组件选用边界不清。
- 建议：明确边界（如「业务表单/表格用 antd，原子化控件用 shadcn」），或收敛到单栈。

### 🟡 SSE hook race 场景需持续守护

- grep 实证：`lib/use-agent-run-stream.ts` 有 10+ 处 `if (cancelled) return;`，专门处理 StrictMode 双调用 / 快速重连 / unmount 后旧 effect 闭包写 state；并有 `AgentRunStreamClient` 防止孤儿 `EventSource`。
- 风险：这是近期修复（commit `31b613e1` "frontend SSE hook race guard"）的关键不变量，任何对该 hook 或 `AgentRunStreamClient` 的改动都可能破坏该保护。
- 建议：保留 `use-agent-run-stream.test.ts` 对 cancelled 行为的断言；改动前先读 `lib/use-agent-run-stream.ts` 顶部注释。

### 🟡 双 E2E 工具声明但未落地

- grep 实证：依赖含 `@playwright/test ≥1.60` 和 `puppeteer 24`，但 `frontend/{e2e,tests,playwright}/` 目录均不存在（glob 0 命中）。
- 风险：依赖膨胀（puppeteer 体积大）；E2E 缺位，关键流程（登录、工作区创建、agent 执行、daemon 会话、PPM 工时）无端到端保护。
- 建议：选定单一工具（推荐 Playwright）并补核心路径 E2E，或移除未用依赖。

### 🟢 页面级测试覆盖薄

- 仅 `app/(dashboard)/runtimes/page.test.tsx` 与 `ppm/milestone-details/__tests__/` 两个页面级测试；PPM 大量子路由、agent-run 面板页面、admin 页面无页面级覆盖。
- 建议：优先补 SSE 消费、PPM 表单提交、admin 权限分支等关键页面。

### 🟢 无 TODO/FIXME 遗留

- grep `TODO|FIXME|HACK|XXX` 在 `src/` 下 0 命中（旧版曾标记 `lib/permission.ts` 旧 helper，当前已无技术债标记）。

## 依赖风险

### 🟡 API 代理 rewrites 仅在 dev / Node runtime 生效

- grep 实证：`next.config.mjs` rewrites `/api/:path*` → backend；`lib/api.ts` 注释依赖此代理。
- 风险：若改纯静态导出（`output: export`）或非 Node 部署，rewrites 失效，前端将无法访问后端；生产依赖 Next server（或反代）兜底。
- 建议：部署文档明确「必须 Node runtime / standalone / 反代」，避免误用静态导出。

### 🟡 TS strict + `noUncheckedIndexedAccess`

- grep 实证：`tsconfig.json` 开启（target ES2022）。
- 影响：数组/对象索引访问需显式 narrowing 或兜底默认值，开发体验更严；代码中常见 `arr[0]!` 或 `?? fallback` 模式。
- 建议：保持开启（正确性收益 > 心智成本），CI 跑 `tsc --noEmit` 守门。

### 🟡 双 lockfile

- glob 实证：`frontend/` 同时存在 `pnpm-lock.yaml` 和 `package-lock.json`。
- 风险：两套锁文件可能漂移，CI/本地装包不一致。
- 建议：删除 `package-lock.json`，统一 pnpm。

### 🟢 主版本依赖较新

- Ant Design 6.x（主版本）、`@xyflow/react` 12、ECharts 6、Next.js 14.2 RSC 生态仍在演进；升级/排错需关注上游 breaking change。
- 建议：锁定 patch，定期跟版。

### 🟢 SSE 客户端手写解析

- grep 实证：`lib/agent-stream.ts` 的 `AgentRunStreamClient` 手写 `EventSource` + 事件解析，逻辑集中在 `agent-stream.ts` / `use-agent-run-stream.ts` / `components/agent-log/normalize.ts`。
- 风险：边界场景（断帧、心跳、重连）分散在多文件，各自实现易不一致。
- 建议：抽取统一 SSE reader util + 自动重连策略。
