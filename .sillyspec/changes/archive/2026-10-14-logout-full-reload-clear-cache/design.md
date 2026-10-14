---
author: flow-machine-draft
created_at: 2026-10-14T02:34:28.807Z
---
# 设计记录（Design Record）— 2026-10-14-logout-full-reload-clear-cache

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：两处主动登出（桌面 `frontend/src/components/app-shell.tsx` 的 `performLogout`、移动 `frontend/src/app/m/account/page.tsx` 的 `handleLogout`）只清 session token 后用 `router.replace` 在 SPA 内跳回登录页——`QueryClient`（`frontend/src/lib/providers.tsx` 经 `useState(() => makeQueryClient())` 每次整页加载才新建）与内存态 zustand store（`stores/workspace.ts` 当前工作区、`stores/kanban.ts` 看板、`stores/floating-session.ts` 悬浮会话壳态）全部存活，换账号登录后下一个用户直接看到上一用户的缓存数据。查询 key 全部是资源 id 维度、不含用户 id（`lib/query-keys.ts`），同一 QueryClient 跨用户必然串数据。

修法：两处登出跳转从 `router.replace` 改为 `window.location.assign` 整页跳转，对齐既有 401 被动登出先例（`frontend/src/lib/api.ts` 401 分支的 `window.location.href = "/login"`）。整页销毁使 QueryClient、全部 zustand store、SSE 连接、模块级缓存机制性重置——一处改动覆盖全部缓存面，未来新增内存 store 也不会漏。选整页跳转而非逐面清缓存（`queryClient.clear()` + 逐 store reset）的理由：枚举式清理靠人记，本次问题正是枚举漏网的产物；且 SSE/模块级闭包缓存难以穷尽。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `AppShell.performLogout`（frontend/src/components/app-shell.tsx）：跳转方式变化 `router.replace("/login")` → `window.location.assign("/login")`；函数签名、`/api/auth/logout` 调用、`useSession.clear()` 时序不变。
- 移动端 `handleLogout`（frontend/src/app/m/account/page.tsx）：跳转方式变化 `router.replace("/m/login")` → `window.location.assign("/m/login")`；`logout()`（lib/auth）调用与时序不变。
- 无后端 API、OpenAPI schema、前端接口类型（api-types.ts）变化，不需 gen:types。
- 桌面端 `useRouter` 随登出跳转改动失去唯一调用点，已连 import 一并删除；移动端 `router` 保留（`push("/m/workspaces")` 等其它导航仍走 SPA）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/app-shell.tsx | 桌面端 performLogout 登出跳转改整页 `window.location.assign("/login")`，删除失去唯一调用点的 useRouter |
| 修改 | frontend/src/components/__tests__/app-shell.test.tsx | 补登出整页跳转用例（assign 断言 + router.replace 零调用）；nav mock 改可断言 hoisted 对象 |
| 修改 | frontend/src/app/m/account/page.tsx | 移动端 handleLogout 登出跳转改整页 `window.location.assign("/m/login")` |
| 修改 | frontend/src/app/m/account/page.test.tsx | 补登出整页跳转用例（同上口径） |
| 修改 | frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx | 顺手修既有 TS 债 `calls[0]?.[2]`（与本变更行为无关，typecheck 全绿所需） |

注：上表 5 文件均为本变更交付（frontend/src/components/app-shell.tsx 系本变更核心交付文件，非他侧声明——已按 flow done 归属提示在此自声明）。backend 三文件（seed.py/main.py/test_profile_seed.py）为并行会话 2026-10-14-agent-profile-express-preset 的未提交 WIP，与本变更无关，不在本变更面。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：两处登出均先 `await` 登出 POST（桌面 `fetch`、移动 `logout()`）再在 `finally` 里跳转，POST 完成或失败都先落定再跳；POST 失败时本地 token 已清，残留服务端会话由既有 token 生命周期兜底，不受跳转方式影响。跳转引发的页面卸载不会产生「跳转后又收到旧数据回写」的乱序——页面已销毁。
2. 并发写：多标签页场景下两页同时登出，各自整页跳转互不干扰；session store 的 zustand persist 落盘（写 localStorage）在跳转前同步完成，storage 事件回放机制（stores/session.ts）不因本次改动变化。
3. 切换/生命周期：整页跳转等于页面生命周期终结，登出中途关标签页/断网与现状风险面一致（token 已在 `clear()` 时落盘清除）；登录页作为全新文档加载，hydrated 标记由 onRehydrateStorage 重新置位。
4. 作用域：被清的缓存全部是「当前登录用户」作用域（工作区/会话/看板），整页重置后不存在跨用户串台。localStorage 中的 UI 偏好（主题 sillyhub-theme、输入框高度、浮球位置、宠物形象）设计上就是设备级全局偏好、不分会话用户，本次有意保留不清。**披露缺口补记（2026-10-14 独立评审 P3）**：localStorage 另有按 sessionId/groupId 索引的会话草稿、群聊草稿、未读锚点、会话活性状态（turn-state.ts / group-chat-panel.tsx / use-session-liveness.ts / group-unread.ts）登出后同样残留——非本次引入（401 先例与改动前的 SPA 登出同样不清）、无服务端数据风险（后端权限校验兜底、id 为随机 UUID 难撞车），本轮不扩面清理，留独立任务统一治理。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：整页跳转比 SPA 跳转多一次完整文档加载（HTML/JS 重取，浏览器缓存可摊薄），登出是低频操作且 401 被动登出长期就是这个行为，体验一致性与数据正确性优先，可接受。放弃方案 A：登出时 `queryClient.clear()` + 逐个 reset 内存 store——需要 app-shell 拿到 QueryClient 并枚举所有 store，覆盖面靠人工维护，未来新增 store 即漏（本次 bug 正是此类漏网），且组件内闭包/SSE 状态仍难穷尽；放弃方案 B：给全部 query key 加用户维度——改动面遍历全站 hook，且不解决非 QueryClient 的内存 store 串台，收益/成本倒挂。
