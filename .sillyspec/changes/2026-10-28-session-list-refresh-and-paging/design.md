---
author: flow-machine-draft
created_at: 2026-10-28T04:34:47.342Z
---
# 设计记录（Design Record）— 2026-10-28-session-list-refresh-and-paging

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两个独立缺陷一次收口，均为纯前端：

1. **切换即时刷新**（session-panel-page.tsx）：暂存切换的收敛函数
   `settleStagedAfterSend` 只 invalidate 会话详情、漏调列表刷新回调——而现状
   四控件（供应商/模型/档案/思考级别）全状态点选=暂存，切换全部经该路径生效，
   左侧列表只能等 10s/30s 轮询兜底。补一行 `onSessionListRefresh?.()`（与
   onSwitched/打断/重置/结束等既有 8 个点位同款回调，零新机制）。
2. **递增分页**（session-list-panel.tsx）三层：
   - 组内展示层：`showAllGroupIds` 二态「显示全部」→ `groupExtraCount`
     （Map<groupId, number>）递增计数，点「加载更多」+20；展示集 = 最新
     (10+extra) 条 ∪ 在线全显（保服务端序），覆盖全量后按钮消失；
   - 总数常显：树底部提示行改常显「共 {total} 条」（服务端 total=过滤后
     总数，天然按筛选分类），已加载不足时附已加载计数；
   - 数据层续拉：已加载 < total 时底部「加载更多会话」按钮，按与首屏
     完全相同的筛选参 `offset=已加载数` 续拉（limit=500），附加段组件 state
     拼接渲染、按 id 去重。选保守组合而非 useInfiniteQuery 全量重构，见风险节。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 后端/端点：无改动——GET /api/daemon/sessions 既有真分页（limit≤500 +
  offset + 过滤后 total，session_crud.py:158-164）直接消费。
- `settleStagedAfterSend`（session-panel-page.tsx）：行为增强（补列表刷新
  回调调用 + 依赖数组），无签名变化。
- `SessionListPanel`（session-list-panel.tsx）：对外 props 无变化；内部
  state（showAllGroupIds → groupExtraCount + 附加段三件套）与组底部按钮
  （「显示全部」→「加载更多（+20）」）变化；`defaultVisibleGroupSessions`
  纯函数签名不变（展示集计算改由新函数承担并导出供测试）。
- 移动端 mobile-session-list：非目标，本次不动（其口径仍为 10+在线全显无
  递增；后续需要另行对齐，非本变更范围）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   offset 翻页期间首屏轮询刷新（排序键=置顶+最近活跃倒序，活跃态变化会
   重排）→ offset 页与首屏可能重叠 → **附加段 append 按 id 去重**兜底；漂移
   漏行属极端窗口，用户再点一次加载更多自然补齐（可接受边界，不追求翻页
   快照一致性）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端 state，无共享可变数据；「加载更多会话」按钮加 in-flight 守卫防
   连续快速点击双拉（附加段幂等 append + 去重下双拉亦无害，守卫只为省请求）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   scope/筛选/引擎 tab/archived 视图切换 → 既有筛选重置 effect 扩展：清空
   附加段 + 组内递增计数（旧筛选的附加段不泄漏进新视图）。附加段**不参与**
   10s/30s 轮询——500 条外的老会话状态低频变化，接受陈旧（声明边界，非缺陷）；
   首屏仍全量轮询。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   附加段拉取携带与首屏逐字段相同的筛选参（scope workspace_id/change_id/
   ql_id/runtime_id + assoc + archived + 引擎 provider），不同 scope 附加段
   不串台；切换重置 effect 兜底清残留。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：客户端分组（工作区树）与服务端 offset 翻页的排序漂移（置顶会话
跨页移动致重叠/漏行）——以 id 去重 + 可再点补齐收敛，接受极端窗口漏行。
试过放弃的方案：useInfiniteQuery 全量重构（翻页原生支持）——需改动现有
queryKey 前缀 invalidate 语义（门户全前缀覆盖）、refetchInterval 形状
（InfiniteData vs items）、structuralSharing 行为，影响面远超本缺陷，放弃；
保守组合（首屏 useQuery 不动 + 附加段 state）代价仅为附加段不自动轮询，
远小于重构风险。
