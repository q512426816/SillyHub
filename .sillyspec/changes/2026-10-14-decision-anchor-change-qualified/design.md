---
author: flow-machine-draft
created_at: 2026-10-15T00:42:33.492Z
---
# 设计记录（Design Record）— 2026-10-14-decision-anchor-change-qualified

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：`decisions/unmapped.md` 等聚合文件里多个变更各有同名决策号（实证：D-003@v1 出现 3+ 次），既有锚 `文件#决策号` 不唯一，`querySelector` 命中文件序第一个同号卡——沉淀资产卡弹窗（上一变更新增）与知识库页深链滚动都会落错卡。修复采用「复合锚」：结构化条目卡新增 `data-entry-anchor-qualified="文件#变更号#决策号"`（变更号取条目自身的「变更：」字段，与仓库既有跨变更引用约定 `变更名#D-xxx@vN` 同构），裸锚保留兼容。

改动三点：① `entry-card-list.tsx` DecisionCard 输出复合属性（id+变更字段齐备才输出）；② `change-assets-card.tsx` 资产卡新增 `changeKey` prop（变更详情页已有 `change.change_key`，一处透传），FR/决策行深链 anchor 参数带变更号前缀，弹窗定位先试复合锚再退裸锚；③ `knowledge/page.tsx` 深链滚动对含 `#` 的 anchor 先试复合属性、查无退裸锚。知识触达/手册/INDEX 锚点不动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 后端：零改动（条目「变更：」字段已在文件里，前端自取）。
- `EntryCardList`（DecisionCard）：新增 DOM 属性 `data-entry-anchor-qualified`，无 props 签名变化；裸 `data-entry-anchor` 语义不变。
- `ChangeAssetsCard`：props 新增可选 `changeKey?: string`（缺省时深链/定位自动退化为裸 id 旧路径，向后兼容）。
- 知识库页深链 `?anchor=`：新增合法取值形态 `<变更号>#<条目id>`（URL 编码传输），旧裸 id 形态行为不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：弹窗取数 useQuery 按 `[workspaceId, filename]` 分键，晚到响应不串键；定位 effect 以 `q.isSuccess` 为闸，内容未落定不执行——与上一变更同款时序面，本次未改。
2. 并发写：纯读（GET knowledge + 静态解析），无写路径，不适用。
3. 切换/生命周期：复合锚查无时的降级路径逐级兜底——复合属性查无退裸锚（兜底键剥变更号前缀，裸属性值域恒为 文件#id）→ 裸锚也查无则静默落文件级顶部。旧构建缓存（无复合属性的 JS）配新复合深链时不会报错：带前缀的裸选择器不命中，直接落文件级顶部（评审 P1 修复后口径）——切换期安全。
4. 作用域：变更号取自「变更：」字段字面值，与 workspace 无关；不同 workspace 的同名变更号各自在自己的文件域内解析，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：复合属性是新增 DOM 契约，若未来其它消费方按 `[data-entry-anchor=…]` 全量枚举做统计会少算复合锚——已核查现网消费方（知识库页 selectEntry、沉淀资产卡弹窗、测试断言）均为「按值查单个」，无枚举面。
- 弃案 A：改裸 `data-entry-anchor` 的值为复合形态——会破坏旧深链与潜在收藏链接，且 INDEX/触达等裸锚消费方需同步迁移，改动面大收益零，弃。
- 弃案 B：后端 assets 响应给 decisions 条目加变更号字段（前端免传 changeKey）——需改 OpenAPI schema + gen:types + 前端类型同步，而 changeKey 在详情页现成可得，后端改动纯属多余，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/components/knowledge/entry-card-list.tsx | DecisionCard 输出 data-entry-anchor-qualified |
| 改 | frontend/src/components/changes/detail/change-assets-card.tsx | changeKey prop + FR/决策深链带变更号前缀 + 弹窗定位复合锚优选 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 资产卡接线透传 changeKey |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 深链滚动对含 # anchor 先试复合锚 |
| 改 | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | 复合属性断言 |
| 改 | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | 同 id 跨变更弹窗定位用例 + 深链断言更新 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | 深链复合锚滚动用例 |
