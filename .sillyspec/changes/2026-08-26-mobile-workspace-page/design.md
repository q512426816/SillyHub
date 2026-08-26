---
author: qinyi
created_at: 2026-08-26 23:59:00
updated_at: 2026-08-26 23:59:00
scale: large
risk_level: unit-sufficient
modules: [frontend, prototype]
---

# 设计文档（Design）— 工作区移动端页面（变更中心 + 会话移植）

> 原型：`prototype-mobile-workspace.html`（8 屏可交互：工作区选择器 / 主页变更Tab /
> 变更详情 / 快速修复 / 会话列表 / 会话对话 / 新建会话两步 / 筛选抽屉。AI 紫主题，
> 390×844 手机壳，左侧导航切屏，用户已确认）。

生命周期契约：无/N/A——本变更纯前端 UI 移植：会话的 create / inject / interrupt /
end 等生命周期事件全部经既有 `frontend/src/lib/daemon.ts` API 与 SessionPanel 内核
既有逻辑触发，协议、字段、状态机零改动；本变更不新增、不修改任何生命周期事件。

## §1 背景

移动端骨架（`/m/` 路由段 + middleware UA 分流 + MobileAppShell + mobile 组件库）
已于 2026-07-22-mobile-app-ui / 2026-07-23-milestone-mobile 建成，PPM 四页 + 工作区
选择器可用；但 `m/workspaces/page.tsx:199` 明确门禁：「工作区详情及之后功能手机端
不渲染」，点卡片提示"请在电脑端打开"。

用户需求：把工作区的核心操作——**变更中心**与**会话**——移植到手机端页面。要求
复用核心组件（数据层/会话内核）、样式完全重做（移动竖屏卡片式，非桌面缩放）、
适配手机操作（触摸热区 ≥44px、底部抽屉、全屏钻取）。

桌面端现状（复用源）：
- 变更中心：`(dashboard)/workspaces/[id]/changes/**` 四层路由；数据层
  `lib/changes.ts`（listChanges / getChange / submitStageReview）+ `lib/tasks.ts` +
  `lib/quicklog.ts`，全部 react-query；详情子组件在 `components/changes/detail/`。
- 会话：`SessionsPortal`（623 行门户）+ `SessionListPanel`（2142 行树列表）+
  `SessionPanel`（4522 行内核，mode="page"/"dialog" 两形态，SSE 流式/消息队列/
  中断/子代理目录/上下文用量全内聚）；数据层 `lib/daemon.ts`。2026-08-25-unified-
  floating-session 已验证「一个内核 · N 宿主」模式（悬浮窗为第三宿主）。

## §2 设计目标

1. 手机 UA 访问 `/workspaces/[id]/**`（变更中心/会话）时获得原生移动页面，而非
   "请在电脑端打开"（middleware rewrite + 守卫已就绪，零基础设施改动）。
2. 变更中心核心版：列表（三 Tab/搜索/筛选/智能轮询）→ 详情（阶段条/审批操作/
   时间线/文档/日志）→ 文档全屏预览；审批可操作。
3. 会话完整内核：会话列表（分组卡片）+ SessionPanel 全功能复用（发消息/SSE 流式/
   中断/结束/消息队列/子代理目录等），仅重排样式适配竖屏。
4. 桌面零回归：`(dashboard)/**` 现有行为不变；SessionPanel 改动必须带桌面回归保障。
5. 样式完全重做：AI 紫双主题 token（brand-* 语义阶）、卡片式竖屏钻取，触摸热区
   ≥44px、正文 ≥14px、max-w-480px 容器（对齐既有 mobile 约束）。

## §3 非目标（不在范围内 / Non-Goals）

1. 任务看板与任务详情/执行页（`changes/[cid]/tasks/**`）移动端不做——D-002 核心版
   裁剪，详情页放"请到电脑端"引导条。
2. 不改后端：零 API/DTO/schema 改动（纯前端渲染层变更，`api-types.ts` 不需重新生成）。
3. 不改桌面端功能与布局（`(dashboard)/**` 渲染零改动；例外仅两处桌面共用组件
   `components/daemon/session-panel.tsx` 与 `components/sessions/pre-session-picker.tsx`
   各加一个可选 variant prop，默认值保持桌面行为；外加 `(dashboard)/…/changes/page.tsx`
   给既有模块私有常量 `PENDING_REVIEW_LABEL` 加 export 供移动端复用——纯导出，
   渲染零变化，同文件已有 isTerminalChange 等导出先例）。
