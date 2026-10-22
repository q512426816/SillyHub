---
author: flow-machine-draft
created_at: 2026-10-21T01:14:33.403Z
---
# 设计记录（Design Record）— 2026-10-21-mobile-scan-birth-cleanup

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：总览卡已在 2026-10-21-overview-card-mainflow-scan 去 scan，本变更清掉同根因的三处残留。①`mobile-change-detail.tsx`：删除 `STEPPER_STAGES` 局部别名（`["scan", ...WORKFLOW_STAGES]`），5 处使用点改直用桌面单一源 `WORKFLOW_STAGES`（change-stage-header 导出，本就五段 brainstorm→archive）——移动端与桌面共用同一阶段数组，杜绝第三份口径副本。②`changes/page.tsx:764` 与 `mobile-change-card.tsx:261` 的 `current_stage ?? "scan"` 兜底改 `?? "brainstorm"`（出生阶段即 brainstorm，缺失兜底显 scan 是 2026-09-27 前的过时口径）；mobile-change-card.tsx 头注释 35 行的降级口径描述同步。③`change-step-badge.tsx` 的 STAGE_LABELS/STAGE_KIND 中 scan 映射**不动**——那是 legacy 数据值域映射（旧归档行可能带 scan 阶段值），与「起步阶段」口径无关。测试同步：detail 步骤条标签数组与可点性循环去「扫描」、card 缺省降级用例改断言「需求分析」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无 API/端点/数据契约变化。组件内部：`STEPPER_STAGES` 常量删除（模块内私有，无导出消费）；两处 `??` 兜底字面量值变化（纯展示）；移动端步骤条渲染节点 6→5。`WORKFLOW_STAGES`/`WORKFLOW_STAGE_LABELS`/`STAGE_LABELS`（badge）导出面零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：n/a——纯渲染常量与兜底字面量变化，无事件序假设；30s/请求级重渲染全量重算。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：n/a——无共享可变态，无写入面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全——STEPPER_STAGES→WORKFLOW_STAGES 替换后数组内容仅少 scan：includes 可点判定、indexOf 当前定位语义不变；边界情形为 legacy 数据 current_stage='scan' 的旧行，indexOf 命中 -1 走「非线性阶段降级不渲染」分支——与桌面 [cid] 页现状一致（桌面 WORKFLOW_STAGES 从不含 scan，scan 行本就走该降级），移动端向桌面收敛而非回归。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不会——无取数面变化；桌面/移动两列表与详情均消费各自已有 props。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：legacy scan 阶段值（2026-09-27 前创建且未推进的行）在移动端详情失去步骤条——实为与桌面一致的既有降级形态（收敛），且此类行本就停滞在出生阶段无步骤可看，风险可忽略。次要风险：兜底改 brainstorm 后 `current_stage=null` 行显「需求分析」可能被误读为「正在头脑风暴」——null 属平台镜像异常态（正常行恒有阶段），兜底只是防裸显，可接受。放弃方案：①保留 STEPPER_STAGES 别名仅删 scan 元素——留无谓别名不如直用 WORKFLOW_STAGES 单一源，防第三份副本再漂移；②连 ChangeStepBadge 的 scan 标签/色映射一并删——那是 legacy 值域映射，删了会让存量 scan 行裸显英文 'scan'，越界，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/mobile/mobile-change-detail.tsx | 删 STEPPER_STAGES 别名，5 处使用直用 WORKFLOW_STAGES，注释同步 |
| 修改 | frontend/src/components/mobile/mobile-change-card.tsx | 缺省兜底 "scan"→"brainstorm"（261 行）+ 头注释 35 行口径同步 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 缺省兜底 "scan"→"brainstorm"（764 行） |
| 修改 | frontend/src/components/mobile/mobile-change-detail.test.tsx | 步骤条标签数组与可点性循环去「扫描」 |
| 修改 | frontend/src/components/mobile/mobile-change-card.test.tsx | 缺省降级用例改断言「需求分析」（brainstorm） |
