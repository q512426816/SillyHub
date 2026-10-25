---
author: flow-machine-draft
created_at: 2026-10-25T05:16:46.963Z
---
# 设计记录（Design Record）— 2026-10-25-session-tab-visual-unify

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

宽度统一：turn-segment-views.tsx 中 agent 侧信息块现存的两种限宽（`max-w-[min(100%,52rem)]`——TextSegmentView；`max-w-[86%]`——PreambleSegmentView / CompactSegmentView / TurnTriggerView×2 / file 段容器）与 turn-timeline.tsx 旧路径 output 正文（`max-w-[min(100%,52rem)]`）统一替换为 `max-w-[calc(100%-120px)]`（整行宽度 − 120px，随父容器自适应）。用户侧气泡（56%）、轮内引导气泡（80%）、system_event 居中装饰行不属于 agent 反馈信息，不动。

组件统一：进度视图的 AskUser 渲染从 AskUserToolCard（工具卡片形态）换成对话视图同款 DialogQaBlock（❓ 问答块）——v2 段路径（timeline 分支）与旧回退路径（TurnDetailsList askUser 分支）两处都换；DialogQaBlock 去掉仅对话视图语境合理的 ml-9 缩进、加统一限宽，使两视图（含进度视图 ml-9 竖线容器）内左缘与其它段行对齐；换完 AskUserToolCard 无引用即删除（Wrench 图标仍被 ToolEventCard 使用，import 保留）。

按钮文案：session-change-files-hover.tsx 悬浮入口按钮可见文本「变更文件」→「变更」，aria-label 保留完整语义。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无外部 API / 端点 / 文件格式变化。组件层对外可见变化：

- AskUserToolCard（turn-timeline.tsx 私有函数组件）删除——两视图 AskUser 统一走 DialogQaBlock。
- DialogQaBlock className 变化：去 `ml-9`、加 `max-w-[calc(100%-120px)]`。
- agent 反馈信息块容器限宽类统一为 `max-w-[calc(100%-120px)]`（原 52rem / 86% 不复存在）。
- 悬浮 pill 按钮可见文案「变更文件」→「变更」（aria-label 不变）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立——AskUser 穿插的 ts 合并排序逻辑不动，只换渲染组件，提问记录迟到/乱序到达的容错行为不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——纯前端渲染层改动，宽度类为静态 className、无共享可变状态，不存在并发写问题。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——viewMode 三态切换的渲染门控不变（timeline 仅 all、convoTimeline 非 all），统一组件在两分支共用，视图切换无状态残留、无双重渲染。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会——改动作用于会话面板组件树（弹窗版 / 整页版共用 TurnTimeline），跨工作区 / 跨仓无数据面变化；pill 文案为纯展示无状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：DialogQaBlock 去 ml-9 后对话视图 ❓ 块左缘与其它 agent 段对齐（视觉位置变化，属统一的预期部分）；进度视图提问卡不再展示全部 options 选中态（信息量下降，用户裁决优先统一形态）；类名锁定的测试断言需逐个同步，漏改会假红。

放弃方案一：进度视图保留 AskUserToolCard（保留全部 options / 选中态展示）——用户明确裁决「优先使用对话的」，且问答块已含问题+回答主信息，弃。

放弃方案二：宽度用固定像素上限（如 max-w-[880px]）——「整行宽度 − 120px」语义要求随容器宽度自适应（弹窗版/整页版/移动端容器宽度不同），固定值会在窄容器下越界，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 6 处 agent 信息块限宽统一为 max-w-[calc(100%-120px)] |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 旧路径正文限宽统一；轮失败错误卡限宽统一；进度视图两处 AskUser 换 DialogQaBlock；DialogQaBlock 去 ml-9 加限宽；删 AskUserToolCard |
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | 按钮文案「变更文件」→「变更」 |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 宽度断言同步（52rem → calc 限宽） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx | all 视图 AskUser 断言换问答块形态 |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx | 头注释口径同步（AskUserToolCard 路径已不存在）；「全部视图」用例反转为新契约 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx | AC-10-01c 用例按统一问答块契约改写（原锁定工具卡显全部选项旧契约） |
| 修改 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | 入口按钮文案断言「变更」 |
