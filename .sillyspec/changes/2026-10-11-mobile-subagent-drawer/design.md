---
author: flow-machine-draft
created_at: 2026-10-10T16:14:36.914Z
---
# 设计记录（Design Record）— 2026-10-11-mobile-subagent-drawer

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实测：手机端会话页回显子代理内容时，内部会话整段内联刷进对话流。根因：SubagentPanelContext 的挂载条件显式排除 mobile（session-panel-page `hasSubagentPanelHost = !mobile && onOpenSubagent != null`，2026-09-15 设计「移动端窄屏不做右栏」），无 context 时 SubagentBlockView 回退内联展开分支；且手机页宿主不传 portal 专属三 props（openSubagentId/onOpenSubagent/onSubagentPanelClose），槽位状态无处承载。修法最小侵入：①mobile 恒挂 Provider——宿主未传时用组件内状态（mobileSubagentId）承载开合（会话切换清槽），openSubagent/closeSubagent 收敛为统一槽位出口（context / 失效自动关 / 右栏 ✕ / Drawer 关闭共用）；②mobile 命中段时右侧滑出 antd Drawer（size min(92vw, 420px)，与移动端轮次导航 Drawer 同款用法）内嵌既有 SubagentDetailPanel——与 PC 右栏同一组件零复制，嵌套子代理单槽位换内容天然生效。desktop 分支（portal 三 props / 悬浮宿主回退）逐字不动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- SessionPanel/SessionPanelPage 对外 props 零变化（三 props 语义不变，仅内部消费点收敛）。
- SubagentPanelContext 挂载条件变化：mobile 恒挂（此前恒不挂）；context 值 shape 不变。
- 后端/数据零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | mobile 内部槽位状态 + 统一槽位回调 + Provider 条件放宽 + mobile Drawer 渲染 |
| 新增 | frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx | 紧凑卡/Drawer 开关/toggle/零回归锚 3 用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。槽位 id 指向段 id（装配器稳定 key），SSE 更新重装配后段引用变化但 id 稳定；段失效（id 消失）由既有 effect 走统一关闭出口自动收口，迟到事件不产生悬挂状态。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：纯前端 UI 状态（单一组件内 useState），无共享写面；Drawer 开合与槽位状态同源。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：会话切换 effect 清 mobileSubagentId（Drawer 随 subagentPanelOpen=false 卸载）；destroyOnHidden 卸载面板内容；组件卸载随 React 状态机自然回收。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：槽位状态为组件实例私有、随 sessionId 重建；段解析限定本会话 displayTurns（既有口径）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：Drawer 内 SubagentDetailPanel 的 h-full 布局在 antd Drawer body 内的高度链——body 已设 flex column + 面板根 h-full（jsdom 无布局无法实测，真机验收项）；若异常退化方案为 body 加显式 height。
- 放弃方案「mobile 页宿主自持三 props（照 portal 装配）」：手机页无右栏可开，props 还得指回组件内状态，多一层无意义转发；放弃「mobile 复用内联展开 + 默认折叠」：信息密度仍高于紧凑卡且与 PC 形态不一致（用户点名要 PC 同构）。
- 已知残留：Drawer 无嵌套路由/返回键联动（移动端返回手势直接退页面而非关 Drawer）——后续可按需接 antd onClose 与历史栈。