4. 不做平板适配（平板 UA 走桌面，既有 D-005 决策不变）。
5. 不做工作区其它 16 个子 tab（文件/知识库/组件/explorer 等）的移动端——后续变更。
6. 不做 PWA 离线/推送/安装能力。
7. 不改 middleware 分流策略与 `MOBILE_TABS` 五 Tab 结构（平台切换 Tab 仍指向
   /workspaces，进入工作区后高亮不变）。

## §4 拆分判断

单变更而非拆多变更：变更中心与会话共享同一套入口改造（m/workspaces 解除门禁、
工作区主页导航壳、layout 钻取层识别），拆开会重复改同一批文件产生交叉冲突；
规模虽大但全部是同一架构模式（独立移动渲染层）的复制展开，风险集中在一个点
（SessionPanel variant），无跨模块 schema/协议耦合，适合作为一个 large 变更推进。

## §5 总体方案

### §5.1 路由结构（全部新增，middleware/守卫已就绪）

```
/m/workspaces/[id]/                     主页：redirect → /m/workspaces/[id]/changes
/m/workspaces/[id]/changes/             变更列表（= 主页 Tab①「变更中心」）
/m/workspaces/[id]/changes/[cid]/       变更详情（全屏钻取：隐藏底部 Tab）
/m/workspaces/[id]/sessions/            会话列表（= 主页 Tab②「会话」）
/m/workspaces/[id]/sessions/[sid]/      会话对话（SessionPanel 第四宿主，全屏钻取）
```

- 双 Tab 是两个真实路由（`/changes`、`/sessions`），非 query 参数——桌面分享链接
  rewrite 过来直接命中；顶栏段控（segmented）切换即路由跳转。
- 深链兼容：桌面 URL `/workspaces/123/changes/abc` 手机访问 → middleware rewrite
  `/m/workspaces/123/changes/abc` → 详情页直出；`/m/workspaces/[id]/changes`（无 cid，
  桌面是列表页）→ 列表页直出。桌面变更级/quicklog 级会话门户
  （`/changes/[cid]/sessions`、`/quicklog/[qlId]/sessions`）rewrite 后无对应移动页 →
  两条 redirect 薄壳兜底到会话列表（见 §9.4 X-02）。
- 守卫：`route-guard.ts` 已放行 `/workspaces/:id/**`（`route-guard.ts:96`
  `/^\/workspaces\/[^/]+/` 先判放行），零改动。

### §5.2 布局层级（Wave 1）

```
app/m/layout.tsx（已有，最小扩展）
  ├ 普通页：MobileAppShell（顶栏+内容+底部5Tab）——现状不变
  └ 钻取页（DRILL_ROUTES 正则命中 /workspaces/:id/changes/:cid、/workspaces/:id/sessions/:sid）：
    裸容器（max-w-480px flex-col，无底部 Tab）——页面自渲染返回顶栏
app/m/workspaces/[id]/layout.tsx（新增）
  └ 工作区上下文 Provider：getWorkspace 预取（react-query ["workspaces", id]），
    供子页共享（顶栏工作区名/在线状态），避免每页重复拉取
```

- `m/layout.tsx` 只加一个正则分支，既有 /m 页面（login/account/workspaces/ppm）路径
  不命中，零回归。
- 列表页保留底部 5 Tab（可回平台功能，"平台切换"高亮）；钻取页隐藏（沉浸 + 给
  输入条/时间线腾空间）。

### §5.3 变更中心（Wave 2）

**列表页 `changes/page.tsx`（移动版，自绘）**
- 数据层 100% 复用：`useQuery(["changes", workspaceId, 参数])` 同 key 结构 +
  `changesRefetchInterval` / `isTerminalChange` / `hasActiveChanges` 纯函数复用 +
  `["changesTabTotals"]` 计数。
