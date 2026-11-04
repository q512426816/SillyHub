# 决策知识 — app-mobile-pages

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-app-mobile-pages-001@v1 2026-10-14-logout-full-reload-clear-cache——根因：两处主动登出（桌面 `frontend/src/components/app-shell.tsx` 的 `performLogout`、移动 `front
状态：implemented
变更：2026-10-14-logout-full-reload-clear-cache
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-logout-full-reload-clear-cache/design.md
文件：frontend/src/app/m/account/page.test.tsx, frontend/src/app/m/account/page.tsx, frontend/src/components/__tests__/app-shell.test.tsx, frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx, frontend/src/components/app-shell.tsx
最近确认：未记录
理由：根因：两处主动登出（桌面 `frontend/src/components/app-shell.tsx` 的 `performLogout`、移动 `frontend/src/app/m/account/page.tsx` 的 `handleLogout`）只清 session token 后用 `router.replace` 在 SPA 内跳回登录页——`QueryClient`（`frontend/src/lib/providers.tsx` 经 `useState(() => makeQueryClient())` 每次整页加载才新建）与内存态 zustand store（`stores/workspace.ts` 当前工作区、`stores/kanban.ts` 看板、`stores/floating-session.ts` 悬浮会话壳态）全部存活，换账号登录后下一个用户直接看到上一用户的缓存数据。查询 key 全部是资源 id 维度、不含用户 id（`lib/query-keys.ts`），同一 QueryClient 跨用户必然串数据。 修法：两处登出跳转从 `router.replace` 改为 `window.location.assign` 整页跳转，对齐既有 401 被动登出先例（`frontend/src/lib/api.ts` 401 分支的 `window.location.href = "/login"`）。整页销毁使 QueryClient、全部 zustand store、SSE 连接、模块级缓存机制性重置——一处改动覆盖全部缓存面，未来新增内存 store 也不会漏。选整页跳转而非逐面清缓存（`queryClient.clear()` + 逐 store reset）的理由：枚举式清理靠人记，本次问题正是枚举漏网的产物；且 SSE/模块级闭包缓存难以穷尽。

## D-app-mobile-pages-002@v1 2026-10-14-logout-localstorage-user-data-cleanup——上变更（2026-10-14-logout-full-reload-clear-cache）整页跳转解决了内存缓存串台，但 localStorage 持久层跨登
状态：implemented
变更：2026-10-14-logout-localstorage-user-data-cleanup
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-logout-localstorage-user-data-cleanup/design.md
文件：docs/sillyspec/tests-redomain-from-prefix-doubling.md, frontend/src/app/m/account/page.test.tsx, frontend/src/app/m/account/page.tsx, frontend/src/components/__tests__/app-shell.test.tsx, frontend/src/components/app-shell.tsx, frontend/src/lib/__tests__/logout-storage.test.ts, frontend/src/lib/api.ts, frontend/src/lib/logout-storage.ts
最近确认：未记录
理由：上变更（2026-10-14-logout-full-reload-clear-cache）整页跳转解决了内存缓存串台，但 localStorage 持久层跨登录残留：评审 P3 实证 6 类按 sessionId/groupId 索引的用户域键（会话草稿含用户输入内容、群聊草稿、视图模式、群打开锚点、活性状态、未读标记）在换账号后原样留存，B 用户可看到 A 用户的草稿、未读徽标错乱。 修法：新建 `frontend/src/lib/logout-storage.ts`——用户域键以**前缀注册表**集中声明（本文件为唯一键清单源，新增用户域键只改注册表），导出 `clearUserScopedLocalStorage()`（遍历 localStorage 匹配前缀删除，全程 try/catch 容错不阻断登出）。三条登出路径在整页跳转前调用：桌面 `app-shell.tsx` performLogout finally、移动 `m/account/page.tsx` handleLogout finally、`lib/api.ts` 401 单飞失败分支（上变更只改了主动登出，401 被动登出的 localStorage 残留本变更一并覆盖）。不改既有键名（改键丢现有数据且改动面大），设备级键不进注册表即天然保留。 用户域前缀注册表（FR-01 清查结论，全部实测自源码键定义）： | 前缀 | 来源 | 内容 | | --- | --- | --- | | `sillyhub.sessions.draft.` | components/daemon/session-panel/turn-state.ts（sessionDraftLsKey，含 `__pre__` 预会话变体） | 单聊会话草稿（用户输入内容） | | `sillyhub.sessions.viewMode.` | components/daemon/session-panel/turn-state.ts（viewModeLsKey） | 会话视图模式（按 sessionId 索引） | | `sillyhub.groupchats.draft.` | components/group-chat/group-chat-panel.tsx（groupDraftLsKey） | 群聊草稿（用户输入内容） | | `sillyhub-group-last-open-` | lib/group-unread.ts（groupLastOpenKey） | 群「上次打开」锚点（未读计算基准） | | `sillyhub:liveness-state:` | hooks/use-session-liveness.ts（STATE_KEY_PREFIX） | 会话活性状态机 prevState | | `sillyhub:liveness-unread:` | hooks/use-session-liveness.ts（UNREAD_KEY_PREFIX） | 未读标记 | 设备级保留面（不进注册表即保留，FR-01 二分结论）：`sillyhub-theme`（主题）、`multi-agent-platform.session`（session persist，登出 clear() 已置空）、登录页记住登录名/平台键（REMEMBER_KEY/PLATFORM_KEY，「记住我」跨登录语义）、侧边栏折叠（app-shell COLLAPSED_KEY）、输入框高度（session-input-bar/group-chat-panel 共用 INPUT_HEIGHT_LS_KEY）、浮球位置（BALL_STORAGE_KEY）、宠物形象（PET_STORAGE_KEY）、各面板宽度（explorer/knowledge/scan-docs/portal-file-panels）、会话页详情面板开合（SESSIONS_DETAIL_PANEL_LS_KEY）、会话树分组折叠/展开态/筛选（sillyhub-group-section-collapsed、sillyhub.sessions.tree.expansion、sillyhub.sessions.tree.filter——2026-10-14 独立评审 P3 补列）、新建会话默认机器（`sillyhub.sessions.new.machineId`——同 `sillyhub.sessions.` 命名空间但按完整键名存储、机器列表全平台共享，注册表用带尾分隔符的精确前缀不会误删）。
