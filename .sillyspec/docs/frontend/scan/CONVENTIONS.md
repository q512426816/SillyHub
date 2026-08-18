---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 代码约定（Conventions）

> 子项目：**frontend** · Next 14.2.5 / React 18.3.1 / TS 5.5.4 / antd 6 · pnpm 9.6.0，Node ≥20
> 范围：仅 `frontend/` 内的代码约定（commit 744e3de4，全量重扫覆盖旧版 6e78b29a）。页面级实现规范见 `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`，设计系统总纲见 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/`。

## 框架隐形规则

这些是"不写就会踩"的框架级硬约束，违反通常不立即报错，而在构建/运行期/提交守护处爆雷。

1. **API 类型由 OpenAPI 生成，禁止手改 `src/lib/api-types.ts`，提交前必须跑类型漂移守护。**
   `frontend/package.json:13-14` 的 `gen:types` 从后端 OpenAPI 生成类型，`gen:types:check` 重新生成后用 `git diff --exit-code` 阻止漂移提交。后端 schema（DTO/请求/响应）一改，同一变更内必须先 `pnpm gen:types` 再改前端（项目 CLAUDE.md 规则 21），不能凭记忆手写类型。

2. **`Date.toLocaleString()` 必须显式传 `"zh-CN"`，否则开发机 zh-CN 过 CI en-US 红。**
   现状（744e3de4 grep 统计）：`src/` 内共约 45 处 `toLocaleString`、36 个文件，日期时间格式化处均已显式带 `"zh-CN"`（如 `frontend/src/app/(dashboard)/ppm/shared.tsx:21`、`frontend/src/app/(dashboard)/ppm/project-plans/page.tsx:63`、`frontend/src/components/charts/RuntimeUsageLineChart.tsx:61-62`）；不带 locale 参数的仅剩**数字千分位**格式化（token 数值等），如 `RuntimeUsageLineChart.tsx:93`、`frontend/src/components/daemon/turn-timeline.tsx:725,728`——数字千分位是约定保留项，不算漏网。Windows Node 忽略 LANG，本地无法复现 en-US，必须靠写死 locale 防护。

3. **Tailwind `md:` 是视口断点不是容器断点，侧栏/卡片内嵌组件禁用响应式前缀做布局决策。**
   桌面视口下即使容器只有 320px，`md:grid-cols-2` 仍强制两栏挤崩。代码注释明证：`frontend/src/components/changes/detail/change-sessions-card.tsx:20`（"整包塞进 320px 折叠卡——`md:` 是视口断点非容器断点"），测试标题也固化此认知（`frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx:81`）。侧栏内宽内容改用 Dialog（radix Portal 脱离侧栏）承载。

4. **Markdown 渲染必须过 rehype-sanitize，禁止裸渲后端/用户内容。**
   统一入口 `frontend/src/components/ui/markdown-text.tsx:6,89`：自定义 `MARKDOWN_SANITIZE_SCHEMA` + 导出 `markdownRehypePlugins = [[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]`，供 `@uiw/react-markdown-preview` 挂载；行为有专门测试守护（`frontend/src/components/ui/markdown-text.test.tsx:232-240`）。新渲染位复用该导出，不各自拼 schema。

5. **antd 6 静态方法 `message.xxx` 在 App Router 下拿不到主题/上下文，提示统一经 `useNotify()`。**
   `frontend/src/lib/errors.ts:2,39,44` 以 `App.useApp()` 封装 `useNotify()` 收敛错误提示，新代码不要 `message.error(...)` 裸调；`App` 包裹入口在 providers 层。

6. **HTTP 调用统一走 `apiFetch`，错误归一化为 `ApiError`，禁止裸 `fetch`。**
   定义在 `frontend/src/lib/api.ts:46,80`：自动带 session bearer token、401 刷新、错误归一 `ApiError`。src/lib 下 406 处引用/49 文件，react-query 的 error 类型固定写 `ApiError`。

7. **路径别名 `@/*` → `./src/*`；TS 严格模式 + `noUncheckedIndexedAccess: true`。**
   见 `frontend/tsconfig.json:8,19-21`。`arr[i]` 类型是 `T | undefined`，下标访问后必须窄化或兜底，不能直接当 `T` 用。

8. **UI 文案与测试标题默认中文（必要专业术语除外）。**
   依据项目 CLAUDE.md 规则 12；测试用例也用中文描述业务语义（如 `frontend/src/middleware.test.ts` 的中文断言标题，决策编号 `R-02 / D-005` 直接写进标题便于溯源）。

9. **新页面样式照页面级实现规范执行。**
   `frontend` 页面实现统一参考 `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（仓库内文件，改其它页面照这个），设计系统总纲见 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/`（原型 + design.md）。

## 代码风格

1. **服务端状态全部走 react-query，queryKey 必须经集中工厂 `queryKeys` 构造，不能就地拼字符串。**
   工厂在 `frontend/src/lib/query-keys.ts:15`，文件头注释明确规则"凡影响查询结果的变量都进 key"（分页/过滤 params 整体进 key）。mutation 失效缓存复用同一 key 做 `invalidateQueries`，key 拼错会静默去重到不存在的缓存条目，是已踩过的坑。

2. **数据 hook 统一 `useXxx` 命名，集中在 `src/lib/`，返回 react-query 结果对象（含 `data/isLoading/error`），不拆散。**
   典型文件：`frontend/src/lib/use-daemon-runtimes.ts`（风格基准）、`frontend/src/lib/use-daemon-machines.ts`、`frontend/src/lib/use-agent-runs.ts`、`frontend/src/lib/use-workspace-context.ts`；业务模块 hook 如 `frontend/src/lib/daemon-audit.ts`、`frontend/src/lib/mcp-settings.ts` 内的 `useMcpConfig / useUpdateMcpConfig`。

3. **UI 基元用 `cva` 定义 variant，再用 `cn()` 合并 className，放在 `src/components/ui/`。**
   `cn = twMerge(clsx(inputs))` 定义在 `frontend/src/lib/utils.ts:4-6`。variant 用例：`frontend/src/components/ui/badge.tsx:2,6,29`——`cva(...)` 产出 `badgeVariants`，组件内 `className={cn(badgeVariants({ variant }), className)}`；Radix + Tailwind 的 dialog/input 同构。antd 管交互/语义，Tailwind 管布局/间距/微调，经 `className` 叠加，不引第三个 UI 库。

4. **组件文件按领域分子目录组织，文件名 kebab-case。**
   `frontend/src/components/` 下分域：`agent/ agent-log/ changes/ charts/ daemon/ layout/ llm-providers/ mobile/ permissions/ ppm/ sessions/ workspace/`，基础件在 `ui/`（button/badge/dialog/input/markdown-text 等 13 个）。历史遗留两个大写开头文件（`AgentModelInput.tsx`、`AgentProviderSelect.tsx`），新文件一律 kebab-case。

5. **全局状态用 zustand，store 放 `src/stores/`，hook 命名 `useXxxStore`。**
   现有 `frontend/src/stores/workspace.ts`、`frontend/src/stores/session.ts`、`frontend/src/stores/kanban.ts`。每个 store 头部 JSDoc 写设计依据与边界（如 workspace.ts 明确"URL 是真相源，store 仅叠加缓存""非 persist：localStorage 与 URL 派生状态不同步会引发闪烁"）。

6. **表单/外部数据校验用 zod，属按需局部使用而非全局强制。**
   现仅 3 处：`frontend/src/lib/daemon.ts`、`frontend/src/lib/mcp-settings.ts`、`frontend/src/app/(dashboard)/settings/mcp/page.tsx`（校验 daemon 上报与 MCP 配置）。表单交互仍以 antd Form rules 为主，勿为凑规范强引 zod。

7. **测试用 Vitest（jsdom + globals）+ @testing-library/react，文件就近放置：`*.test.ts(x)` 与被测文件同名同目录，或落 `__tests__/` 子目录。**
   现共 157 个测试文件，两种放置并存（co-located 如 `frontend/src/components/file-upload.test.tsx`；子目录如 `frontend/src/components/__tests__/`、`frontend/src/lib/__tests__/`）。配置 `frontend/vitest.config.ts`：`clearMocks: true` 统一隔离（刻意不开 `restoreMocks`，注释写明会破 describe/beforeAll 级持久 spy）、`testTimeout: 15000` 治全量 flaky、`environmentMatchGlobs` 把纯逻辑 lib 测试切 node 省 jsdom 启动。已知坑：jsdom 下 `next/dynamic` 的 `ssr:false` 组件同步渲染为 null，需在测试顶部 `vi.mock`。

8. **ESLint 用 eslint-config-next（`next lint`），叠加 `no-unused-vars` warn，`_` 前缀豁免。**
   `frontend/.eslintrc.json`：`extends: ["next/core-web-vitals"]`。运行 `pnpm lint`。

9. **App Router 下 client 组件必须显式 `"use client"` 首行声明。**
   现状 211 处（src/ 内 211 文件）。数据获取依赖 react-query，页面/组件几乎全是 client 组件；server 侧仅 layout 根、中间件与静态壳，新页面默认从 `"use client"` 起手。

## 典型模式

1. **数据 hook 模式**：`useXxx` + `queryKeys` 工厂 + `apiFetch` + `ApiError`，返回完整 query 结果对象。样板见 `frontend/src/lib/use-daemon-machines.ts`、key 定义见 `frontend/src/lib/query-keys.ts:27-31`（params 整体进 key 的写法）。
2. **UI 基元模式**：`cva` variant + `cn()` 合并 + `VariantProps` 暴露类型。样板 `frontend/src/components/ui/badge.tsx`（全文 30 行，完整示范 variants/defaultVariants/组合写法）。
3. **安全 Markdown 模式**：统一 schema + 导出插件数组复用。样板 `frontend/src/components/ui/markdown-text.tsx:89`（`markdownRehypePlugins` 导出），配套行为测试 `frontend/src/components/ui/markdown-text.test.tsx`。
4. **zustand store 模式**：`create<T>()` + 显式状态/动作接口 + 头部 JSDoc 写设计依据与 persist 边界。样板 `frontend/src/stores/workspace.ts`。

## 相关脚本（pnpm）

| 用途 | 脚本 | 来源 |
|------|------|------|
| 类型检查 | `pnpm typecheck` | `frontend/package.json:10` |
| Lint（eslint-config-next） | `pnpm lint` | `frontend/package.json:9` |
| 单元测试 | `pnpm test`（= vitest run） | `frontend/package.json:11` |
| 生成 OpenAPI 类型 | `pnpm gen:types` | `frontend/package.json:13` |
| 类型漂移守护（提交前必跑） | `pnpm gen:types:check` | `frontend/package.json:14` |
