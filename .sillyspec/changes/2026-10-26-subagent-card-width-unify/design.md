---
author: flow-machine-draft
created_at: 2026-10-26T07:07:30.293Z
---
# 设计记录（Design Record）— 2026-10-26-subagent-card-width-unify

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

2026-10-25-session-tab-visual-unify 把 agent 侧文本类信息块（TextSegmentView/PreambleSegmentView/CompactSegmentView/TurnTriggerView/file 段容器/旧路径正文）统一到 `max-w-[calc(100%-120px)]`，但**过程类组件漏网**——用户 2026-10-26 实证：子代理卡片、进度视图工具调用行仍铺满整行。本变更补漏：turn-segment-views.tsx 内五个过程组件根容器统一加限宽——SubagentBlockView 两分支（`w-full self-stretch` → `w-full max-w-[calc(100%-120px)] self-start`，self-stretch 撤除防 flex 父容器 stretch 反噬，对齐 file 段容器先例）、TeamWorkerBlockView（同款）、ToolRowView / ThinkingRowView（根 div `w-full` → `w-full max-w-[calc(100%-120px)]`）、StderrRowView（根加 `max-w-[calc(100%-120px)]`，原本无 w-full 但在 flex-col 父容器里被 stretch 铺满）。

选 calc 相对值而非固定像素上限：弹窗版/整页版/移动端容器宽度不同，口径沿用已归档变更的裁决（固定值会在窄容器越界）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 组件对外 props 签名**零变化**（SubagentBlockView/TeamWorkerBlockView/ToolRowView/ThinkingRowView/StderrRowView 均只改根容器 className）。
- 对外可见行为：上述组件渲染宽度从铺满整行收敛为「整行 − 120px」，右缘不再贴行尾；其余交互（折叠/展开/点击/复制）零变化。
- 后端 API / daemon 协议 / api-types.ts：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。限宽是纯静态 className，与事件到达顺序无关；段数据流（SSE 装配/历史回放）不动。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 不适用——纯前端渲染层单文件改动，无共享可变状态。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。视图三态（对话/进度/轨迹）切换的渲染门控不动；限宽类在两分支共用，无状态残留。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。改动为组件树局部样式，无数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：既有测试若有锁定 `w-full self-stretch` 全宽形态的断言会假红（预计无——宽度断言只锁 TextSegmentView 的 calc 限宽）；视觉上子代理卡右缘留白变化属统一预期。
- 放弃方案一：连 TurnLiveMarquee bar 变体（`w-[min(100%,52rem)]` 胶囊条）一并统一——它是独立胶囊形态非信息块，用户未点名，避免面扩大，弃（如需另行变更）。
- 放弃方案二：限宽类抽公共常量（如 SEG_MAX_W）——Tailwind JIT 扫描需要完整类名字面量，抽常量会丢样式，必须保持字面量类名，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 五组件根容器加 max-w-[calc(100%-120px)]（子代理卡×2/团队卡 self-stretch→self-start；工具行/思考行根 div；警告行根） |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 补五组件根容器限宽断言；既有断言核对 |
