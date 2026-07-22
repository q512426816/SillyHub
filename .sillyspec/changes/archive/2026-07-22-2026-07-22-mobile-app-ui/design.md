---
author: qinyi
created_at: 2026-07-22 22:13:51
updated_at: 2026-07-22 22:30:00
scale: large
---
# 设计文档（Design）— 移动端 App UI（PPM + SillyHub 工作区）

> 本文档已经过 Design Grill 交叉审查（review.json: specVerdict/qualityVerdict 初判 fail → 已按用户决策修正）。修正要点：D-002@v1 的「服务端读 cookie 防 FOUC」前提为假（layout 是 client component），已升级为 D-002@v2 的 **middleware rewrite 到独立 `/m/` 移动路由段**；功能范围按 D-008「尽量全做」扩展。见 §11 决策追踪。

## 1. 背景

现有前端（`frontend/`，Next.js 14 App Router + antd v6 + Tailwind + CSS 变量 + React Query + Zustand）按**桌面后台**设计。原始样式系统变更 `2026-06-21-frontend-style-system` 的 `design.md` §3 曾把「响应式移动端适配」列为**非目标**（理由：后台桌面为主）。

实际使用场景已扩展到手机端，用户需要在手机上使用 PPM（个人工作台、计划任务、问题清单）与 SillyHub 工作区选择页（`/workspaces`）。当前手机端**完全不可用**，核心阻塞（均经 Design Grill 源码核验属实）：

- `components/app-shell.tsx`（417 行，client component）：固定侧边栏 `w-[260px]` + 主内容 `ml-[260px]`，**无移动端分支**。
- `(dashboard)/layout.tsx` 为 **client component**（含 usePathname/useEffect 登录与工作区守卫）——这决定了不能在它里面服务端读 cookie（见 D-002@v2）。
- **无断点系统**：`styles/tokens.ts` 无 breakpoint，`tailwind.config.ts` 未自定义 `screens`。
- PPM 四页（workbench/task-plans/problem-list/workspaces）数据获取为**手动 `useEffect+useState+lib/*` fetch**（非 React Query hooks）——Design Grill 核验。
- 表格/Modal/搜索区全为桌面假设；业务代码零 `useMediaQuery`。

经两轮对话探索 + 需求澄清 + Design Grill，确认方向：**独立移动 App UI + middleware rewrite 自动分流**，是对原「移动端非目标」决策的方向性反转。

## 2. 设计目标

- 手机端（≤768px）提供独立 App UI，覆盖 PPM 三页 + workspaces + 移动外壳 + 移动登录页，且**功能与桌面对齐**（D-008：新建/编辑/导出/批量删除/执行/详情/别名/工作区创建绑定全支持）。
- 同一 URL，**middleware 服务端按 UA rewrite** 到 `/m/` 移动路由段，**彻底无 FOUC**（D-002@v2）；用户地址栏 URL 不变。
- **数据层 100% 复用**：复用现有数据获取层（`lib/*` API 函数、Zustand stores、OpenAPI 类型），仅 UI 独立。
- **桌面端完全零回归**：`app/(dashboard)/**`、`app-shell.tsx`、`(auth)/login` 全部不动。
- 底部 5 Tab 移动导航。

## 3. 非目标

- ❌ 其他页面的移动版：runtimes / settings / admin / changes / agent-run 等（手机访问维持桌面版，后续迭代）。
- ❌ SillyHub 工作区详情及其后续功能（changes/spec 等）：手机端进入时提示「请在电脑端打开」（D-006）。**但** workspaces 列表页本身的功能（选择/切换/创建/绑定/别名）按 D-008 全做。
- ❌ 暗色模式（当前未启用）。
- ❌ 平板（768~1024px）：走桌面 web UI（D-005）。
- ❌ 后端任何改动。

## 4. 拆分判断

- **不拆分多个变更**：内聚的「移动 App UI」改造，非 3+ 独立模块、无多角色、无跨页状态流转。
- **不走批量模式**：各页移动视图策略不同（工作台卡片流 vs 列表卡片 vs 工作区卡片），非「模板 × 数据」。
- 单变更按 Phase 渐进交付。

## 5. 总体方案

采用 **middleware rewrite + 独立 `/m/` 移动路由段 + 数据层复用**（D-002@v2，Design Grill 修正后的方案）。

### 5.1 设备分流（middleware rewrite，防 FOUC）—— D-002@v2

