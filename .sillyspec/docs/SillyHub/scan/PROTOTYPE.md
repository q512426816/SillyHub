# PROTOTYPE.md — 原型分型与「原型即实现」管线规约

> 2026-09-27-prototype-pipeline 落档。背景：2026-09-26-core-pages-visual-redesign 实证
> 「选型方言原型（手写 HTML）→ 项目方言实现」之间无机械桥梁，视觉保真度全流程零承接，
> 差距部署后才被肉眼发现。本规约确立：**原型从真码生成，产物是编译结果，不是手绘稿**。

## 三类原型

| 类型 | 例子 | 源（入仓、可 diff、过质量门） | 产物 | 批准后怎么「接线」 |
|---|---|---|---|---|
| **页面类** | 变更中心/详情、工作区、会话门户 | `frontend/src/components/prototype/<名>-view.tsx`（import 生产 primer 组件 + Tailwind + themes.ts token，fixture 数据） | `pnpm prototype:build` → `frontend/prototype-dist/<名>.html`（自包含、离线双击、三主题可切） | fixture 换真实 hooks → 挪到正式页面位置 → 用批准渲染生成 Playwright 数值断言与基线截图（**接线，非翻译**） |
| **流程类** | 状态机、同步回执链、门禁管线（**没有对应页面**） | 同目录流程视图 tsx：节点/边 JSON（`FlowNode[]`/`FlowEdge[]`，经 `flow-diagram.tsx` 渲染分层 SVG） | 同上（同一编译管线） | 对照节点/边 JSON 源写状态机测试、design.md 引用节点 id（**可追溯即防漂移**，不接 UI） |
| **规则类** | 决策表、契约、验收口径 | 本体就是文本 → `design.md` / `requirements.md` 相应小节 | 无编译产物 | 不适用（文本即源） |

## 工作流（页面类/流程类共用）

1. **写变体**：在 `frontend/src/components/prototype/` 写视图（或一组风格变体目录），
   与生产同方言；粗选风格可用一次性 HTML 草稿，但**用户选定后的确认稿必须是真码变体**。
2. **编译评审**：`pnpm prototype:build` → 双击 `prototype-dist/*.html` 离线查看
   （三主题切换内嵌）→ 用户对着产物批准。
3. **批准即冻结**：批准时的产物+源码一起显式 pathspec 提交；此后源码改动必须重编译，
   `git diff` 为空是对账门（**禁止手改产物 HTML**——产物不可能与源码分家）。
4. **接线**：按上表「批准后怎么接线」执行；结构对不齐处停下来带截图裁决，不许静默降级。

## 铁律

- 原型源码与生产代码同一质量门：tsc / eslint / 禁硬编码色（token 铁律，参照
  FRONTEND_PAGE_STYLE.md §0.5）。
- 视图只读消费生产组件（import 单向）；业务代码零反向依赖原型目录。
- 产物交互为编译内嵌的轻量 vanilla JS（主题切换/列表过滤）；需要完整交互的原型走
  **dev 预览路由（已落地）**（2026-10-20-session-page-dsh-alignment / D-010），不在本管线内补；
  入口与导出管线见下节。
- 产物体积 ~150KB/文件（全量 Tailwind CSS 内联），接受；按视图裁剪为后续优化项。

## dev 预览路由（已落地）

2026-10-20-session-page-dsh-alignment 起，「dev 预览路由」由**后续演进项**转为**已落地**的定稿原型通道（D-010）：原型直接 `import` 生产组件、喂真实导出或桩数据，起 `next dev` 后浏览器直开。三条实际入口（均 dev-only：不进导航、不被生产页面引用、不加 middleware 守卫）：

| 路由 | 内容 | 数据面 |
|---|---|---|
| `/proto/session-redesign` | **整页真组件**：真实 `AppShell`（preview 入参）+ 真实 `SessionListPanel` + 真实 `TurnTimeline`，可切现状 / v2 与对话 / 进度 | 真实会话导出 `frontend/.proto-staging/session-export.json`（RSC 读盘，3.3MB 只进 RSC 载荷、不进 JS bundle） |
| `/proto/session-trajectory` | **轨迹视图**：三泳道（输入 / 模型 / 工具）共享绝对时间轴（缩放 / 平移 / 总览刷子）+ `role="grid"` 账本 + 320px inspector | 同上，读 `.proto-staging/session-export.json`（`force-dynamic`，每次请求读最新导出） |
| `/proto/session-file-changes` | **文件变更卡形态原型**：折叠 / 展开 / 快照超时降级 / 100 文件内滚四态 + 三主题换肤 | **桩数据**（数据全在页面文件里；卡片组件 props only）。点击文件行只写 dev 日志，不会打开文件 |

### 三条路由的已落地实况与 dev-only 边界（2026-10-20-session-page-dsh-alignment 收口登记）

三条路由源码均在 `frontend/src/app/proto/<名>/page.tsx`，已随本变更联调完成，**不再是待落地项**：

