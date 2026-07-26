---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 关注点(Concerns)

> 子项目:`frontend/`。仅列真实问题并标来源(grep / 配置文件 / 加固文档 / 记忆)。🔴 高 / 🟡 中 / 🟢 低。

## 代码质量

### 🔴 E2E 测试完全缺失(依赖声明但零脚本)

- 实证:`@playwright/test ^1.60.0` + `puppeteer ^24.43.1` 在 `package.json` devDeps,但 `frontend/{e2e,tests,playwright}` 目录、`playwright.config.*`、任意 `*.spec.ts` 全量 Glob **0 命中**;`@playwright/test` 当前只作为 `next` 间接依赖被安装。来源:`package.json` + Glob。
- 风险:登录、工作区创建/扫描、Agent Run SSE、daemon 交互式会话、PPM 工时/导入等关键流程**无端到端保护**;组件测无法覆盖路由跳转、中间件守卫、SSE 透传链路。
- 建议:选定 Playwright 补核心路径 E2E,或移除未用的 puppeteer(体积大)。

### 🟡 react-query 迁移未完成(Wave3 / Wave4 待做)

- 实证:记忆 `react-query-migration-status` —— Wave1/2 已完成(538 passed 零回归,未 commit),Wave3(Agent / Runtime 页)与 Wave4(门禁)待做;坑为 `console.error` 静默 + `refetchInterval` 需抽纯函数(27 文件用到 refetchInterval)。
- 风险:迁移半途,已迁移与未迁移页面数据获取范式不一致;未 commit 的改动有丢失风险。
- 建议:按 Wave 推进收尾,Wave3/4 完成后统一 commit。

### 🟡 useSession 选择器优化只做了安全子集(布局守卫页遗留)

- 实证:`docs/code-quality-hardening-2026-07-24.md` §5 Wave E F2 —— 仅 11 个只读叶子页改 `useSession((s)=>s.user)`,**dashboard/admin layout 守卫页跳过**(收窄订阅会丢失登出反应,安全回归)、**mcp 页回退**(测试 mock 不支持 selector,按 rule 9 不改测试通过)。token 轮换(~20min + 401 刷新)仍会重渲染 3000 行的 `milestone-details` 等大页。
- 风险:性能优化未覆盖最重的布局守卫页;后续若盲目推广 selector 会破坏 auth gate。
- 建议:layout 守卫页需逐组件设计反应性(getState + 选择器混合)后再迁,不可机械套用。

### 🟡 测试中 `console.error` 静默 + `any` 类型债

- 实证:`vi.spyOn(console,"error").mockImplementation(()=>{})` 见 `app/(dashboard)/workspaces/[id]/agent/__tests__/page.test.tsx:138`、`lib/__tests__/use-agent-runs.test.tsx:35`;测试文件内 `: any` 计 21 处,集中在 4 个文件(`components/__tests__/workspace-path-picker`、`components/daemon/__tests__/interactive-session-panel`(+ changeid 变体)、`components/changes/__tests__/change-session-section`),多用于构造 fake connection handlers。来源:Grep。
- 风险:静默会掩盖真实报错;测试 `any` 削弱类型守护(生产代码 `any` 已收敛,如 `lib/ppm/aggregations.ts` 旧 `formatter: (p:any)` 应迁 zod 推断类型)。
- 建议:新增测试优先断言错误而非静默;fake handlers 用 `unknown` + narrow 或共享类型。

### 🟡 双 UI 组件库并存(antd 6 + shadcn/ui)

- 实证:`src/components/ui/` 保留 shadcn 全套原子件(avatar/badge/button/card/dialog/dropdown-menu/empty-state/input/skeleton/status-badge/tag/tooltip),业务表单/表格用 antd 6.4。`FRONTEND_PAGE_STYLE.md` 已定调「UI 组件全用 antd,布局/间距用 tailwind」,但 shadcn 原子件仍在使用。来源:Glob + `FRONTEND_PAGE_STYLE.md`。
- 风险:两套设计系统(主题 token / CSS 变量 / 间距)并存,视觉一致性靠人工维护;同类控件双栈各一份,选用边界不清。
- 建议:按页面样式规范逐步收敛,或明确原子控件与业务控件边界。

