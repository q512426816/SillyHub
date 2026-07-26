---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 代码约定(Conventions)

> 子项目:**frontend** · Next 14.2.5 / React 18.3.1 / TS 5.5.4 · pnpm 9.6.0,Node ≥20
> 范围:仅 `frontend/` 内的代码约定(commit 6e78b29a,覆盖旧版)。页面级实现规范见 `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`,设计系统总纲见 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/`。
> 重要更正:旧版(commit ba87eec)记载"无 React Query",自 react-query 迁移(记忆 `react-query-migration-status`)后**已全面采用**,下文已更新。

## 框架隐形规则

这些是"不写就会踩"的框架级硬约束,违反通常不立即报错,而在构建/运行期/提交守护处爆雷。

1. **API 类型由 OpenAPI 生成,禁止手改 `src/lib/api-types.ts`,提交前必须跑类型同步守护。**
   `package.json:14` 的 `gen:types:check` 会重新生成 `api-types.ts` 并用 `git diff --exit-code` 阻止漂移提交。消费方式统一为 `import type { components } from "@/lib/api-types"`,再从 `components["schemas"]["..."]` 取类型(`frontend/src/lib/auth.ts:4`、`frontend/src/lib/workspaces.ts:9`、`frontend/src/lib/runtime.ts:5`)。后端 schema 一改,必须先 `pnpm gen:types` 再改前端,不能凭记忆手写类型。

2. **服务端状态全部走 react-query,queryKey 必须经集中工厂 `queryKeys` 构造,不能就地拼字符串。**
   工厂定义在 `frontend/src/lib/query-keys.ts:15`,规则是"凡影响查询结果的变量都进 key"(分页/过滤 params 整体进 key,见文件头注释)。消费侧一律 `useQuery<TData, ApiError>({ queryKey: queryKeys.xxx.all, ... })`,mutation 失效缓存也复用同一 key 做 `invalidateQueries`(`frontend/src/lib/custom-skills.ts:119-120,160-161`)。key 拼错会静默去重到不存在的缓存条目,是已踩过的坑。

3. **HTTP 调用统一走 `apiFetch`,错误归一化为 `ApiError`,禁止裸 `fetch`。**
   `apiFetch` 自动带 session bearer token、归一化错误(`frontend/src/lib/admin.ts:9,123`、`frontend/src/lib/daemon-audit.ts:28`)。因此 react-query 的 error 类型固定写 `ApiError`,业务函数 JSDoc 用 `@throws ApiError 401/403/422/5xx` 标注(`frontend/src/lib/daemon-audit.ts:94,137`)。

4. **antd 6 的静态方法 `message.xxx` 在 Next 14 App Router 下拿不到主题/上下文,需经 `<App>` 包裹并用 `App.useApp()`。**
   项目通过 `frontend/src/lib/errors.ts:2,39` 的 `import { App } from "antd"` 暴露 `useNotify()` hook 收敛错误提示;页面级直接用 `App` 组件入口(`frontend/src/app/m/workspaces/page.tsx:35`)。新代码不要 `message.error(...)` 裸调。

5. **路径别名 `@/*` → `./src/*`,TS 严格模式 + `noUncheckedIndexedAccess`。**
   见 `frontend/tsconfig.json:8-9,20`。`noUncheckedIndexedAccess: true` 意味着 `arr[i]` 类型是 `T | undefined`,下标访问后必须窄化或兜底,不能直接当 `T` 用。

## 代码风格

1. **数据 hook 统一 `useXxx` 命名,集中在 `src/lib/`,返回 react-query 结果对象(含 `data/isLoading/error`),不拆散。**
   典型:`usePolicyAudit` / `usePolicyAuditByRuntime`(`frontend/src/lib/daemon-audit.ts:131,171`),`useMcpConfig` / `useUpdateMcpConfig`(`frontend/src/lib/mcp-settings.ts:92,126`)。源码注释明确"风格对齐 lib/use-daemon-runtimes.ts(useQuery + ApiError + 暴露常用态)"(`frontend/src/lib/daemon-audit.ts:153`),新 hook 照此对齐。

2. **UI 基元用 `cva` 定义 variant,再用 `cn()` 合并 className,放在 `src/components/ui/`。**
   `cn = twMerge(clsx(inputs))`,定义在 `frontend/src/lib/utils.ts:1-5`。variant 用例:`frontend/src/components/ui/badge.tsx:2,6,29` —— `cva(...)` 产出 `badgeVariants`,组件内 `className={cn(badgeVariants({ variant }), className)}`。Radix + Tailwind 的 dialog/input 同构(`frontend/src/components/ui/dialog.tsx:25`、`frontend/src/components/ui/input.tsx:12`)。

3. **antd 6 与 Tailwind 3.4 共存:antd 管交互/语义,Tailwind 管布局/间距/微调,经 `className` 叠加。**
   antd 组件直接导入(`frontend/src/components/admin-user-drawer.tsx:4` 的 `Form/Input/Select/Modal`、`frontend/src/components/admin-org-tree.tsx:4` 的 `Tree`),同组件用 Tailwind class 调布局(`frontend/src/components/file-upload.tsx:156,176` 的 `rounded border border-border ... px-2 py-1.5`、`flex items-center gap-2`)。新页面优先复用既有 antd 组件 + Tailwind 原子类,不要引第三个 UI 库。

4. **UI 文案默认中文;测试标题也用中文描述业务语义,不写英文化名。**
   依据 `.claude/CLAUDE.md` 规则 12(必要专业术语除外)。测试用例:`frontend/src/middleware.test.ts:70-105` 的 `describe("isMobileUserAgent")` 下 `it("识别 iPhone / Android 手机 / Windows Phone / BlackBerry 为移动")` 等中文断言标题,决策编号 `R-02 / D-005` 直接写进标题便于溯源。

5. **测试用 Vitest(jsdom + globals),文件就近放置:`*.test.ts(x)` 与组件同名同目录,或落在 `__tests__/` 子目录。**
   配置见 `frontend/vitest.config.ts:8-15`(`environment: "jsdom"`、`globals: true`、`testTimeout: 15000` 治全量 flaky 超时)。纯逻辑 `*.test.ts`,组件 `*.test.tsx`(已命中 100+ 测试文件);运行 `pnpm test`(= `vitest run`)。已知坑:jsdom 下 `next/dynamic` 的 `ssr:false` 组件同步渲染为 null,需在测试顶部 `vi.mock` 成纯文本渲染(记忆 `frontend-markdown-text-jsdom-null`)。

## 相关脚本(pnpm)

| 用途 | 脚本 | 来源 |
|------|------|------|
| 类型检查 | `pnpm typecheck` | `package.json:10` |
| Lint(eslint-config-next) | `pnpm lint` | `package.json:9` |
| 单元测试 | `pnpm test` | `package.json:11` |
| 生成 OpenAPI 类型 | `pnpm gen:types` | `package.json:13` |
| 类型漂移守护(提交前必跑) | `pnpm gen:types:check` | `package.json:14` |
