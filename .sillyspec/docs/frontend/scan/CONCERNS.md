---
source_commit: ba87eec
updated_at: 2026-06-23T16:24:51Z
created_at: 2026-06-24T00:24:51
author: qinyi
generator: sillyspec-scan
---

# frontend 关注点 / 技术债

> 基于 `frontend/src/` grep + 配置文件事实，🔴 高 / 🟡 中 / 🟢 低。全量重扫覆盖旧版。仅统计事实，未逐行 Read 源码。

## 代码质量

### 🟡 双 UI 组件库并存（Ant Design 6 + shadcn/ui）

- 实证：`src/` 下 `from "antd"` 等 antd 导入约 42 处；`src/components/ui/` 同时存在 shadcn 全套原子件（avatar / badge / button / card / dialog / dropdown-menu / empty-state / input / skeleton / status-badge / tag / tooltip）。
- 风险：两套设计系统并存（主题 token / CSS 变量 / 字体 / 间距），视觉一致性靠人工维护；同类控件（如 Button）双栈各一份，选用边界不清。
- 建议：明确边界（如「业务表单/表格用 antd，原子控件用 shadcn」）或逐步收敛到单栈。

### 🟡 SSE hook race 场景为关键不变量

- 实证：`lib/use-agent-run-stream.ts` 有 8 处 `if (cancelled) return;`，专门处理 StrictMode 双调用 / 快速重连 / unmount 后旧闭包写 state；`AgentRunStreamClient`（`lib/agent-stream.ts`）防止孤儿 EventSource。
- 风险：任何对该 hook 或 stream client 的改动都可能破坏保护。
- 建议：保留 `use-agent-run-stream.test.ts` 对 cancelled 行为的断言；改动前先读 `lib/use-agent-run-stream.ts` 顶部注释。

### 🟡 双 E2E 工具声明但未落地

- 实证：依赖含 `@playwright/test@^1.60.0` + `puppeteer@^24.43.1`，但 `frontend/{e2e,tests,playwright}/` 目录均不存在（0 命中）。
- 风险：依赖膨胀（puppeteer 体积大）；关键流程（登录、工作区创建、agent 执行、daemon 会话、PPM 工时）无端到端保护。
- 建议：选定单一工具（推荐 Playwright）补核心路径 E2E，或移除未用依赖。

### 🟡 类型系统局部放宽（19 处 `any`）

- 实证：`grep -rnE ":\s*any\b|as any\b|<any>" src` 命中约 19 处，集中在测试 mock（`interactive-session-panel.test.tsx` 的 FakeConn handlers）与个别生产代码（如 `lib/ppm/aggregations.ts:115 formatter: (p: any)`）。
- 风险：生产代码中的 `any` 削弱类型保护；测试中的 `any` 可接受但应尽量收敛为具体类型。
- 建议：生产 `any` 改为 zod 推断类型或显式接口；测试 `any` 可替换为 `unknown` + narrow。

### 🟢 页面级测试覆盖薄

- 仅 `runtimes/page.test.tsx` 与 `ppm/milestone-details` 两个页面级测试；PPM 其余 14 个子路由（projects / project-plans / plan-nodes / kanban / work-hours / work-hour-statistics / problem-list / problem-changes / task-plans / task-execute / customers / project-members / project-stakeholders）、admin、settings 无页面级覆盖。
- 建议：优先补 SSE 消费、PPM 表单提交、admin 权限分支等关键页面。

### 🟢 无 TODO/FIXME/HACK/XXX 遗留，无 @ts-ignore

- 实证：`grep -rnE "TODO|FIXME|HACK|XXX"` 在 `src/` 下 0 命中；`@ts-ignore` / `@ts-expect-error` 0 命中。
- 说明：代码无明显技术债标记，类型逃逸口受控。

## 依赖风险

### 🟡 API 代理 rewrites 依赖 Next Node runtime

- 实证：`next.config.mjs` `rewrites()` 将 `/api/:path*` → `${apiBaseUrl}/api/:path*`；`output` 由 `NEXT_BUILD_STANDALONE=1` 控制（默认非 standalone）。
- 风险：rewrites 仅在 Next server（Node runtime）生效，纯静态导出（`output: export`）或非 Node 部署会失效，前端无法访问后端。
- 建议：部署文档明确「必须 Node runtime / standalone / 反代」，避免误用静态导出。

### 🟡 双 lockfile

- 实证：`frontend/` 同时存在 `pnpm-lock.yaml` 与 `package-lock.json`；`packageManager: pnpm@9.6.0`。
- 风险：两套锁文件可能漂移，CI/本地装包不一致。
- 建议：删除 `package-lock.json`，统一 pnpm。

### 🟡 主版本/较新依赖需跟版

- Ant Design 6（`^6.4.4`，主版本）、`@xyflow/react@^12`、ECharts 6（`echarts@^6.1.0`）、Next.js 14.2（RSC 生态仍在演进）；升级/排错需关注上游 breaking change。
- 建议：锁定 patch，定期跟版；antd 6 为最新主版本，社区文档与兼容库可能滞后。

### 🟢 TS strict + noUncheckedIndexedAccess

- 实证：`tsconfig.json` 开启 `strict` + `noUncheckedIndexedAccess`，`target: ES2022`。
- 影响：数组/对象索引访问需显式 narrowing 或兜底默认值（常见 `arr[0]!` 或 `?? fallback`）。
- 建议：保持开启（正确性收益 > 心智成本），CI 跑 `tsc --noEmit` 守门。

### 🟢 SSE 客户端手写解析

- 实证：`EventSource` / `text/event-stream` 相关逻辑分布在 `lib/agent-stream.ts`、`lib/use-agent-run-stream.ts`、`lib/daemon.ts`、`lib/api.ts`、3 个 Route Handler（`daemon-chat/[runId]/stream`、`daemon/sessions/[sessionId]/stream`、`workspaces/.../agent/runs/[runId]/stream`）、`components/agent-log/normalize.ts`。
- 风险：边界场景（断帧、心跳、重连）分散在多文件，各自实现易不一致。
- 建议：抽取统一 SSE reader util + 自动重连策略。

### 🟢 大包体积

- ECharts 6（含 `echarts-for-react`）+ puppeteer 24 + antd 6 + @xyflow/react 12 同处一包；puppeteer 作为 devDep 体积大但未使用。
- 建议：移除未用的 puppeteer / playwright 之一，或按需 tree-shake ECharts（按图表类型引入）。