- 新增 `frontend/src/middleware.ts`：matcher 匹配目标页面（`/ppm/*`、`/workspaces`、`/login` 等），读请求 UA，移动设备时 `NextResponse.rewrite(new URL('/m' + pathname, req.url))`。
- **服务器端即定型**：手机请求一进来就被 rewrite 到 `/m/...`，直接渲染移动路由，**无任何 FOUC**。
- 用户地址栏 URL 不变（rewrite 不改地址栏）→ 符合 D-002「同一 URL」原意。
- 桌面 UA 不 rewrite，照常走 `(dashboard)` / `(auth)` 路由。
- UA 检测失败/异常（爬虫等）默认不 rewrite（走桌面），避免误判。
- 客户端组件**无需**做首屏设备判断（在 `/m/` 路由段里即为移动）；如移动组件内部需感知横屏等，用 `matchMedia` 轻量 hook。

### 5.2 移动外壳（独立 layout）

- 新增 `app/m/layout.tsx`：移动外壳（`MobileAppShell` = 移动顶栏 + 内容区 + 底部 TabBar）+ **登录守卫**：新建 `lib/auth/route-guard.ts` 实现移动端守卫（基于 `(dashboard)/layout.tsx` 现有 useSession/工作区白名单语义），`(dashboard)/layout.tsx` **保持不动**（桌面零回归）；route-guard 行为用单测镜像桌面守卫语义 + 注释锚点防漂移。
- 桌面 `(dashboard)/layout.tsx` 与 `app-shell.tsx` **完全不动**。

### 5.3 移动页面（独立路由段）—— D-001

- 移动页面置于 `app/m/`：
  - `app/m/ppm/workbench/page.tsx`
  - `app/m/ppm/task-plans/page.tsx`
  - `app/m/ppm/problem-list/page.tsx`
  - `app/m/workspaces/page.tsx`
  - `app/m/login/page.tsx`（移动登录页）
- 各移动 page 复用桌面页面的**数据获取逻辑**（`lib/*` 函数 + stores + 类型），仅渲染层独立。
- 桌面 `app/(dashboard)/**` page.tsx 不动（零回归）。

### 5.4 移动导航 —— D-004

- `components/mobile/mobile-tab-bar.tsx`：底部 5 项（工作台/计划任务/问题清单/我的/平台切换），导航到对应路径（手机访问会被 middleware 自动 rewrite 到 `/m/` 版）。

### 5.5 列表与全功能（MobileCardList + 配套）—— D-007 + D-008

- 通用 `components/mobile/mobile-card-list.tsx` 替代 antd Table，接口承载全功能（见 §7）：
  - 卡片主体 + `actions`（动作集：编辑/删除/执行/别名…）
  - `selectable` + 批量栏 `mobile-batch-bar.tsx`（批量删除）
  - `pagination`（对接现有 page/page_size，**不用无限滚动**）
  - `headerActions`（创建/导出入口：`mobile-export-button.tsx`）
- 新建/编辑/别名/工作区创建绑定：`mobile-detail-sheet.tsx`（全屏表单/Modal，承载表单）。
- 筛选：`mobile-filter-drawer.tsx`（顶部按钮唤起抽屉，替代桌面 `grid-cols-4`）。

### 5.6 数据层复用 —— D-003（B-02 修正）

- 移动 page 复用现有**数据获取层**：`lib/*` API 函数（当前 4 页用的手动 fetch 封装）、Zustand stores、OpenAPI 生成类型。
- 禁止移动视图自写请求；按各页实际机制（多数为 `lib/*` 函数）调用，与桌面同源。

### 5.7 Phase 划分（plan 阶段细化为 Wave/Task）