### 🟢 无 TODO/FIXME/HACK/XXX,无 @ts-ignore

- 实证:`grep "TODO|FIXME|XXX|HACK"` 在 `frontend/src` 下 **0 命中**;`@ts-ignore` / `@ts-expect-error` 计数 **0**。来源:Grep。
- 说明:代码无明显技术债标记,类型逃逸口受控。

### 🟢 全局错误边界已补(Wave E F1)

- 实证:`docs/code-quality-hardening-2026-07-24.md` §1 Wave E —— 新建 `app/error.tsx`(路由级,保留外层 layout)+ `app/global-error.tsx`(root layout 崩溃兜底,自带 html/body + 内联样式)。验证 1059 passed 零回归。
- 说明:此前整页白屏只能刷新的风险已治。

## 依赖风险

### 🔴 OpenAPI 生成类型的 nullable / by_alias 陷阱(仅靠 git diff 守护)

- 实证:`gen:types:check`(`scripts/gen-api-types.mjs`)从 `backend/openapi.json` 经 openapi-typescript 生成 `src/lib/api-types.ts`,靠 `git diff --exit-code` 守漂移。记忆 `frontend-type-migration-landscape` 标注 nullable 字段需 `?? null`、后端 `by_alias=False` 会让字段别名与预期不一致。来源:`scripts/gen-api-types.mjs` + 记忆。
- 风险:后端改 schema 若忘记跑 `gen:types:check` 提交,前端类型与后端失同步,运行时 500 才暴露;CI 若未跑此检查则闸门失效。
- 建议:CI 强制跑 `gen:types:check`;后端 PR 模板提醒改 schema 同步前端类型。

### 🟡 主版本 / 较新依赖需跟版

- 实证(`package.json`):Ant Design **6.4.4**(主版本,社区文档/兼容库可能滞后)、`@xyflow/react ^12.10`、ECharts **6.1.0**、Next.js **14.2.5**(App Router 生态演进中)、React 18.3.1。
- 风险:antd 6 为最新主版本,两汉字按钮自动插空格等行为差异需排错;Next 14 RSC 缓存语义仍在演进。
- 建议:锁定 patch,定期跟版;升级前读 upstream breaking change。

### 🟡 双 lockfile

- 实证:`frontend/` 同时存在 `pnpm-lock.yaml` 与 `package-lock.json`;`packageManager: pnpm@9.6.0`。来源:Glob。
- 风险:两套锁文件可能漂移,CI/本地装包不一致。
- 建议:删除 `package-lock.json`,统一 pnpm。

### 🟡 next/dynamic ssr:false 是公共污染点

- 实证:`next/dynamic` + `ssr:false` 用于 `components/ui/markdown-text.tsx`、`components/charts/index.tsx`(ECharts 包装)、`app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`、`components/change-file-tree.tsx`。任何用到这些组件的 jsdom 测试都需 vi.mock,否则渲染 null。来源:Grep(20+ 文件注释标注此坑)。
- 风险:新增页面引入 MarkdownText / 图表却忘记 mock,测试会假阳性通过(断言空 DOM)。
- 建议:在共享测试工具(如 `src/test/setup.ts` 或 `src/test/helpers`)提供统一 mock,新测试 import 即用。

### 🟢 TS strict + noUncheckedIndexedAccess

- 实证:`tsconfig.json` 开启 `strict` + `noUncheckedIndexedAccess`,`target: ES2022`;`@ts-ignore` 计数 0。来源:`tsconfig.json` + Grep。
- 影响:数组/对象索引访问需显式 narrowing 或兜底(`arr[0]!` 或 `?? fallback`),正确性收益 > 心智成本。
- 建议:保持开启,CI 跑 `tsc --noEmit` 守门。

### 🟢 Node 20 / pnpm 9 engines 钉死

- 实证:`package.json` `engines.node >=20.0.0`,`packageManager: pnpm@9.6.0`。来源:`package.json`。
- 说明:运行时与包管理版本受控,降低环境漂移风险。
