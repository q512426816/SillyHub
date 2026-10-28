---
author: flow-machine-draft
created_at: 2026-10-28T06:39:43.067Z
---
# 设计记录（Design Record）— 2026-10-28-change-detail-side-assets-scroll

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两处纯展示层调整（用户裁决）：①`change-overview-side.tsx` 删「范围对账」「产出速览」两个 MetaPanelSection 及其取数（getScopeAudit / getChangeAssets 两 query 与 auditCounts / assetCounts 派生计算）——弱信息占据侧栏，明细入口由「文件与对账」「产出」两个专属 tab 承接，侧栏摘要属重复信息；②`change-assets-card.tsx` 六组卡片统一限高滚动——抽 `GROUP_CARD_CLS`（max-h-64 flex 容器）与 `GROUP_BODY_CLS`（min-h-0 flex-1 overflow-y-auto 滚动区）两个 className 常量，六组卡片引用同一对常量（防漂移），标题行 shrink-0 钉顶、GroupToggle 移到滚动区外钉底、仅中间列表滚动。

高度取 max-h-64（256px）——2026-10-15-change-detail-redesign 改造前的历史高度值复用，本次用户裁决推翻该变更 FR-06/D-001 的「自然高度」口径（限高滚动回归），相应旧契约用例改写为新契约断言。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ChangeOverviewSide`：props 签名不变；渲染组从五组减为三组（基本信息 / 执行用量 / 会话）；组件不再 import useQuery / getChangeAssets / getScopeAudit（侧栏取数只剩 useChangeUsage）。
- `change-assets-card.tsx`：新增模块级常量 `GROUP_CARD_CLS` / `GROUP_BODY_CLS`（私有，不导出）；六组卡片（fr / decisions / knowledge-touch / tests / modules / audit）DOM 结构调整——GroupToggle 从滚动内容区移到卡片层；audit（归档留档）组把跨仓区 + 文件清单区整体包进滚动容器，标题与统计行钉住。
- 对外 API / 类型 / 后端：**无变化**（纯前端展示层）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：不适用——纯展示层，数据到达顺序不影响（react-query 缓存语义未动，各 query 到达后照常渲染）。
2. **并发写**：不适用——无 mutation、无共享可变状态；「同步变更」按钮逻辑未动。
3. **切换/生命周期**：展开态（expandedGroups）与卡折叠态（open）仍为组件内 useState，切 tab / 卸载重挂重置——与改造前一致；滚动位置不持久化（组内滚动到顶重挂载，可接受）。
4. **作用域**：不适用——组件级样式调整，无跨工作区 / 跨仓数据面变化。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**嵌套滚动体验**——audit 组滚动容器内含原文件清单区的 overflow-hidden 结构，双层约束在极端长清单下滚动全落在外层（内层无自身高度约束不产生第二滚动条），行为一致但需目验；max-h-64 对知识触达组（chip 行 + 文件分组）在条目多时可视行数较少，用户如嫌小可调常量一处改全局。

死路（试过放弃）：a) 只加 `overflow-y-auto` 不限高——无高度约束不产生滚动，必须 max-h 配套；b) GroupToggle 留在滚动区内——用户须先滚到底才能展开，违背「随时可点」直觉（调试用例实证按钮可达性断言的价值：初版用例造数 1 条无按钮可断言，暴露断言前提）；c) 侧栏两组区块只隐藏不删取数——白耗两个请求，且 D-016@v1「同 key 命中缓存零额外请求」的取数纪律本意是复用而非保留死代码，删除更干净。
