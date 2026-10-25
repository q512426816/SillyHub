---
author: flow-machine-draft
created_at: 2026-10-25T02:38:35.812Z
---
# 设计记录（Design Record）— 2026-10-25-subagent-card-unify-panel

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

统一子代理卡片形态（用户裁决：去掉弹窗原地展开）：

1. **SubagentBlockView 删内联展开分支**：删除 open state、aria-expanded、children 原地渲染与
   progressLine 展开区；无面板上下文时渲染同款头部纯展示（无按钮语义）。生产宿主中仅剩
   回放体/悬浮助手等无 Provider 场景走纯展示（信息不丢，详情不可达为声明边界）。
2. **dialog 挂面板能力**：`session-panel-dialog` 增加 activeId 状态 +
   `SubagentPanelContext.Provider`（toggle/close/activeId，与 page 同一 context 值形状）；
   段解析复用 `findSegmentById` DFS；详情出口为弹窗内 antd Drawer（右侧滑出，
   `min(92vw, 420px)`，与 page 移动端 Drawer 同构），内嵌既有 `SubagentDetailPanel`。
   Drawer 而非固定右栏的原因：弹窗宽度不定，浮层不压缩消息流布局。
3. **卡片内嵌内部活动流（2026-10-25 用户澄清）**：`TurnLiveMarquee` 新增 `layout="inline"`
   变体（无 ml-9、w-full、h-7、贴卡片底色、独立 testid）与可选 `testId` prop；
   `SubagentBlockView` 两分支在头部下方渲染
   `<TurnLiveMarquee layout="inline" entries={deriveLiveMarqueeEntries(segment.children)} />`
   ——子代理内部过程在框内流动展示（运行中转圈/走秒/等待指示同外部机制），
   children 为空不渲染。外部会话跑马灯维持上轮的容器条目（名称/状态/时间）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SubagentBlockView`：删除内联展开行为（props 签名不变）；无 Provider 时由「可展开」变为「纯展示头部」。
- `session-panel-dialog.tsx`：新增内部子代理面板状态与 Drawer；无新增对外 props。
- `subagent-panel-context.ts` / `SubagentDetailPanel` / `session-panel-page.tsx`：**零改动**。
- 后端 API / daemon 协议 / `api-types.ts`：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。段解析走 DFS 活引用（SSE 更新即重渲 Drawer 内容），与 page 同构；段失效自动关闭。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无新增写面；activeId 为组件内状态。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。段失效 effect 自动关闭 Drawer；弹窗关闭即卸载；无 Provider 宿主退化为纯展示不崩。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。activeId 作用域为单个弹窗实例；context 为组件树局部。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：无 Provider 宿主（回放体、悬浮助手）失去子代理详情入口——头部信息仍完整，完整过程可去「进度」视图看；属用户裁决的统一取舍（已声明边界）。
- Drawer 覆盖在弹窗内容上而非并排：弹窗宽度有限（约 60vw~90vw），固定右栏会把消息流压到不可用；浮层是移动端已验证的同构方案。
- 放弃方案：① dialog 内固定右栏（布局压缩严重）；② 保留内联展开作为无 Provider 回退（用户明确要求去掉）；③ 把 page 右栏整套抽出共享 hook（改动面大，dialog 仅需 Drawer 出口，复制 20 行状态更小）。
