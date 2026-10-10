---
author: flow-machine-draft
created_at: 2026-10-09T04:10:52.133Z
---
# 设计记录（Design Record）— 2026-10-09-thin-hide-step-timeline

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

桌面详情页（`changes/[cid]/page.tsx`）与移动端详情页（`mobile-change-detail.tsx`）的「步骤时间线」卡挂载条件各加一个 `!isThinLineageChange(change)` 前置排除——该谓词是页面既有单一真相（顶部轻量流程条 2026-09-27-thin-display-fix 已用同一判定，后端 `_is_thin_lineage` 三分支同口径），thin 出身时整卡不渲染。选整卡隐藏而非「过滤补种行」：thin 的 steps 里只有归档补种 3 行，过滤后必空卡无意义；且「补种行特征」（stage=archive + 同一时间戳）属脆弱启发式，与出身判定重复造轮子。移动端同步改（同一产品面同一数据，单改桌面会留同款噪音）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无后端/API/DTO 改动（纯前端条件渲染）。对外可见行为变化仅一处：thin 出身变更的详情页不再出现「步骤时间线」卡（桌面 testid `change-step-timeline-card` / 移动端 `m-change-timeline-card`）；厚变更渲染路径与「真实留痕时间线」卡挂载条件零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——详情数据经 10s 轮询整体到达，谓词是 change 载荷的纯派生函数，每次渲染重算；迟到补种的 steps 到达后下一次轮询确定性翻卡可见性，无顺序假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯只读渲染路径，本变更零写入；不存在两执行体竞争面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全——路由切换即重挂载（真实留痕卡已 key=changeId）；focusStage 联动对 thin 天然缺席（thin 不渲染 ChangeStageHeader 阶段节点，focusStage 恒 null），隐藏时间线卡无残留状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——`isThinLineageChange` 按 change 对象逐条判定（含 created_at 时间窗双保险），无跨工作区/跨实例共享状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：出身误判导致厚变更卡片被误隐藏——缓解：复用已被 thin-badge-survives-archive / thin-display-fix 两个变更钉过的既有谓词，不引入新判定逻辑。试过放弃的方案：①按「3 行同一时间戳 + stage=archive」特征过滤补种行——放弃，脆弱启发式且过滤后必空卡；②后端停止补种 steps——放弃，补种行承载归档终态投影语义（status=archived 读时覆盖依赖 latest_progress），前端隐藏是展示层正确切面。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 步骤时间线卡挂载条件加 `!isThinLineageChange(change)` 前置 + 注释记录规则 |
| 修改 | frontend/src/components/mobile/mobile-change-detail.tsx | 阶段时间线卡同款 thin 出身排除 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | 共存用例语义翻转（thin 隐藏）+ 厚变更双卡共存新增用例 |
| 修改 | frontend/src/components/mobile/mobile-change-detail.test.tsx | 归档 thin 用例补时间线卡缺席断言 |