- UI：三 Tab（进行中/已归档/快速修复，计数徽标）+ 搜索框 + 筛选（`MobileFilterDrawer`
  底部抽屉：阶段 + 只看待我处理）+ 变更卡片（变更名/阶段徽标/待办徽标
  `PENDING_REVIEW_LABEL` 映射复用/最近活动时间）。
- 快速修复 Tab：quicklog 卡片列表（`listQuicklogEntries` +
  `quicklogPollInterval` 复用）；详情用 `MobileDetailSheet` 全屏呈现（对齐原型，
  桌面 QuicklogDrawer 是 antd 右抽屉不适合手机）。
- 空态引导跳会话列表（对齐桌面 changes/page.tsx:443 行为）。

**详情页 `changes/[cid]/page.tsx`（移动版，自绘壳 + 内容组件评估复用）**
- 顶栏：返回 + 变更名 + ⋯ 菜单（重解析/复制变更名）。
- 阶段步骤条：横向滚动紧凑版（自绘——桌面 change-stage-header.tsx:70 是
  `flex flex-wrap`，390px 下六阶段折行拥挤，不适合直接复用）。
- 审批操作卡：默认展开、通过/驳回（`submitStageReview` 复用）；待办态驱动展示
  （`PENDING_REVIEW_LABEL` 映射复用）。
- 规范文档卡：文档 chip 列表 → `FilePreviewModal` 复用（2026-08-26-file-fullscreen-
  preview 已支持全屏态，天然适配手机）。
- 时间线/执行日志/关联会话/quicklog 关联：折叠卡（自绘 sec-card 模式）。
- 任务区：desktop-guide 引导条（D-002）。
- 桌面 `components/changes/detail/*` 复用准则：纯内容渲染（badge/文本/列表）直接
  复用；有 lg:grid/固定宽/桌面交互耦合的重绘移动版。逐组件在 execute 时按此准则
  落位并在 tasks 记录（X-03）。

### §5.4 会话（Wave 3）

**列表页 `sessions/page.tsx`（移动版，自绘）**
- 数据：自建 `useQuery(["agentSessions", "sessionsPortal", scope, 参数])` 同 key
  结构——数据函数用 `listAgentSessions` + workspace_id 过滤参（对齐
  session-list-panel.tsx:584 的 D-103 实现；注意**不是** `listWorkspaceAgentSessions`，
  后者无 limit/archived 参数、返回类型不同），limit=500 一次拉取客户端分组——与
  桌面门户共享 react-query 缓存与 invalidate 前缀，不复制请求逻辑进独立实现。
- UI：状态 Tab（全部/进行中/已归档）+ 机器分组卡片列表（在线/离线分组，机器名+
  在线点）；卡片：会话名/引擎/状态/最后活动；长按或卡上 ⋯ 菜单：删除/归档/取消
  归档（`deleteAgentSession`/`archiveAgentSession`/`unarchiveAgentSession` 复用，
  `MobileActionMenu` 承载）。
- 点击卡片 → `/m/workspaces/[id]/sessions/[sid]`。

**对话页 `sessions/[sid]/page.tsx`（SessionPanel 第四宿主）**
- 直接渲染 `<SessionPanel key={sid} mode="page" sessionId={sid} machines={…}
  llmProviders={…} onSessionListRefresh={…} />`，用法对齐 floating-session-host.tsx:307
  （第三宿主）；`key={sid}` 重挂载清 SSE/队列契约由路由参数天然保证。
- 页面级数据（machines 15s 轮询 / llmProviders 30s staleTime）与悬浮宿主同源同 key。

**新建会话（移动两步浮层）**
- 顶栏 ＋ 按钮 → 预会话流程复用：`PreSessionPicker` 组件本体复用（受控组件、零数据
  请求，pre-session-picker.tsx:41 props：open/machines/onCancel/onPick），加
  `variant?: "center" | "bottomSheet"`（默认 center 保持桌面）——bottomSheet 仅改
  容器定位类为底部抽屉（对齐原型），两步逻辑零分叉。
- 选定 runtime → 移动版进入预会话对话页（`/sessions/new?runtime=…` 或列表页内
  preContext 状态切对话视图）：渲染 `<SessionPanel sessionId={null} preContext={…}
  onPreSessionCreated={切真会话路由} />`——首句 createSession 后 `router.replace`
  到 `/sessions/[sid]`（key 变化自然接管，对齐门户 handlePreSessionCreated 语义）。

