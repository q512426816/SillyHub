---
author: flow-machine-draft
created_at: 2026-10-13T02:34:28.398Z
---
# 设计记录（Design Record）— 2026-10-13-session-scroll-layout-storm

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

现象：系统 Chrome 上会话页连续滚动（触顶自动加载 / 回到开头后快速滚到底）100% 单标签白屏崩溃（renderer 被杀）；ZCode 内置 webview 实测同路径全部稳定（内存峰值 56MB、DOM ~5800 节点）。Chrome 对主线程长挂起的 tab 有查杀机制，webview 无——这是可复现性差异的解释。

根因（代码实证）：`session-panel-page.tsx` onScroll 程序性滚动分支（非 isTrusted）同步调用 `anchorPinRef.current?.()`——apply 读 `row.offsetTop`（强制同步布局）+ 写 `el.scrollTop`（再派发 scroll 事件）→ 事件反馈环；Chrome 真实滚轮高频事件（10-30+/秒，惯性滚动持续派发）叠加触顶翻页 prepend 的高度突变，每秒可打满数百次全文档强制布局（scrollHeight 3.6 万 px、content-visibility 懒布局放大单次成本），主线程持续打满 → Chrome 判挂杀 tab。

方案：最小侵入的 rAF 合帧——钉回重申从 scroll 事件同步执行改为 requestAnimationFrame 合帧（同帧多次 scroll 只排一个回调，句柄判重），每帧至多一次 apply；用户真实滚动（isTrusted）弃锚时同步取消挂起 rAF，effect cleanup 一并清理。不选「删除钉回重申」（ql-20260916-019 引入它修视口被未知写入者拉走的实际问题，删除是行为回归）；不选「IntersectionObserver 重构 activeTurn 联动」（改动面大、非本次根因——联动已有 rAF 节流）；轮询合并（单页 4 份 useDaemonMachines 独立轮询）是确认存在但独立的背景负载问题，另立变更。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无。组件对外 props、API 端点、hook 签名零变化；变化仅限 SessionPanel 内部 scroll 事件处理的执行时机（同步 → 下一帧，延迟至多 16ms 量级，钉回语义不变）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：成立。rAF 合帧对事件顺序不敏感——同帧冗余 scroll 合并为一次 apply，apply 现测 offsetTop（每次现测语义保留，见 2024 行注释），迟到的 scroll 事件只会在下一帧再排一个 rAF；锚定期 2.5s + 300ms watch interval 兜底语义不变。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：不适用：纯前端单线程事件模型，无共享可变状态；rAF 句柄判重（null 检查）保证同帧唯一排程，apply 内部已有 anchor 身份校验（`cur !== anchor` 防旧锚复活）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：安全。三处清理：isTrusted 弃锚分支取消挂起 rAF（用户接管后无迟到钉回）；滚动监听 effect cleanup（换会话/主体重挂）随现有 activeTurnRaf 取消同点一并取消；锚失效（apply 返回 false / until 过期）时 anchorPinRef 置空，挂起 rAF 回调读 null 自然 no-op。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：不适用：改动是滚动事件处理的执行时机，无数据读写面变化，不涉及跨工作区数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：rAF 合帧使钉回延迟至多一帧（16ms）——极端高惯性滚动下视口可能瞬时偏移一帧再被拉回，视觉上理论可感（单帧偏移 ≤ 一帧滚动量，watch interval 300ms 兜底跟进）；实测路径（webview 全场景回归）未观察到可感差异，Chrome 上的最终验证依赖用户复测（部署后由用户在原崩溃路径确认）。

试过但放弃的方案：① 删除钉回重申（anchorPinRef 机制）——回归 ql-20260916-019 修复的「未知写入者拉走视口」问题；② IntersectionObserver 重构 activeTurn 联动——联动已有 rAF 节流非风暴源，重构改动面大风险不成比例；③ 同时合并单页 4 份 useDaemonMachines 轮询——确认存在的独立问题，混入本变更扩大审查面，另立变更；④ 给 handleLoadEarlier 锚捕获段（全量行 rect 遍历）也做合帧——经核查它在 fetch await 之后、不在 scroll 事件栈内、每页至多一次，非反馈环成员，不动（禁止扩大改动面）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | onScroll 程序性滚动分支钉回改 rAF 合帧（anchorPinRafRef 新增：声明 + 合帧排程 + isTrusted 取消 + effect cleanup 取消） |
| 修改 | frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | 新增两用例：同帧多事件只排程一个 rAF（合帧）；isTrusted 弃锚同步取消挂起 rAF |
