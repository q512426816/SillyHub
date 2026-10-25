---
author: flow-machine-draft
created_at: 2026-10-25T00:44:49.791Z
---
# 设计记录（Design Record）— 2026-10-25-trajectory-system-rows

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

DB 实证团队派发指令（主控 brief / Worker 派发）以 user_input 落库且 metadata 为空，前端无从区分它与真实用户输入。本变更采用纯前端启发式：`from-turn-views.ts` 内定义团队指令特征前缀常量（锚定 backend 文案来源注释），对轮首用户行（prompt 行）与 `user_msg` 段的文本做前缀匹配，命中则行映射 `kind=system` + `meta.systemBrief=true`，账本经 `trajectory-view-model.ts` 标签分支显示「系统」。选择启发式而非后端盖戳：存量历史会话立即生效（用户当前看的正是历史数据），且不触碰后端落库行为；误判面被限制在「显示标签」，不影响任何数据正确性。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化。`trajectoryFromTurnViews` 签名不变；产物行为差异：命中前缀的用户行变为「系统」标签行（kind=system + meta.systemBrief）。无后端/API/DTO/落库变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。前缀识别是逐行纯函数，不依赖顺序；流式追加幂等。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无并发写面：纯函数派生 + 只读消费。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。无新增状态；识别随 turns 更新幂等重算。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。只消费当前会话轮视图文本。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：backend 指令文案改版时前缀常量漏跟，导致新指令显示回「用户」行——以前缀取文案开头稳定段（"你是多 Agent 团队的"/"你是多 Agent 团队中的一个"）缩小漂移面，并用注释锚定来源路径提醒同步；退化形态只是标签回退，无数据损坏。误判风险：用户手打相同开头文本会被标「系统」——概率极低且只影响标签。放弃的方案：后端 inject 盖 turn_trigger 戳——正道但存量数据不生效，用户当前验收的历史会话依旧看不到；留作后续增量（新数据盖戳 + 前端配置表加行，可与本启发式并存）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | 团队指令特征前缀常量（锚定 backend 文案注释）+ 轮首用户行/user_msg 段识别 → kind=system + meta.systemBrief |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-view-model.ts | recordKindLabel：systemBrief → 「系统」标签（KIND_TONE 已有系统配色） |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts | 主控 brief / Worker 派发 / 普通输入三类用例 |