**SessionPanel 移动适配（本变更唯一触碰桌面共用文件的点）**
- `SessionPanelProps` 新增 `variant?: "desktop" | "mobile"`（默认 "desktop"，全部
  既有调用点不传 → 行为零变化）。
- mobile 分支仅做：布局类调整（面板 padding/圆角/满宽）、头部次要 chrome 收纳
  （机器/provider 徽标与低频按钮收进 ⋯ 菜单）、输入条贴底适配
  （100dvh + 键盘避让）、TurnTimeline 内横向内容（表格/代码块）横向滚动容器。
- 核心逻辑零分叉：SSE 建流（streamSession）、断线 resync、消息队列
  （useMessageQueue）、中断/结束/重开、装配器全部共用同一条代码路径；variant 只
  影响渲染层 className 与次要 UI 的显隐收纳。

### §5.5 样式与交互规范（对齐 FRONTEND_PAGE_STYLE.md 与既有 mobile 组件）

- 主题：双主题 token（blue/ai-native/dark，brand-* 语义阶 + shadow token），移动页
  全部用语义 token，不写死色值；antd ConfigProvider 既有注入不动。
- 复用 mobile 基础件：`MobileCardList`（泛型卡片列表模式）、`MobileFilterDrawer`、
  `MobileDetailSheet`、`MobileActionMenu`、`MobileTopBar`；不足处新增移动组件放
  `components/mobile/`。
- 触摸热区 ≥44px、正文 ≥14px、`h-[100dvh]` + `max-w-[480px]`。
- 交互模式：列表 → 全屏钻取（左上返回）；筛选/新建 → 底部抽屉；危险操作（删除/
  结束会话）→ MobileActionMenu 二次确认。
- 防漂移锚点：改 m/layout.tsx 时同步其头部 R-10 注释锚；改 SessionPanel 时保持
  mode/variant 双维度正交（mode=宿主形态，variant=视口样式）。

### §5.6 既有文件最小改动清单（桌面零回归面）

| 文件 | 改动 | 回归保障 |
|---|---|---|
| `app/m/layout.tsx` | 加 DRILL_ROUTES 正则分支（裸容器） | 既有 /m 路径不命中；既有测试补正则用例 |
| `app/m/workspaces/page.tsx` | 卡片点击 message.info → router.push（:199） | 既有测试**新增**门禁移除后的导航断言（现 page.m-workspaces.test.tsx 仅覆盖筛选/创建，无门禁断言） |
| `(dashboard)/workspaces/[id]/changes/page.tsx` | 给模块私有常量 `PENDING_REVIEW_LABEL`（:63）加 `export`（纯导出，渲染零变化；同文件已有 isTerminalChange 等导出先例） | 既有测试全绿即证 |
| `components/sessions/pre-session-picker.tsx` | 加 variant prop（默认 center） | 桌面调用点零改动 + 既有测试 |
| `components/daemon/session-panel.tsx` | 加 variant prop（默认 desktop） | 桌面零改动 + 既有测试 + 新增 mobile 快照/交互测试 |

## §6 文件变更清单（File Changes）

> 纯前端渲染层变更，无对外字段/DTO/接口 payload 变更，无需数据流标注；
> `api-types.ts` / `openapi.json` 零改动（无 gen:types 需求）。

