---
author: flow-machine-draft
created_at: 2026-10-29T02:11:51.669Z
---
# 设计记录（Design Record）— 2026-10-29-edit-diff-stat-badge

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

数据链已通：TurnSegment 工具段在 tool_result 配对时已写入 editPatch（structuredPatch JSON，Edit 与 Write 覆盖写均携带，session-log-assembler.ts:505 注释钉板），前端已有全仓唯一行级 diff 解析器 parseStructuredPatch（agent-log/tool-diff.tsx）。本变更纯前端消费该数据，不改后端 / daemon / SSE 协议：

1. 新增纯函数 `diffStatFromPatch(patchJson): { added, removed } | null`——与 parseStructuredPatch 同文件，直接复用其解析结果（DiffRow[]）数 add/del 行，保证徽标口径与展开区行级 diff 严格同源（同一解析器，不可能出现「徽标 +11、展开区 +12」的自相矛盾）。
2. 新增共享徽标组件 `DiffStatBadge`（daemon/diff-stat-badge.tsx）：`+N` 绿（emerald）`-M` 红（destructive），removed=0 只显示 +N。
3. 两处消费：跑马灯 collectEntries 的 tool 分支在 status=ok 且 editPatch 存在时派生 entry.diffStat，MarqueeItemView 完成态在耗时区前渲染徽标；进度视图 ToolRowView 完成态行尾（状态徽标后、时长前）渲染同款组件。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出 `diffStatFromPatch(patchJson: string): { added: number; removed: number } | null`（frontend/src/components/agent-log/tool-diff.tsx）；null 语义 = 解析失败 / 空 hunks / 0/0（调用方不渲染）。
- 新增组件 `DiffStatBadge({ added, removed }: { added: number; removed: number })`（frontend/src/components/daemon/diff-stat-badge.tsx）。
- `LiveMarqueeEntry`（turn-live-marquee.tsx）增加可选字段 `diffStat?: { added: number; removed: number } | null`，由 deriveLiveMarqueeEntries 从 tool 段派生（status=ok + editPatch 双门控）。
- 后端 / daemon / SSE 事件面 / api-types：**无**任何变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：成立。editPatch 随 tool_result 由既有装配逻辑配对写入段；result 未到（运行中）时 editPatch 缺省 → 不显示；迟到配对后段树引用更新触发既有重渲染路径，统计届时出现。统计是纯派生值（deriveLiveMarqueeEntries / 渲染 useMemo），无自持时序状态，乱序不产生错误中间态（最多「先无后有」）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：本变更纯前端只读渲染，无新增可变共享数据；多会话面板各持各的段树副本（既有装配隔离），无串写面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全。统计不落组件本地 state（随段数据派生），卸载 / 轮切换 / 刷新零残留；历史回放 slim 截断只截 content，edit_patch 为独立列不受截断影响，回放场景统计照常可得。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不会。统计只读单个工具段自身的 editPatch，不做任何跨段 / 跨轮 / 跨会话聚合。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：大 patch（数千行）重复解析开销。缓解：跑马灯条目窗口上限 12 条、派生发生在 deriveLiveMarqueeEntries 纯函数内（段引用变化才重算，React memo 链既有）；ToolRowView 侧 useMemo 按 editPatch 字符串缓存。实测面量级（单文件 patch 数百行）无虞。
- 已放弃方案 a：用 hunk 头 oldLines/newLines 直接相加（省一轮遍历）——Write 覆盖写等场景 hunk 头与 lines 实际前缀可能不一致，且与展开区行级 diff（按行前缀渲染）不同源，会造成两处口径漂移。
- 已放弃方案 b：daemon 侧预计算统计随事件下发——多一层协议与 api-types 改动，前端已有全量数据，本变更不需要。
- 已知边界：zcode 引擎交互链路 edit_patch 暂缺（providers.ts 标记「structuredPatch 未验证」）→ 该引擎下按 FR-03 不伪造口径自然不显示徽标，引擎侧后续补齐数据后零改动自然点亮，不在本变更范围。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | frontend/src/components/agent-log/tool-diff.tsx | 新增导出 diffStatFromPatch 纯函数（复用 parseStructuredPatch） |
| A | frontend/src/components/daemon/diff-stat-badge.tsx | 共享统计徽标组件（+N 绿 / -M 红，removed=0 只显示 +N） |
| M | frontend/src/components/daemon/turn-live-marquee.tsx | LiveMarqueeEntry 增 diffStat 字段 + collectEntries 派生 + 完成态渲染 |
| M | frontend/src/components/daemon/turn-segment-views.tsx | ToolRowView 完成态行尾渲染徽标（useMemo 缓存解析） |
| A | frontend/src/components/agent-log/__tests__/tool-diff.test.tsx | 纯函数用例（计数 / 多 hunk / 非法输入 / 零改动） |
| M | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | 派生与渲染用例（含运行中 / 失败门控） |
| M | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | ToolRowView 渲染用例 |
