---
author: flow-machine-draft
created_at: 2026-10-21T00:59:28.398Z
---
# 设计记录（Design Record）— 2026-10-21-overview-card-mainflow-scan

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：改 `frontend/src/components/workspace/changes-overview-card.tsx` 单文件两处。①`MAIN_STAGES` 常量从六段（含 scan）删去 scan 成五段 brainstorm→archive——依据 sillyspec `src/progress/shared.js` 的 `MAIN_FLOW_ORDER = ['brainstorm','plan','execute','verify','archive']`（主流程不含 scan/quick/explore 辅助阶段）与 2026-09-27-change-birth-stage-brainstorm（出生阶段=brainstorm，scan 是按需显式跑的 auxiliary）：前端 2026-09-02 建卡时照抄了当时含 scan 的 `STAGE_ORDER`，出生阶段改版后未随迁，导致 brainstorm 阶段变更被渲染「scan 已完成」的假语义。②`ActiveChangeRow` 对 `current_stage==='thin'` 隐藏「步骤 0/0」文案——thin 不走阶段机无步骤语义（CLI steps 口径维持 {0,0} 真实值，2026-10-21-overview-thin-stage design 已裁决），quick/explore 存量渲染不动。配套更新同目录测试的 scan 点位断言并新增 thin 行用例。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无 API/端点/数据契约变化。组件内部：`MAIN_STAGES` 常量值域收窄（scan 移除）——`StagePipeline` 读屏 aria 语义随之少一个「scan *」档位；`ActiveChangeRow` 对 thin 阶段不渲染步骤文案（纯展示）。envelope 解析、字段消费、其余渲染路径零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：n/a——纯渲染投影，每轮 30s 轮询全量重绘，无事件序假设；旧 envelope（可能仍报 thin 变更为 brainstorm 的旧 daemon 采集值）下 thin 行会暂走主管线，属既有降级形态，daemon 下一拍采集自愈（根因已在 sillyspec 仓修复）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：n/a——纯前端常量与条件渲染改动，无共享可变态；react-query 轮询单数据源，无并发写面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全——filterTab/ghostExpanded 状态机未触碰；阶段值域变化对未知 stage 的兜底（不进管线、全 todo/旁路）既有逻辑不变。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不会——改动仅涉渲染常量，无数据取数面变化；FR-06 机器定位链、工作区级 map 取数均未触碰（既有测试「map 在场且含当前工作区」等用例锚定）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：既有测试与潜在快照对「六段管线」的隐含依赖——已定位唯一断言面（本组件测试 213-217 行 scan aria 断言）同步更新，全仓 grep 无其他组件消费本卡 MAIN_STAGES（组件内常量未导出）。次要风险：旧 daemon 采集值（CLI 未升级机器）下 thin 变更暂显 brainstorm 主管线——数据源升级自愈，非本变更面（依据：根因修复在 sillyspec 2026-10-21-overview-thin-stage，跨仓不在本冻结面）。放弃方案：①连带改移动端 stepper（mobile-change-detail STEPPER_STAGES 含 scan）与变更中心 `?? "scan"` 兜底——同根因但异仓异面，用户本轮只点名总览卡，扩面应由用户裁决，留后续候选；②改 CLI 侧让 envelope 附带阶段清单驱动前端渲染——过度设计，前端静态常量与 sillyspec MAIN_FLOW_ORDER 对齐即可，增契约无收益。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/workspace/changes-overview-card.tsx | MAIN_STAGES 去 scan 成五段；ActiveChangeRow 对 thin 隐藏步骤文案 |
| 修改 | frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx | scan 点位断言更新为五段口径；新增 thin 行用例 |