| 操作 | 路径（frontend/ 内，相对仓根） | 说明 |
|---|---|---|
| 新增 | src/app/m/workspaces/[id]/layout.tsx | 工作区上下文 Provider（getWorkspace 预取） |
| 新增 | src/app/m/workspaces/[id]/page.tsx | 主页 redirect → /changes |
| 新增 | src/app/m/workspaces/[id]/changes/page.tsx | 变更列表移动版（三Tab/搜索/筛选/卡片/quicklog Tab） |
| 新增 | src/app/m/workspaces/[id]/changes/[cid]/page.tsx | 变更详情移动版（钻取） |
| 新增 | src/app/m/workspaces/[id]/sessions/page.tsx | 会话列表移动版（分组卡片+新建入口+预会话态） |
| 新增 | src/app/m/workspaces/[id]/sessions/[sid]/page.tsx | 会话对话（SessionPanel 第四宿主，钻取） |
| 新增 | src/app/m/workspaces/[id]/changes/[cid]/sessions/page.tsx | X-02 深链兜底：redirect → /m/workspaces/[id]/sessions |
| 新增 | src/app/m/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx | X-02 深链兜底：redirect → /m/workspaces/[id]/sessions |
| 新增 | src/components/mobile/mobile-workspace-header.tsx | 返回+工作区名+段控双Tab（两列表页复用） |
| 新增 | src/components/mobile/mobile-change-card.tsx | 变更/quicklog 卡片（阶段/待办徽标映射复用） |
| 新增 | src/components/mobile/mobile-change-detail.tsx | 详情区块组（阶段条/审批/折叠卡；自绘壳） |
| 新增 | src/components/mobile/mobile-session-list.tsx | 会话分组卡片列表（同 key query + 分组） |
| 修改 | src/app/m/layout.tsx | DRILL_ROUTES 正则 → 裸容器分支 |
| 修改 | src/app/m/workspaces/page.tsx | :199 门禁改 router.push |
| 修改 | src/app/(dashboard)/workspaces/[id]/changes/page.tsx | PENDING_REVIEW_LABEL（:63）加 export（Grill C-10） |
| 修改 | src/components/sessions/pre-session-picker.tsx | variant?: "center"\|"bottomSheet"（默认 center） |
| 修改 | src/components/daemon/session-panel.tsx | variant?: "desktop"\|"mobile"（默认 desktop），mobile 仅渲染层 |
| 新增 | 对应 __tests__/*.test.tsx（就近 colocate） | 见 §8 测试策略 |
| 修改 | src/lib/auth/route-guard.test.ts 等 | 仅当正则/守卫行为变化补用例（守卫本身零改动，预期不加） |

## §7 接口定义

```ts
// components/daemon/session-panel.tsx（扩展）
export interface SessionPanelProps {
  mode: "page" | "dialog";              // 既有
  variant?: "desktop" | "mobile";       // 新增，默认 "desktop"；仅影响渲染层样式
  sessionId: string | null;             // 既有
  machines?: DaemonMachineRead[];       // 既有
  llmProviders?: LlmProviderRead[];     // 既有
  onSessionListRefresh?: () => void;    // 既有
  preContext?: SessionPreContext;       // 既有
  onPreSessionCreated?: (r: SessionCreateResponse) => void; // 既有
  pageContextOverride?: …;              // 既有
}

// components/sessions/pre-session-picker.tsx（扩展）
export interface PreSessionPickerProps {
  variant?: "center" | "bottomSheet";   // 新增，默认 "center"
  open: boolean; machines: DaemonMachineRead[];
  onCancel: () => void; onPick: (runtimeId: string) => void;  // 既有
}

// components/mobile/mobile-workspace-header.tsx（新增）
export function MobileWorkspaceHeader(props: {
  workspace: Workspace;                  // m/workspaces/[id]/layout 预取注入
  tab: "changes" | "sessions";           // 当前段控高亮
  onTabChange: (t: "changes" | "sessions") => void;  // → router.push 对应路由
  onBack: () => void;                    // → /m/workspaces
})

// components/mobile/mobile-session-list.tsx（新增）
export function MobileSessionList(props: {
  workspaceId: string;
  onSelect: (sessionId: string) => void;             // → /sessions/[sid]
  onNew: () => void;                                  // → PreSessionPicker(bottomSheet)
})
// 数据：listAgentSessions + workspace_id 过滤参（对齐 session-list-panel.tsx:584），
// useQuery key ["agentSessions","sessionsPortal",scope,{limit:500,archived,…}]
// 与 SessionListPanel 同构（D-103 语义），共享缓存与 invalidate 前缀。

// components/mobile/mobile-change-card.tsx（新增）
export function MobileChangeCard(props: {
  change: ChangeSummary; onClick: () => void;
})   // 阶段徽标/待办徽标（PENDING_REVIEW_LABEL 复用）/相对时间

// components/mobile/mobile-change-detail.tsx（新增）
export function MobileChangeDetail(props: {
  changeId: string; workspaceId: string;
  onOpenSession: () => void;             // 关联会话卡 → 会话列表
})   // 内部 useQuery getChange + 审批 submitStageReview + FilePreviewModal
```

## §8 数据模型

无。零 DB 表结构、零 OpenAPI schema、零 api-types 变更。

## §9 兼容策略（brownfield）

1. **桌面零回归**：`(dashboard)/**` 路由/组件零渲染改动；SessionPanel /
   PreSessionPicker 新 prop 全部带桌面默认值，既有调用点不传行为不变；改动文件
   配既有测试回归 + 新增 mobile 分支测试。
2. **未登录/未选工作区**：`/m/workspaces/[id]/**` 走既有 useMobileRouteGuard
   （登录守卫 → /m/login；工作区守卫已放行 /workspaces/:id/**）。
3. **桌面 UA 访问 /m/ 路径**：middleware 只做手机 UA → /m rewrite，不做反向；
   桌面直接访问 /m/** 会得到移动页（现状既有行为，本变更不改变）。
4. **深链回退（X-02）**：`/m/workspaces/[id]/changes/[cid]/sessions`（桌面变更级
   会话门户）与 `/m/workspaces/[id]/quicklog/[qlId]/sessions` 无移动页 → §6 清单
   两条 redirect 薄壳页兜底重定向到 `/m/workspaces/[id]/sessions`（会话列表）；
   scope 信息丢失可接受——手机端会话列表本身就是全工作区视图。
5. **回退路径**：如移动页出问题，用户可用桌面 UA（平板/PC）访问同 URL 获得桌面页；
   移动页面群是纯新增文件，revert 不影响桌面。

## §10 风险登记（Risk Register）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SessionPanel 4522 行桌面 chrome 耦合度未知，variant 改造量超预期（头部按钮/时间线内布局） | P0 | Wave 3 首个任务先通读渲染层做耦合清单（execute 时产出），mobile 分支只动 className/收纳不改逻辑；若耦合过深降级为「mobile 壳组件包 SessionPanel + CSS 覆盖」，逻辑零触碰 |
| R-02 | 手机锁屏/切后台 SSE 长连接断开，重连风暴或消息丢失 | P1 | `streamSession`（lib/daemon.ts:1216）已有断线指数退避 + resync 增量回放（底层 fetch-sse.ts 只管传输不自动重连，重连语义在 streamSession 层）；真机实测重连正确性；页面 visibilitychange 时不主动断流（复用既有行为） |
| R-03 | SessionListPanel 数据逻辑内嵌 2142 行组件，移动列表自建 query 可能与桌面 key/参数漂移 | P1 | key 结构逐字对齐（["agentSessions","sessionsPortal",scope,{…}]）并在两侧测试中锁 key 形态；X-04 若发现可低成本提取 hook 则提取（不复制请求实现） |
| R-04 | 详情子组件复用准则（纯内容复用/布局耦合重绘）执行时主观漂移 | P2 | tasks 中逐组件列落位决定（复用/重绘），X-03 清单随任务产出供 verify 对账 |
| R-05 | antd 弹层类组件（Select/Modal/Popover）在 480px 体验差 | P2 | 移动页优先原生交互（底部抽屉/原生列表）；antd 仅用无布局耦合纯控件；SessionPanel 内既有 antd 弹层经 variant 收纳或保留（桌面同款） |
| R-06 | 手机键盘弹出挤压 100dvh 布局（对话输入条被遮） | P1 | 100dvh + 输入条 fixed 贴底 + visualViewport 兜底（既有 mobile 页无输入场景，本变更首次引入，需真机验证）；prototype 已按贴底形态设计 |
| R-07 | 变更列表智能轮询在手机后台标签页持续请求耗电 | P2 | 复用 changesRefetchInterval 语义；react-query 默认后台窗口失焦不轮询（既有行为），不做额外改动 |

## §11 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@V1 渲染层策略：独立移动渲染层（方案 A） | accepted | §5 全节；§6 清单（桌面文件仅 4 处最小改动） |
| D-002@V1 变更中心核心版（任务看板不做） | accepted | §3 非目标 1；§5.3 引导条 |
| D-003@V1 会话完整内核（SessionPanel 全功能复用） | accepted | §5.4 对话页；§7 variant 定义 |
| D-004@V1 主页+双Tab 导航 | accepted | §5.1 路由；mobile-workspace-header |

未解决：无（四决策均已用户拍板）。剩余风险见 §10。

## §12 测试策略

- 就近 colocate `__tests__/*.test.ts(x)`，vitest + testing-library，仅跑本次相关
  测试（CLAUDE.md 规则 0）。
- 纯函数：m/layout 钻取正则（命中/不命中既有页）、变更卡片徽标映射、会话分组。
- 组件：变更列表（tab 切换/筛选抽屉/卡片点击导航/quicklog 轮询函数）、详情
  （审批提交/文档预览打开/折叠交互）、会话列表（分组/新建入口/菜单操作）、对话页
  （SessionPanel 透传 props/key 重挂载）。
- 桌面回归：SessionPanel/PreSessionPicker 既有测试文件全绿 + 新增「不传 variant
  时 className 与 desktop 一致」用例；m/workspaces 测试**新增**门禁移除后的导航断言
  （既有 page.m-workspaces.test.tsx 无门禁断言，Grill C-17）。

## §14 Design Grill 修订记录（2026-08-27）

独立审查（review-2026-08-27-000028，specVerdict/qualityVerdict 均 pass，无 P0）后
修订 3 个 P1 + 6 个 P2：
- C-08/UB-3（P1）：会话列表数据函数 `listWorkspaceAgentSessions` → `listAgentSessions`
  + workspace_id（后者无 limit/archived 参数、返回类型不同，缓存语义也对不齐）。
  已改 §5.4/§7。
- C-10/UB-2（P1）：`PENDING_REVIEW_LABEL`（changes/page.tsx:63 模块私有）复用不可
  实现 → 本变更为其加 `export`（纯导出零渲染变化，同文件有导出先例）。已改
  §3.3/§5.6/§6。
- C-11/UB-1（P1）：X-02 深链兜底无实现文件 → §6 补两条 redirect 薄壳
  （changes/[cid]/sessions、quicklog/[qlId]/sessions → 会话列表）。
- C-02：route-guard 行号 :105 → :96。
- C-12：§6 移除 mobile-app-shell.tsx 自相矛盾行（裸容器在 m/layout 分支实现，
  该文件零改动）。
- C-13：§3.3「唯一例外」措辞改为三处例外（session-panel / pre-session-picker 加
  variant + changes/page.tsx 加 export）。
- C-14：R-02 应对依据改为 streamSession（daemon.ts:1216）层重连语义，fetch-sse
  仅传输层不自动重连。
- C-15：change-stage-header 实为 flex-wrap（无 lg:），自绘理由改为 390px 折行拥挤。
- C-17：m/workspaces 测试为「新增导航断言」而非「更新既有断言」。
- 真机/移动视口手测清单（verify 阶段执行，Playwright 移动视口可选）：键盘避让、
  SSE 断线重连、文档全屏预览、双主题切换。

## §13 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 章节齐全（背景/目标/非目标/总体/清单/接口/兼容/风险/决策/自审） | ✅ |
| 生命周期关键词命中（session）→ 已写紧邻豁免短语「生命周期契约：无/N/A」 | ✅ |
| 文件清单含前端文件且达必须生成原型级别 → prototype-mobile-workspace.html 已存在并经用户确认 | ✅ |
| decisions.md 四决策全部被 §11 引用 | ✅ |
| 桌面零回归路径明确（4 个修改文件的回归保障逐个列在 §5.6） | ✅ |
| 数据流标注：无对外字段变更，无需标注 | ✅ |
| ⚠️ 自审存疑 1：SessionPanel variant 的实际耦合面要等 Wave 3 首任务通读后才能定（R-01 已登记，含降级方案） |
| ⚠️ 自审存疑 2：quicklog 详情用 MobileDetailSheet 还是复用 QuicklogDrawer 改 placement，execute 时按实现成本定（倾向前者，原型即此形态） |
| ⚠️ 自审存疑 3：新建会话预会话态放列表页内还是独立 /sessions/new 路由，execute 时定（倾向列表页内状态切换，少一个路由文件；§5.4 已写两选项语义一致） |
