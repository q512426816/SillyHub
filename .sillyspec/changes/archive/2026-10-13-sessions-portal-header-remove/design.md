---
author: flow-machine-draft
created_at: 2026-10-13T08:48:58.467Z
---
# 设计记录（Design Record）— 2026-10-13-sessions-portal-header-remove

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户诉求：智能体会话四入口（/sessions、/workspaces/[id]/sessions、…/changes/[cid]/sessions、…/quicklog/[qlId]/sessions）页头的「智能体会话 · 后缀」标题 + 「跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建」副标题占掉一段高度，去掉该块、让下方分栏占满屏幕。

改一处（`frontend/src/components/sessions/sessions-portal.tsx`）：原 `<PageHeader title={portalTitle} subtitle=… actions={<GitStatusBar variant="compact"/>}/>` 整块退役，换成

1. `<h1 className="sr-only">{portalTitle}</h1>` —— 标题降级为视觉零占位的隐藏一级标题（Tailwind sr-only＝绝对定位 1px 裁切，仍在可访问性树内）：读屏仍有页面标题，四 scope 后缀文案（· 工作区 / · 变更 / · 快速修复 · <qlId>）继续可断言；页容器 `aria-label={portalTitle}` 原样保留；
2. 副标题文案整句删除（用户点名的目标对象，DOM 中不再出现）；
3. workspace scope 的紧凑态 Git 状态条（2026-08-26-workspace-git-status CC-08 功能件，非标题文案）保留：容纳点由「PageHeader actions 槽」改为独立右对齐紧缩一行 `flex shrink-0 justify-end`，仅该 scope 渲染（change/quicklog/全局零渲染语义不变）；
4. 分栏行补 `data-testid="sessions-portal-panes"`（类名链不变：`flex min-h-0 flex-1 gap-3 overflow-hidden`），供高度链契约断言。

页容器仍是 `h-[calc(100vh-64px)] gap-3 py-4`（TopBar h-16=64px 锚定，未动）：页头块（h1 text-2xl + 副标题行 + 容器 gap）退役后，分栏行 `flex-1` 直接吃掉腾出的整段高度，即「占满屏幕」。

为何保留 sr-only 标题而不是彻底删掉：① 该页是路由页，此前 h1 即页面标题，删掉会丢无障碍一级标题；② 四条既有「scope 标题后缀」断言可原样继续当回归面，不必为「视觉移除」缩小语义覆盖。为何 Git 状态条不随标题一起删：它是功能件（工作区健康状态 + 悬停展开全量细节），用户只针对标题文案；一并删除是未经要求的功能回归。

顺手修正的存量测试债：`page.test.tsx` 的附件引用 token 断言仍是 `【截图.png】`，而 2026-10-12-ws-ref-emoji-inline 起 token 已内嵌类型 emoji（`【📎 截图.png】`，见 `lib/attachment-refs.ts` buildRefToken）——该断言在基线 HEAD 即红，与本变更无关（属本次触达文件的邻居用例；仓库惯例：暴露的旧测试债顺手修好，CLAUDE.md §21）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无对外签名 / 端点 / 命令 / 文件格式变化：`SessionsPortalProps`（scope 判别联合）零变化；四路由薄壳与页面文件零改动；后端零改动。
- DOM 契约变化仅一处区域：页面根容器（PageContainer，保留 `aria-label={portalTitle}`）内不再渲染 PageHeader（无 `header` 元素、无副标题文案）；`h1` 由可见变 `sr-only`（语义保留）；新增 `data-testid="sessions-portal-panes"` 静态属性。
- 新增（本变更证据物，非产品代码）：`.sillyspec/changes/2026-10-13-sessions-portal-header-remove/render-sessions-portal.mjs` —— 真页渲染取证脚本（Playwright + `**/api/**` route mock + 登录态 localStorage 注入），复跑命令见 visual-evidence.md。

### 文件变更清单（自声明）

- frontend/src/components/sessions/sessions-portal.tsx
- frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
- frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx

（每行的角色/说明一律写在本节之外——declared-face 路径行裸写，规避括号注记污染：
docs/sillyspec/flow-diff-declared-face-paren-pollution.md。）

角色说明：门户组件（页头块退役 + sr-only 标题 + Git 条独立行 + 分栏 testid + 过时注释修正）；门户单测（新增「页头标题块移除」用例 + 两处过时注释修正）；/sessions 冒烟（页标题语义用例文案对齐 + 附件 token 存量断言修正）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

1. 乱序/迟到到达：不适用——纯同步渲染的静态布局/文案改动，无事件顺序假设；机器/会话数据到达早晚只影响分栏内部内容，不影响页头块在否与高度链。
2. 并发写：不适用——无共享可变态新增，h1/sr-only/Git 行/分栏 testid 均为纯派生静态渲染。
3. 切换/生命周期：安全——四 scope 走同一 JSX 分支；会话切换（key 重挂载）、进/出预会话、群/会话互切、文件模式切换均不触碰本块；Git 状态条挂载仅由 `scope.kind === "workspace"` 决定（与选中态无关），取数沿 useGitLogStatus staleTime 60s 不变。
4. 作用域：无串台面——改动在门户壳层，四入口共用同一组件；Git 条仍只挂 workspace scope（CC-08 不变）；sr-only 标题文案按 scope 参数化（后缀语义不变）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险①：后续有人把 sr-only 改成 `hidden`/`display:none` 之类，标题会从可访问性树消失（等于删标题）——单测以 `toHaveClass("sr-only")` 锁形态。
- 风险②：高度链回归（有人给分栏行去 `flex-1`、或给标题块加回可见占位）——`sessions-portal-panes` 类名契约（flex-1 + min-h-0）与容器 `h-[calc(100vh-64px)]` 断言兜住。
- 风险③：workspace scope 顶部仍留一行 ≈26px 的紧凑 Git 条（保留功能件的代价，非回归）；用户若要求该 scope 也彻底全屏，属新诉求（可后续把 Git 条移入左栏头或折叠）。
- 放弃的方案：a) 整块删 PageHeader 且不留标题——丢无障碍一级标题 + 四处 scope 标题断言（回归面缩小）；b) Git 状态条一并删——未经要求的功能回归；c) Git 条塞进左栏面板头——左栏自有 📁/筛选控件，语义错位、改动面扩大；d) 用 `hidden` 隐藏标题——可访问性树同步丢失，即 a 的变体。
- 存量债风险：`page.test.tsx` 的 emoji token 断言修正属「测试跟随已交付实现」而非「改测试掩盖实现错误」——实现侧 token 形态由 2026-10-12-ws-ref-emoji-inline 交付且另有专门用例覆盖。
