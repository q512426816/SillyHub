---
author: flow-machine-draft
created_at: 2026-10-15T03:09:55.835Z
---
# 设计记录（Design Record）— 2026-10-15-change-assets-graph

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。


用户四条诉求全在展示层：①新建 `change-assets-graph.tsx` 组件嵌进 ChangeAssetsCard 展开态顶部——数据复用 `getKnowledgeGraphQuery(workspaceId,"neighbors",{anchor:changeKey})`（与图谱页 neighbors 切片同一端点同型收窄），画布复用 `GraphCanvas`（slice 模式），右侧详情栏是图谱页 detail tab 的紧凑直译（类型中文标签+色点+ID+按边型分组出入邻居行）。选独立子组件而非内联：资产卡已 850 行，图谱分区自带取数/选中态，独立文件可单测（GraphCanvas stub 范式同图谱页测试）。②page.tsx 主栏把 ChangeAssetsCard 挂载点上移到步骤时间线 section 之前。③步骤时间线 section 加 stepsOpen state（默认 false），卡头改切换按钮，focusStage 联动 useEffect 自动展开。④change-stage-actions.tsx 的 `!gatePanel` 分支由渲染占位卡改为 return null。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `ChangeAssetsGraph`（components/changes/detail/change-assets-graph.tsx）：props `{ workspaceId, changeKey }`，内部 useQuery 自取数（QuicklogLinkedCard 同款范式），无对外导出函数。
- `graph-canvas.tsx` 新增具名导出 `NODE_TYPE_LABELS`（自图谱页 page.tsx 迁入——新组件与图谱页共用单一源）；图谱页删除本地定义改 import。
- `ChangeStageActions` 无待审分支行为变化：渲染占位卡 → return null（组件签名不变）。
- 后端端点/DTO 零改动（复用既有 graph query 端点）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

图谱分区数据走 react-query 单请求（key 含 workspaceId+changeKey），无多源竞争；选中态 selectedId 由用户点击/锚点初始化设置，查询回包晚到不覆盖已选节点（初始选中在数据到达派生时以 null 守卫，仅从无到有时置锚点，不后写覆盖用户已选）。步骤时间线 focusStage 联动为单向派生（点击→置 state→effect 展开），无回写环。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯展示组件无写路径；审批卡 mutation 状态机不变。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

图谱分区随资产卡卸载（弹窗态无常驻请求）；查询失败静默置 error → 分区隐藏，不重试轰炸（retry:false 同资产卡口径）；路由切换变更时 page 以 changeId 取数、stepsOpen/focusStage state 残留——focusStage 残留为既有行为（本次不改），stepsOpen 默认收起无残留危害（切换后仍收起）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

图谱查询 key 含 workspaceId+changeKey 双键隔离；GraphCanvas 为受控纯组件（nodes/edges 引用稳定时无内部状态外泄），无跨实例串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险一：在途变更（未注册图节点）neighbors 查询锚点未命中——可能形态为 available=false 或 data.nodes 空；双态都收敛到「整区隐藏」，实测时用归档变更核对。缓解：空 nodes 与 unavailable 同走隐藏分支，不出现半渲染。
- 风险二：资产卡测试既有 fixture 未 mock getKnowledgeGraphQuery——jsdom fetch 报错 → react-query error → 隐藏，既有用例不受扰；显式在新组件测试中 mock 全两态（可用/不可用）。
- 试过放弃：①把图谱分区做成弹窗（点「查看图谱」再开 Dialog）——用户原话是「图放卡片中」，弹窗多一步且复刻了被用户否掉的「点了看不到东西」反模式；②复用图谱页整页三栏（左表单/右结果 tab）——资产卡内只需要画布+节点详情两块，表单/图例属图谱页职责，嵌入会撑爆卡片。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/changes/detail/change-assets-graph.tsx | 沉淀资产卡内嵌知识图谱分区组件（画布+右侧节点详情） |
| 修改 | frontend/src/components/changes/detail/change-assets-card.tsx | 展开态网格顶部挂载 ChangeAssetsGraph（md:col-span-2） |
| 修改 | frontend/src/components/knowledge/graph-canvas.tsx | 导出 NODE_TYPE_LABELS（自图谱页迁入单一源） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx | 删本地 NODE_TYPE_LABELS 改 import |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 主栏顺序上移沉淀资产；步骤时间线默认收起+切换+focusStage 联动展开 |
| 修改 | frontend/src/components/changes/detail/change-stage-actions.tsx | 无待审分支占位卡改 return null |
| 新增 | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx | 图谱分区组件测试（可用两态+选中交互+降级隐藏） |
| 修改 | frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx | 无待审用例改断言渲染 null |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | 时间线用例改「默认收起→点开展开」 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | 补主栏顺序钉子用例 |
