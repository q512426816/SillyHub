---
author: flow-machine-draft
created_at: 2026-10-14T02:52:48.814Z
---
# 设计记录（Design Record）— 2026-10-14-logout-localstorage-user-data-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

上变更（2026-10-14-logout-full-reload-clear-cache）整页跳转解决了内存缓存串台，但 localStorage 持久层跨登录残留：评审 P3 实证 6 类按 sessionId/groupId 索引的用户域键（会话草稿含用户输入内容、群聊草稿、视图模式、群打开锚点、活性状态、未读标记）在换账号后原样留存，B 用户可看到 A 用户的草稿、未读徽标错乱。

修法：新建 `frontend/src/lib/logout-storage.ts`——用户域键以**前缀注册表**集中声明（本文件为唯一键清单源，新增用户域键只改注册表），导出 `clearUserScopedLocalStorage()`（遍历 localStorage 匹配前缀删除，全程 try/catch 容错不阻断登出）。三条登出路径在整页跳转前调用：桌面 `app-shell.tsx` performLogout finally、移动 `m/account/page.tsx` handleLogout finally、`lib/api.ts` 401 单飞失败分支（上变更只改了主动登出，401 被动登出的 localStorage 残留本变更一并覆盖）。不改既有键名（改键丢现有数据且改动面大），设备级键不进注册表即天然保留。

用户域前缀注册表（FR-01 清查结论，全部实测自源码键定义）：

| 前缀 | 来源 | 内容 |
| --- | --- | --- |
| `sillyhub.sessions.draft.` | components/daemon/session-panel/turn-state.ts（sessionDraftLsKey，含 `__pre__` 预会话变体） | 单聊会话草稿（用户输入内容） |
| `sillyhub.sessions.viewMode.` | components/daemon/session-panel/turn-state.ts（viewModeLsKey） | 会话视图模式（按 sessionId 索引） |
| `sillyhub.groupchats.draft.` | components/group-chat/group-chat-panel.tsx（groupDraftLsKey） | 群聊草稿（用户输入内容） |
| `sillyhub-group-last-open-` | lib/group-unread.ts（groupLastOpenKey） | 群「上次打开」锚点（未读计算基准） |
| `sillyhub:liveness-state:` | hooks/use-session-liveness.ts（STATE_KEY_PREFIX） | 会话活性状态机 prevState |
| `sillyhub:liveness-unread:` | hooks/use-session-liveness.ts（UNREAD_KEY_PREFIX） | 未读标记 |

设备级保留面（不进注册表即保留，FR-01 二分结论）：`sillyhub-theme`（主题）、`multi-agent-platform.session`（session persist，登出 clear() 已置空）、登录页记住登录名/平台键（REMEMBER_KEY/PLATFORM_KEY，「记住我」跨登录语义）、侧边栏折叠（app-shell COLLAPSED_KEY）、输入框高度（session-input-bar/group-chat-panel 共用 INPUT_HEIGHT_LS_KEY）、浮球位置（BALL_STORAGE_KEY）、宠物形象（PET_STORAGE_KEY）、各面板宽度（explorer/knowledge/scan-docs/portal-file-panels）、会话页详情面板开合（SESSIONS_DETAIL_PANEL_LS_KEY）、会话树分组折叠/展开态/筛选（sillyhub-group-section-collapsed、sillyhub.sessions.tree.expansion、sillyhub.sessions.tree.filter——2026-10-14 独立评审 P3 补列）、新建会话默认机器（`sillyhub.sessions.new.machineId`——同 `sillyhub.sessions.` 命名空间但按完整键名存储、机器列表全平台共享，注册表用带尾分隔符的精确前缀不会误删）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `frontend/src/lib/logout-storage.ts`：导出 `USER_SCOPED_LS_PREFIXES: readonly string[]`（注册表）与 `clearUserScopedLocalStorage(): void`（遍历删除，容错）。无网络、无 store 依赖（纯 localStorage 操作，lib 层无循环依赖）。
- `app-shell.tsx` performLogout：finally 内 `clear()` 后、`window.location.assign("/login")` 前插入清理调用；其余行为不变。
- `m/account/page.tsx` handleLogout：同样在 finally 跳转前插入。
- `lib/api.ts` 401 单飞失败分支：`useSession.getState().clear()` 后、`window.location.href = "/login"` 前插入。
- 无后端 API、OpenAPI、api-types.ts 变化，不需 gen:types。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：清理在登出 POST 完成后、跳转前同步执行；跳转引发的页面卸载后不存在「旧页回写」——已销毁。边缘：登出 POST 在途时用户在别的输入框继续打字产生新草稿写入？写入发生在清前则被清（符合登出语义），清后则随页面卸载丢弃，无残留路径。
2. 并发写：多标签页——A 页登出清 localStorage，共享存储立即对 B 页生效，B 页正被编辑的草稿会丢；这是登出语义的正确行为（B 页的 session 也已被 storage 事件同步清空、终将被踢回登录页）。清理本身单线程同步遍历，无并发写冲突。
3. 切换/生命周期：清理发生在「当前登录会话终结」时点，三处调用点都紧邻既有 clear()（token 清除）之后，时序上一致——先清凭证再清用户数据，失败路径（POST reject）走 finally 仍执行。storage 异常被容错吞掉不阻断跳转，最坏残留与现状等价（不劣于改前）。
4. 作用域：注册表前缀全部带尾分隔符（`.`/`-`/`:`），精确到命名空间段，不存在跨域误删（如 `sillyhub.sessions.new.machineId` 不匹配 `sillyhub.sessions.draft.`）。非本仓写入的同名键若存在（第三方扩展），按前缀命中即删——可接受，该命名空间 `sillyhub` 为本应用专属。401 分支挂载后，「无 401 也可能调用清理」的场景不存在（仅单飞失败即会话终结路径触发）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：前缀注册表漏掉未来新增的用户域键（枚举式固有的漏网风险——与上变更放弃方案 A 同型）。缓解：键清单集中一处且有本测试钉住存量 6 前缀，新增键时注册表是唯一需要动的地方；已知取舍是接受「未来键需自觉登记」而非引入命名空间强约束（改造全部读写点收益/成本倒挂）。放弃方案 B：统一用户域键命名空间前缀（如 `sillyhub:user.*`）——需改 6 个文件的全部读写点+旧键迁移清理，收益只是「前缀扫描永不漏」，且改键会导致现有用户草稿/未读状态丢失，不值；放弃方案 C：在 logout-storage 里顺带清 session persist 键——session store 的 clear() 已负责（persist 落盘空值），双份清理引入「谁是真的清空者」歧义，不碰。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/lib/logout-storage.ts | 用户域前缀注册表 + clearUserScopedLocalStorage（容错遍历删除） |
| 新增 | frontend/src/lib/__tests__/logout-storage.test.ts | 清理行为单测（全清/保留/精确匹配/容错） |
| 修改 | frontend/src/components/app-shell.tsx | performLogout finally 跳转前挂载清理 |
| 修改 | frontend/src/components/__tests__/app-shell.test.tsx | 登出用例追加清理函数被调断言 |
| 修改 | frontend/src/app/m/account/page.tsx | handleLogout finally 跳转前挂载清理 |
| 修改 | frontend/src/app/m/account/page.test.tsx | 登出用例追加清理函数被调断言 |
| 修改 | frontend/src/lib/api.ts | 401 单飞失败分支 clear() 后挂载清理 |
