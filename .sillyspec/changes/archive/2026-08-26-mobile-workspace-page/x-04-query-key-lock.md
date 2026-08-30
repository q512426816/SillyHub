---
author: qinyi
created_at: 2026-08-27 07:57:00
task: task-16
source_tasks: [task-06, task-08, task-09, task-11, task-12, task-15]
---

# X-04 · query key 锁形态用例记录（verify/archive 对账）

> 依据：design §10 R-03（移动列表自建 query 可能与桌面 key/参数漂移 →「key 结构
> 逐字对齐并在两侧测试中锁 key 形态」）+ §5.3/§5.4 数据层 100% 复用约束。
> 素材来源：task-06/08/11/15 实现与测试汇报，task-16 收尾逐条核对测试文件实际断言后落盘。
> 路径均相对仓根（worktree 内同构；行号为 task-16 核对时点）。

## 1. task-06 · 变更列表主 key + Tab 计数 key

**key 形态（与桌面逐字同构）**

- 主列表：`["changes", workspaceId, { location, search, currentStage, sort,
  pendingReviewOnly, page, pageSize }]`（含 pendingReviewOnly 仅 active+focusMine 生效）
  ← 桌面锚 `(dashboard)/workspaces/[id]/changes/page.tsx:149`
- Tab 计数：`["changesTabTotals", workspaceId]` ← 桌面锚同文件 `:209`
  （retry:false / 不轮询 / 不随筛选变化）
- quicklog Tab（task-07 增量）：`["quicklogEntries", ws, { search, status, author,
  showPlaceholder, page, pageSize }]` ← 桌面 QuicklogTable 默认形态

**测试文件与断言点**

`frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx`

- `:266` 「主列表 query key 逐字对齐桌面 page.tsx:149（全参槽位）且请求全参」：
  `queryClient.getQueryData(mainKey())` truthy（错任一槽位取 null 即失败）+
  `listChanges` 全参调用断言（location/sort/pendingReviewOnly/page/pageSize）
- `:286` 「Tab 计数 query key 逐字为 [changesTabTotals, workspaceId]」：
  `getQueryData(["changesTabTotals","ws-1"])` 等于 `{active:2, archive:0, quicklog:3}` +
  quicklog 徽标渲染 "3"
- `:298` tab 切 archive → `location:"archive"` 重取落桌面同构 key
- `:202` `quicklogKey()` 辅助函数锁 quicklog 槽位结构；`:509` quicklog 轮询数据落键

## 2. task-08 · 变更详情 key

**key 形态**：`["change", workspaceId, changeId]`
← 桌面锚 `(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:43`（轮询语义同构：
非终态 10s / 终态停，isTerminalChange 从桌面详情页 import 复用）

**测试文件与断言点**

`frontend/src/components/mobile/mobile-change-detail.test.tsx`

- `:254-257`（审批用例内）：「详情 query key 逐字对齐桌面 ["change", wid, cid]
  （缓存落键即证 key 形态）」`getQueryData(["change","ws-1","c1"])` truthy
- `:278-281`：审批成功 invalidate 断言——`["changes","ws-1"]` 前缀 + 详情 key
  `["change","ws-1","c1"]` 双失效（与桌面语义一致）

**补充（task-09 页面壳同 key 共享）**：
`app/m/workspaces/[id]/changes/[cid]/page.tsx:45-48` 页面级 useQuery 与组件内部查询
同 key，两个 observer 只发一次请求；其测试
`changes/[cid]/__tests__/page.m-change-detail.test.tsx:136` 同样断言
`getQueryData(["change","ws-1","c1"])` 落键。

## 3. task-11 · 会话列表 key（X-04 / Grill C-08 核心）

**key 形态（逐字）**：`["agentSessions", "sessionsPortal",
{ kind: "workspace", workspaceId }, { limit: 500, archived, assoc: null }]`
← 桌面锚 `components/daemon/session-list-panel.tsx:584`（D-103 语义）
- 数据函数用 `listAgentSessions({ limit, workspace_id })` 过滤参——**不是**
  `listWorkspaceAgentSessions`（后者无 limit/archived 参数、返回类型不同，C-08）
- 与桌面门户共享 react-query 缓存与 `["agentSessions"]` invalidate 前缀

**测试文件与断言点**

`frontend/src/components/mobile/mobile-session-list.test.tsx`

- `:116` `sessionsPortalKey()` 辅助函数逐字锁四槽位（scope 对象 + 参数对象）
- `:194` 「query key 逐字对齐桌面门户形态且数据落键」：
  `getQueryData(sessionsPortalKey("ws-1", false)) === resp`（错键取 null 即失败）
  + 反证 `sessionsPortalKey("ws-2", false)` 为 undefined（scope 槽位锁）
  + `AGENT_SESSIONS_TREE_FETCH_LIMIT === 500`（limit 常量数值锁）
- `:213` 「queryFn 调 listAgentSessions({limit:500, workspace_id}) 且未调
  listWorkspaceAgentSessions（C-08）」
- `:390` 菜单三操作（删除/归档/取消归档）后 invalidate `["agentSessions"]` 前缀
- `:349` 状态 Tab 切换客户端过滤：不换 queryKey、不发第二次请求

## 4. task-15 · 会话对话页页面级 providers key

**key 形态**：`["llmProviders", "floating-session"]` + `staleTime: 30_000`
← 第三宿主锚 `components/daemon/floating-session-host.tsx:86-96`（同 key 共享缓存
零重复请求）；machines 走 `useDaemonMachines({ limit: 100 })`（内部 15s 无条件轮询）
与悬浮宿主同源。

**测试文件与断言点**

`frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx`

- `:172` 「页面级数据同源：useDaemonMachines({limit:100}) + providers 同 key
  [llmProviders, floating-session] 落缓存 + staleTime 30s」：
  `getQueryData(["llmProviders","floating-session"])` 落键 +
  `queryCache.find(...).options.staleTime === 30_000`（运行时形状断言）
- `:194` sid 变化 → `key={sid}` 触发 SessionPanel 重挂载（SSE/队列干净重建契约）

**补充（task-12 会话列表页同 key 同款）**：
`app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx:288`
「providers 同 key 同源：[llmProviders, floating-session] 落缓存 + staleTime 30s」。

## 对账结论

四组 key（列表/计数、详情、会话门户、providers）全部有「缓存落键」式逐字断言
（错槽位取不到数据即失败的反证模式），桌面锚行号在实现文件头注释与本清单双登记；
R-03 key/参数漂移风险闭环。未做 hook 提取（design R-03 允许的低成本可选项）：
移动侧组件与桌面门户 key+queryFn 逐字同构，提取收益低、改动面反而扩大，维持现状。
