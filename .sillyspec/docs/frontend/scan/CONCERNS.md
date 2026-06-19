---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 关注点 / 技术债

> 基于 `frontend/src/` grep 事实，🔴 高 / 🟡 中 / 🟢 低。覆盖旧版文档。

## 代码质量

### 🟡 双 UI 组件库并存（Ant Design 6 + shadcn/ui）

- grep 实证：50+ 文件 `from "antd"` / `@ant-design/icons`，同时 `components/ui/{button,badge,input}.tsx` 存在 shadcn 原子件
- 风险：两套设计系统并存（主题 token、CSS variables、字体、间距），视觉一致性靠人工维护；同一类控件（如 Button）在两栈中各有一份，组件选用边界不清
- 建议：明确边界（如「业务表单/表格用 antd，原子化营销控件用 shadcn」），或收敛到单栈

### 🟡 React Query 依赖未使用

- grep 实证：`@tanstack/react-query` / `useQuery` / `QueryClient` 在 `src/` 内 0 命中（依赖声明存在）
- 风险：dead dependency；数据获取/缓存/失效全靠页面 `useEffect` + 手动 refetch，重复请求、loading/error 态散落各页
- 建议：要么启用 React Query 统一数据层，要么移除依赖减小包体

### 🟡 双 E2E 工具声明但未落地

- grep 实证：依赖含 `@playwright/test ≥1.60` 和 `puppeteer 24`，但 `frontend/{e2e,tests,playwright}/` 目录均不存在（glob 0 命中）
- 风险：依赖膨胀（puppeteer 体积大）；E2E 缺位，关键流程（登录、工作区创建、agent 执行、daemon 会话）无端到端保护
- 建议：选定单一工具（推荐 Playwright）并补核心路径 E2E，或移除未用依赖

### 🟢 页面级测试覆盖薄

- 仅 `app/(dashboard)/runtimes/page.test.tsx` 一个页面级测试；27 个页面中大量无测试覆盖
- 建议：优先补 SSE 消费、表单提交、权限分支等关键页面

### 🟢 已标记弃用代码

- grep 命中 1 处 `@deprecated`：`lib/permission.ts:8`（按功能前缀判断的旧 helper），需评估清理时机

## 依赖风险

### 🟡 API 代理 rewrites 仅在 dev / Node runtime 生效

- grep 实证：`lib/api.ts:18` 注释明确「via the Next.js rewrite proxy (/api/* → backend)」
- 风险：若改纯静态导出（`output: export`）或非 Node 部署，rewrites 失效，前端将无法访问后端；生产依赖 Next server（或反代）兜底
- 建议：部署文档明确「必须 Node runtime / standalone / 反代」，避免误用静态导出

### 🟡 TS strict + `noUncheckedIndexedAccess`

- grep 实证：`tsconfig.json` 开启（target ES2022）
- 影响：数组/对象索引访问需显式 narrowing 或兜底默认值，开发体验更严；也意味着代码中常见 `arr[0]!` 或 `?? fallback` 模式
- 建议：保持开启（正确性收益 > 心智成本），CI 跑 `tsc --noEmit` 守门

### 🟡 双 lockfile

- glob 实证：`frontend/` 同时存在 `pnpm-lock.yaml` 和 `package-lock.json`
- 风险：两套锁文件可能漂移，CI/本地装包不一致
- 建议：删除 `package-lock.json`，统一 pnpm

### 🟢 主版本依赖较新

- Ant Design 6.x（主版本）、`@xyflow/react` 12、Next.js 14.2 RSC 生态仍在演进；升级/排错需关注上游 breaking change
- 建议：锁定 patch，定期跟版

### 🟢 SSE 客户端手写解析

- grep 实证：18 文件 / 120 处手写 `fetch + getReader + TextDecoder` 解析 SSE
- 风险：解析逻辑分散（`agent-stream.ts` / `daemon.ts` / `agent-log/normalize.ts` 等），边界场景（断帧、心跳、重连）易各自实现
- 建议：抽取统一 SSE reader util + 自动重连
