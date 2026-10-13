---
author: qinyi
created_at: 2026-10-13T15:35:00+08:00
---
# 设计记录（Design Record）— 2026-10-13-session-changefiles-select-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实测反馈：会话页悬浮变更文件弹窗头部的切换下拉「选择不了」。根因：radix Dialog 以 modal 模式打开时对 body 施加 `pointer-events: none`（仅在 DialogContent 子树内恢复），而 antd Select 下拉默认 portal 到 `document.body` 直挂节点——下拉项既点不动（pointer-events 被禁），点按又会被 radix 判定为弹窗外部交互（onPointerDownOutside）触发弹窗关闭，表现为「看得到、选不了」。方案：给 Select 配 `getPopupContainer={(trigger) => trigger.closest('[role="dialog"]') ?? document.body}`，把下拉 DOM 挂进 DialogContent（radix 弹窗节点，role="dialog"）内部——pointer-events 恢复、z 层级随弹窗、radix 不再视为 outside。顺带修标签文案：`is_thin` 徽标「轻量」与 thin 阶段映射「轻量变更」拼出「轻量·轻量变更」重复，按原型口径将 `current_stage === "thin"` 的阶段标签改为「干活中」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外 API/端点/数据格式变化。前端组件内部变化两处：①`SessionChangeFilesHover` 内部 antd Select 新增 `getPopupContainer` 配置（仅影响下拉 DOM 挂载位置）；②`stageLabel` 纯函数新增 `current_stage === "thin"` 分支返回「干活中」（返回值从「轻量变更」变更，仅本组件内消费——下拉项阶段 pill 与 Select 选项 label 两处）。组件对外 props（`workspaceId/sessionId/running`）零变化。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | Select 加 getPopupContainer 挂 DialogContent（closest role=dialog，兜底 body）+ stageLabel thin 分支「干活中」 |
| 修改 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | selectAntdOption 加下拉挂载位置守护断言 + 新增「干活中」用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——本次为同步 UI 修复（下拉挂载位置 + 纯函数返回值），无异步事件/消息输入面。
2. 并发写：不适用——下拉挂载为单次渲染期 DOM 配置；`stageLabel` 纯函数无共享状态；无并发写面。
3. 切换/生命周期：已覆盖——下拉随 DialogContent 卸载（弹窗关闭）自动移除，无残留；`getPopupContainer` 回调在每实例渲染时解析 `trigger.closest('[role="dialog"]')`，弹窗重开（新实例）重新解析，无跨实例悬挂引用。`closest` 未命中（理论兜底）回落 `document.body`，行为退回修复前（不劣化）。
4. 作用域：不适用——下拉挂载点限定在自身弹窗 DOM 子树内，多弹窗/多会话实例各自独立（`closest` 从各自 trigger 向上解析）；无跨工作区/跨仓数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`closest('[role="dialog"]')` 依赖 radix DialogContent 的 `role="dialog"` 语义稳定——若未来 shadcn Dialog 实现变更（role 改名/自定义 DialogContent 包裹层），兜底回落 body 会静默退回旧 bug。缓解：既有 vitest 用例已加「下拉 DOM 必须在 `[role="dialog"]` 内」守护断言（`selectAntdOption` 内），实现变更会测试转红而非静默。试过但放弃的方案：①改用 shadcn `ui/dropdown-menu`（radix Dropdown）替代 antd Select——违背 FRONTEND_PAGE_STYLE「控件类继续 antd」且交互重写面大；②radix Dialog 改 `modal={false}`——牺牲遮罩/焦点管理语义，影响面远超本 bug；③把下拉挂到 Select 的 `parentElement`（DialogHeader）——头部容器层级/裁剪风险高于 `closest(role=dialog)`（DialogContent 是 radix 明确标记的可交互子树）。
