---
author: qinyi
created_at: 2026-07-22 22:13:51
---
# 决策台账（Decisions）— 移动端 App UI

本次变更 `2026-07-22-mobile-app-ui` 的实现/验收决策记录。仅记有实现影响的决策，闲聊与低风险偏好不录入。长期术语在 archive/scan 时再提升到 `glossary.md`。

## D-001@v1: 移动端形态为独立 App UI 模块（非响应式自适应）
- type: architecture
- status: accepted
- source: user
- question: 移动端是「同一套代码做响应式自适应」还是「独立开发一套移动 App UI，靠设备判断切换」？
- answer: 独立开发一套移动 App UI（新模块），通过浏览器/设备类型判断决定显示 web UI 还是 app UI。不是响应式微调。
- normalized_requirement: 移动端界面为独立组件树，与桌面 web UI 并存；不由现有桌面组件加 @media 自适应得来。
- impacts: [FR-01, FR-02, design §5 总体方案, design §6 文件变更清单]
- evidence: 对话探索第 1 轮（表格策略问题，用户选「独立开发新模块」）
- priority: P0

## D-002@v1: 设备切换采用自动检测，同一 URL
- type: architecture
- status: superseded
- source: user
- question: 手机和电脑访问同一网址时如何决定显示哪套界面？
- answer: 自动检测设备，同一 URL 手机自动显示 app UI、电脑显示 web UI。不用单独网址，不用手动切换按钮。
- normalized_requirement: 同一路由路径下，按设备自动渲染对应 UI；服务端读 UA 写 cookie 防首屏闪烁（FOUC）；URL 不分叉。
- impacts: [FR-01, design §5 设备检测, design R-01]
- evidence: 对话探索第 2 轮（切换方式问题）
- priority: P0

## D-003@v1: 数据层共享，仅 UI 独立
- type: architecture
- status: accepted
- source: user
- question: 移动界面与桌面界面背后的接口调用、登录信息是否共用？
- answer: 只界面分开，数据共用。接口调用、登录、数据格式完全复用现有层。
- normalized_requirement: 移动视图禁止自写数据请求；必须复用现有数据获取层（`lib/*` API 函数 / Zustand stores / OpenAPI 类型）与登录态。注：4 个目标页面现为 `lib/*` 手动 fetch（非 React Query hooks，见 design §5.6 / B-02 修正）。
- impacts: [FR-08, design §5 数据层复用, design R-03]
- evidence: 对话探索第 2 轮（数据共用问题）
- priority: P0

## D-004@v1: 移动导航为底部 5 个 Tab
- type: architecture
- status: accepted
- source: user
- question: 手机端全局导航（桌面是左侧边栏）用什么形态？底部放哪几个入口？
- answer: 底部 Tab 栏；放 PPM 四件套 + 平台切换 = 5 个：工作台、计划任务、问题清单、我的、平台切换。
- normalized_requirement: MobileAppShell 含底部 TabBar，固定 5 项：工作台(/ppm/workbench)、计划任务(/ppm/task-plans)、问题清单(/ppm/problem-list)、我的、平台切换（切到 /workspaces）。
- impacts: [FR-02, design §5 MobileTabBar]
- evidence: 对话探索第 1 轮（导航形态）+ 第 2 轮（底部 Tab 内容）
- priority: P0

## D-005@v1: 设备范围仅手机（≤768px），平板及以上走桌面
- type: boundary
- status: accepted
- source: user
- question: 移动端适配面向哪些设备？
- answer: 仅手机（≤768px）。平板（768~1024px）及以上维持桌面 web UI。
- normalized_requirement: isMobile 判定阈值 ≤768px；≥769px 一律渲染桌面版。
- impacts: [FR-01, design §3 非目标, design R-05]
- evidence: 对话探索第 1 轮（设备范围）
- priority: P1

## D-006@v1: SillyHub 手机端仅 workspaces 列表，详情提示去电脑端
- type: boundary
- status: accepted
- source: user
- question: 手机底部「平台切换」切到 SillyHub 平台后，手机端做到哪一步？
- answer: 只到工作区列表（浏览/选择/切换当前工作区）。选了工作区后的详情、变更中心等功能提示去电脑端打开。
- normalized_requirement: workspaces 移动视图只实现工作区卡片列表与切换；工作区详情及其后续页面（changes/spec/runtimes 等）本次不做移动版，进入时提示「请在电脑端打开」。
- impacts: [FR-07, design §3 非目标]
- evidence: 需求澄清 Grill（SillyHub 范围问题）
- priority: P0

## D-007@v1: 手机端表格统一改为卡片列表
- type: architecture
- status: accepted
- source: user
- question: PPM 表格在手机窄屏怎么处理？
- answer: 独立 App UI 语境下，手机端不再用 antd Table，改为卡片列表（每行一卡片）。
- normalized_requirement: 计划任务、问题清单等列表型页面在移动视图使用通用 MobileCardList 组件渲染卡片，不复用桌面 antd Table；卡片展示关键字段 + 状态 + 操作入口。
- impacts: [FR-05, FR-06, design §5 MobileCardList, design §6 文件清单]
- evidence: 对话探索第 1 轮（表格策略）+ D-001 独立 App UI 推论
- priority: P1

## D-002@v2: 防 FOUC 采用 middleware rewrite 到独立移动路由段
- type: architecture
- status: accepted
- supersedes: D-002@v1
- source: design-grill + user
- question: Design Grill 验证发现 `(dashboard)/layout.tsx` 是 client component，D-002@v1 设想的「服务端读 cookie 防 FOUC」前提为假（client component 不能调 `cookies()`）。改用何种方案真正防 FOUC？
- answer: 用 Next.js middleware 读 UA，移动设备 `NextResponse.rewrite()` 到独立移动路由段（`/m/...`），**服务器端即定型**，手机请求一进来就渲染移动路由，彻底无 FOUC。用户地址栏 URL 不变（rewrite 不改地址栏），符合 D-002「同一 URL」原意。
- normalized_requirement: 新增 `src/middleware.ts`，matcher 匹配目标页面路由，移动 UA 时 rewrite `${pathname}` → `/m${pathname}`；移动页面置于 `app/m/` 独立路由段，自带 `app/m/layout.tsx`（移动外壳 + 登录守卫）；不再依赖 cookie 或客户端 useIsMobile 做首屏判断。
- impacts: [FR-01, FR-02, design §5.1/§5.2/§5.3/§6/§10 R-01]
- evidence: review.json X-01/B-01；用户选「服务器端按设备分流」
- priority: P0

## D-008@v1: 手机端功能尽量全做（与桌面对齐）
- type: boundary
- status: accepted
- source: user
- question: 手机端要不要支持新建/编辑、导出 Excel、批量删除、执行任务、进详情、编辑别名、创建/绑定工作区等操作？
- answer: 尽量全做——手机端支持上述全部操作，与桌面端功能对齐。
- normalized_requirement: MobileCardList / 移动视图须承载：创建入口、编辑（Modal 或全屏表单）、导出、批量选择删除、执行任务、进入详情、别名编辑、工作区创建与绑定；分页对接现有 page/page_size（不用无限滚动）。对应各桌面页面的功能在移动视图都要有等价入口。
- impacts: [FR-04, FR-05, FR-06, FR-07, design §5.5 MobileCardList 接口扩展, §5.7 Phase, §10 R-08]
- evidence: 用户在 Design Grill 选「尽量全做」
- priority: P1