- `/proto/session-redesign`：整页**真组件**——真实 `AppShell`（dev 预览入参：菜单/品牌区/顶栏显示名由调用方给预览值，生产调用方不传则逐字段回落原 store 读取）+ 真实 `SessionListPanel` + 真实 `TurnTimeline`；顶部 dev 说明条 + 「现状 / v2」「对话 / 进度」切换。数据面＝SSR 请求时读 `frontend/.proto-staging/session-export.json`（`STAGED_EXPORT_RELATIVE_PATH` 定义相对路径，`frontend/src/app/proto/session-redesign/staged-session-export.ts:30`；`:36` 是唯一读盘入口），文件缺失/JSON 坏 → 返回 `null` → 占位不白屏。
- `/proto/session-trajectory`：三泳道（输入 / 模型 / 工具）共享同一条绝对时间轴（缩放 / 平移 / 总览刷子）+ `role="grid"` 账本 + 320px inspector；`force-dynamic` 每次请求读最新导出。模型泳道按 `Trajectory.modelBasis` **明示两态口径**：`observed`→「真实占用」、`approx`→「近似（无 TTFT 采样）」（`frontend/src/components/daemon/trajectory/trajectory-timeline.tsx:100`）；staged 导出无 `timing` 字段 → 常态 `approx`。
- `/proto/session-file-changes`：文件变更卡**形态原型**（桩数据全在页面文件里，卡片 props only）——折叠（8 文件）/ 展开（3 文件）/ 快照超时 `truncated` + 共享工作区 / 100 文件长列表（限高 240px 内滚）四态 + 三主题换肤；点文件行只 `console.log` 一条 dev 日志（`frontend/src/app/proto/session-file-changes/page.tsx:104`），不打开文件、不取任何真实数据。

**dev-only 边界（四条，缺一条即视为越界）**

1. **不进导航**：`/proto/*` 不出现在任何菜单 / 侧栏 / 快捷入口；`app-shell` / `workspace-switcher` 的预览入参只由 proto 页面传入（`frontend/src/components/app-shell.tsx:159` 为该边界的源码注释：仅 dev 预览路由传入、不进导航、不被生产页引用；生产缺省逐字段等价旧行为）。
2. **不进 middleware**：`frontend/src/middleware.ts` 无 `/proto` 规则（不鉴权、不重写、不守卫）；三条路由靠「不被生产页面引用」保持 dev-only，不是靠运行时门控或环境变量。
3. **不被生产代码引用**：全树只有 `frontend/src/app/proto/**` 内部互相 import（生产组件里出现的 `app/proto` 字样仅为边界注释，不是 import）；轨迹 / 文件变更卡组件本身在 `frontend/src/components/daemon/**`，可被生产复用，但 `/proto/*` 页面不反向进入生产路由。
4. **真实数据不进 `public/`**：真实会话导出只允许 staging 在 `frontend/.proto-staging/`（`frontend/.gitignore:11` 覆盖 —— 不进 git、不进构建产物），取数唯一路径是 server component 的 `readFileSync`（只进 RSC 载荷、不进 JS bundle）；`public/` 是**免鉴权静态服务面**，历史 `public/__proto/` 已迁出，并加 `frontend/.gitignore:12`（`/public/__proto*/`）防同名目录被重建后误提交。

> 分工不变（R-11）：**功能完整性只能回 dev 路由验**，静态导出稿（`export-hydrated.mjs` 产物）只作观感评审；`--with-js` 那段 vanilla shim 不是水合，不能据它宣称「可交互定稿」。

**导出管线：`frontend/scripts/export-hydrated.mjs`**

- **必须水合后序列化 DOM，禁止抓 SSR HTML**（D-018）：该路由的真实答复正文走 `next/dynamic ssr:false`，SSR 稿实测含 138 处 CSR bailout `<template>` 占位、**0 个 `.wmde-markdown`**——正文全缺的稿子不能作为任何结论的依据。脚本流程＝playwright 打开路由 → `networkidle` → `waitForFunction(.wmde-markdown ≥ 阈值)` → 逐片收集 `cssRules` → `outerHTML` → 剥 `<script>`/`<link>`/原 `<style>` → 合并单 `<style>` → 机械校验（各闭合标签恰好一次、正文块计数、无 `<link>`）→ 落盘；不达标 exit 1 且**不落盘**。
- `--with-js`：产出**可点但非 React** 的离线稿＝静态快照 + 一段约 4.1KB 的 vanilla shim（只重放卡头开合、文件行点击写日志、主题切换、长列表显隐）。**它不是水合**：没有 React 运行时 / 路由 / inspector，功能完整性仍须回 dev 路由看。
- `--with-react`：**已证伪，勿再试**。把 8 个 `<script src>`（12.4MB dev bundle）+ 1.2MB 动态 chunk 全量内联（9 个脚本、约 13.7MB）、脚本全部执行且零 http(s) 请求，React 仍报 `Expected server HTML to contain a matching <script> in <head>` → `Hydration failed` → 整根切客户端渲染；同一份文件换伪 http origin 也报同样错，说明根因是「水合后 `outerHTML` 再序列化」与 RSC 载荷对不上，不是 `file://` 协议。代码保留供复核，但不得再用这条路宣称「可交互定稿」。
- 产物与源码同源：改源码必须重跑导出，禁止手改产物 HTML（`git diff` 为空的产物不受信任）。

## 当前视图清单

见 `frontend/src/components/prototype/README.md`（五页面视图 + SillySpec 流程状态机）。