- **Phase 0 基础设施**：`middleware.ts`（UA rewrite）+ `app/m/layout.tsx`（外壳+守卫）+ `app/m/login` + 断点 token。
- **Phase 1 移动组件库**：MobileAppShell/TabBar/TopBar + 通用件（MobileCardList 全功能/FilterDrawer/DetailSheet/ActionMenu/BatchBar/ExportButton）。
- **Phase 2 工作台移动**：卡片流 + 全功能。
- **Phase 3 计划任务移动**：卡片列表 + 新建/编辑/导出/批量/执行/详情。
- **Phase 4 问题清单移动**：同 Phase 3 模式。
- **Phase 5 workspaces 移动**：列表 + 创建/绑定/别名；工作区详情之后提示电脑端（D-006）。
- **Phase 6 收尾**：`FRONTEND_PAGE_STYLE.md` 增「移动端 App UI」章节 + 验收。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/middleware.ts` | UA 检测 + rewrite 到 `/m/`，防 FOUC（D-002@v2） |
| 新增 | `frontend/src/app/m/layout.tsx` | 移动外壳 + 登录守卫（复用现有守卫逻辑） |
| 新增 | `frontend/src/app/m/login/page.tsx` | 移动登录页 |
| 新增 | `frontend/src/app/m/ppm/workbench/page.tsx` | 工作台移动视图 |
| 新增 | `frontend/src/app/m/ppm/task-plans/page.tsx` | 计划任务移动视图 |
| 新增 | `frontend/src/app/m/ppm/problem-list/page.tsx` | 问题清单移动视图 |
| 新增 | `frontend/src/app/m/workspaces/page.tsx` | 工作区选择移动视图 |
| 新增 | `frontend/src/components/mobile/mobile-app-shell.tsx` | 移动外壳 |
| 新增 | `frontend/src/components/mobile/mobile-tab-bar.tsx` | 底部 5 Tab |
| 新增 | `frontend/src/components/mobile/mobile-top-bar.tsx` | 移动顶栏 |
| 新增 | `frontend/src/components/mobile/mobile-card-list.tsx` | 通用卡片列表（全功能，替代表格） |
| 新增 | `frontend/src/components/mobile/mobile-filter-drawer.tsx` | 筛选抽屉 |
| 新增 | `frontend/src/components/mobile/mobile-detail-sheet.tsx` | 全屏表单（新建/编辑/别名/工作区创建绑定） |
| 新增 | `frontend/src/components/mobile/mobile-action-menu.tsx` | 卡片动作集 |
| 新增 | `frontend/src/components/mobile/mobile-batch-bar.tsx` | 批量选择删除 |
| 新增 | `frontend/src/components/mobile/mobile-export-button.tsx` | 导出 Excel |
| 新增 | `frontend/src/lib/auth/route-guard.ts` | 移动端路由守卫（task-03，镜像桌面守卫，桌面不改） |
| 新增 | `frontend/src/middleware.test.ts` | middleware 单测 |
| 新增 | `frontend/src/lib/auth/route-guard.test.ts` | route-guard 单测 |
| 新增 | `frontend/src/components/mobile/mobile-card-list.test.tsx` | MobileCardList 单测 |
| 新增 | `frontend/src/components/mobile/mobile-tab-bar.test.tsx` | MobileTabBar 单测 |
| 新增 | `frontend/src/app/m/layout.test.tsx` | layout 单测 |
| 修改 | `frontend/src/styles/tokens.ts` | 新增 `breakpoint` token |
| 修改 | `frontend/src/lib/__tests__/query-client.test.ts` | 预存债修复：同步 react-query v2 staleTime 15000（D-002@v2，解锁 ci-check hook） |
| 修改 | `backend/app/modules/change/dispatch.py` | 预存债修复：ruff UP033 lru_cache→functools.cache |
| 修改 | `backend/app/modules/admin/router.py` | 预存债修复：ruff format |
| 修改 | `backend/app/modules/agent/service.py` | 预存债修复：ruff format |
| 修改 | `backend/app/modules/runtime/service.py` | 预存债修复：ruff format |
| 修改 | `backend/app/modules/ppm/problem/tests/test_problem_flow.py` | 预存债修复：ruff format |
| 文档 | `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md` | 新增「移动端 App UI」章节，更新原「非目标」条款 |

**明确不动（桌面零回归）**：`app/(dashboard)/**`、`app/(auth)/login/page.tsx`、`components/app-shell.tsx`、`top-bar.tsx`、`components/layout/**`、后端全部。B-04（改名 WebAppShell）因改用独立路由段方案而**消解**——无需改名 app-shell。

## 7. 接口定义

均为前端内部契约（无后端接口变更）：

```ts
// components/mobile/mobile-card-list.tsx（泛型，全功能替代表格）
interface MobileCardListProps<T> {
  items: T[]
  renderCard: (item: T) => ReactNode
  onItemPress?: (item: T) => void                       // 进入详情
  actions?: (item: T) => MobileAction[]                  // 卡片动作集（编辑/删除/执行/别名…）
  selectable?: boolean                                   // 批量选择模式
  selectedKeys?: string[]
  onSelectedKeysChange?: (keys: string[]) => void
  pagination?: { page: number; pageSize: number; total: number; onChange: (p: number) => void }  // 对接现有 page/page_size
  headerActions?: ReactNode                              // 创建/导出/批量入口
}
interface MobileAction { key: string; label: string; danger?: boolean; onPress: () => void }

// components/mobile/mobile-detail-sheet.tsx（新建/编辑/别名/工作区创建绑定）
interface MobileDetailSheetProps { open: boolean; title: string; onClose: () => void; children: ReactNode; onSubmit: () => void; loading?: boolean }

// components/mobile/mobile-filter-drawer.tsx
interface MobileFilterDrawerProps { open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; onApply: () => void; onReset?: () => void }
```

## 8. 数据模型

**无后端数据模型变更**。前端复用现有 OpenAPI 类型与 `lib/*` 数据获取函数；不新增/修改任何数据库表、migration、API 端点。

## 9. 兼容策略（brownfield）

- **桌面端完全零回归**：所有桌面文件不动；桌面 UA 不 rewrite，渲染产物与当前完全一致。
- **回退路径**：middleware 未命中/UA 异常 → 不 rewrite → 走桌面；用户直接访问 `/m/...` 也渲染移动版（`/m/` 路由存在），无死链。
- **登录守卫一致性**：`app/m/layout.tsx` 用新建 `lib/auth/route-guard.ts` 守卫，`(dashboard)/layout.tsx` 保持不动（桌面零回归）；route-guard 单测镜像桌面守卫行为 + 注释锚点防漂移（R-10）。
- **不改变**：后端 `/api/*` 全部端点、数据库表结构、桌面 AppShell/折叠/localStorage、现有 antd 主题。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SSR 首屏 FOUC | P2（已大幅缓解） | middleware 服务端 rewrite 定型，从根本上无 FOUC；residual：middleware matcher 漏配的路径回退桌面 |
| R-02 | 设备误判（桌面被 rewrite 到移动） | P1 | UA 异常/失败默认不 rewrite；仅移动 UA + ≤768 语义判定 |
| R-03 | 移动视图与桌面数据不一致 | P2 | 强制复用同一 `lib/*` 数据层，禁止自写请求（D-003） |
| R-04 | 触摸热区/字号偏小 | P2 | 最小触摸目标 44×44px，正文 ≥14px |
| R-05 | 平板边界抖动 | P2 | UA + 宽度判定，平板走桌面 |
| R-07 | middleware 全路由开销 | P2 | matcher 精确限定目标页面，排除静态资源 |
| R-08 | **全功能工作量大**（D-008） | P1 | plan 充分拆 Wave，通用组件（CardList/DetailSheet/ActionMenu/BatchBar/Export）先行，各页复用 |
| R-09 | middleware UA 检测库选型/维护 | P2 | 用轻量 UA 正则或 `ua-parser-js`，plan 阶段定 |
| R-10 | 移动/桌面登录守卫逻辑漂移 | P2 | 移动端独立 route-guard + 单测镜像桌面守卫行为 + 注释锚点（桌面不改，保零回归） |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖章节 / FR | 状态 |
|---|---|---|---|
| D-001@v1 | 独立 App UI（非响应式） | §5.3 / FR-01,FR-02 | accepted |
| D-002@v1 | ~~自动检测 + 服务端读 cookie~~ | — | **superseded by D-002@v2** |
| D-002@v2 | middleware rewrite 到 `/m/` 移动路由段，URL 不变，真防 FOUC | §5.1 / FR-01 | accepted |
| D-003@v1 | 数据层共享，UI 独立 | §5.6 / FR-08 | accepted |
| D-004@v1 | 底部 5 Tab | §5.4 / FR-02 | accepted |
| D-005@v1 | 仅手机 ≤768px | §3 / FR-01 | accepted |
| D-006@v1 | SillyHub 仅 workspaces 列表（详情提示电脑端） | §3 / FR-07 | accepted |
| D-007@v1 | 表格改卡片列表 | §5.5 / FR-05,FR-06 | accepted |
| D-008@v1 | 手机端功能尽量全做（与桌面对齐） | §5.5/§5.7 / FR-04~07 | accepted |

全部当前版本决策（D-001/D-002@v2/D-003~008）已被设计章节覆盖，无未解决 P0/P1 blocker。详见 `decisions.md` 与 `review.json`。

## 12. 自审（Design Grill 修正后复审）

- **章节齐全**：背景/目标/非目标/拆分/总体方案/文件清单/接口/数据模型/兼容/风险/决策追踪/自审 全具备 ✓
- **生命周期契约表**：不涉及 session/lease/agent_run/daemon/lifecycle 等关键词 → 省略 ✓
- **B-01（P0）已修正**：D-002@v2 middleware rewrite 替代不可行的 cookie 方案，layout 边界问题消除 ✓
- **B-02 已修正**：§5.6 措辞改为「现有数据获取层（lib/* 函数）」，与源码一致 ✓
- **B-03 已修正**：§5.5 MobileCardList 接口扩展承载全功能 + §3 明确功能边界（D-008 全做） ✓
- **B-04 已消解**：独立路由段方案无需改名 app-shell，零回归成立 ✓
- **桌面零回归强化**：`app/(dashboard)/**`、app-shell、login 全不动（优于原方案的「改名」）✓
- ⚠️ **交 plan 阶段细化**：
  1. middleware matcher 精确范围（哪些路径 rewrite、登录页如何处理、`/m/` 直接访问兜底）。
  2. ~~移动/桌面登录守卫公共函数的抽取点~~ 已定（方案 b）：移动端独立 `lib/auth/route-guard.ts`，不抽取/不改桌面 layout，单测镜像桌面守卫 + 注释锚点（见 §5.2/§9/R-10）。
  3. UA 检测库选型（正则 vs ua-parser-js）。
  4. 各列表页功能在移动视图的具体承载（哪些动作进 ActionMenu、哪些进详情页），plan 结合各页实际字段定。
- 复审通过，可进入「用户确认并生成规范文件」。
