---
author: flow-machine-draft
created_at: 2026-10-16T13:17:35.194Z
---
# 设计记录（Design Record）— 2026-10-16-change-center-back-keeps-list-state

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两层修复，互为兜底：

1. **列表页状态 URL 化**（`changes/page.tsx`）：挂载时从 `useSearchParams` 初始化全部筛选
   /分页 state（扩展现有 `?tab=`/`?search=` 深链先例到 page/pageSize/stage/lineage/mine/
   sort）；状态变化时用**原生 `window.history.replaceState`** 把 querystring 写回 URL。
   选原生 API 而非 `router.replace` 的原因：不产生历史条目、不触发 RSC 导航请求（React
   Query queryKey 与 URL 无关，UI 状态仍以 useState 为单一源，URL 只是恢复快照）。
2. **详情页返回入口改为「返回」语义**（`changes/[cid]/page.tsx`）：breadcrumb「变更列表」
   与错误态「← 变更列表」统一换 `BackToListLink` 小组件——`window.history.length > 1` 时
   `preventDefault + router.back()`（回带 query 的列表 URL，配合①从 URL 恢复状态）；无历史
   可退（新标签深链）时保持 Link 默认导航。href 始终保留（新标签打开语义不变）。

为什么不全靠 `router.back()`（不加①）：back 恢复列表状态目前依赖 bfcache（行点击是整页
导航），bfcache 被弃用/禁用时（如带 WebSocket 连接、内存压力）back 后列表整页重载，状态
仍丢——①让状态恢复不依赖 bfcache。为什么不全靠①（返回入口不变）：客户端导航回带 query
的列表 URL 需要详情页知道来路 query（详情页无从得知），back 是唯一能拿到「离开时 URL」的
通道。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `changes/page.tsx`：新增模块级纯函数 `buildChangesQuery(state): string`（构造 querystring，
  默认值/空值省略）与 `parsePositiveInt(v, fallback)`（防御解析）；组件新增挂载初始化（从
  searchParams 读 page/pageSize/stage/lineage/mine/sort）与写回 useEffect。无后端/接口变化。
- `changes/[cid]/page.tsx`：新增内部组件 `BackToListLink({ workspaceId, className,
  children })`（渲染 `<Link href=/workspaces/<id>/changes>` + 可后退时 onClick
  `router.back()`）；两处返回入口（breadcrumb :351 / 错误态 :322）替换为该组件。对外可见
  DOM 仍是 `<a>`（测试 `getByText`/`getByRole("link")` 兼容）。
- 无 API 端点、无 api-types、无 daemon 变化（gen:types 义务不触发）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：写回 useEffect 以 state 值为依赖、构造目标串与 `location.pathname +
   location.search` 比较，相同即跳过——连续快速翻页（ antd Pagination 连点）每次 effect
   只写最终值，replaceState 幂等，无乱序窗口；React Query queryKey 不含 URL，写回不触发
   请求竞态。
2. 并发写：多标签页各自独立 history 与 state，replaceState 只动本标签 URL，无跨页写冲突；
   列表页自身 UI 状态单一源是 useState，URL 写入是单向快照（不从 URL 反向订阅），无双源
   漂移面（挂载后不读 searchParams 更新）。
3. 切换/生命周期：quicklog 深链 tab（enabled=false 不发主请求）同样参与写回，URL 反映
   `tab=quicklog`；详情页内切 tab 用 router.replace（不增历史条目，现有实现），back 目标
   始终是进详情前的列表条目；浏览器后退/前进回列表条目时组件重挂载从 URL 初始化，state
   与 URL 一致——bfcache 恢复（JS state 完整）与整页重载（从 URL 重建）两条路径结果一致。
4. 作用域：URL 写回带 workspaceId 路径段（`/workspaces/<id>/changes`），跨工作区路由切换
   时组件按 Next 路由 key 重挂载重新初始化，不串台；sessionStorage 类跨页隐式状态方案
   （多标签污染）已规避。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **风险①（已知取舍）**：`history.length > 1` 判定在「从站外页点链接进详情」场景会
  back 回站外页——内部工具场景罕见，且符合浏览器标准「返回」语义；Next 14.2.5 的
  history.state 无可靠栈深标记（idx 为 Next 15+ 字段），无法精确判定「上一条是否本站」，
  接受该取舍。
- **风险②**：原生 replaceState 后浏览器「后退」退出列表（不回溯列表内翻页历史）——与
  改造前行为一致（useState 翻页本就不产生历史条目），非行为退化；URL 与 UI 的瞬时不一致
  仅出现在列表页内按浏览器后退的瞬间（随即整页离开列表），用户实证范围内不可见。
- **死路 A（放弃）**：router.replace 写回——每次翻页触发 RSC 导航请求（页面是 server
  component 树根），快速翻页产生请求风暴且可能互相竞态。
- **死路 B（放弃）**：sessionStorage 记「最后列表 URL」——多标签页隐式共享面、SSR hydration
  需要挂载后二次渲染切 href，复杂度高于收益。
- **死路 C（放弃）**：详情页 URL 反向携带列表 query——污染详情 URL（分享/收藏语义脏），
  且从工作区首页等非列表入口进详情时无 query 可带。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 状态 URL 化：挂载初始化 + replaceState 写回 + 防御解析纯函数 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 新增 BackToListLink；breadcrumb 与错误态返回入口替换 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | mock 补 replaceState 兼容；新增 URL 初始化/写回用例 |
| 新增 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx | 详情页返回入口 back/兜底行为断言 |
