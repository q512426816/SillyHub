---
author: flow-machine-draft
created_at: 2026-10-10T15:03:59.680Z
---
# 设计记录（Design Record）— 2026-10-10-dialog-qa-inplace

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实证：SillySpec 断点七连问在同一轮内发生，对话视图把全部 ❓ 提问记录整组渲染在轮头部、agent 回复之前（`turn-timeline.tsx` 旧块按 `run_id` 过滤后前置），时序全丢；「全部」视图早已按时间戳穿插（既有 `timeline` memo + 旧路径 `TurnDetailsList` 合并排序，注释明示该差异），对话视图是遗留旧路径。修法对齐「全部」视图既有约定：`SegmentedTurnBody` 新增 `convoTimeline` memo（对话段 `textSegments` 以 `segmentTsOf`、❓ 块以 `created_at` 为键，稳定排序缺 ts 视 0），对话流按合并序渲染；❓ 块标记抽出 `DialogQaBlock` 组件（视觉逐字不变）供 v2 穿插与旧回退两处复用；旧块门控收紧为 `segments === undefined`（孤儿轮/旧数据回退，行为不变）。不选「给 dialog 落一条 chat 日志行」——动数据写入链路面大且历史数据不回填，纯渲染层合并零数据改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `TurnTimeline` 对外 props 零变化（`dialogHistory` 语义不变，仅消费位置变）。
- 新增组件内部 `DialogQaBlock`（不导出，标记新增 `data-testid="dialog-qa-block"` 供测试定位，不改视觉）。
- 后端/数据零改动（dialog 历史仍走 `GET /dialogs/history`）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | DialogQaBlock 抽取 + SegmentedTurnBody convoTimeline 合并穿插 + 旧块回退门控 |
| 新增 | frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx | 穿插顺序/末尾块/仅提问轮/回退路径/全部视图不双画 5 用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。合并排序是稳定排序：缺 ts（null/NaN）视为 0 保持文档序（与「全部」视图既有约定逐字一致）；dialog 迟到到达（history 刷新）时 `convoTimeline` memo 依赖 `turnDialogs` 重算，位置按其 `created_at` 落位，与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：纯渲染层变更，无写入面；`dialogHistory` 数组由父级既有序列化 setState 供给。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：`convoTimeline`/`DialogQaBlock` 均为纯派生渲染，无本地状态/定时器；会话切换走父级既有 turnState 重建，无残留面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：❓ 块仍按 `run_id === 该轮 runKey` 过滤（既有口径），跨会话/跨用户数据不进入。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：段时刻缺失（`startedAt`/`ts` 为 null 的旧段）与 ❓ 块（ts 视 0）混排时穿插位置退化——与「全部」视图同款既有语义（视 0 靠前 + 稳定保文档序），非新增风险；回退路径完全不动。
- 放弃方案「dialog 落 chat 日志行参与日志流」：需动后端写入链路 + 历史数据不回填 + 与 dialog 机制（不走 tool_use 日志）的既有裁决冲突，收益不抵面。
- 已知残留：`created_at` 精度为 dialog 请求时刻，与段时刻毫秒级并列排序理论上可同刻（稳定排序保互不跳序）。
